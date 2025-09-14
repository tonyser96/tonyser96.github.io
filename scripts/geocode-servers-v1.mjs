// Node 18+.  Usage:
// 1) npm i node-fetch@3 p-queue@7
// 2) node scripts/geocode-servers.mjs
//
// It prefers MapTiler Geocoding if MAPTILER_KEY is set (fast & reliable).
// Otherwise uses Nominatim (OpenStreetMap) with polite rate limits.
import fs from 'node:fs/promises';
import fetch from 'node-fetch';
import PQueue from 'p-queue';

const allCities = Object.values(raw).reduce((sum, arr) => sum + arr.length, 0);
let processed = 0, hits = 0, misses = 0;
console.log(`[info] Geocoding ${allCities} cities…`);


const INPUT = 'data/servers.json';
const OUTPUT = 'data/servers_geocoded.json';
const CACHE = 'data/geocode-cache.json';
const MAPTILER_KEY = process.env.MAPTILER_KEY || '';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function loadJSON(path, fallback) {
  try { return JSON.parse(await fs.readFile(path, 'utf8')); }
  catch { return fallback; }
}

async function geocodeMapTiler(q, country) {
  const url = new URL(`https://api.maptiler.com/geocoding/${encodeURIComponent(q)}.json`);
  url.searchParams.set('key', MAPTILER_KEY);
  url.searchParams.set('limit', '1');
  url.searchParams.set('language', 'en');
  if (country) url.searchParams.set('country', countryCodeGuess(country)); // best-effort ISO
  const r = await fetch(url.href);
  if (!r.ok) throw new Error(`MapTiler ${r.status}`);
  const j = await r.json();
  const f = j.features?.[0];
  if (!f) return null;
  const [lng, lat] = f.geometry.coordinates;
  return { lat, lng, provider: 'maptiler' };
}

async function geocodeNominatim(q, country) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('accept-language', 'en');
  if (country) url.searchParams.set('country', country);
  const r = await fetch(url.href, {
    headers: { 'User-Agent': 'tonyser96.github.io-geocoder/1.0 (GitHub Pages)' }
  });
  if (!r.ok) throw new Error(`Nominatim ${r.status}`);
  const j = await r.json();
  const f = j[0];
  if (!f) return null;
  return { lat: parseFloat(f.lat), lng: parseFloat(f.lon), provider: 'nominatim' };
}

// crude ISO hint; improves accuracy but safe if unknown
function countryCodeGuess(name) {
  const map = {
    'United States': 'US','United Kingdom':'GB','South Korea':'KR','North Macedonia':'MK',
    'Czech Republic':'CZ','United Arab Emirates':'AE','Russia':'RU','Vietnam':'VN',
    'Laos':'LA','Myanmar (Burma)':'MM','Taiwan':'TW','Hong Kong':'HK',
  };
  return map[name] || '';
}

function key(country, city) { return `${country}::${city}`; }

(async () => {
  const raw = await loadJSON(INPUT, {});
  const cache = await loadJSON(CACHE, {});
  const out = {};

  // modest concurrency; be gentle to free endpoints
  const queue = new PQueue({ concurrency: MAPTILER_KEY ? 6 : 1 });

  let miss = 0, hit = 0;

  const tasks = [];
  for (const [country, cities] of Object.entries(raw)) {
    out[country] = [];
    for (const city of cities) {
      const k = key(country, city);
      if (cache[k]) { 
        out[country].push({ name: city, ...cache[k] }); 
        hits++; processed++;
        if (processed % 10 === 0) {
          console.log(`[progress] ${processed}/${allCities} (cache hits: ${hits})`);
        }
        continue; 
      }

      tasks.push(queue.add(async () => {
        const query = `${city}, ${country}`;
        let res = null;
        try {
          if (MAPTILER_KEY) res = await geocodeMapTiler(query, country);
          else { res = await geocodeNominatim(query, country); await sleep(1100); } // 1 req/s
        } catch (_) { /* retry with plain city */ }
        if (!res) {
          try {
            if (MAPTILER_KEY) res = await geocodeMapTiler(city, '');
            else { res = await geocodeNominatim(city, ''); await sleep(1100); }
          } catch (_) { /* ignore */ }
        }
        if (res) { cache[k] = { lat: res.lat, lng: res.lng }; out[country].push({ name: city, ...cache[k] }); }
        else { 
            misses++;
         }
      }));
    }
  }

  await Promise.all(tasks);
  await fs.writeFile(CACHE, JSON.stringify(cache, null, 2));
  await fs.writeFile(OUTPUT, JSON.stringify(out, null, 2));
  console.log(`Geocoded. cache hits: ${hit}, misses (not found): ${miss}`);
})();
