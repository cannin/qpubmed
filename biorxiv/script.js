import { CATEGORIES } from './category.js';

const VERSION = 'v0.0.1';

const CONFIG = {
  biorxivBaseUrl: 'https://api.biorxiv.org/details/biorxiv',
  biorxivWebBaseUrl: 'https://www.biorxiv.org/content',
  openAlexAuthorsUrl: 'https://api.openalex.org/authors',
  openaiResponsesUrl: 'https://api.openai.com/v1/responses',
  openaiModel: 'gpt-5-mini',
  reasoningEffort: 'low',
  interval: 'd90',
  maxSummaryArticles: 5,
  maxAbstractChars: 5000,
  maxOutputTokens: 5000
};

/**
 * Get a query parameter from the current URL.
 * @param {string} param
 * @returns {string|null}
 */
function getQueryParam(param) {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(param);
}

/**
 * Resolve a required param from the URL or localStorage.
 * @param {string} param
 * @returns {string|null}
 */
function getParamValue(param) {
  let value = getQueryParam(param);

  if (value) {
    localStorage.setItem(param, value);
  } else {
    value = localStorage.getItem(param);
  }

  if (!value) {
    console.error(`ERROR: ${param} is not provided and not found in localStorage`);
  }

  return value;
}

/**
 * Resolve an interval label from the URL.
 * @returns {string}
 */
function resolveIntervalLabel() {
  const interval = getQueryParam('interval');
  if (interval) {
    return interval.trim();
  }
  const days = getQueryParam('days');
  const parsedDays = Number(days);
  if (Number.isFinite(parsedDays) && parsedDays > 0) {
    return `d${parsedDays}`;
  }
  return CONFIG.interval;
}

/**
 * Normalize a category string.
 * @param {string} value
 * @returns {string}
 */
function normalizeCategory(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ');
}

/**
 * Select a random category without mutating the array.
 * @returns {string}
 */
function pickRandomCategory() {
  if (!CATEGORIES.length) {
    return '';
  }
  const index = Math.floor(Math.random() * CATEGORIES.length);
  return CATEGORIES[index];
}

const CATEGORY_MAP = CATEGORIES.reduce((acc, category) => {
  acc[normalizeCategory(category)] = category;
  return acc;
}, {});

/**
 * Resolve a requested category to the canonical API value.
 * @param {string|null} requested
 * @returns {string}
 */
function resolveCategory(requested) {
  if (!requested) {
    return '';
  }
  const normalized = normalizeCategory(requested);
  return CATEGORY_MAP[normalized] || '';
}

/**
 * Fetch JSON with basic error handling.
 * @param {string} url
 * @returns {Promise<object>}
 */
