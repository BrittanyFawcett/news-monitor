/* ── Constants ──────────────────────────────────────────────────── */
const ALL_INDUSTRIES = [
  'big_tech_fintech', 'card_networks', 'payments', 'commerce', 'bnpl',
  'neobanks', 'brokerage', 'mortgage_lending', 'crypto', 'open_banking',
];
const ALL_EVENT_TYPES = ['ma_fundraising', 'earnings', 'partnerships', 'product_launch', 'leadership', 'regulatory', 'industry_news'];
const ALL_SOURCES     = ['news', 'rss', 'filing', 'press_release'];
const LIMIT           = 15;

const INDUSTRY_LABELS = {
  big_tech_fintech: 'Big Tech',
  payments:         'Payments',
  brokerage:        'Brokerage & Asset Management',
  card_networks:    'Card Networks',
  open_banking:     'Data & Open Banking',
  crypto:           'Crypto',
  neobanks:         'Neobanks',
  bnpl:             'Buy Now Pay Later',
  mortgage_lending: 'Mortgage & Lending',
  commerce:         'Commerce & Embedded Finance',
};

const EVENT_TYPE_LABELS = {
  // UI compound key
  ma_fundraising: 'M&A / Fundraising',
  // UI + DB keys
  earnings:       'Earnings',
  partnerships:   'Partnerships',
  product_launch: 'Product Launch',
  leadership:     'Leadership',
  regulatory:     'Regulatory',
  // DB-only keys (used in breaking/section card badges)
  ma:             'M&A',
  fundraising:    'Fundraising',
  industry_news:  'Industry News',
};

const SOURCE_LABELS = {
  news: 'News', rss: 'RSS', filing: 'SEC Filing', press_release: 'Press Release',
};

const COMPANY_GROUPS = {
  big_tech_fintech: { label: 'Big Tech',             companies: ['Apple', 'Amazon', 'Google', 'Microsoft', 'Meta'] },
  card_networks:    { label: 'Card Networks',         companies: ['Visa', 'Mastercard', 'American Express', 'Discover'] },
  payments:         { label: 'Payments',              companies: ['PayPal', 'Stripe', 'Block', 'Bilt', 'Adyen'] },
  commerce:         { label: 'Commerce',              companies: ['Shopify'] },
  bnpl:             { label: 'BNPL',                  companies: ['Klarna', 'Affirm', 'Afterpay'] },
  neobanks:         { label: 'Neobanks',              companies: ['Chime', 'SoFi', 'Revolut'] },
  brokerage:        { label: 'Brokerage',             companies: ['Fidelity', 'Schwab', 'Vanguard', 'BlackRock', 'Robinhood'] },
  mortgage_lending: { label: 'Mortgage & Lending',   companies: ['Rocket Mortgage', 'LoanDepot', 'Better.com'] },
  crypto:           { label: 'Crypto',                companies: ['Coinbase', 'Kraken', 'Crypto.com', 'Binance'] },
  open_banking:     { label: 'Data & Open Banking',  companies: ['Plaid', 'Finicity', 'Yodlee', 'MX'] },
};

/* ── State ──────────────────────────────────────────────────────── */
const state = {
  industries:      new Set(ALL_INDUSTRIES),
  eventTypes:      new Set(),
  sourceTypes:     new Set(ALL_SOURCES),
  datePreset:      '7d',
  search:          '',
  selectedCompany: null,
  loading:         false,
};

/* ── DOM refs ───────────────────────────────────────────────────── */
const feedContent    = document.getElementById('feed-content');
const resultCount    = document.getElementById('result-count');
const filterSummary  = document.getElementById('filter-summary');
const fetchBtn       = document.getElementById('fetch-btn');
const fetchIcon      = document.getElementById('fetch-icon');
const fetchText      = document.getElementById('fetch-text');
const fetchNotice    = document.getElementById('fetch-notice');
const emptyState     = document.getElementById('empty-state');
const emptyMsg       = document.getElementById('empty-message');
const loadingSpinner = document.getElementById('loading-spinner');
const searchInput    = document.getElementById('search-input');
const totalCount     = document.getElementById('total-count');
const lastFetched    = document.getElementById('last-fetched');

