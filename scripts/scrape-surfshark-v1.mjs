// Node 18+, `npm i playwright@^1 cheerio@^1`
import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const URL = 'https://surfshark.com/servers';

function normalizeCountry(name) {
  return name.replace(/\s+\(.*?\)\s*$/, '').trim(); // drop "(virtual)" suffixes if present
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  // Give the client-side app a moment to finish rendering
  await page.waitForTimeout(2500);

  // This selector may change; it targets the country/locations list items on the page.
  // If Surfshark alters markup, inspect the page and tweak selectors below.
  const data = await page.evaluate(() => {
    const countries = [];
    // Try common patterns: country blocks with city lists
    const blocks = document.querySelectorAll('[class*="servers"] [class*="country"], [data-testid*="country"]');
    if (blocks.length) {
      blocks.forEach(block => {
        const titleEl = block.querySelector('h3, h2, [class*="title"]');
        const country = titleEl?.textContent?.trim();
        if (!country) return;

        const cityEls = block.querySelectorAll('li, [class*="city"]');
        const cities = [...cityEls].map(li => li.textContent?.trim()).filter(Boolean);

        countries.push({ country, cities });
      });
    }

    // Fallback: flat table/list
    if (!countries.length) {
      const rows = document.querySelectorAll('table tr, [role="row"]');
      const map = new Map();
      rows.forEach(r => {
        const tds = r.querySelectorAll('td, [role="cell"]');
        if (tds.length >= 1) {
          const country = tds[0].textContent?.trim();
          const city = tds[1]?.textContent?.trim();
          if (country) {
            if (!map.has(country)) map.set(country, new Set());
            if (city) map.get(country).add(city);
          }
        }
      });
      if (map.size) {
        map.forEach((set, k) => countries.push({ country: k, cities: [...set] }));
      }
    }

    return countries;
  });

  // Normalize + sort
  const grouped = {};
  for (const { country, cities } of data) {
    if (!country) continue;
    const key = normalizeCountry(country);
    if (!grouped[key]) grouped[key] = new Set();
    (cities || []).forEach(c => grouped[key].add(c));
  }

  // Convert Sets to sorted arrays
  const output = Object.fromEntries(
    Object.entries(grouped)
      .sort(([a],[b]) => a.localeCompare(b))
      .map(([k, v]) => [k, [...v].sort((a,b) => a.localeCompare(b))])
  );

  await fs.mkdir('data', { recursive: true });
  await fs.writeFile('data/servers.json', JSON.stringify(output, null, 2), 'utf8');
  console.log('Wrote data/servers.json with', Object.keys(output).length, 'countries');
  await browser.close();
})();
