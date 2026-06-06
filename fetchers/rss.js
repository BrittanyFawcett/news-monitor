const Parser = require('rss-parser');
const { saveArticle } = require('../db');
const { detectCompanies, detectEventType, detectIndustry, isRelevant, isBreaking } = require('./classify');
const { decodeEntities } = require('./decode');

// Unambiguous BNPL/payments/commerce terms required for broad feeds that lack
// a category focus (PYMNTS publishes everything from wearables to CEO profiles).
const STRICT_CORE_TERMS = [
  'buy now pay later', 'bnpl', 'pay in 4', 'installment loan', 'installment payment',
  'embedded finance', 'embedded payment', 'payment processing', 'digital payment',
  'point of sale', 'merchant payment', 'fintech',
];

const parser = new Parser({
  timeout: 12000,
  headers: { 'User-Agent': 'MarketPulse/1.0 (fintech intelligence platform)' },
  customFields: { item: ['media:content', 'media:thumbnail', ['media:content', 'mediaContent']] },
});

// Broad financial publications fetched once per run; detectIndustry() assigns each article.
// Processed with a higher item limit (25) since filtering is heavy.
const GLOBAL_FEEDS = [
  { url: 'https://feeds.bloomberg.com/markets/news.rss',                       name: 'Bloomberg Markets' },
  { url: 'https://feeds.content.dowjones.io/public/rss/mw_marketpulse',        name: 'WSJ MarketPulse' },
  { url: 'https://www.ft.com/rss/home',                                        name: 'Financial Times' },
  { url: 'https://api.axios.com/feed/',                                        name: 'Axios' },
  { url: 'https://www.theblock.co/rss.xml',                                    name: 'The Block' },
  { url: 'https://seekingalpha.com/feed.xml',                                  name: 'Seeking Alpha' },
  { url: 'https://feeds.businessinsider.com/custom/all',                       name: 'Business Insider' },
  { url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories',         name: 'MarketWatch' },
];

const FEEDS = {
  big_tech_fintech: [
    { url: 'https://techcrunch.com/category/fintech/feed/', name: 'TechCrunch Fintech' },
    { url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664', name: 'CNBC Finance' },
  ],
  payments: [
    { url: 'https://www.finextra.com/rss/headlines.aspx',   name: 'Finextra' },
    { url: 'https://paymentsjournal.com/feed/',              name: 'Payments Journal' },
    { url: 'https://www.digitaltransactions.net/feed/',      name: 'Digital Transactions' },
  ],
  brokerage: [
    { url: 'https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines', name: 'MarketWatch' },
    { url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664', name: 'CNBC Finance' },
    { url: 'https://www.bankingdive.com/feeds/news/',        name: 'Banking Dive' },
  ],
  card_networks: [
    { url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml',    name: 'WSJ Markets' },
    { url: 'https://www.paymentscardsandmobile.com/feed/',      name: 'Payments Cards & Mobile' },
  ],
  open_banking: [
    { url: 'https://www.bankingdive.com/feeds/news/',        name: 'Banking Dive' },
  ],
  digital_assets: [
    { url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', name: 'CoinDesk' },
    { url: 'https://cointelegraph.com/rss',                   name: 'CoinTelegraph' },
  ],
  neobanks: [
    { url: 'https://www.bankingdive.com/feeds/news/',         name: 'Banking Dive' },
  ],
  bnpl: [
    { url: 'https://www.paymentsjournal.com/feed/', name: 'Payments Journal' },
  ],
  mortgage_lending: [
    { url: 'https://www.housingwire.com/feed/',               name: 'HousingWire' },
    { url: 'https://nationalmortgagenews.com/rss',            name: 'National Mortgage News' },
  ],
  commerce: [
    { url: 'https://www.paymentsjournal.com/feed/', name: 'Payments Journal' },
    { url: 'https://www.modernretail.co/feed/',               name: 'Modern Retail' },
    { url: 'https://www.retaildive.com/feeds/news/',          name: 'Retail Dive' },
  ],
};

function extractImage(item) {
  return (
    item['media:content']?.$.url ||
    item['media:thumbnail']?.$.url ||
    item.mediaContent?.$.url ||
    null
  );
}

function toISO(str) {
  if (!str) return new Date().toISOString();
  try { return new Date(str).toISOString(); } catch { return new Date().toISOString(); }
}

async function fetchRSSFeeds(industry) {
  for (const feed of FEEDS[industry] || []) {
    try {
      const parsed = await parser.parseURL(feed.url);
      let count = 0;
      for (const item of (parsed.items || []).slice(0, 15)) {
        if (!item.title || !item.link) continue;
        const title  = decodeEntities(item.title);
        const desc   = decodeEntities(item.contentSnippet || item.summary || null);
        const author = decodeEntities(item.creator || item.author || null);
        const companies = detectCompanies(title, desc);
        if (!isRelevant(title, desc, companies)) continue;

        // Strict feeds (PYMNTS): require a tracked company OR an explicit topic keyword
        if (feed.strict && !companies.length) {
          const lc = `${title} ${desc || ''}`.toLowerCase();
          if (!STRICT_CORE_TERMS.some(k => lc.includes(k))) continue;
        }

        // Use the company's canonical industry when known; fall back to the feed's industry
        const effectiveIndustry = (companies.length ? detectIndustry(companies, title, desc) : null) || industry;

        const eventType    = detectEventType(title, desc, companies);
        const companiesStr = companies.join(',') || null;
        const breaking     = isBreaking(title, desc) ? 1 : 0;
        if (saveArticle({ title, description: desc, url: item.link,
                          source_name: feed.name, source_type: 'rss',
                          industry: effectiveIndustry,
                          published_at: toISO(item.isoDate || item.pubDate),
                          author, image_url: extractImage(item),
                          event_type: eventType, companies: companiesStr,
                          is_breaking: breaking })) count++;
      }
      console.log(`[RSS] ${feed.name}: +${count}`);
    } catch (err) {
      console.error(`[RSS] ${feed.name}: ${err.message}`);
    }
  }
}

async function fetchGlobalRSSFeeds() {
  for (const feed of GLOBAL_FEEDS) {
    try {
      const parsed = await parser.parseURL(feed.url);
      let count = 0;
      for (const item of (parsed.items || []).slice(0, 25)) {
        if (!item.title || !item.link) continue;
        const title  = decodeEntities(item.title);
        const desc   = decodeEntities(item.contentSnippet || item.summary || null);
        const author = decodeEntities(item.creator || item.author || null);
        const companies = detectCompanies(title, desc);
        if (!isRelevant(title, desc, companies)) continue;
        const industry     = detectIndustry(companies, title, desc);
        if (!industry) continue;
        const eventType    = detectEventType(title, desc, companies);
        const companiesStr = companies.join(',') || null;
        const breaking     = isBreaking(title, desc) ? 1 : 0;
        if (saveArticle({ title, description: desc, url: item.link,
                          source_name: feed.name, source_type: 'rss',
                          industry, published_at: toISO(item.isoDate || item.pubDate),
                          author, image_url: extractImage(item),
                          event_type: eventType, companies: companiesStr,
                          is_breaking: breaking })) count++;
      }
      console.log(`[RSS] ${feed.name}: +${count}`);
    } catch (err) {
      console.error(`[RSS] ${feed.name}: ${err.message}`);
    }
  }
}

module.exports = { fetchRSSFeeds, fetchGlobalRSSFeeds };
