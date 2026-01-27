import { INTERESTS } from './interests.js';

const APP_VERSION = '0.0.1';

const CONFIG = {
  pubmedBaseUrl: 'https://pubmed.ncbi.nlm.nih.gov',
  eutilsBaseUrl: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils',
  openaiResponsesUrl: 'https://api.openai.com/v1/responses',
  openaiModel: 'gpt-5-mini',
  days: 30,
  maxArticles: 10,
  randomInterests: 1,
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
 * Resolve an optional param from the URL with a fallback value.
 * @param {string} param
 * @param {string} fallback
 * @returns {string}
 */
function getOptionalParam(param, fallback) {
  const value = getQueryParam(param);
  if (value) {
    return value;
  }
  return fallback;
}

/**
 * Resolve an optional param from the URL or localStorage with a fallback value.
 * @param {string} param
 * @param {string|number} fallback
 * @returns {string|number}
 */
function getStoredOptionalParam(param, fallback) {
  const value = getQueryParam(param);
  if (value) {
    localStorage.setItem(param, value);
    return value;
  }
  const stored = localStorage.getItem(param);
  if (stored) {
    return stored;
  }
  return fallback;
}

/**
 * Parse and clamp a numeric parameter.
 * @param {number|string} value
 * @param {number} fallback
 * @param {number} minValue
 * @returns {number}
 */
function normalizeNumberParam(value, fallback, minValue) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(parsed, minValue);
}

/**
 * Select random items without mutating the original array.
 * @template T
 * @param {T[]} items
 * @param {number} count
 * @returns {T[]}
 */
function pickRandomItems(items, count) {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.min(count, copy.length));
}

/**
 * Format a date for PubMed [PDat] query usage.
 * @param {Date} date
 * @returns {string}
 */
function formatPDat(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd}`;
}

/**
 * Format a date as YYYY-MM-DD.
 * @param {Date} date
 * @returns {string}
 */
function formatIsoDate(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Build a PubMed date range with a start and end date.
 * @param {number} daysBack
 * @returns {{range: string, start: Date, end: Date}}
 */
function buildDateRange(daysBack) {
  const today = new Date();
  const past = new Date();
  past.setDate(today.getDate() - daysBack);
  return {
    range: `("${formatPDat(past)}"[PDat] : "${formatPDat(today)}"[PDat])`,
    start: past,
    end: today
  };
}

/**
 * Ensure a query includes the hasabstract filter.
 * @param {string} pubmedQuery
 * @returns {string}
 */
function ensureHasAbstract(pubmedQuery) {
  if (pubmedQuery.toLowerCase().includes('hasabstract')) {
    return pubmedQuery;
  }
  return `(${pubmedQuery}) AND hasabstract`;
}

/**
 * Build a PubMed query from a topic or journal interest.
 * @param {{query: string, type: string}} interest
 * @returns {string}
 */
function buildPubmedQuery(interest) {
  if (interest.type === 'journal') {
    return ensureHasAbstract(`("${interest.query}"[jour]) AND (journal article[pt])`);
  }
  return ensureHasAbstract(`(${interest.query})`);
}

/**
 * Build a PubMed search link that mirrors the query window.
 * @param {string} pubmedQuery
 * @param {number} days
 * @returns {string}
 */
function buildPubmedSearchLink(pubmedQuery, days) {
  const today = new Date();
  const start = new Date();
  start.setDate(today.getDate() - days);
  const term = `(${pubmedQuery}) AND ("${formatIsoDate(start)}"[pdat] : "${formatIsoDate(today)}"[pdat])`;
  const params = new URLSearchParams({ term });
  return `${CONFIG.pubmedBaseUrl}/?${params.toString()}`;
}

/**
 * Fetch and parse XML from a URL.
 * @param {string} url
 * @returns {Promise<Document>}
 */
async function fetchXml(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP error: ${response.status}`);
  }
  const text = await response.text();
  const parser = new DOMParser();
  return parser.parseFromString(text, 'application/xml');
}

