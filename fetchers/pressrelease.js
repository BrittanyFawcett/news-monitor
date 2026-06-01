const Parser = require('rss-parser');
const { saveArticle } = require('../db');
const { detectCompanies, detectEventType, detectIndustry, isRelevant, isBreaking } = require('./classify');
const { decodeEntities } = require('./decode');

const parser = new Parser({
  timeout: 15000,
  headers: { 'User-Agent': 'MarketPulse/1.0 (fintech intelligence platform)' },
  customFields: { item: ['media:content', 'media:thumbnail', ['media:content', 'mediaContent']] },
});

// Confirmed-working press release RSS feeds (tested 2026-05-31).
// BusinessWire blocks automated access (ECONNRESET).
// GlobeNewswire industry/9821 is currently empty.
const FEEDS = [
  // PR Newswire — Financial Services topic feed (still broad; apply full relevance filter)
  { url: 'https://www.prnewswire.com/rss/financial-services-latest-news.rss', name: 'PR Newswire' },
  // PR Newswire — general news releases (apply full relevance filter)
  { url: 'https://www.prnewswire.com/rss/news-releases-list.rss', name: 'PR Newswire General' },
];

function toISO(str) {
  if (!str) return new Date().toISOString();
  try { return new Date(str).toISOString(); } catch { return new Date().toISOString(); }
}

async function fetchPressReleases() {
  for (const feed of FEEDS) {
    try {
      const parsed = await parser.parseURL(feed.url);
      let count = 0;

      for (const item of (parsed.items || []).slice(0, 25)) {
        if (!item.title || !item.link) continue;

        const title  = decodeEntities(item.title);
        const desc   = decodeEntities(item.contentSnippet || item.summary || item.content || null);
        const author = decodeEntities(item.creator || item.author || null);

        const companies = detectCompanies(title, desc);

        // Trusted topic feeds already scoped to financial services — accept all.
        // General feeds require the full relevance check.
        if (!feed.trusted && !isRelevant(title, desc, companies)) continue;

        const industry     = detectIndustry(companies, title, desc);
        const eventType    = detectEventType(title, desc);
        const companiesStr = companies.join(',') || null;
        const breaking     = isBreaking(title, desc) ? 1 : 0;

        if (saveArticle({ title, description: desc, url: item.link,
                          source_name: feed.name, source_type: 'press_release',
                          industry, published_at: toISO(item.isoDate || item.pubDate),
                          author, event_type: eventType, companies: companiesStr,
                          is_breaking: breaking })) count++;
      }

      console.log(`[PR] ${feed.name}: +${count}`);
    } catch (err) {
      console.error(`[PR] ${feed.name}: ${err.message}`);
    }
  }
}

module.exports = { fetchPressReleases };
