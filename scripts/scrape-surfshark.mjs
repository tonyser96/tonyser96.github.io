// Node 18+ (uses built-in fetch, no proxy libs)
// Usage: node scripts/scrape-surfshark.mjs

import fs from 'node:fs/promises';

const ENDPOINTS = [
  'https://api.surfshark.com/v4/server/clusters',
  'https://api.surfshark.com/v3/server/clusters',
];

async function getJsonWithRetry(url, retries = 4) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; tonyser96-map/1.0)',
          'Accept': 'application/json'
        }
      });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return await r.json();
    } catch (e) {
      lastErr = e;
      const delay = 400 * (i + 1); // 400ms, 800ms, 1200ms, 1600ms
      console.warn(`[warn] fetch failed (attempt ${i + 1}/${retries}) for ${url}: ${e.message}; retrying in ${delay}ms`);
      await new Promise(res => setTimeout(res, delay));
    }
  }
  throw lastErr;
}

function normalize(name = '') {
  return name.replace(/\s+\(virtual\)\s*$/i, '').trim();
}

(async () => {
  let clusters = [];
  let used = '';

  for (const url of ENDPOINTS) {
    try {
      const json = await getJsonWithRetry(url);
      if (Array.isArray(json) && json.length > 0) {
        clusters = json;
        used = url;
        break;
      } else {
        console.warn(`[warn] ${url} returned ${Array.isArray(json) ? json.length : typeof json} items`);
      }
    } catch (e) {
      console.warn(`[warn] giving up on ${url}: ${e.message}`);
    }
  }

  if (!clusters.length) {
    console.error('[error] Could not obtain clusters from any endpoint. If surfshark.com is blocked on your network, run behind VPN/Codespaces or a GitHub Action.');
    process.exit(2);
  }

  console.log(`[info] Using ${used} with ${clusters.length} entries`);

  // Build { country: [cities...] }
  const map = new Map();
  for (const c of clusters) {
    const country = normalize(c.country || c.countryCode || '');
    const city = (c.location || c.city || '').trim();
    if (!country) continue;
    if (!map.has(country)) map.set(country, new Set());
    if (city) map.get(country).add(city);
  }

  const output = Object.fromEntries(
    [...map.entries()]
      .sort(([a],[b]) => a.localeCompare(b))
      .map(([country, cities]) => [country, [...cities].sort((a,b)=>a.localeCompare(b))])
  );

  await fs.mkdir('data', { recursive: true });
  await fs.writeFile('data/servers.json', JSON.stringify(output, null, 2), 'utf8');

  console.log(`Wrote data/servers.json with ${Object.keys(output).length} countries`);
})();