async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP error: ${response.status}`);
  }
  return response.json();
}

/**
 * Build a bioRxiv content URL from DOI and version.
 * @param {string} doi
 * @param {string|number} version
 * @returns {string}
 */
function buildBiorxivUrl(doi, version) {
  const trimmed = normalizeDoi(doi);
  if (!trimmed) {
    return '';
  }
  const safeDoi = encodeURIComponent(trimmed).replace(/%2F/g, '/');
  const versionSuffix = version ? `v${version}` : '';
  return `${CONFIG.biorxivWebBaseUrl}/${safeDoi}${versionSuffix}`;
}

/**
 * Fetch bioRxiv articles for a category.
 * @param {string} category
 * @returns {Promise<object[]>}
 */
async function fetchBiorxivArticles(category, interval) {
  const url = `${CONFIG.biorxivBaseUrl}/${interval}?category=${encodeURIComponent(category)}`;
  const data = await fetchJson(url);
  const collection = Array.isArray(data?.collection) ? data.collection : [];
  const normalizedCategory = normalizeCategory(category);
  return collection.filter((item) => {
    const itemCategory = normalizeCategory(item?.category);
    return item?.title && item?.abstract && itemCategory === normalizedCategory;
  });
}

const openAlexCache = new Map();

/**
 * Fetch OpenAlex author stats for a corresponding author.
 * @param {string} authorName
 * @returns {Promise<{meanCitedness: number, displayName: string, openAlexId: string}>}
 */
async function fetchOpenAlexAuthorStats(authorName) {
  const trimmed = String(authorName || '').trim();
  if (!trimmed) {
    return { meanCitedness: 0, displayName: '', openAlexId: '' };
  }

  if (openAlexCache.has(trimmed)) {
    return openAlexCache.get(trimmed);
  }

  const params = new URLSearchParams({
    search: trimmed,
    per_page: '1',
    select: 'display_name,summary_stats,ids'
  });
  const url = `${CONFIG.openAlexAuthorsUrl}?${params.toString()}`;

  try {
    const data = await fetchJson(url);
    const result = Array.isArray(data?.results) ? data.results[0] : null;
    const meanCitedness = Number(result?.summary_stats?.['2yr_mean_citedness']);
    const stats = {
      meanCitedness: Number.isFinite(meanCitedness) ? meanCitedness : 0,
      displayName: result?.display_name || trimmed,
      openAlexId: result?.ids?.openalex || ''
    };
    openAlexCache.set(trimmed, stats);
    return stats;
  } catch (error) {
    console.warn('OpenAlex author lookup failed:', error);
    const fallback = { meanCitedness: 0, displayName: trimmed, openAlexId: '' };
    openAlexCache.set(trimmed, fallback);
    return fallback;
  }
}

/**
 * Attach OpenAlex stats to bioRxiv articles.
 * @param {object[]} articles
 * @returns {Promise<object[]>}
 */
async function attachAuthorStats(articles) {
  const tasks = articles.map(async (article) => {
    const stats = await fetchOpenAlexAuthorStats(article.author_corresponding);
    return {
      ...article,
      corresponding_author_stats: stats
    };
  });
  return Promise.all(tasks);
}

/**
 * Extract output text from an OpenAI Responses API payload.
 * @param {object} responseJson
 * @returns {string}
 */
function extractOutputText(responseJson) {
  if (responseJson.output_text && responseJson.output_text.trim()) {
    return responseJson.output_text.trim();
  }
  const output = responseJson.output;
  if (!Array.isArray(output)) {
    return '';
  }
  const parts = [];
  output.forEach((item) => {
    if (!item || typeof item !== 'object') {
      return;
    }
    const content = item.content;
    if (!Array.isArray(content)) {
      return;
    }
    content.forEach((chunk) => {
      if (!chunk || typeof chunk !== 'object') {
        return;
      }
      if ((chunk.type === 'output_text' || chunk.type === 'summary_text') && typeof chunk.text === 'string') {
        const trimmed = chunk.text.trim();
        if (trimmed) {
          parts.push(trimmed);
        }
      }
    });
  });
  return parts.join('\n').trim();
}

/**
 * Normalize a DOI by stripping trailing version markers.
 * @param {string} doi
 * @returns {string}
 */
function normalizeDoi(doi) {
  return String(doi || '')
    .trim()
    .replace(/[\"'>]+$/g, '')
    .replace(/[).,;]+$/g, '')
    .replace(/v\d+$/i, '');
}

/**
 * Escape HTML special characters.
 * @param {string} value
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Normalize summary into paragraph strings.
 * @param {string} text
 * @returns {string[]}
 */
function normalizeSummaryParagraphs(text) {
  const summaryMatches = Array.from(
    text.matchAll(/<p[^>]*class=["']summary["'][^>]*>([\s\S]*?)<\/p>/gi)
  );
  if (summaryMatches.length > 0) {
    return summaryMatches.map((match) => match[1].trim()).filter(Boolean);
  }

  const paragraphMatches = Array.from(text.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi));
  if (paragraphMatches.length > 0) {
    return paragraphMatches.map((match) => match[1].trim()).filter(Boolean);
  }

  const split = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_`>~-]/g, ' ')
    .split(/\n{2,}/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (split.length > 0) {
    return split;
  }

  const trimmed = text.trim();
  return trimmed ? [trimmed] : [];
}

/**
 * Build a DOI anchor link.
 * @param {string} doi
 * @param {string|number} version
 * @returns {string}
 */