/* ── Utilities ──────────────────────────────────────────────────── */
function timeAgo(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const secs = Math.floor((Date.now() - d) / 1000);
  if (secs < 60)      return 'just now';
  if (secs < 3600)    return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400)   return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 2592000) return `${Math.floor(secs / 86400)}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function dateFromPreset(preset) {
  if (preset === 'all') return null;
  const d = new Date();
  if (preset === '1d')  d.setDate(d.getDate() - 1);
  if (preset === '3d')  d.setDate(d.getDate() - 3);
  if (preset === '7d')  d.setDate(d.getDate() - 7);
  if (preset === '30d') d.setDate(d.getDate() - 30);
  if (preset === '1y')  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString();
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildFilterParams() {
  const params = new URLSearchParams();

  const industries = [...state.industries];
  if (industries.length && industries.length < ALL_INDUSTRIES.length) {
    params.set('industry', industries.join(','));
  }

  if (state.eventTypes.size > 0) {
    const apiTypes = new Set();
    for (const t of state.eventTypes) {
      if (t === 'ma_fundraising') { apiTypes.add('ma'); apiTypes.add('fundraising'); }
      else if (t === 'industry_news') { apiTypes.add('none'); }
      else apiTypes.add(t);
    }
    params.set('event_type', [...apiTypes].join(','));
  }

  const sources = [...state.sourceTypes];
  if (sources.length && sources.length < ALL_SOURCES.length) {
    params.set('source_type', sources.join(','));
  }

  const from = dateFromPreset(state.datePreset);
  if (from) params.set('date_from', from);

  if (state.search.trim()) params.set('search', state.search.trim());
  if (state.selectedCompany) params.set('company', state.selectedCompany);

  return params;
}

function updateFilterSummary() {
  const parts = [];

  if (state.selectedCompany) {
    parts.push(state.selectedCompany);
  } else {
    const ind = [...state.industries];
    if (ind.length === ALL_INDUSTRIES.length) parts.push('All categories');
    else if (ind.length === 0) parts.push('No category');
    else parts.push(ind.map(i => INDUSTRY_LABELS[i] || i).join(', '));
  }

  if (state.eventTypes.size > 0) {
    parts.push([...state.eventTypes].map(e => EVENT_TYPE_LABELS[e] || e).join(', '));
  }

  const src = [...state.sourceTypes];
  if (src.length < ALL_SOURCES.length && src.length > 0) {
    parts.push(src.map(s => SOURCE_LABELS[s]).join(', '));
  }

  const presetLabels = { '1d': 'Today', '3d': 'Last 3 days', '7d': 'Last 7 days', '30d': 'Last 30 days', '1y': 'Last year', all: 'All time' };
  parts.push(presetLabels[state.datePreset] || '');

  if (state.search.trim()) parts.push(`"${state.search.trim()}"`);

  filterSummary.textContent = parts.filter(Boolean).join(' · ');
}

/* ── Rendering helpers ──────────────────────────────────────────── */
function companyTagsHtml(companies) {
  if (!companies) return '';
  const names = companies.split(',').filter(Boolean).slice(0, 4);
  if (!names.length) return '';
  return `<div class="company-tags">${names.map(n =>
    `<span class="company-tag">${escapeHtml(n)}</span>`
  ).join('')}</div>`;
}

function sectionCardHtml(a) {
  if (!a.url) return '';
  const desc = a.description
    ? `<p class="card-description">${escapeHtml(a.description)}</p>`
    : '';
  const img = a.image_url
    ? `<div class="card-image"><img src="${escapeHtml(a.image_url)}" alt="" loading="lazy" onerror="this.parentElement.remove()"></div>`
    : '';
  return `
    <a class="article-card" href="${escapeHtml(a.url)}" target="_blank" rel="noopener noreferrer">
      <div class="card-body">
        <div class="card-meta">
          <span class="badge badge-${a.source_type}">${SOURCE_LABELS[a.source_type] || a.source_type}</span>
          <span class="card-time">${timeAgo(a.published_at)}</span>
        </div>
        <h3 class="card-title">${escapeHtml(a.title)}</h3>
        ${desc}
        ${companyTagsHtml(a.companies)}
        <div class="card-footer">
          <span class="card-source">${escapeHtml(a.source_name || '')}</span>
        </div>
      </div>
      ${img}
    </a>`;
}

function breakingCardHtml(a) {
  if (!a.url) return '';
  const industryLabel = (INDUSTRY_LABELS[a.industry] || a.industry).toUpperCase();
  const companies     = a.companies ? a.companies.split(',').filter(Boolean) : [];
  const topLine       = companies.length
    ? `${industryLabel}: ${companies[0].toUpperCase()}`
    : industryLabel;
  const evtLabel = (a.event_type && EVENT_TYPE_LABELS[a.event_type]) || (a.event_type ? a.event_type : 'Industry News');
  const evtHtml = `<div class="breaking-evt-row"><span class="breaking-evt-tag">${evtLabel}</span></div>`;
  const timeStr = a.published_at ? ` · ${timeAgo(a.published_at)}` : '';
  return `
    <a class="breaking-card" href="${escapeHtml(a.url)}" target="_blank" rel="noopener noreferrer">
      <div class="breaking-card-body">
        <div class="breaking-card-top">${escapeHtml(topLine)}</div>
        ${evtHtml}
        <div class="breaking-card-divider"></div>
        <div class="breaking-card-title">${escapeHtml(a.title)}</div>
        <div class="breaking-card-footer">${escapeHtml(a.source_name || '')}${timeStr}</div>
      </div>
    </a>`;
}

/* ── Breaking section ───────────────────────────────────────────── */
function renderBreakingSection(articles) {
  const section = document.createElement('section');
  section.className = 'breaking-section';
  section.innerHTML = `
    <div class="breaking-header">
      <div class="breaking-badge">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
          <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>
        </svg>
        Breaking News
      </div>
      <span class="breaking-desc">High-impact events from tracked companies</span>
    </div>
    <div class="breaking-feed">
      ${articles.map(breakingCardHtml).join('')}
    </div>`;
  return section;
}

/* ── Industry section ───────────────────────────────────────────── */
function renderIndustrySection({ industry, total, eventGroups, general }) {
  const section = document.createElement('section');
  section.className = 'industry-section';
  section.dataset.industry = industry;

  const shown  = eventGroups.reduce((s, g) => s + g.articles.length, 0) + general.length;
  const hasMore = total > shown;
  section.dataset.offset = shown;

  const label = INDUSTRY_LABELS[industry] || industry;

  const groupsHtml = eventGroups.map(({ eventType, articles }) => `
    <div class="event-group">
      <div class="event-group-header event-group-toggle">
        <span class="event-group-label">${EVENT_TYPE_LABELS[eventType] || eventType} (${articles.length})</span>
        <svg class="event-group-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>
      <div class="articles-list event-group-body">
        ${articles.map(sectionCardHtml).join('')}
      </div>
    </div>`).join('');

  const generalHtml = (general.length > 0 || hasMore)
    ? `<div class="event-group">
        <div class="event-group-header event-group-toggle">
          <span class="event-group-label">Industry News (${general.length})</span>
          <svg class="event-group-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
        <div class="articles-list event-group-body" id="general-list-${industry}">
          ${general.map(sectionCardHtml).join('')}
        </div>
      </div>`
    : '';

  const moreBtnHtml = hasMore
    ? `<button class="load-section-btn" data-industry="${industry}">
        Show more ${escapeHtml(label)} articles
       </button>`
    : '';

  section.innerHTML = `
    <div class="industry-header">
      <h2 class="industry-title">${escapeHtml(label)}</h2>
      <span class="industry-count">${total.toLocaleString()}</span>
    </div>
    <div class="industry-body">
      ${groupsHtml}
      ${generalHtml}
      <div class="section-more" id="more-${industry}">${moreBtnHtml}</div>
    </div>`;

  section.querySelectorAll('.event-group-toggle').forEach(header => {
    header.addEventListener('click', () => {
      header.closest('.event-group').classList.toggle('collapsed');
    });
  });

  const btn = section.querySelector('.load-section-btn');
  if (btn) btn.addEventListener('click', () => loadMoreForSection(section, industry));

  return section;
}

/* ── Load more for a section ────────────────────────────────────── */
async function loadMoreForSection(section, industry) {
  const btn = section.querySelector('.load-section-btn');
  if (btn) { btn.textContent = 'Loading…'; btn.disabled = true; }

  const offset = parseInt(section.dataset.offset) || 0;
  const params = buildFilterParams();
  params.set('industry', industry);
  params.set('offset', offset);
  params.set('limit', LIMIT);

  try {
    const res  = await fetch(`/api/articles?${params}`);
    const data = await res.json();

    let generalList = section.querySelector(`#general-list-${industry}`);
    if (!generalList) {
      generalList = document.createElement('div');
      generalList.id = `general-list-${industry}`;
      section.querySelector('.industry-body').appendChild(generalList);
    }

    generalList.insertAdjacentHTML('beforeend', data.articles.map(sectionCardHtml).join(''));

    const newOffset = offset + data.articles.length;
    section.dataset.offset = newOffset;

    const moreDiv = section.querySelector(`#more-${industry}`);
    if (newOffset >= data.total || data.articles.length < LIMIT) {
      if (moreDiv) moreDiv.innerHTML = '';
    } else {
      if (btn) { btn.textContent = `Show more ${INDUSTRY_LABELS[industry] || industry} articles`; btn.disabled = false; }
    }
  } catch {
    if (btn) { btn.textContent = 'Error — try again'; btn.disabled = false; }
  }
}

