const axios = require('axios');
const { saveArticle } = require('../db');
const { detectCompanies, detectEventType, isBreaking } = require('./classify');
const { decodeEntities } = require('./decode');

// SEC policy: User-Agent must include name and contact email
const userAgent = () =>
  `MarketPulse/1.0 ${process.env.USER_EMAIL || 'contact@example.com'}`;

// Tracked companies with their SEC CIK numbers and primary industry
// CIKs verified against https://www.sec.gov/cgi-bin/browse-edgar
const TRACKED = [
  { name: 'Apple',           cik: '320193',  industry: 'big_tech_fintech' },
  { name: 'Visa',            cik: '1403161', industry: 'card_networks'    },
  { name: 'PayPal',          cik: '1633917', industry: 'payments'         },
  { name: 'Coinbase',        cik: '1679788', industry: 'crypto'           },
  { name: 'Robinhood',       cik: '1783398', industry: 'brokerage'        },
  { name: 'SoFi',            cik: '1818502', industry: 'neobanks'         },
  { name: 'Rocket Companies',cik: '1805284', industry: 'mortgage_lending' },
  { name: 'Shopify',         cik: '1594805', industry: 'commerce'         },
  { name: 'BlackRock',       cik: '1364742', industry: 'brokerage'        },
  { name: 'Mastercard',      cik: '1141391', industry: 'card_networks'    },
  { name: 'Block',           cik: '1512673', industry: 'payments'         },
  { name: 'Affirm',          cik: '1820302', industry: 'bnpl'             },
  { name: 'American Express',cik: '4962',    industry: 'card_networks'    },
];

// Map 8-K item numbers to event types
// See: https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&type=8-K
function itemsToEventType(items) {
  if (!items) return null;
  if (items.includes('2.01') || items.includes('1.01')) return 'ma';         // acquisition / material agreement
  if (items.includes('2.02'))                           return 'earnings';   // results of operations
  if (items.includes('5.02') || items.includes('4.01')) return 'leadership'; // officer/director changes
  if (items.includes('8.01') && items.includes('1.05')) return 'regulatory'; // cybersecurity incident
  return null;
}

function filingUrl(cik, accessionNumber) {
  const noDashes = accessionNumber.replace(/-/g, '');
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${noDashes}/`;
}

async function fetchEDGARFilings() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  for (const co of TRACKED) {
    // SEC rate limit: max 10 req/s — we stay well below at ~3 req/s
    await new Promise(r => setTimeout(r, 350));

    const paddedCik = co.cik.padStart(10, '0');

    try {
      const { data } = await axios.get(
        `https://data.sec.gov/submissions/CIK${paddedCik}.json`,
        {
          headers: { 'User-Agent': userAgent(), 'Accept': 'application/json' },
          timeout: 15000,
        }
      );

      const recent = data.filings?.recent;
      if (!recent?.form) {
        console.log(`[EDGAR] ${co.name}: no recent filings`);
        continue;
      }

      const { form, filingDate, accessionNumber, items } = recent;
      let count = 0;

      for (let i = 0; i < form.length; i++) {
        if (form[i] !== '8-K') continue;
        if (filingDate[i] < cutoffStr) continue;

        const acc   = accessionNumber[i];
        const url   = filingUrl(co.cik, acc);
        const itemStr = Array.isArray(items) ? (items[i] || '') : '';
        const title = decodeEntities(`8-K: ${data.name}`);
        const desc  = `8-K filing by ${data.name}. Filed: ${filingDate[i]}. ` +
                      (itemStr ? `Items: ${itemStr}.` : '');

        const eventType    = itemsToEventType(itemStr) || detectEventType(title, desc);
        const companiesStr = detectCompanies(title, desc).join(',') || co.name;
        const breaking     = isBreaking(title, desc) ? 1 : 0;

        if (saveArticle({ title, description: desc, url,
                          source_name: 'SEC EDGAR', source_type: 'filing',
                          industry: co.industry,
                          published_at: filingDate[i] + 'T16:00:00Z',
                          author: 'SEC EDGAR',
                          event_type: eventType, companies: companiesStr,
                          is_breaking: breaking })) count++;
      }

      console.log(`[EDGAR] ${co.name}: +${count}`);
    } catch (err) {
      console.error(`[EDGAR] ${co.name}: ${err.message}`);
    }
  }
}

module.exports = { fetchEDGARFilings };