function buildDoiLink(doi, version) {
  const normalizedDoi = normalizeDoi(doi);
  const url = buildBiorxivUrl(normalizedDoi, version);
  if (!url) {
    return '';
  }
  return `<a href="${url}" target="_blank" rel="noopener">DOI: ${escapeHtml(normalizedDoi)}</a>`;
}

/**
 * Extract DOIs from a summary string.
 * @param {string} text
 * @returns {string[]}
 */
function extractDois(text) {
  const found = [];
  const seen = new Set();
  const patterns = [
    /DOI:\s*(10\.\d{4,9}\/[^\s<;),]+)/gi,
    /https?:\/\/www\.biorxiv\.org\/content\/(10\.\d{4,9}\/[^\s<;),]+)(?:v\d+)?/gi
  ];

  patterns.forEach((regex) => {
    let match = regex.exec(text);
    while (match) {
      const raw = match[1] || '';
      const doi = normalizeDoi(raw);
      const key = doi.toLowerCase();
      if (doi && !seen.has(key)) {
        seen.add(key);
        found.push(doi);
      }
      match = regex.exec(text);
    }
  });

  return found;
}

/**
 * Append missing DOIs to the final paragraph list.
 * @param {string[]} paragraphs
 * @param {Array<{doi: string, version: string|number}>} missingDois
 * @returns {string[]}
 */
function appendMissingDois(paragraphs, missingDois) {
  if (!missingDois.length) {
    return paragraphs;
  }
  const citations = missingDois
    .map((item) => buildDoiLink(item.doi, item.version))
    .filter(Boolean)
    .join('; ');
  const suffix = ` (${citations}).`;
  const updated = paragraphs.slice();
  if (updated.length === 0) {
    updated.push(`Summary${suffix}`);
  } else {
    const lastIndex = updated.length - 1;
    updated[lastIndex] = `${updated[lastIndex].trim()}${suffix}`;
  }
  return updated;
}

/**
 * Build HTML for the References section.
 * @param {string[]} doisInOrder
 * @param {Object<string, object>} articlesByDoi
 * @param {number} papersFound
 * @param {number} papersSummarized
 * @returns {string}
 */
function buildBibliographyHtml(
  doisInOrder,
  articlesByDoi,
  papersFound,
  papersSummarized,
  intervalLabel
) {
  if (!doisInOrder.length) {
    return '';
  }
  const foundCount = Number.isFinite(papersFound) ? papersFound : null;
  const summarizedCount = Number.isFinite(papersSummarized) ? papersSummarized : null;
  const intervalSuffix = intervalLabel ? `; ${escapeHtml(intervalLabel)} interval` : '';
  const headingSuffix = (foundCount !== null && summarizedCount !== null)
    ? ` (${foundCount} papers found; ${summarizedCount} summarized${intervalSuffix})`
    : '';
  const entries = doisInOrder
    .map((doi) => {
      const normalizedDoi = normalizeDoi(doi);
      const article = articlesByDoi[normalizedDoi.toLowerCase()];
      const title = article?.title ? escapeHtml(article.title) : `DOI ${escapeHtml(normalizedDoi)}`;
      const url = buildBiorxivUrl(normalizedDoi, article?.version);
      const corresponding = article?.author_corresponding
        ? escapeHtml(article.author_corresponding)
        : '';
      const citedness = Number.isFinite(article?.corresponding_author_stats?.meanCitedness)
        ? article.corresponding_author_stats.meanCitedness
        : null;
      const citednessLabel = citedness === null ? '' : ` (${citedness.toFixed(1)} 2yr_mean_citedness)`;
      const institute = article?.author_corresponding_institution
        ? escapeHtml(article.author_corresponding_institution)
        : '';
      const date = article?.date ? escapeHtml(article.date) : '';
      const category = article?.category ? escapeHtml(article.category) : '';

      const infoParts = [];
      if (corresponding) {
        infoParts.push(`${corresponding}${citednessLabel}.`);
      }

      if (institute || date) {
        const instituteDate = [institute, date].filter(Boolean).join(', ');
        infoParts.push(`${instituteDate}.`);
      }

      if (category) {
        infoParts.push(`${category}.`);
      }

      const titleHtml = url
        ? `<a href="${url}" target="_blank" rel="noopener">${title}</a>`
        : title;
      const suffix = infoParts.length ? ` ${infoParts.join(' ')}` : '';

      return `<p class="reference-entry">DOI: ${escapeHtml(normalizedDoi)} - ${titleHtml}.${suffix}</p>`;
    })
    .join('');
  return `<h3 class="references-title">References${headingSuffix}</h3>${entries}`;
}

