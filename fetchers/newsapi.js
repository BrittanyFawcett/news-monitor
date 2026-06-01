const axios = require('axios');
const { saveArticle } = require('../db');
const { detectCompanies, detectEventType, isRelevant, isBreaking } = require('./classify');
const { decodeEntities } = require('./decode');

const PRESS_RELEASE_SOURCES = new Set([
  'PR Newswire', 'Business Wire', 'GlobeNewswire', 'PRWeb', 'Businesswire'
]);

const QUERIES = {
  big_tech_fintech: '"Apple Pay" OR "Apple Card" OR "Amazon Pay" OR "Google Pay" OR "Google Wallet" OR "Meta Pay" OR "WhatsApp Pay" OR "Microsoft fintech"',
  payments:         'PayPal OR Venmo OR Stripe OR "Cash App" OR Adyen OR "Bilt Rewards"',
  brokerage:        'Fidelity OR "Charles Schwab" OR Vanguard OR BlackRock OR Robinhood',
  card_networks:    'Visa OR Mastercard OR "American Express" OR "Discover card"',
  open_banking:     'Plaid OR Finicity OR Yodlee OR "MX Technologies" OR "open banking" OR "open finance"',
  crypto:           'Coinbase OR Kraken OR "Crypto.com" OR Binance OR cryptocurrency',
  neobanks:         'Chime OR SoFi OR Revolut OR neobank',
  bnpl:             'Klarna OR Affirm OR Afterpay OR "buy now pay later" OR BNPL',
  mortgage_lending: '"Rocket Mortgage" OR "Rocket Companies" OR LoanDepot OR "Better.com" OR "Better Mortgage"',
  commerce:         'Shopify OR "embedded finance" OR "embedded banking" OR "Banking as a Service"',
};

async function fetchNewsAPI(industry) {
  const apiKey = process.env.NEWSAPI_KEY;
  if (!apiKey || apiKey === 'your_newsapi_key_here') {
    if (industry === 'payments') console.warn('[NewsAPI] NEWSAPI_KEY not set — skipping all NewsAPI fetches');
    return;
  }

  try {
    const { data } = await axios.get('https://newsapi.org/v2/everything', {
      params: { q: QUERIES[industry], language: 'en', sortBy: 'publishedAt', pageSize: 20, apiKey },
      timeout: 12000,
    });

    if (data.status !== 'ok') {
      console.warn(`[NewsAPI] ${industry}: API error — ${data.message || data.status}`);
      return;
    }

    let count = 0;
    for (const a of data.articles || []) {
      if (!a.title || a.title === '[Removed]' || !a.url) continue;
      const title  = decodeEntities(a.title);
      const desc   = decodeEntities(a.description);
      const source = decodeEntities(a.source?.name);
      const author = decodeEntities(a.author);
      const companies = detectCompanies(title, desc);
      if (!isRelevant(title, desc, companies)) continue;
      const sourceType   = PRESS_RELEASE_SOURCES.has(a.source?.name) ? 'press_release' : 'news';
      const eventType    = detectEventType(title, desc);
      const companiesStr = companies.join(',') || null;
      const breaking     = isBreaking(title, desc) ? 1 : 0;
      if (saveArticle({ title, description: desc, url: a.url, source_name: source,
                        source_type: sourceType, industry, published_at: a.publishedAt,
                        author, image_url: a.urlToImage, event_type: eventType,
                        companies: companiesStr, is_breaking: breaking })) count++;
    }
    console.log(`[NewsAPI] ${industry}: +${count}`);
  } catch (err) {
    const status = err.response?.status;
    const msg    = err.response?.data?.message || err.message;
    if (status === 429) console.warn(`[NewsAPI] ${industry}: rate limit hit (429) — ${msg}`);
    else if (status === 401) console.warn(`[NewsAPI] ${industry}: invalid API key (401)`);
    else console.error(`[NewsAPI] ${industry}: ${status ? `HTTP ${status} — ` : ''}${msg}`);
  }
}

module.exports = { fetchNewsAPI };
