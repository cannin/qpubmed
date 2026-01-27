const { test, expect } = require('@playwright/test');

test('loads the homepage', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveTitle(/PubMed Summaries/i);
});
