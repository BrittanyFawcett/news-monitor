const axios = require('axios');
const { saveRelease } = require('./pressrelease');
const { decodeEntities } = require('./decode');

// Business Wire has no public RSS (feeds are for media partners only, and the
// one public feed it lists stopped updating in Sep 2026), so this reads its
// newsroom pages directly. robots.txt has no rules for general crawlers;
// we fetch a handful of pages every 15 minutes.
//
// Each page shows the ~10 newest releases. Release links look like
//   /news/home/20261014035740/en/Headline-Slug
// — the 14-digit ID starts with the release date, and "/en/" marks English
// (translations use /nl, /it, … and are skipped).
const BASE = 'https://www.businesswire.com';
const PAGES = [
  { path: '/newsroom',                                  label: 'Latest' },
  { path: '/newsroom/industry/professional-services',   label: 'Professional Services (finance)' },
  { path: '/newsroom/industry/technology',              label: 'Technology' },
  { path: '/newsroom/industry/travel',                  label: 'Travel' },
  { path: '/newsroom/industry/transport',               label: 'Transport' },
  { path: '/newsroom/industry/retail',                  label: 'Retail' },
];

const HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
};

const LINK_RE = /<a\b[^>]*\bhref="((?:https:\/\/www\.businesswire\.com)?\/news\/home\/(\d{14})\/en\/[^"?#]*)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;

function stripTags(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function titleFromSlug(url) {
  const slug = url.split('/en/')[1] || '';
  return decodeURIComponent(slug).replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
}

// Date comes from the ID (YYYYMMDD…). Today's releases get the fetch time, so
// they sort as fresh; older ones get midday Eastern on that date.
function publishedFromId(id) {
  const y = id.slice(0, 4), m = id.slice(4, 6), d = id.slice(6, 8);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); // YYYY-MM-DD
  if (`${y}-${m}-${d}` === today) return new Date().toISOString();
  return new Date(`${y}-${m}-${d}T16:00:00Z`).toISOString();
}

// Pulls { url, id, title } for each English release on a page. The same
// release is often linked more than once (headline, image, "read more");
// the longest anchor text wins, falling back to the URL slug.
function parseReleases(html) {
  const byUrl = new Map();
  let m;
  LINK_RE.lastIndex = 0;
  while ((m = LINK_RE.exec(html)) !== null) {
    const url  = m[1].startsWith('http') ? m[1] : BASE + m[1];
    const text = stripTags(m[3]);
    const prev = byUrl.get(url);
    if (!prev || text.length > prev.title.length) byUrl.set(url, { url, id: m[2], title: text });
  }
  return [...byUrl.values()].map(r => ({ ...r, title: r.title.length >= 15 ? r.title : titleFromSlug(r.url) }));
}

async function fetchBusinessWire() {
  for (const page of PAGES) {
    try {
      const { data } = await axios.get(BASE + page.path, { headers: HEADERS, timeout: 15000 });
      const releases = parseReleases(String(data));
      let count = 0;
      for (const r of releases) {
        if (saveRelease({
          title: r.title, desc: null, url: r.url, author: null,
          published: publishedFromId(r.id), sourceName: 'Business Wire',
        })) count++;
      }
      console.log(`[BW] ${page.label}: ${releases.length} releases on page, +${count}`);
      if (!releases.length) console.warn(`[BW] ${page.label}: no release links found — page layout may have changed`);
    } catch (err) {
      const status = err.response?.status;
      const why = status === 403 || status === 429 || err.code === 'ECONNRESET'
        ? 'Business Wire refused the request (it may be blocking automated access from this server)'
        : err.message;
      console.error(`[BW] ${page.label}: ${status ? `HTTP ${status} — ` : ''}${why}`);
    }
    await new Promise(r => setTimeout(r, 2000)); // be polite between pages
  }
}

module.exports = { fetchBusinessWire, parseReleases, publishedFromId };
