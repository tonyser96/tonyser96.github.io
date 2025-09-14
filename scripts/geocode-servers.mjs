// Node 18+
// Geocode Surfshark cities with progress logs and resumable cache.
// Input : data/servers.json              -> { country: ["City", ...], ... }
// Output: data/servers_geocoded.json     -> { country: [{ name, lat, lng }, ...], ... }
// Cache : data/geocode-cache.json        -> { "Country::City": { lat, lng } }
//
// Usage:
//   # Faster (recommended)
//   export MAPTILER_KEY=YOUR_KEY && node scripts/geocode-servers.mjs
//   # Or without a key (uses Nominatim politely ~1 req/s)
//   node scripts/geocode-servers.mjs

import fs from "node:fs/promises";
import fetch from "node-fetch";
import PQueue from "p-queue";

const INPUT = "data/servers.json";
const OUTPUT = "data/servers_geocoded.json";
const CACHE  = "data/geocode-cache.json";
const MAPTILER_KEY = process.env.MAPTILER_KEY || "";

// Optional hint map from server country names to ISO codes for MapTiler; 
// does NOT change output names — only improves geocoding accuracy.
const ISO_HINT = new Map([
  ["United States", "US"],
  ["United Kingdom", "GB"],
  ["South Korea", "KR"],
  ["North Macedonia", "MK"],
  ["Czech Republic", "CZ"],
  ["United Arab Emirates", "AE"],
  ["Vietnam", "VN"],
  ["Laos", "LA"],
  ["Myanmar", "MM"],
  ["Taiwan", "TW"],
  ["Hong Kong", "HK"],
]);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function loadJSON(path, fallback) {
  try { return JSON.parse(await fs.readFile(path, "utf8")); }
  catch { return fallback; }
}

function key(country, city) { return `${country}::${city}`; }

function normalizeName(s = "") {
  return s.replace(/\s+\(virtual\)\s*$/i, "").trim();
}

async function geocodeMapTiler(q, country) {
  const url = new URL(`https://api.maptiler.com/geocoding/${encodeURIComponent(q)}.json`);
  url.searchParams.set("key", MAPTILER_KEY);
  url.searchParams.set("limit", "1");
  url.searchParams.set("language", "en");
  const iso = ISO_HINT.get(country);
  if (iso) url.searchParams.set("country", iso);
  const r = await fetch(url, { headers: { "User-Agent": "tonyser96.github.io-geocoder/1.0" } });
  if (!r.ok) throw new Error(`MapTiler ${r.status}`);
  const j = await r.json();
  const f = j.features?.[0];
  if (!f) return null;
  const [lng, lat] = f.geometry.coordinates;
  return { lat, lng, provider: "maptiler" };
}

async function geocodeNominatim(q) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", q);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("accept-language", "en");
  const r = await fetch(url, {
    headers: { "User-Agent": "tonyser96.github.io-geocoder/1.0" }
  });
  if (!r.ok) throw new Error(`Nominatim ${r.status}`);
  const j = await r.json();
  const f = j[0];
  if (!f) return null;
  return { lat: parseFloat(f.lat), lng: parseFloat(f.lon), provider: "nominatim" };
}

(async () => {
  // Load inputs first
  const raw = await loadJSON(INPUT, {});
  const cache = await loadJSON(CACHE, {});
  const out = {};

  // Build a unique worklist of country/city pairs
  const work = [];
  for (const [countryRaw, cities] of Object.entries(raw)) {
    const country = normalizeName(countryRaw);
    out[country] = [];
    for (const cityRaw of (cities || [])) {
      const city = normalizeName(cityRaw);
      const k = key(country, city);
      work.push({ country, city, k });
    }
  }

  const allCities = work.length;
  let processed = 0, hits = 0, misses = 0;
  console.log(`[info] Geocoding ${allCities} cities…`);

  // Concurrency: faster with MapTiler, very polite with Nominatim
  const queue = new PQueue({ concurrency: MAPTILER_KEY ? 6 : 1 });

  const tasks = work.map(({ country, city, k }) => queue.add(async () => {
    // Cache hit path
    if (cache[k]) {
      out[country].push({ name: city, ...cache[k] });
      hits++; processed++;
      if (processed % 10 === 0 || processed === allCities) {
        console.log(`[progress] ${processed}/${allCities} (cache hits: ${hits}, misses: ${misses})`);
      }
      return;
    }

    // Try MapTiler first if key is present, else Nominatim
    let res = null;
    try {
      if (MAPTILER_KEY) {
        res = await geocodeMapTiler(`${city}, ${country}`, country);
      } else {
        res = await geocodeNominatim(`${city}, ${country}`);
        await sleep(1100); // ~1 req/sec politeness for Nominatim
      }
    } catch (_) { /* retry below with looser query */ }

    // Fallback: just the city name (helps for well-known cities)
    if (!res) {
      try {
        if (MAPTILER_KEY) res = await geocodeMapTiler(city, country);
        else { res = await geocodeNominatim(city); await sleep(1100); }
      } catch (_) { /* ignore */ }
    }

    if (res) {
      cache[k] = { lat: res.lat, lng: res.lng };
      out[country].push({ name: city, ...cache[k] });
    } else {
      misses++;
    }

    processed++;
    if (processed % 10 === 0 || processed === allCities) {
      console.log(`[progress] ${processed}/${allCities} (cache hits: ${hits}, misses: ${misses})`);
    }
  }));

  await Promise.all(tasks);

  // Persist cache and output
  await fs.mkdir("data", { recursive: true });
  await fs.writeFile(CACHE, JSON.stringify(cache, null, 2));
  await fs.writeFile(OUTPUT, JSON.stringify(out, null, 2));

  console.log(`[done] Processed ${processed}/${allCities}, cache hits ${hits}, misses ${misses}`);
})();