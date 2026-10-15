const Parser = require('rss-parser');
const { saveArticle } = require('../db');
const { detectCompanies, detectEventType, detectIndustry, isRelevant, isBreaking } = require('./classify');
const { decodeEntities } = require('./decode');

const parser = new Parser({
  timeout: 15000,
  headers: { 'User-Agent': 'MarketPulse/1.0 (fintech intelligence platform)' },
  customFields: { item: ['media:content', 'media:thumbnail', ['media:content', 'mediaContent']] },
});

// Press-wire RSS feeds. Every one was checked on 2026-10-15 for valid XML and
// recent items. Each feed returns only its newest ~20 releases, so these are
// also polled every 15 minutes (see runWireFetchers in server.js); at the old
// 2-hour interval the PRN "All News Releases" feed (≈9 minutes of releases per
// 20 items) dropped most of what was published.
//
// Left out on purpose — feeds that exist but had stopped updating when checked:
//   PRN Banking & Financial Services (last item 2026-08-18), PRN All Travel
//   (2026-09-17), PRN Cryptocurrency (2026-09-21).
// Business Wire has no public RSS; its newsroom pages are read by businesswire.js.
const GNW = (path, title) =>
  `https://www.globenewswire.com/RssFeed/${encodeURI(path)}/feedTitle/${encodeURIComponent('GlobeNewswire - ' + title)}`;

const FEEDS = [
  // ── PR Newswire ──
  { url: 'https://www.prnewswire.com/rss/news-releases-list.rss',                                   name: 'PR Newswire' },
  { url: 'https://www.prnewswire.com/rss/financial-services-latest-news.rss',                       name: 'PR Newswire' },
  { url: 'https://www.prnewswire.com/rss/business-technology-latest-news/financial-technology-list.rss', name: 'PR Newswire' },
  { url: 'https://www.prnewswire.com/rss/automotive-transportation-latest-news/airlines-aviation-list.rss', name: 'PR Newswire' },
  // ── GlobeNewswire ──
  { url: GNW('industry/8000-Financials', 'Industry News on Financials'),                         name: 'GlobeNewswire' },
  { url: GNW('subjectcode/27-Mergers and Acquisitions', 'Mergers and Acquisitions'),             name: 'GlobeNewswire' },
  { url: GNW('subjectcode/13-Earnings Releases and Operating Results', 'Earnings Releases and Operating Results'), name: 'GlobeNewswire' },
  { url: GNW('industry/5751-Airlines', 'Industry News on Airlines'),                             name: 'GlobeNewswire' },
  { url: GNW('industry/5753-Hotels', 'Industry News on Hotels'),                                 name: 'GlobeNewswire' },
];

function toISO(str) {
  if (!str) return new Date().toISOString();
  const d = new Date(str);
  return isNaN(d) ? new Date().toISOString() : d.toISOString();
}

// Shared by the wire feeds: classify, filter and save one release.
// Returns true if it was new and saved.
function saveRelease({ title, desc, url, author, published, sourceName, sourceType = 'press_release' }) {
  const companies = detectCompanies(title, desc);
  if (!isRelevant(title, desc, companies)) return false;
  const industry = detectIndustry(companies, title, desc);
  if (!industry) return false;
  return saveArticle({
    title, description: desc, url,
    source_name: sourceName, source_type: sourceType,
    industry, published_at: published,
    author, event_type: detectEventType(title, desc, companies),
    companies: companies.join(',') || null,
    is_breaking: isBreaking(title, desc) ? 1 : 0,
  });
}

function hoursOld(iso) {
  return Math.round((Date.now() - new Date(iso)) / 36e5);
}

async function fetchPressReleases() {
  for (const feed of FEEDS) {
    try {
      const parsed = await parser.parseURL(feed.url);
      const items  = parsed.items || [];
      let count = 0;

      for (const item of items) {
        if (!item.title || !item.link) continue;
        if (saveRelease({
          title:      decodeEntities(item.title),
          desc:       decodeEntities(item.contentSnippet || item.summary || item.content || null),
          url:        item.link,
          author:     decodeEntities(item.creator || item.author || null),
          published:  toISO(item.isoDate || item.pubDate),
          sourceName: feed.name,
        })) count++;
      }

      // Flags feeds that silently stop updating (as several PRN topic feeds have)
      const newest = items[0] && toISO(items[0].isoDate || items[0].pubDate);
      const stale  = newest && hoursOld(newest) > 24 * 7 ? ` — newest item is ${Math.round(hoursOld(newest) / 24)}d old, feed may be stale` : '';
      console.log(`[PR] ${feed.name} (${parsed.title || feed.url}): +${count}${stale}`);
    } catch (err) {
      console.error(`[PR] ${feed.name} (${feed.url}): ${err.message}`);
    }
  }
}

module.exports = { fetchPressReleases, saveRelease, toISO };