/**
 * Convert a month name or number to a two-digit string.
 * @param {string} value
 * @returns {string}
 */
function monthToNumber(value) {
  if (!value) {
    return '';
  }
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    return trimmed.padStart(2, '0');
  }
  const map = {
    jan: '01',
    feb: '02',
    mar: '03',
    apr: '04',
    may: '05',
    jun: '06',
    jul: '07',
    aug: '08',
    sep: '09',
    oct: '10',
    nov: '11',
    dec: '12'
  };
  const key = trimmed.slice(0, 3).toLowerCase();
  return map[key] || '';
}

/**
 * Extract a PubMed date string from an article node.
 * @param {Element} articleNode
 * @returns {string}
 */
function parsePubDate(articleNode) {
  const articleDate = articleNode.querySelector('ArticleDate');
  const dateNode = articleDate || articleNode.querySelector('Journal > JournalIssue > PubDate');
  if (!dateNode) {
    return '';
  }
  const year = dateNode.querySelector('Year')?.textContent?.trim() || '';
  const month = monthToNumber(dateNode.querySelector('Month')?.textContent || '');
  const day = (dateNode.querySelector('Day')?.textContent || '').trim();
  if (!year) {
    return '';
  }
  if (month && day) {
    return `${year}-${month}-${day.padStart(2, '0')}`;
  }
  if (month) {
    return `${year}-${month}`;
  }
  return year;
}

/**
 * Extract author names from a PubMed article node.
 * @param {Element} articleNode
 * @returns {string}
 */
function parseAuthors(articleNode) {
  const authorNodes = Array.from(articleNode.querySelectorAll('AuthorList > Author'));
  const authors = authorNodes
    .map((author) => {
      const lastName = author.querySelector('LastName')?.textContent?.trim() || '';
      const initials = author.querySelector('Initials')?.textContent?.trim() || '';
      const foreName = author.querySelector('ForeName')?.textContent?.trim() || '';
      if (lastName && initials) {
        return `${lastName} ${initials}`;
      }
      if (lastName && foreName) {
        return `${lastName} ${foreName}`;
      }
      if (lastName) {
        return lastName;
      }
      return '';
    })
    .filter(Boolean);
  return authors.join(', ');
}

/**
 * Parse a PubMed XML article into a normalized object.
 * @param {Element} articleNode
 * @returns {{pmid: string, title: string, journal: string, abstract: string, authors: string, pubDate: string, pubmedUrl: string}}
 */
function parsePubmedArticle(articleNode) {
  const pmid = articleNode.querySelector('PMID')?.textContent?.trim() || '';
  const title = articleNode.querySelector('ArticleTitle')?.textContent?.trim() || '';
  const journal = articleNode.querySelector('Journal > Title')?.textContent?.trim() || '';
  const abstractParts = Array.from(articleNode.querySelectorAll('AbstractText'))
    .map((node) => node.textContent.trim())
    .filter(Boolean);
  const abstract = abstractParts.join(' ');
  const authors = parseAuthors(articleNode);
  const pubDate = parsePubDate(articleNode);

  return {
    pmid,
    title,
    journal,
    abstract,
    authors,
    pubDate,
    pubmedUrl: pmid ? `${CONFIG.pubmedBaseUrl}/${pmid}/` : ''
  };
}

/**
 * Fetch recent PubMed articles for an interest.
 * @param {{query: string, type: string}} interest
 * @param {number} days
 * @param {number} maxArticles
 * @returns {Promise<{articles: Array<{pmid: string, title: string, journal: string, abstract: string, authors: string, pubDate: string, pubmedUrl: string}>, pubmedQuery: string, dateRange: {range: string, start: Date, end: Date}, searchLink: string}>}
 */
