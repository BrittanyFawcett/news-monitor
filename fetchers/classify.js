const ALL_COMPANIES = [
  // Big Tech Fintech
  { name: 'Apple',            terms: ['apple pay', 'apple card', 'apple wallet', 'apple cash', 'apple savings'] },
  { name: 'Amazon',           terms: ['amazon pay', 'amazon lending', 'amazon one', 'amazon', 'amazon fintech', 'amazon finance', 'amazon banking'] },
  { name: 'Google',           terms: ['google pay', 'google wallet', 'google'] },
  { name: 'Microsoft',        terms: ['microsoft pay', 'microsoft financial'] },
  { name: 'Meta',             terms: ['meta pay', 'whatsapp pay', 'facebook pay'] },
  // Payments
  { name: 'PayPal',           terms: ['paypal', 'venmo'] },
  { name: 'Stripe',           terms: ['stripe'] },
  { name: 'Block',            terms: ['block inc', 'cash app', 'square payments', 'square financial'] },
  { name: 'Bilt',             terms: ['bilt'] },
  { name: 'Adyen',            terms: ['adyen'] },
  // Brokerage & Asset Management
  { name: 'Fidelity',         terms: ['fidelity'] },
  { name: 'Schwab',           terms: ['charles schwab', 'schwab'] },
  { name: 'Vanguard',         terms: ['vanguard'] },
  { name: 'BlackRock',        terms: ['blackrock'] },
  { name: 'Robinhood',        terms: ['robinhood'] },
  // Card Networks
  { name: 'Visa',             terms: ['visa network', 'visa payment', 'visa card', 'visa inc', 'visa'] },
  { name: 'Mastercard',       terms: ['mastercard'] },
  { name: 'American Express', terms: ['american express', 'amex'] },
  { name: 'Discover',         terms: ['discover financial', 'discover card'] },
  // Data & Open Banking
  { name: 'Plaid',            terms: ['plaid'] },
  { name: 'Finicity',         terms: ['finicity'] },
  { name: 'Yodlee',           terms: ['yodlee'] },
  { name: 'MX',               terms: ['mx technologies'] },
  // Crypto
  { name: 'Coinbase',         terms: ['coinbase'] },
  { name: 'Kraken',           terms: ['kraken'] },
  { name: 'Crypto.com',       terms: ['crypto.com'] },
  { name: 'Binance',          terms: ['binance'] },
  // Neobanks
  { name: 'Chime',            terms: ['chime'] },
  { name: 'SoFi',             terms: ['sofi'] },
  { name: 'Revolut',          terms: ['revolut'] },
  // BNPL
  { name: 'Klarna',           terms: ['klarna'] },
  { name: 'Affirm',           terms: ['affirm'] },
  { name: 'Afterpay',         terms: ['afterpay'] },
  // Mortgage & Lending
  { name: 'Rocket Mortgage',  terms: ['rocket mortgage', 'rocket companies'] },
  { name: 'LoanDepot',        terms: ['loandepot'] },
  { name: 'Better.com',       terms: ['better.com', 'better mortgage'] },
  // Commerce & Embedded Finance
  { name: 'Shopify',          terms: ['shopify'] },
];

const COMPANY_GROUPS = {
  big_tech_fintech: { label: 'Big Tech',            companies: ['Apple', 'Amazon', 'Google', 'Microsoft', 'Meta'] },
  payments:         { label: 'Payments',             companies: ['PayPal', 'Stripe', 'Block', 'Bilt', 'Adyen'] },
  brokerage:        { label: 'Brokerage',            companies: ['Fidelity', 'Schwab', 'Vanguard', 'BlackRock', 'Robinhood'] },
  card_networks:    { label: 'Card Networks',        companies: ['Visa', 'Mastercard', 'American Express', 'Discover'] },
  open_banking:     { label: 'Data & Open Banking', companies: ['Plaid', 'Finicity', 'Yodlee', 'MX'] },
  crypto:           { label: 'Crypto',               companies: ['Coinbase', 'Kraken', 'Crypto.com', 'Binance'] },
  neobanks:         { label: 'Neobanks',             companies: ['Chime', 'SoFi', 'Revolut'] },
  bnpl:             { label: 'BNPL',                 companies: ['Klarna', 'Affirm', 'Afterpay'] },
  mortgage_lending: { label: 'Mortgage & Lending',  companies: ['Rocket Mortgage', 'LoanDepot', 'Better.com'] },
  commerce:         { label: 'Commerce',             companies: ['Shopify'] },
};