/**
 * Build a GPT summary from abstracts.
 * @param {object} options
 * @param {string} options.apiKey
 * @param {string} options.category
 * @param {object[]} options.articles
 * @param {number} options.papersFound
 * @param {number} options.papersSummarized
 * @returns {Promise<string>}
 */
async function buildGptSummary({
  apiKey,
  category,
  articles,
  papersFound,
  papersSummarized,
  intervalLabel
}) {
  if (!apiKey) {
    throw new Error('Missing OpenAI API key.');
  }

  const papersForPrompt = articles.map((article) => ({
    title: article.title,
    corresponding_author: article.author_corresponding,
    institution: article.author_corresponding_institution,
    date: article.date,
    doi: normalizeDoi(article.doi),
    version: article.version,
    biorxiv_url: buildBiorxivUrl(normalizeDoi(article.doi), article.version),
    abstract: String(article.abstract || '').replace(/\s+/g, ' ').trim().slice(0, CONFIG.maxAbstractChars)
  }));

  const systemPrompt = `You write an RSS description as HTML.
Output MUST be 1 to 3 short paragraphs wrapped in <p class="summary"> tags only.
No bibliography, no headings, no lists (<ul>/<ol>/<li>), no Markdown.
Rules:
- Use only the provided abstracts.
- Do not add facts not present in the abstracts.
- Do not mention citation counts, rankings, or OpenAlex.
- Connect related papers instead of summarizing each paper separately.
- Do not put all citations after a single sentence; spread them across sentences.
- Sentences should cite a maximum of 4 DOIs; more than 4 DOIs split into other sentences.
- The majority of sentences should cite at least 2 DOIs.
- Total length under 220 words.
- Cite EVERY paper at least once using inline citations at sentence ends.
- Sentences should never be composed of only citations.
- Use base DOIs only; strip any trailing version markers like v1, v2 from the DOI label text.
- Citation format must use linked DOIs like:
  (<a href="https://www.biorxiv.org/content/10.1101/2021.04.14.439861v1" target="_blank" rel="noopener">DOI: 10.1101/2021.04.14.439861</a>).
- Do not include hyperlinks other than DOI citation links.
- Do not include a references section; it will be appended automatically.
- Do not include a Recent articles section.
- References are appended after the summary using:
  <h3 class="references-title">References</h3>
  and <p class="reference-entry">DOI: 10.1101/... - Title. bioRxiv.</p>`;

  const userPrompt = JSON.stringify(
    {
      category,
      papers: papersForPrompt
    },
    null,
    2
  );

  const body = {
    model: CONFIG.openaiModel,
    max_output_tokens: CONFIG.maxOutputTokens,
    reasoning: { effort: CONFIG.reasoningEffort },
    input: [
      { role: 'system', content: [{ type: 'input_text', text: systemPrompt }] },
      { role: 'user', content: [{ type: 'input_text', text: userPrompt }] }
    ],
    text: { verbosity: 'low' }
  };

  const response = await fetch(CONFIG.openaiResponsesUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed with ${response.status}`);
  }

  const json = await response.json();
  let text = extractOutputText(json);
  if (!text) {
    throw new Error('OpenAI summary was empty.');
  }

  if (text.startsWith('```')) {
    text = text.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
  }

  text = text.replace(/\r\n/g, '\n');
  text = text.replace(/<\/?(ul|ol|li|h[1-6])[^>]*>/gi, ' ');
  text = text.split(/<p[^>]*>\s*References\s*<\/p>/i)[0].trim();
  text = text.split(/^\s*References\s*$/im)[0].trim();

  const paragraphs = normalizeSummaryParagraphs(text);
  if (!paragraphs.length) {
    throw new Error('OpenAI summary could not be parsed into paragraphs.');
  }

  const doiItems = articles
    .map((article) => ({
      doi: normalizeDoi(article.doi),
      version: article.version
    }))
    .filter((item) => item.doi);
  const lowerText = paragraphs.join(' ').toLowerCase();
  const missingDois = doiItems.filter((item) => !lowerText.includes(item.doi.toLowerCase()));
  const finalParagraphs = appendMissingDois(paragraphs, missingDois);

  const summaryHtml = finalParagraphs
    .filter((paragraph) => paragraph.trim())
    .map((paragraph) => `<p class="summary">${paragraph}</p>`)
    .join('');

  const doisInOrder = extractDois(finalParagraphs.join(' '));
  const articlesByDoi = articles.reduce((acc, article) => {
    const normalizedDoi = normalizeDoi(article.doi);
    if (normalizedDoi) {
      acc[normalizedDoi.toLowerCase()] = article;
    }
    return acc;
  }, {});

  const bibliographyHtml = buildBibliographyHtml(
    doisInOrder,
    articlesByDoi,
    papersFound,
    papersSummarized,
    intervalLabel
  );

  return summaryHtml + bibliographyHtml;
}