async function fetchPubmedArticles(interest, days, maxArticles) {
  const pubmedQuery = buildPubmedQuery(interest);
  const dateRange = buildDateRange(days);
  const fullQuery = `(${pubmedQuery}) AND ${dateRange.range}`;
  const esearchUrl = `${CONFIG.eutilsBaseUrl}/esearch.fcgi?db=pubmed&retmax=${maxArticles}&term=${encodeURIComponent(fullQuery)}`;

  const esearchXml = await fetchXml(esearchUrl);
  const pmids = Array.from(esearchXml.querySelectorAll('Id')).map((node) => node.textContent.trim());

  if (pmids.length === 0) {
    return {
      articles: [],
      pubmedQuery,
      dateRange,
      searchLink: buildPubmedSearchLink(pubmedQuery, days)
    };
  }

  const efetchUrl = `${CONFIG.eutilsBaseUrl}/efetch.fcgi?db=pubmed&retmode=xml&id=${pmids.join(',')}`;
  const efetchXml = await fetchXml(efetchUrl);
  const articles = Array.from(efetchXml.querySelectorAll('PubmedArticle'))
    .map((node) => parsePubmedArticle(node))
    .filter((article) => article.pmid && article.abstract);

  return {
    articles,
    pubmedQuery,
    dateRange,
    searchLink: buildPubmedSearchLink(pubmedQuery, days)
  };
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
 * Build a PMID anchor link.
 * @param {string} pmid
 * @returns {string}
 */
function buildPmidLink(pmid) {
  return `<a href="${CONFIG.pubmedBaseUrl}/${pmid}/" target="_blank">PMID: ${pmid}</a>`;
}

/**
 * Extract PMIDs from a text string.
 * @param {string} text
 * @returns {string[]}
 */
function extractPmids(text) {
  const regex = /(https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)\/)|\bPMID:\s*(\d+)\b/gi;
  const found = [];
  const seen = new Set();
  let match = regex.exec(text);
  while (match) {
    const pmid = match[2] || match[3];
    if (pmid && !seen.has(pmid)) {
      seen.add(pmid);
      found.push(pmid);
    }
    match = regex.exec(text);
  }
  return found;
}

/**
 * Append missing PMIDs to the final paragraph list.
 * @param {string[]} paragraphs
 * @param {string[]} missingPmids
 * @returns {string[]}
 */
function appendMissingPmids(paragraphs, missingPmids) {
  if (!missingPmids.length) {
    return paragraphs;
  }
  const citations = missingPmids.map((pmid) => buildPmidLink(pmid)).join('; ');
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
 * Normalize summary HTML into paragraph strings.
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

  const paragraphMatches = Array.from(
    text.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)
  );
  if (paragraphMatches.length > 0) {
    return paragraphMatches.map((match) => match[1].trim()).filter(Boolean);
  }

  const split = text
    .split(/\n{2,}/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (split.length > 0) {
    return split;
  }

  return text.trim() ? [text.trim()] : [];
}

/**
 * Build HTML for the References section.
 * @param {string[]} pmidsInOrder
 * @param {Object<string, {title?: string, journal?: string}>} articlesByPmid
 * @returns {string}
 */