// ── Event type classification ─────────────────────────────────────────────
// Order matters: first match wins. Most specific / unambiguous types first.
const EVENT_PATTERNS = [
  { key: 'ma', terms: [
    'merger', 'merges with', 'acquisition of', 'acquires', 'acquired by', 'acquiring',
    'buyout', 'takeover', 'divest', 'divestiture',
    'agreed to acquire', 'agreed to buy', 'agrees to acquire', 'agrees to buy',
    'to acquire', 'purchased by', 'all-cash deal',
  ]},
  { key: 'fundraising', terms: [
    'ipo', 'initial public offering', 'funding round', 'series a', 'series b',
    'series c', 'series d', 'series e', 'raises $', 'raised $',
    'valuation', 'venture capital', 'spac', 'goes public', 'public offering',
    'seed round', 'pre-ipo',
  ]},
  // Earnings: use compound / specific phrases — avoid standalone 'revenue'/'profit'
  // which appear in almost every financial article description
  { key: 'earnings', terms: [
    'earnings', 'quarterly results', 'quarterly earnings', 'quarterly revenue',
    'quarterly profit', 'financial results', 'annual results', 'full year results',
    'net income', 'operating income', 'ebitda', ' eps ', 'earnings per share',
    'beat estimates', 'beats estimates', 'miss estimates', 'misses estimates',
    'beat expectations', 'missed expectations', 'fiscal quarter', 'fiscal year',
    'first quarter', 'second quarter', 'third quarter', 'fourth quarter',
    'q1 20', 'q2 20', 'q3 20', 'q4 20',
    'reports results', 'reported results', 'reports earnings', 'reported earnings',
    'earnings guidance', 'revenue guidance', 'profit guidance', 'revenue beat',
    'revenue miss', 'profit beat', 'profit rose', 'profit fell',
  ]},
  { key: 'regulatory', terms: [
    'cfpb', 'sec charges', 'sec fine', 'sec enforcement', 'sec investigation',
    'enforcement action', 'enforcement order', 'consent order', 'regulatory action',
    'fined', 'fine of', 'lawsuit', 'lawsuits', 'sanction', 'penalty',
    'violation', 'charges against', 'charged with', 'compliance violation',
    'regulatory investigation', 'regulatory penalty',
  ]},
  // Leadership: 'ceo'/'cfo' etc. placed AFTER earnings & regulatory so that
  // "CEO guides Q3 earnings" → earnings, "CEO faces SEC probe" → regulatory
  { key: 'leadership', terms: [
    'ceo', 'cfo', 'coo', 'cto', 'chief executive', 'chief financial officer',
    'appointed', 'appoints', 'resigns', 'resigned', 'fired',
    'stepping down', 'steps down', 'named as', 'joins as', 'named chief',
  ]},
  { key: 'partnerships', terms: [
    'partnership', 'partners with', 'joint venture', 'collaboration',
    'collaborates', 'strategic alliance', 'strategic partnership',
    'agreement with', 'deal with', 'teams up', 'integrates with', 'integrate with',
  ]},
  { key: 'product_launch', terms: [
    'launches', 'launched', 'announces', 'introduces', 'introduced',
    'unveils', 'unveiled', 'debuts', 'rolls out', 'rollout',
    'new product', 'new feature', 'new service', 'new platform', 'new tool',
    'expands', 'expansion',
  ]},
];

// ── Tier 1: direct company name match (user-specified list) ───────────────
const TIER1_NAMES = [
  'apple', 'amazon', 'google', 'microsoft', 'meta',
  'paypal', 'stripe', 'block', 'square', 'bilt', 'adyen',
  'fidelity', 'schwab', 'vanguard', 'blackrock', 'robinhood',
  'visa', 'mastercard', 'american express', 'amex', 'discover',
  'plaid', 'finicity', 'yodlee',
  'coinbase', 'kraken', 'crypto.com', 'binance',
  'chime', 'sofi', 'revolut',
  'klarna', 'affirm', 'afterpay',
  'rocket mortgage', 'loandepot', 'better.com',
  'shopify',
];

