const Parser = require('rss-parser');
const { saveArticle } = require('../db');
const { detectCompanies, detectEventType, detectIndustry, isBreaking, COMPANY_TO_INDUSTRY, TIER2_KEYWORDS } = require('./classify');
const { decodeEntities } = require('./decode');
const { toISO } = require('./pressrelease');

const parser = new Parser({
  timeout: 15000,
  headers: { 'User-Agent': 'MarketPulse/1.0 (fintech intelligence platform)' },
});

// Official company newsroom / blog feeds. Each URL was checked on 2026-10-15
// for a valid feed with recent items. Companies not listed either have no
// public feed or their newsroom blocked the check (American, Delta, JetBlue,
// Southwest, Marriott, Hilton, Choice, Wells Fargo, Schwab, Fidelity, Robinhood…);
// their releases still arrive through the press wires and news APIs.
//
// `fintechOnly`: Big Tech newsrooms are mostly about devices, games and media,
// so only posts with a payments/finance signal are kept. Every other newsroom
// belongs to a tracked company whose own news is in scope, so all posts are kept.
const NEWSROOMS = [
  { company: 'Apple',             name: 'Apple Newsroom',     url: 'https://www.apple.com/newsroom/rss-feed.rss', fintechOnly: true },
  { company: 'Google',            name: 'Google Blog',        url: 'https://blog.google/rss/',                     fintechOnly: true },
  { company: 'Microsoft',         name: 'Microsoft Source',   url: 'https://news.microsoft.com/source/feed/',      fintechOnly: true },
  { company: 'Amazon',            name: 'Amazon News',        url: 'https://www.aboutamazon.com/news/rss',         fintechOnly: true },
  { company: 'PayPal',            name: 'PayPal Newsroom',    url: 'https://newsroom.paypal-corp.com/news?pagetemplate=rss' },
  { company: 'Stripe',            name: 'Stripe Blog',        url: 'https://stripe.com/blog/feed.rss' },
  { company: 'Kraken',            name: 'Kraken Blog',        url: 'https://blog.kraken.com/feed' },
  { company: 'PNC',               name: 'PNC Newsroom',       url: 'https://pnc.mediaroom.com/news-releases?pagetemplate=rss' },
  { company: 'Truist',            name: 'Truist Newsroom',    url: 'https://media.truist.com/news-releases?pagetemplate=rss' },
  { company: 'United Airlines',   name: 'United Newsroom',    url: 'https://united.mediaroom.com/news-releases?pagetemplate=rss' },
  { company: 'Alaska Airlines',   name: 'Alaska Air Newsroom', url: 'https://news.alaskaair.com/feed/' },
  { company: 'Hyatt',             name: 'Hyatt Newsroom',     url: 'https://newsroom.hyatt.com/news-releases?pagetemplate=rss' },
];

const FINTECH_SIGNALS = [
  ...TIER2_KEYWORDS,
  ' pay ', 'pay later', 'wallet', 'payment', 'payments', 'checkout', 'bank', 'banking',
  'credit', 'debit', 'card', 'loan', 'lending', 'savings', 'finance', 'financial',
  'crypto', 'stablecoin', 'merchant', 'transaction', 'cash back', 'rewards',
];

function hasFintechSignal(title, desc) {
  const text = ` ${title || ''} ${desc || ''} `.toLowerCase();
  return FINTECH_SIGNALS.some(k => text.includes(k));
}

async function fetchNewsrooms() {
  for (const nr of NEWSROOMS) {
    try {
      const parsed = await parser.parseURL(nr.url);
      let count = 0;
      for (const item of parsed.items || []) {
        if (!item.title || !item.link) continue;
        const title = decodeEntities(item.title);
        const desc  = decodeEntities(item.contentSnippet || item.summary || null);
        if (nr.fintechOnly && !hasFintechSignal(title, desc)) continue;

        // It's the company's own newsroom, so the company is always tagged,
        // even when the post doesn't repeat its name ("We're launching…").
        const companies = detectCompanies(title, desc);
        if (!companies.includes(nr.company)) companies.unshift(nr.company);
        const industry = detectIndustry(companies, title, desc) || COMPANY_TO_INDUSTRY[nr.company];

        if (saveArticle({
          title, description: desc, url: item.link,
          source_name: nr.name, source_type: 'newsroom',
          industry, published_at: toISO(item.isoDate || item.pubDate),
          author: decodeEntities(item.creator || item.author || null),
          event_type: detectEventType(title, desc, companies),
          companies: companies.join(','),
          is_breaking: isBreaking(title, desc) ? 1 : 0,
        })) count++;
      }
      console.log(`[Newsroom] ${nr.name}: +${count}`);
    } catch (err) {
      console.error(`[Newsroom] ${nr.name}: ${err.message}`);
    }
  }
}

module.exports = { fetchNewsrooms, hasFintechSignal, NEWSROOMS };
