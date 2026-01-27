# PubMed Summaries

Client-side PubMed summarizer that queries recent articles and generates a brief summary with PMID citations.

## Usage

Open `index.html` in a browser and provide your OpenAI key as a URL parameter once:

```
index.html?apikey=YOUR_KEY
```

The key is stored in `localStorage` for subsequent visits.

## Query Parameters

- `apikey` (required): OpenAI API key. Stored in `localStorage` after first use.
- `query` (optional): Overrides random interest selection with a custom PubMed search query.
- `type` (optional): Filters interests to `topic` or `journal` before selection.
- `days` (optional): Lookback window in days for PubMed search (default: 30). Stored in `localStorage`.
- `maxArticles` (optional): Max PubMed articles to fetch per query (default: 10). Stored in `localStorage`.
- `model` (optional): OpenAI model name (default: `gpt-5-mini`).

## Examples

```
index.html?apikey=YOUR_KEY&type=journal
index.html?apikey=YOUR_KEY&query=colorectal%20organoids
index.html?apikey=YOUR_KEY&days=14&maxArticles=5
```
