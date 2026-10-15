// ── Story region ───────────────────────────────────────────────────────────
// Works out where a story is about, in this order:
//   1. Dateline — press releases and wire stories open with one:
//        "CHARLOTTE, N.C., Oct. 14, 2026 /PRNewswire/ -- …"
//        "TORONTO, Oct. 14, 2026 (GLOBE NEWSWIRE) -- …"
//        "WASHINGTON (AP) — …"
//   2. The first country / US state / major city named in the headline,
//      then in the summary.
//   3. Fallback: the tracked company's headquarters (basis = 'hq'), shown
//      differently in the UI because it's an assumption, not from the story.
//
// Returns { region, basis } — basis is 'story' or 'hq' — or null.

const US = 'US', UK = 'UK';

// AP-style and full state names → US (used in datelines and text)
const US_STATES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware',
  'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky',
  'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi',
  'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico',
  'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania',
  'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont',
  'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming', 'Puerto Rico', 'New England',
];
const US_STATE_ABBREVS = [
  'Ala.', 'Ariz.', 'Ark.', 'Calif.', 'Colo.', 'Conn.', 'Del.', 'Fla.', 'Ga.', 'Ill.', 'Ind.',
  'Kan.', 'Ky.', 'La.', 'Md.', 'Mass.', 'Mich.', 'Minn.', 'Miss.', 'Mo.', 'Mont.', 'Neb.',
  'Nev.', 'N.H.', 'N.J.', 'N.M.', 'N.Y.', 'N.C.', 'N.D.', 'Okla.', 'Ore.', 'Pa.', 'R.I.',
  'S.C.', 'S.D.', 'Tenn.', 'Vt.', 'Va.', 'Wash.', 'W.Va.', 'Wis.', 'Wyo.', 'D.C.',
];
// Two-letter postal codes only count inside a dateline ("PLANO, TX, Oct. 14")
const US_POSTAL = new Set(('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV ' +
  'NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC PR').split(' '));

// Cities that stand alone in AP datelines → country. Only used in datelines,
// where "WASHINGTON" or "PHOENIX" can't be a person's name.
const DATELINE_CITIES = {
  US: ['New York', 'Chicago', 'San Francisco', 'Los Angeles', 'Boston', 'Atlanta', 'Dallas', 'Houston',
       'Seattle', 'Washington', 'Miami', 'Denver', 'Philadelphia', 'Detroit', 'Charlotte', 'Minneapolis',
       'Phoenix', 'Austin', 'Nashville', 'Pittsburgh', 'Cleveland', 'Cincinnati', 'Columbus', 'St. Louis',
       'Baltimore', 'San Diego', 'San Jose', 'Las Vegas', 'Salt Lake City', 'Kansas City', 'Omaha',
       'Milwaukee', 'Indianapolis', 'Tampa', 'Orlando', 'Jacksonville', 'Raleigh', 'Richmond', 'Louisville',
       'Sacramento', 'Honolulu', 'New Orleans', 'Oklahoma City', 'Plano', 'McLean', 'Wilmington',
       'Palo Alto', 'Menlo Park', 'Mountain View', 'Cupertino', 'Redmond', 'Stamford', 'Jersey City',
       'Newark', 'Purchase', 'Armonk', 'San Antonio', 'Fort Worth', 'Scottsdale', 'Boca Raton', 'Irving'],
  UK: ['London', 'Edinburgh', 'Manchester', 'Glasgow'],
  Canada: ['Toronto', 'Montreal', 'Vancouver', 'Calgary', 'Ottawa'],
  Singapore: ['Singapore'], 'Hong Kong': ['Hong Kong'], Japan: ['Tokyo'], Australia: ['Sydney', 'Melbourne'],
  France: ['Paris'], Germany: ['Frankfurt', 'Berlin', 'Munich'], UAE: ['Dubai', 'Abu Dhabi'],
  India: ['Mumbai', 'New Delhi', 'Bengaluru', 'Bangalore'], Brazil: ['Sao Paulo', 'São Paulo', 'Rio de Janeiro'],
  China: ['Shanghai', 'Beijing', 'Shenzhen'], 'South Korea': ['Seoul'], Netherlands: ['Amsterdam'],
  Sweden: ['Stockholm'], Switzerland: ['Zurich', 'Geneva'], Ireland: ['Dublin'], Spain: ['Madrid', 'Barcelona'],
  Italy: ['Milan', 'Rome'], Mexico: ['Mexico City'], Israel: ['Tel Aviv', 'Jerusalem'], 'Saudi Arabia': ['Riyadh'],
  Nigeria: ['Lagos'], Kenya: ['Nairobi'], 'South Africa': ['Johannesburg', 'Cape Town'], Indonesia: ['Jakarta'],
  Luxembourg: ['Luxembourg'], 'Cayman Islands': ['George Town'],
};