// ── Tier 2: industry-specific keyword match ───────────────────────────────
const TIER2_KEYWORDS = [
  // Big Tech Fintech
  'fintech', 'financial services', 'digital wallet', 'apple pay', 'google pay', 'amazon pay',
  // Payments
  'payment processing', 'digital payments', 'merchant payments', 'payment gateway',
  'transaction fees', 'point of sale', 'remittance', 'money transfer',
  // Brokerage
  'brokerage', 'asset management', 'mutual fund', 'retail investing',
  'stock trading', 'wealth management',
  // Card Networks
  'card network', 'interchange fees', 'credit card', 'debit card', 'contactless payment',
  'card processing', 'payment rails',
  // Data & Open Banking
  'open banking', 'financial data aggregation', 'account linking',
  'api banking', 'consumer financial data',
  // Crypto
  'cryptocurrency', 'bitcoin', 'ethereum', 'blockchain', 'digital assets', 'crypto exchange',
  'defi', 'stablecoin', 'web3', 'crypto regulation',
  // Neobanks
  'neobank', 'digital bank', 'challenger bank', 'mobile banking', 'fintech bank',
  // BNPL
  'buy now pay later', 'bnpl', 'installment payments', 'point of sale lending',
  'split payments', 'pay in 4',
  // Mortgage & Lending
  'mortgage', 'home loan', 'refinancing', 'loan origination',
  'housing market', 'mortgage rates', 'home equity', 'heloc',
  // Commerce & Embedded Finance
  'embedded finance', 'embedded payments', 'merchant services', 'commerce platform',
  'banking as a service', 'baas',
  // General finserv
  'etf ', ' etf', 'hedge fund', 'private equity', 'venture capital',
  'financial regulation', 'bank earnings', 'lending platform',
];

// ── Breaking news triggers ─────────────────────────────────────────────────
const BREAKING_TRIGGERS = [
  // M&A
  'merger', 'acquisition', 'acquires', 'acquired', 'takeover', 'buyout',
  'to acquire', 'to buy', 'in talks to buy', 'in talks to acquire',
  'exploring acquisition', 'weighing acquisition', 'bid for', 'takeover bid', 'offered to buy',
  'agreed to buy', 'agrees to buy', 'billion deal', 'all-cash deal',
  // IPO / fundraising
  'ipo', 'goes public', 'spac',
  // Regulatory actions
  'sec charges', 'cfpb fine', 'regulatory action', 'enforcement action', 'consent order',
  // Leadership crisis
  'ceo fired', 'ceo resigns', 'appointed ceo',
  // Security
  'data breach', ' hack', 'cyberattack',
  // Financial distress
  'bankruptcy', 'insolvency', 'chapter 11',
  // Macro
  'federal reserve', 'interest rate decision',
  // Earnings shocks
  'earnings beat', 'earnings miss', 'guidance cut', 'revenue warning',
];

// Single-word terms that are common English words — require a capital first letter
// in the original text to confirm they refer to the company, not the generic word.
const AMBIGUOUS_SINGLE_TERMS = new Set([
  'stripe',    // also: a stripe pattern
  'affirm',    // also: to affirm/assert
  'chime',     // also: a bell sound
  'plaid',     // also: a fabric pattern
  'bilt',      // uncommon but ambiguous
  'sofi',      // also: a name suffix
  'kraken',    // also: mythological creature
  'vanguard',  // also: military/organizational vanguard
  'fidelity',  // also: faithfulness, audio fidelity
  'visa',      // also: travel document
  'google',    // also: common verb ("google it")
]);

function detectCompanies(title, description) {
  const lowerText = `${title || ''} ${description || ''}`.toLowerCase();
  const origText  = `${title || ''} ${description || ''}`;
  const found = new Set();
  for (const { name, terms } of ALL_COMPANIES) {
    if (terms.some(t => {
      const idx = lowerText.indexOf(t);
      if (idx === -1) return false;
      // Multi-word terms are already context-specific; accept them as-is
      if (t.includes(' ') || !AMBIGUOUS_SINGLE_TERMS.has(t)) return true;
      // Ambiguous single-word terms: require the first letter to be uppercase
      // in the original text ("Stripe" → company; "stripe" → pattern)
      const ch = origText[idx];
      return ch >= 'A' && ch <= 'Z';
    })) found.add(name);
  }
  return [...found];
}

