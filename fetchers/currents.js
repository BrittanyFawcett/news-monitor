const axios = require('axios');
const { saveArticle } = require('../db');
const { detectCompanies, detectEventType, detectIndustry, isRelevant, isBreaking } = require('./classify');
const { decodeEntities } = require('./decode');

const QUERIES = {
  big_tech_fintech: '"Apple Pay" OR "Apple Card" OR "Amazon Pay" OR "Google Pay" OR "Google Wallet" OR "Meta Pay"',
  payments:         'PayPal OR Venmo OR Stripe OR "Cash App" OR Adyen OR Bilt',
  brokerage:        'Fidelity OR Schwab OR Vanguard OR BlackRock OR Robinhood',
  card_networks:    'Visa OR Mastercard OR "American Express" OR "Discover card"',
  open_banking:     'Plaid OR Finicity OR Yodlee OR "open banking" OR "open finance"',
  crypto:           'Coinbase OR Kraken OR "Crypto.com" OR Binance OR cryptocurrency',
  neobanks:         'Chime OR SoFi OR Revolut OR neobank',
  bnpl:             'Klarna OR Affirm OR Afterpay OR "buy now pay later" OR BNPL',
  mortgage_lending: '"Rocket Mortgage" OR "Rocket Companies" OR LoanDepot OR "Better Mortgage"',
  commerce:         'Shopify OR "embedded finance" OR "embedded banking" OR "Banking as a Service"',
};

async function fetchCurrentsAPI(industry) {
  const apiKey = process.env.CURRENTS_API_KEY;
  if (!apiKey || apiKey === 'your_currents_api_key_here') {
    if (industry === 'payments') console.warn('[Currents] CURRENTS_API_KEY not set — skipping');
    return;
  }

  try {
    const { data } = await axios.get('https://api.currentsapi.services/v1/search', {
      params: { keywords: QUERIES[industry], language: 'en', apiKey },
      timeout: 12000,
    });

    if (data.status !== 'ok') {
      console.warn(`[Currents] ${industry}: API error — ${data.message || data.status}`);
      return;
    }

    let count = 0;
    for (const a of data.news || []) {
      if (!a.title || !a.url) continue;
      const title = decodeEntities(a.title);
      const desc  = decodeEntities(a.description);
      const companies = detectCompanies(title, desc);
      if (!isRelevant(title, desc, companies)) continue;
      const eventType    = detectEventType(title, desc);
      const companiesStr = companies.join(',') || null;
      const breaking     = isBreaking(title, desc) ? 1 : 0;
      if (saveArticle({ title, description: desc, url: a.url, source_name: decodeEntities(a.author),
                        source_type: 'currents', industry, published_at: a.published,
                        author: null, image_url: a.image !== 'None' ? a.image : null,
                        event_type: eventType, companies: companiesStr, is_breaking: breaking })) count++;
    }
    console.log(`[Currents] ${industry}: +${count}`);
  } catch (err) {
    const status = err.response?.status;
    const msg    = err.response?.data?.message || err.message;
    if (status === 429) console.warn(`[Currents] ${industry}: rate limit (429) — ${msg}`);
    else if (status === 401) console.warn(`[Currents] ${industry}: invalid API key (401)`);
    else console.error(`[Currents] ${industry}: ${status ? `HTTP ${status} — ` : ''}${msg}`);
  }
}

module.exports = { fetchCurrentsAPI };
