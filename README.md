# PubMed Summaries

Client-side PubMed summarizer that queries recent articles and generates a brief summary with PMID citations.

## Usage

Open `index.html` in a browser and provide your OpenAI key as a URL parameter once:

```
index.html?apikey=YOUR_KEY
```

The key is stored in `localStorage` for subsequent visits.

You can also copy `.env.js.example` to `.env.js` and set `OPENAI_API_KEY` for local use (file:// or localhost).

## Query Parameters

- `apikey` (required): OpenAI API key. Stored in `localStorage` after first use.
- `query` (optional): Overrides random interest selection with a custom PubMed search query.
- `type` (optional): Filters interests to `topic` or `journal` before selection.
- `days` (optional): Lookback window in days for PubMed search (default: 30). Stored in `localStorage`.
- `maxSummaryArticles` (optional): Max articles summarized per query (default: 10). Stored in `localStorage`.
- `maxRetrievalArticles` (optional): Max PubMed articles retrieved per query (default: 25). Stored in `localStorage`.
- `minCited` (optional): Minimum OpenAlex cited-by count required to summarize (default: 0).
- `model` (optional): OpenAI model name (default: `gpt-5-mini`).
- `reasoningEffort` (optional): OpenAI reasoning effort setting (default: `low`). Options: `minimal` (10 seconds to response; poor quality), `low` (15-30s), `medium` (30-60s), `high` (???; errors).

## Examples

```
index.html?apikey=YOUR_KEY&type=journal
index.html?apikey=YOUR_KEY&query=colorectal%20organoids
index.html?apikey=YOUR_KEY&days=14&maxSummaryArticles=5&maxRetrievalArticles=20
index.html?apikey=YOUR_KEY&minCited=1&maxSummaryArticles=10&days=60
```