function detectEventType(title, description) {
  const text = `${title || ''} ${description || ''}`.toLowerCase();
  for (const { key, terms } of EVENT_PATTERNS) {
    if (terms.some(t => text.includes(t))) return key;
  }
  return null;
}

function isRelevant(title, description, companies) {
  // Already detected by our company extraction → always relevant
  if (companies.length > 0) return true;

  const text = `${title || ''} ${description || ''}`.toLowerCase();

  // Tier 1: direct company name substring match
  if (TIER1_NAMES.some(n => text.includes(n))) return true;

  // Tier 2: require 2 hits to avoid false positives from incidental keyword mentions
  let hits = 0;
  for (const k of TIER2_KEYWORDS) { if (text.includes(k) && ++hits >= 3) return true; }
  return false;
}

function isBreaking(title, description) {
  const text = `${title || ''} ${description || ''}`.toLowerCase();
  return BREAKING_TRIGGERS.some(t => text.includes(t));
}

// Maps a detected company name to its primary industry
const COMPANY_TO_INDUSTRY = {
  Apple: 'big_tech_fintech', Amazon: 'big_tech_fintech', Google: 'big_tech_fintech',
  Microsoft: 'big_tech_fintech', Meta: 'big_tech_fintech',
  PayPal: 'payments', Stripe: 'payments', Block: 'payments', Bilt: 'payments', Adyen: 'payments',
  Fidelity: 'brokerage', Schwab: 'brokerage', Vanguard: 'brokerage',
  BlackRock: 'brokerage', Robinhood: 'brokerage',
  Visa: 'card_networks', Mastercard: 'card_networks',
  'American Express': 'card_networks', Discover: 'card_networks',
  Plaid: 'open_banking', Finicity: 'open_banking', Yodlee: 'open_banking', MX: 'open_banking',
  Coinbase: 'crypto', Kraken: 'crypto', 'Crypto.com': 'crypto', Binance: 'crypto',
  Chime: 'neobanks', SoFi: 'neobanks', Revolut: 'neobanks',
  Klarna: 'bnpl', Affirm: 'bnpl', Afterpay: 'bnpl',
  'Rocket Mortgage': 'mortgage_lending', LoanDepot: 'mortgage_lending', 'Better.com': 'mortgage_lending',
  Shopify: 'commerce',
};

function detectIndustry(companies, title, description) {
  for (const co of companies) {
    if (COMPANY_TO_INDUSTRY[co]) return COMPANY_TO_INDUSTRY[co];
  }
  const text = `${title || ''} ${description || ''}`.toLowerCase();
  if (text.includes('crypto') || text.includes('bitcoin') || text.includes('blockchain') || text.includes('ethereum')) return 'crypto';
  if (text.includes('mortgage') || text.includes('home loan') || text.includes('heloc'))  return 'mortgage_lending';
  if (text.includes('credit card') || text.includes('card network') || text.includes('interchange')) return 'card_networks';
  if (text.includes('neobank') || text.includes('digital bank') || text.includes('challenger bank')) return 'neobanks';
  if (text.includes('buy now pay later') || text.includes('bnpl') || text.includes('installment')) return 'bnpl';
  if (text.includes('open banking') || text.includes('financial data') || text.includes('account linking')) return 'open_banking';
  if (text.includes('brokerage') || text.includes('asset management') || text.includes(' etf ') || text.includes('wealth management')) return 'brokerage';
  if (text.includes('shopify') || text.includes('embedded finance') || text.includes('commerce platform')) return 'commerce';
  if (text.includes('digital wallet') || text.includes('apple pay') || text.includes('google pay')) return 'big_tech_fintech';
  return null;
}

module.exports = {
  ALL_COMPANIES, COMPANY_GROUPS, COMPANY_TO_INDUSTRY, EVENT_PATTERNS,
  TIER1_NAMES, TIER2_KEYWORDS, BREAKING_TRIGGERS,
  detectCompanies, detectEventType, detectIndustry, isRelevant, isBreaking,
};