function buildBibliographyHtml(pmidsInOrder, articlesByPmid) {
  if (!pmidsInOrder.length) {
    return '';
  }
  const entries = pmidsInOrder
    .map((pmid) => {
      const article = articlesByPmid[pmid];
      const title = article?.title ? escapeHtml(article.title) : `PMID ${pmid}`;
      const journal = article?.journal ? escapeHtml(article.journal) : '';
      const url = `${CONFIG.pubmedBaseUrl}/${pmid}/`;
      if (journal) {
        return `<p class="reference-entry">PMID: ${pmid} - <a href="${url}" target="_blank">${title}</a>. ${journal}.</p>`;
      }
      return `<p class="reference-entry">PMID: ${pmid} - <a href="${url}" target="_blank">${title}</a>.</p>`;
    })
    .join('');
  return `<h3 class="references-title">References</h3>${entries}`;
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
 * Build a GPT summary with PMID-linked citations.
 * @param {object} options
 * @param {string} options.apiKey
 * @param {string} options.query
 * @param {number} options.days
 * @param {Array<{pmid: string, title: string, journal: string, abstract: string, authors: string, pubDate: string, pubmedUrl: string}>} options.articles
 * @param {string} options.model
 * @param {boolean} options.rankedByCitations
 * @returns {Promise<string>}
 */
async function buildGptSummary({ apiKey, query, days, articles, model, rankedByCitations }) {
  const papersForPrompt = articles.map((article) => {
    const abstract = article.abstract.replace(/\s+/g, ' ').trim().slice(0, CONFIG.maxAbstractChars);
    return {
      pmid: article.pmid,
      title: article.title,
      journal: article.journal,
      date: article.pubDate,
      authors: article.authors,
      abstract
    };
  });

  const rankingNote = rankedByCitations
    ? 'Papers are already selected and ranked; do not mention citation counts.'
    : 'Papers are already selected; do not mention citation counts.';

  const systemPrompt = `You write an RSS description as HTML.
Output MUST be 1 to 3 short paragraphs wrapped in <p class="summary"> tags only.
No bibliography, no headings, no lists (<ul>/<ol>/<li>), no Markdown.
Rules:
- No em dashes.
- Use only the provided abstracts; do not add facts.
- Never provide a list of articles or bullet points outside the References section.
- ${rankingNote}
- Do not mention OpenAlex or citation counts.
- Connect related papers instead of summarizing each paper separately.
- Do not put all citations after a single sentence; spread them across sentences.
- Sentences should cite a maximum of 3 PMIDs; more than 3 split into other sentences.
- Connect the papers by some meaningful topic (e.g., studies in different age groups, methological papers, mouse studies, etc.)
- Total length less than 500 words.
- Cite EVERY paper at least once using inline citations at sentence ends.
- Sentences should never be composed of only citations.
- Citation format must use linked PMIDs like:
  (<a href="https://pubmed.ncbi.nlm.nih.gov/12345/" target="_blank">PMID: 12345</a>;
   <a href="https://pubmed.ncbi.nlm.nih.gov/67890/" target="_blank">PMID: 67890</a>).
- Do not include hyperlinks other than PMID citation links.
- Do not include a references section; it will be appended automatically.
- Do not include a Recent articles section.
- References are appended after the summary using:
  <p class="references-title">References</p>
  and <p class="reference-entry">PMID: 12345 - Title. Journal.</p>
Example:
<p class="summary">Recent ACC studies link rare clinical phenotypes and germline
predisposition to evolving molecular diagnostics and preclinical models: a first-reported
ectopic pancreatic ACC emphasizes unusual presentations
(<a href="https://pubmed.ncbi.nlm.nih.gov/41571237/" target="_blank">PMID: 41571237</a>;
<a href="https://pubmed.ncbi.nlm.nih.gov/41542508/" target="_blank">PMID: 41542508</a>).</p>`;

  const userPrompt = JSON.stringify(
    {
      query,
      days,
      papers: papersForPrompt
    },
    null,
    2
  );
  console.log('LLM system prompt:', systemPrompt);
  console.log('LLM user prompt:', userPrompt);
  if (!apiKey) {
    throw new Error('Missing OpenAI API key.');
  }

  const body = {
    model,
    max_output_tokens: CONFIG.maxOutputTokens,
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
  console.log('LLM raw output:', text);

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

  const pmids = articles.map((article) => article.pmid).filter(Boolean);
  const mentioned = extractPmids(paragraphs.join(' '));
  const missing = pmids.filter((pmid) => !mentioned.includes(pmid));
  const finalParagraphs = appendMissingPmids(paragraphs, missing);

  const summaryHtml = finalParagraphs
    .filter((paragraph) => paragraph.trim())
    .map((paragraph) => `<p class="summary">${paragraph}</p>`)
    .join('');

  const pmidsInOrder = extractPmids(finalParagraphs.join(' '));
  const articlesByPmid = articles.reduce((acc, article) => {
    acc[article.pmid] = article;
    return acc;
  }, {});

  const bibliographyHtml = buildBibliographyHtml(pmidsInOrder, articlesByPmid);
  return summaryHtml + bibliographyHtml;
}

/**
 * Render a topic section with summary content and a PubMed link.
 * @param {{query: string, type: string}} interest
 * @param {string} apiKey
 * @param {number} days
 * @param {number} maxArticles
 * @param {string} model
 * @param {HTMLElement} container
 * @returns {Promise<void>}
 */
async function renderInterest(interest, apiKey, days, maxArticles, model, container) {
  const section = document.createElement('section');
  section.className = 'rssItem';

  const heading = document.createElement('h2');
  heading.textContent = `${interest.query} (${interest.type})`;
  section.appendChild(heading);

  const metaRow = document.createElement('div');
  metaRow.className = 'meta-row';

  const time = document.createElement('time');
  time.textContent = `Last ${days} days`;
  metaRow.appendChild(time);

  section.appendChild(metaRow);

  const desc = document.createElement('div');
  desc.className = 'desc';
  desc.innerHTML = '<p class="summary">Loading summary...</p>';
  section.appendChild(desc);

  const articlesWrap = document.createElement('div');
  section.appendChild(articlesWrap);

  container.appendChild(section);

  try {
    const { articles, pubmedQuery, dateRange, searchLink } = await fetchPubmedArticles(
      interest,
      days,
      maxArticles
    );

    const rangeLabel = `${formatIsoDate(dateRange.start)} to ${formatIsoDate(dateRange.end)}`;
    time.textContent = rangeLabel;

    if (!articles.length) {
      desc.innerHTML = '<p class="summary">No recent articles with abstracts found.</p>';
      return;
    }

    const summaryHtml = await buildGptSummary({
      apiKey,
      query: pubmedQuery,
      days,
      articles,
      model,
      rankedByCitations: false
    });

    desc.innerHTML = summaryHtml;

    const searchLinkEl = document.createElement('a');
    searchLinkEl.href = searchLink;
    searchLinkEl.target = '_blank';
    searchLinkEl.textContent = 'Open PubMed search';
    articlesWrap.appendChild(searchLinkEl);
  } catch (error) {
    console.error('ERROR: Failed to load interest', error);
    desc.innerHTML = `<p class="summary error">Error: ${escapeHtml(error.message || 'Unknown error')}</p>`;
  }
}

/**
 * Initialize the page on load.
 * @returns {void}
 */
window.onload = function onLoad() {
  const apiKey = getParamValue('apikey');
  const days = normalizeNumberParam(getStoredOptionalParam('days', CONFIG.days), CONFIG.days, 1);
  const maxArticles = normalizeNumberParam(
    getStoredOptionalParam('maxArticles', CONFIG.maxArticles),
    CONFIG.maxArticles,
    1
  );
  const model = getOptionalParam('model', CONFIG.openaiModel);
  const typeFilter = getOptionalParam('type', '').toLowerCase();
  const queryOverride = getOptionalParam('query', '').trim();

  const status = document.getElementById('status');
  const results = document.getElementById('results');

  if (!apiKey) {
    status.innerHTML = '<span class="error">Missing apikey. Provide ?apikey=YOUR_KEY in the URL.</span>';
    return;
  }

  const filteredInterests = ['topic', 'journal'].includes(typeFilter)
    ? INTERESTS.filter((item) => item.type === typeFilter)
    : INTERESTS;
  if (!filteredInterests.length) {
    status.innerHTML = '<span class="error">No interests match the requested type.</span>';
    return;
  }
  const selected = queryOverride
    ? [{ query: queryOverride, type: 'topic' }]
    : pickRandomItems(filteredInterests, CONFIG.randomInterests);
  status.textContent = '';

  const tasks = selected.map((interest) =>
    renderInterest(interest, apiKey, days, maxArticles, model, results)
  );

  Promise.all(tasks)
    .catch((error) => {
      console.error('ERROR: Failed to render results', error);
      status.innerHTML = '<span class="error">Failed to load all results.</span>';
    });
};