// Names that identify a place anywhere in a headline or summary. Matched
// case-sensitively, so "china plates" or "polish your résumé" don't count.
// Left out on purpose — too often something else: "America"/"American"
// (American Express, Bank of America), "Turkey", "Jordan", "Chad", "Victoria",
// "Jersey", "Delta", "Phoenix" (outside datelines).
const TEXT_PLACES = {
  US: ['United States', 'U.S.', 'US', 'USA', 'Americans', 'Wall Street', 'Silicon Valley',
       'New York', 'San Francisco', 'Los Angeles', 'Chicago', ...US_STATES],
  UK: ['United Kingdom', 'U.K.', 'UK', 'Britain', 'British', 'England', 'Scotland', 'Scottish', 'Wales', 'London'],
  Europe: ['European Union', 'EU', 'Europe', 'European', 'Eurozone', 'euro zone'],
  Canada: ['Canada', 'Canadian', 'Toronto'], Mexico: ['Mexico', 'Mexican'], Brazil: ['Brazil', 'Brazilian'],
  Argentina: ['Argentina', 'Argentine', 'Argentinian'], Chile: ['Chile', 'Chilean'],
  Colombia: ['Colombia', 'Colombian'], Peru: ['Peru', 'Peruvian'], 'Latin America': ['Latin America', 'LatAm'],
  Germany: ['Germany', 'German'], France: ['France', 'French'], Spain: ['Spain', 'Spanish'],
  Italy: ['Italy', 'Italian'], Netherlands: ['Netherlands', 'Dutch'], Sweden: ['Sweden', 'Swedish'],
  Norway: ['Norway', 'Norwegian'], Denmark: ['Denmark', 'Danish'], Finland: ['Finland', 'Finnish'],
  Ireland: ['Ireland', 'Irish'], Switzerland: ['Switzerland', 'Swiss'], Belgium: ['Belgium', 'Belgian'],
  Austria: ['Austria', 'Austrian'], Poland: ['Poland'], Portugal: ['Portugal', 'Portuguese'],
  Greece: ['Greece', 'Greek'], 'Türkiye': ['Türkiye', 'Turkish'], Russia: ['Russia', 'Russian'],
  Ukraine: ['Ukraine', 'Ukrainian'], Israel: ['Israel', 'Israeli'], 'Saudi Arabia': ['Saudi Arabia', 'Saudi'],
  UAE: ['United Arab Emirates', 'UAE', 'Emirati', 'Dubai', 'Abu Dhabi'], Qatar: ['Qatar', 'Qatari'],
  Egypt: ['Egypt', 'Egyptian'], Nigeria: ['Nigeria', 'Nigerian'], Kenya: ['Kenya', 'Kenyan'],
  'South Africa': ['South Africa', 'South African'], India: ['India', 'Indian'], Pakistan: ['Pakistan', 'Pakistani'],
  China: ['China', 'Chinese', 'Beijing', 'Shanghai'], Japan: ['Japan', 'Japanese', 'Tokyo'],
  'South Korea': ['South Korea', 'Korea', 'Korean', 'Seoul'], Taiwan: ['Taiwan', 'Taiwanese'],
  'Hong Kong': ['Hong Kong'], Singapore: ['Singapore', 'Singaporean'],
  Indonesia: ['Indonesia', 'Indonesian'], Philippines: ['Philippines', 'Filipino'],
  Vietnam: ['Vietnam', 'Vietnamese'], Thailand: ['Thailand', 'Thai'], Malaysia: ['Malaysia', 'Malaysian'],
  Australia: ['Australia', 'Australian', 'New South Wales', 'Sydney'], 'New Zealand': ['New Zealand'],
  'Asia-Pacific': ['Asia-Pacific', 'Asia Pacific', 'APAC', 'Southeast Asia', 'Asia'],
  'Middle East': ['Middle East', 'Gulf states'], Africa: ['Africa', 'African'],
};