/* ── Main feed loader ───────────────────────────────────────────── */
async function loadFeed() {
  if (state.loading) return;
  state.loading = true;

  loadingSpinner.classList.remove('hidden');
  emptyState.classList.add('hidden');
  feedContent.innerHTML = '';

  if (state.industries.size === 0 || state.sourceTypes.size === 0) {
    resultCount.textContent = '0';
    updateFilterSummary();
    emptyState.classList.remove('hidden');
    emptyMsg.textContent = 'No categories or sources selected. Enable at least one to see articles.';
    state.loading = false;
    loadingSpinner.classList.add('hidden');
    return;
  }

  try {
    const params = buildFilterParams();
    const res  = await fetch(`/api/feed?${params}`);
    const data = await res.json();

    resultCount.textContent = (data.total || 0).toLocaleString();
    updateFilterSummary();

    if (data.breaking.length === 0 && data.sections.length === 0) {
      emptyState.classList.remove('hidden');
      const hasFilters = state.industries.size < ALL_INDUSTRIES.length
        || state.sourceTypes.size < ALL_SOURCES.length
        || state.eventTypes.size > 0
        || state.selectedCompany;
      emptyMsg.textContent = hasFilters
        ? 'No articles match your current filters. Try broadening your selection.'
        : 'No articles yet. Click "Fetch Latest" to populate your feed.';
    } else {
      if (data.breaking.length > 0) {
        feedContent.appendChild(renderBreakingSection(data.breaking));
      }
      for (const section of data.sections) {
        feedContent.appendChild(renderIndustrySection(section));
      }
    }
  } catch (err) {
    console.error('Feed error:', err);
  } finally {
    state.loading = false;
    loadingSpinner.classList.add('hidden');
  }
}