/**
 * Initialize the page.
 * @returns {Promise<void>}
 */
async function init() {
  document.title = document.title.replace('$VERSION', VERSION);
  const apiKey = getParamValue('apikey');
  const status = document.getElementById('status');
  const resultsEl = document.getElementById('results');
  const intervalLabel = resolveIntervalLabel();

  if (!apiKey) {
    status.innerHTML = '<span class="error">Missing apikey. Provide ?apikey=YOUR_KEY in the URL.</span>';
    return;
  }

  const requestedCategory = getQueryParam('category');
  const resolvedCategory = resolveCategory(requestedCategory);
  const category = resolvedCategory || pickRandomCategory();
  const displayCategory = normalizeCategory(category);

  status.innerHTML = `<span>Loading bioRxiv category: <strong>${displayCategory}</strong>...</span>`;
  resultsEl.innerHTML = '';
  const section = document.createElement('section');
  section.className = 'rssItem';
  const heading = document.createElement('h2');
  heading.textContent = `${displayCategory} (category)`;
  section.appendChild(heading);
  const desc = document.createElement('div');
  desc.className = 'desc';
  desc.innerHTML = '<p class="summary">Loading selection...</p>';
  section.appendChild(desc);
  resultsEl.appendChild(section);

  try {
    const rawArticles = await fetchBiorxivArticles(category, intervalLabel);
    if (!rawArticles.length) {
      status.innerHTML = '<span class="error">No articles found for this category.</span>';
      desc.innerHTML = '<p class="summary">No articles found.</p>';
      return;
    }

    const withStats = await attachAuthorStats(rawArticles);
    const topArticles = [...withStats]
      .sort((a, b) => {
        const aValue = a?.corresponding_author_stats?.meanCitedness ?? 0;
        const bValue = b?.corresponding_author_stats?.meanCitedness ?? 0;
        return bValue - aValue;
      })
      .slice(0, CONFIG.maxSummaryArticles);

    const summaryHtml = await buildGptSummary({
      apiKey,
      category: displayCategory,
      articles: topArticles,
      papersFound: rawArticles.length,
      papersSummarized: topArticles.length,
      intervalLabel
    });
    desc.innerHTML = summaryHtml;

    status.textContent = '';
  } catch (error) {
    console.error('ERROR:', error);
    status.innerHTML = `<span class="error">Error: ${error.message || 'Unknown error'}</span>`;
    desc.innerHTML = `<p class="summary error">Error: ${escapeHtml(error.message || 'Unknown error')}</p>`;
  }
}

window.onload = function onLoad() {
  init();
};