// Where each tracked company is headquartered (fallback only). Everything not
// listed is US-based.
const HQ = {
  Adyen: 'Netherlands', Revolut: UK, Klarna: 'Sweden', 'Crypto.com': 'Singapore',
  Shopify: 'Canada', IHG: UK, Afterpay: 'Australia', Binance: null,
};

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// One alternation, longest names first so "New Mexico" beats "Mexico" and
// "South Korea" beats "Korea".
const TEXT_ENTRIES = Object.entries(TEXT_PLACES)
  .flatMap(([region, names]) => names.map(n => ({ n, region })))
  .sort((a, b) => b.n.length - a.n.length);
const TEXT_LOOKUP = new Map(TEXT_ENTRIES.map(e => [e.n, e.region]));
const TEXT_RE = new RegExp(
  `(?<![\\w.])(${TEXT_ENTRIES.map(e => escapeRe(e.n)).join('|')})(?![\\w]|\\.\\w)`, 'g');

const DATELINE_LOOKUP = new Map();
for (const [region, cities] of Object.entries(DATELINE_CITIES)) cities.forEach(c => DATELINE_LOOKUP.set(c.toLowerCase(), region));
US_STATES.forEach(s => DATELINE_LOOKUP.set(s.toLowerCase(), US));
US_STATE_ABBREVS.forEach(s => DATELINE_LOOKUP.set(s.toLowerCase(), US));
for (const [region, names] of Object.entries(TEXT_PLACES)) {
  if (region === 'US') continue;
  names.forEach(n => { if (!DATELINE_LOOKUP.has(n.toLowerCase())) DATELINE_LOOKUP.set(n.toLowerCase(), region); });
}

// "CHARLOTTE, N.C., Oct. 14, 2026 /PRNewswire/ --"  → "CHARLOTTE, N.C."
// "SAN FRANCISCO--(BUSINESS WIRE)--"                → "SAN FRANCISCO"
// "WASHINGTON (AP) —"                                → "WASHINGTON"
const DATELINE_RE = /^\s*([A-ZÀ-Ý][A-Za-zÀ-ÿ.'’ -]{1,40}(?:,\s*[A-Za-zÀ-ÿ.' ]{2,30}){0,2}?)(?:,\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}\b|\s*-{1,2}\s*\(?(?:BUSINESS WIRE|GLOBE NEWSWIRE|PRNewswire)|\s+\((?:AP|Reuters|BUSINESS WIRE)\))/;

function regionFromDateline(desc) {
  if (!desc) return null;
  const m = desc.match(DATELINE_RE);
  if (!m) return null;
  // Check the most specific-to-least: "N.C." before "CHARLOTTE"; country before city
  const parts = m[1].split(',').map(p => p.replace(/[\s\-–—]+$/, '').trim()).filter(Boolean).reverse();
  for (const p of parts) {
    if (US_POSTAL.has(p)) return US;
    const hit = DATELINE_LOOKUP.get(p.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

function regionFromText(text) {
  if (!text) return null;
  TEXT_RE.lastIndex = 0;
  const m = TEXT_RE.exec(text);
  return m ? TEXT_LOOKUP.get(m[1]) : null;
}

function detectRegion({ title, description, companies, sourceType }) {
  const fromStory = regionFromDateline(description) || regionFromText(title) || regionFromText(description);
  if (fromStory) return { region: fromStory, basis: 'story' };

  const list = Array.isArray(companies) ? companies : String(companies || '').split(',').map(s => s.trim()).filter(Boolean);
  if (list.length) {
    const hq = Object.prototype.hasOwnProperty.call(HQ, list[0]) ? HQ[list[0]] : US;
    if (hq) return { region: hq, basis: 'hq' };
  }
  if (sourceType === 'filing') return { region: US, basis: 'hq' };   // SEC 8-Ks are US filers
  return null;
}

module.exports = { detectRegion, regionFromDateline, regionFromText };