/* ── Status polling ─────────────────────────────────────────────── */
async function refreshStatus() {
  try {
    const res  = await fetch('/api/status');
    const data = await res.json();

    totalCount.textContent  = data.total?.toLocaleString() ?? '—';
    lastFetched.textContent = data.lastFetchTime ? timeAgo(data.lastFetchTime) : '—';

    for (const ind of ALL_INDUSTRIES) {
      const el = document.getElementById(`cnt-${ind}`);
      if (el) el.textContent = data[`${ind}_count`]?.toLocaleString() ?? '—';
    }
    // Combined M&A + Fundraising count
    const mafEl = document.getElementById('cnt-ma_fundraising');
    if (mafEl) mafEl.textContent = ((data.ma_count || 0) + (data.fundraising_count || 0)).toLocaleString();
    // Individual event type counts
    for (const et of ['earnings', 'partnerships', 'product_launch', 'leadership', 'regulatory', 'industry_news']) {
      const el = document.getElementById(`cnt-${et}`);
      if (el) el.textContent = data[`${et}_count`]?.toLocaleString() ?? '—';
    }
    const srcMap = { news: data.news_count, rss: data.rss_count, filing: data.filing_count, press_release: data.press_release_count };
    for (const [k, v] of Object.entries(srcMap)) {
      const el = document.getElementById(`cnt-${k}`);
      if (el) el.textContent = v?.toLocaleString() ?? '—';
    }

    if (!data.isFetching && fetchBtn.disabled) {
      setFetchIdle();
      fetchNotice.classList.add('hidden');
      loadFeed();
    }
  } catch { /* ignore */ }
}

let statusInterval = null;

function setFetchIdle() {
  fetchBtn.disabled = false;
  fetchIcon.classList.remove('spinning');
  fetchText.textContent = 'Fetch Latest';
  if (statusInterval) { clearInterval(statusInterval); statusInterval = null; }
}

function setFetchBusy() {
  fetchBtn.disabled = true;
  fetchIcon.classList.add('spinning');
  fetchText.textContent = 'Fetching…';
  fetchNotice.classList.remove('hidden');
  statusInterval = setInterval(refreshStatus, 4000);
}

/* ── Company picker ─────────────────────────────────────────────── */
function buildCompanyPicker() {
  const panel = document.getElementById('company-filter');

  let html = '';
  for (const [, { label: groupLabel, companies }] of Object.entries(COMPANY_GROUPS)) {
    html += `<div class="company-group">
      <div class="company-group-label">${escapeHtml(groupLabel)}</div>
      <div class="company-chips">
        ${companies.map(c =>
          `<button class="company-chip" data-company="${escapeHtml(c)}">${escapeHtml(c)}</button>`
        ).join('')}
      </div>
    </div>`;
  }
  panel.innerHTML = html;

  panel.querySelectorAll('.company-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const company = btn.dataset.company;
      if (state.selectedCompany === company) {
        clearCompanyFilter();
      } else {
        panel.querySelectorAll('.company-chip').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.selectedCompany = company;
        showCompanyClear(company);
        loadFeed();
      }
    });
  });
}

function showCompanyClear(company) {
  const clearBtn   = document.getElementById('company-clear-btn');
  const clearLabel = document.getElementById('company-clear-label');
  clearLabel.textContent = company;
  clearBtn.classList.remove('hidden');
}

function clearCompanyFilter() {
  state.selectedCompany = null;
  document.getElementById('company-clear-btn').classList.add('hidden');
  document.querySelectorAll('.company-chip').forEach(b => b.classList.remove('active'));
  loadFeed();
}

document.getElementById('company-clear-btn').addEventListener('click', clearCompanyFilter);

document.getElementById('companies-toggle').addEventListener('click', () => {
  const panel  = document.getElementById('company-filter');
  const toggle = document.getElementById('companies-toggle');
  const open   = panel.style.display === 'none';
  panel.style.display = open ? '' : 'none';
  toggle.classList.toggle('expanded', open);
});

/* ── Select All / Deselect All ──────────────────────────────────── */
function updateSelectAllBtn(section) {
  if (section === 'industry') {
    const btn = document.getElementById('industry-select-all');
    if (btn) btn.textContent = state.industries.size === ALL_INDUSTRIES.length ? 'Deselect All' : 'Select All';
  } else if (section === 'event_type') {
    const btn = document.getElementById('eventtype-select-all');
    if (btn) btn.textContent = state.eventTypes.size === ALL_EVENT_TYPES.length ? 'Deselect All' : 'Select All';
  }
}

document.querySelectorAll('.select-all-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const section = btn.dataset.section;
    if (section === 'industry') {
      const allSelected = state.industries.size === ALL_INDUSTRIES.length;
      if (allSelected) {
        state.industries.clear();
        document.querySelectorAll('.filter-btn[data-group="industry"]').forEach(b => b.classList.remove('active'));
      } else {
        ALL_INDUSTRIES.forEach(v => state.industries.add(v));
        document.querySelectorAll('.filter-btn[data-group="industry"]').forEach(b => b.classList.add('active'));
      }
      updateSelectAllBtn('industry');
    } else if (section === 'event_type') {
      const allSelected = state.eventTypes.size === ALL_EVENT_TYPES.length;
      if (allSelected) {
        state.eventTypes.clear();
        document.querySelectorAll('.filter-btn[data-group="event_type"]').forEach(b => b.classList.remove('active'));
      } else {
        ALL_EVENT_TYPES.forEach(v => state.eventTypes.add(v));
        document.querySelectorAll('.filter-btn[data-group="event_type"]').forEach(b => b.classList.add('active'));
      }
      updateSelectAllBtn('event_type');
    }
    loadFeed();
  });
});

/* ── Filter wiring ──────────────────────────────────────────────── */
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const group = btn.dataset.group;
    const value = btn.dataset.value;
    const setMap = { industry: state.industries, source_type: state.sourceTypes, event_type: state.eventTypes };
    const set = setMap[group];
    if (!set) return;

    if (set.has(value)) set.delete(value);
    else set.add(value);
    btn.classList.toggle('active', set.has(value));
    if (group === 'industry') updateSelectAllBtn('industry');
    if (group === 'event_type') updateSelectAllBtn('event_type');
    loadFeed();
  });
});

document.querySelectorAll('.preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.datePreset = btn.dataset.preset;
    loadFeed();
  });
});

let searchTimer;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.search = searchInput.value;
    loadFeed();
  }, 350);
});

/* ── Fetch button ───────────────────────────────────────────────── */
async function triggerFetch() {
  if (fetchBtn.disabled) return;
  setFetchBusy();
  try {
    const res  = await fetch('/api/fetch', { method: 'POST' });
    const data = await res.json();
    if (data.status !== 'already_running') return;
  } catch {
    setFetchIdle();
    fetchNotice.classList.add('hidden');
  }
}

fetchBtn.addEventListener('click', triggerFetch);
document.getElementById('empty-fetch-btn').addEventListener('click', triggerFetch);

/* ── Init ───────────────────────────────────────────────────────── */
buildCompanyPicker();
updateFilterSummary();
loadFeed();
refreshStatus();
setInterval(refreshStatus, 30000);
