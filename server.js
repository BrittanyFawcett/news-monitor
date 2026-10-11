require('dotenv').config();
const express = require('express');
const cron    = require('node-cron');
const path    = require('path');
const db      = require('./db');
const { fetchNewsAPI }      = require('./fetchers/newsapi');
const { fetchRSSFeeds, fetchGlobalRSSFeeds } = require('./fetchers/rss');
const { fetchEDGARFilings } = require('./fetchers/edgar');
const { fetchPressReleases } = require('./fetchers/pressrelease');
const { fetchCurrentsAPI }  = require('./fetchers/currents');
const { fetchGNews }        = require('./fetchers/gnews');
const { isBreaking, isRelevant, detectCompanies, detectIndustry, detectEventType, isLeadershipEvent } = require('./fetchers/classify');
const { decodeEntities }    = require('./fetchers/decode');
const { applyLearnedFilter, learningSummary } = require('./learn');

const app  = express();
const PORT = process.env.PORT || 3000;

const INDUSTRIES = [
  'big_banks', 'big_tech_fintech', 'card_networks', 'payments', 'commerce', 'bnpl',
  'neobanks', 'brokerage', 'mortgage_lending', 'digital_assets', 'open_banking',
];

const EVENT_TYPES = ['ma', 'ipo', 'fundraising', 'earnings', 'partnerships', 'product_launch', 'leadership', 'regulatory'];

// Event types that qualify an article for Breaking News (product_launch and
// fundraising excluded — too noisy; fundraising breaking articles surface via ma/ipo)
const BREAKING_EVENT_TYPES = ['ma', 'ipo', 'earnings', 'leadership', 'regulatory'];

// Order in which event types are displayed within each industry section
const EVENT_TYPE_ORDER = ['ma', 'ipo', 'fundraising', 'earnings', 'partnerships', 'product_launch', 'leadership', 'regulatory'];

let isFetching    = false;
let lastFetchTime = null;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Fetcher ────────────────────────────────────────────────────────────────
async function runAllFetchers() {
  if (isFetching) return;
  isFetching = true;
  console.log('\n[Fetch] Starting...');

  // Per-industry: NewsAPI + RSS + Currents + GNews
  for (const industry of INDUSTRIES) {
    await fetchNewsAPI(industry);
    await fetchRSSFeeds(industry);
    await fetchCurrentsAPI(industry);
    await fetchGNews(industry);
  }

  // Global financial publications — fetched once, industry assigned per article
  await fetchGlobalRSSFeeds();

  // Company-specific: SEC EDGAR 8-K filings (CIK-based, runs once)
  await fetchEDGARFilings();

  // Press releases: BusinessWire, PR Newswire, GlobeNewswire
  await fetchPressReleases();

  // Hide newly fetched articles that resemble ones you've flagged
  try { applyLearnedFilter(); } catch (err) { console.error('[Learn]', err.message); }

  lastFetchTime = new Date().toISOString();
  isFetching = false;
  console.log('[Fetch] Complete\n');
}

// ── Shared query builder ───────────────────────────────────────────────────
function buildBaseConditions(req) {
  const { source_type, date_from, search, company } = req.query;
  const conds  = [visibilityCondition(req)];
  const params = [];

  if (source_type) {
    const list = source_type.split(',').filter(Boolean);
    if (list.length) {
      conds.push(`source_type IN (${list.map(() => '?').join(',')})`);
      params.push(...list);
    }
  }

  if (date_from) { conds.push('published_at >= ?'); params.push(date_from); }

  if (search) {
    conds.push('(title LIKE ? OR description LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }

  if (company) {
    conds.push('companies LIKE ?');
    params.push(`%${company}%`);
  }

  return { conds, params };
}

// Normal view shows visible articles only; ?hidden=1 shows what you flagged
// plus what the learned filter hid, so you can review and restore them.
function visibilityCondition(req) {
  return req.query.hidden === '1' ? 'irrelevant IN (1, 2)' : 'COALESCE(irrelevant, 0) = 0';
}

function makeWhere(conds) {
  return conds.length ? `WHERE ${conds.join(' AND ')}` : '';
}

function applyEventTypeFilter(list, conds, params) {
  const hasNone = list.includes('none');
  const others  = list.filter(v => v !== 'none');
  if (hasNone && others.length) {
    conds.push(`(event_type IN (${others.map(() => '?').join(',')}) OR event_type IS NULL OR event_type = '')`);
    params.push(...others);
  } else if (hasNone) {
    conds.push(`(event_type IS NULL OR event_type = '')`);
  } else if (others.length) {
    conds.push(`event_type IN (${others.map(() => '?').join(',')})`);
    params.push(...others);
  }
}

// ── GET /api/feed — structured layout ─────────────────────────────────────
app.get('/api/feed', (req, res) => {
  const { industry, event_type } = req.query;
  const activeIndustries = industry ? industry.split(',').filter(Boolean) : INDUSTRIES;
  const activeEventTypes = event_type ? event_type.split(',').filter(Boolean) : null;

  const { conds: base, params: baseParams } = buildBaseConditions(req);

  try {
    // ── Breaking news — uses is_breaking flag set at fetch time ────────────
    let breaking = [];
    if (req.query.hidden !== '1') {
      const bConds  = [...base, 'is_breaking = 1',
        `event_type IN (${BREAKING_EVENT_TYPES.map(() => '?').join(',')})`];
      const bParams = [...baseParams, ...BREAKING_EVENT_TYPES];

      if (activeEventTypes) applyEventTypeFilter(activeEventTypes, bConds, bParams);

      if (activeIndustries.length < INDUSTRIES.length) {
        bConds.push(`industry IN (${activeIndustries.map(() => '?').join(',')})`);
        bParams.push(...activeIndustries);
      }

      breaking = db.prepare(
        `SELECT * FROM articles ${makeWhere(bConds)} ORDER BY published_at DESC`
      ).all(...bParams);
    }

    // ── Industry sections ───────────────────────────────────────────────
    const sections = [];
    let total = 0;

    for (const ind of activeIndustries) {
      const iConds  = [...base, 'industry = ?'];
      const iParams = [...baseParams, ind];

      if (activeEventTypes) applyEventTypeFilter(activeEventTypes, iConds, iParams);

      const where  = makeWhere(iConds);
      const indTotal = db.prepare(`SELECT COUNT(*) as n FROM articles ${where}`).get(...iParams).n;
      if (!indTotal) continue;
      total += indTotal;

      const articles = db.prepare(
        `SELECT * FROM articles ${where} ORDER BY published_at DESC LIMIT 200`
      ).all(...iParams);

      const groups  = {};
      const general = [];

      for (const a of articles) {
        if (a.event_type) {
          if (!groups[a.event_type]) groups[a.event_type] = [];
          groups[a.event_type].push(a);
        } else {
          if (general.length < 10) general.push(a);
        }
      }

      const eventGroups = EVENT_TYPE_ORDER
        .filter(et => groups[et])
        .map(et => ({ eventType: et, articles: groups[et] }));

      sections.push({ industry: ind, total: indTotal, eventGroups, general });
    }

    res.json({ breaking, sections, total });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/articles — flat paginated list ────────────────────────────────
app.get('/api/articles', (req, res) => {
  const { industry, source_type, event_type, date_from, date_to, search, company,
          limit = 20, offset = 0 } = req.query;

  const conditions = [visibilityCondition(req)];
  const params = [];

  if (industry) {
    const list = industry.split(',').filter(Boolean);
    if (list.length) {
      conditions.push(`industry IN (${list.map(() => '?').join(',')})`);
      params.push(...list);
    }
  }

  if (source_type) {
    const list = source_type.split(',').filter(Boolean);
    if (list.length) {
      conditions.push(`source_type IN (${list.map(() => '?').join(',')})`);
      params.push(...list);
    }
  }

  if (event_type) {
    const list = event_type.split(',').filter(Boolean);
    if (list.length) applyEventTypeFilter(list, conditions, params);
  }

  if (date_from) { conditions.push('published_at >= ?'); params.push(date_from); }
  if (date_to)   { conditions.push('published_at <= ?'); params.push(date_to + 'T23:59:59Z'); }

  if (search) {
    conditions.push('(title LIKE ? OR description LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }

  if (company) {
    conditions.push('companies LIKE ?');
    params.push(`%${company}%`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const total    = db.prepare(`SELECT COUNT(*) as n FROM articles ${where}`).get(...params).n;
    const articles = db.prepare(
      `SELECT * FROM articles ${where} ORDER BY published_at DESC LIMIT ? OFFSET ?`
    ).all(...params, parseInt(limit), parseInt(offset));

    res.json({ articles, total, offset: parseInt(offset) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/fetch ────────────────────────────────────────────────────────
app.post('/api/fetch', (req, res) => {
  if (isFetching) return res.json({ status: 'already_running' });
  res.json({ status: 'started' });
  runAllFetchers();
});

// ── POST /api/articles/:id/flag — flag as irrelevant, or restore ──────────
// Body: { irrelevant: true | false }
app.post('/api/articles/:id/flag', (req, res) => {
  const id   = parseInt(req.params.id);
  const flag = req.body?.irrelevant === true;
  const row  = db.prepare('SELECT id, irrelevant FROM articles WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Article not found' });

  try {
    if (flag) {
      db.prepare(`UPDATE articles SET irrelevant = 1, user_kept = 0, hidden_reason = NULL,
                  flagged_at = datetime('now') WHERE id = ?`).run(id);
    } else {
      // Restoring something the filter hid automatically is a signal that it got it
      // wrong: keep this article visible for good and learn from it. Un-flagging your
      // own flag is just an undo.
      const keep = row.irrelevant === 2 ? 1 : 0;
      db.prepare(`UPDATE articles SET irrelevant = 0, user_kept = ?, hidden_reason = NULL,
                  flagged_at = NULL WHERE id = ?`).run(keep, id);
    }
    const { hidden, restored } = applyLearnedFilter();
    res.json({ ok: true, id, irrelevant: flag,
               autoHidden: hidden.filter(x => x !== id), autoRestored: restored });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/learning — what the filter has learned from your flags ───────
app.get('/api/learning', (_req, res) => {
  try { res.json(learningSummary()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/status ────────────────────────────────────────────────────────
app.get('/api/status', (_req, res) => {
  const industryCols = INDUSTRIES.map(i =>
    `COUNT(CASE WHEN industry = '${i}' THEN 1 END) AS ${i}_count`
  ).join(', ');

  const eventCols = EVENT_TYPES.map(e =>
    `COUNT(CASE WHEN event_type = '${e}' THEN 1 END) AS ${e}_count`
  ).join(', ');

  const stats = db.prepare(`
    SELECT
      COUNT(*) AS total,
      COUNT(CASE WHEN source_type = 'news'          THEN 1 END) AS news_count,
      COUNT(CASE WHEN source_type = 'rss'           THEN 1 END) AS rss_count,
      COUNT(CASE WHEN source_type = 'filing'        THEN 1 END) AS filing_count,
      COUNT(CASE WHEN source_type = 'press_release' THEN 1 END) AS press_release_count,
      COUNT(CASE WHEN source_type = 'currents'      THEN 1 END) AS currents_count,
      COUNT(CASE WHEN source_type = 'gnews'         THEN 1 END) AS gnews_count,
      ${industryCols},
      ${eventCols}
    FROM articles
    WHERE COALESCE(irrelevant, 0) = 0
  `).get();

  const industry_news_count = db.prepare(
    `SELECT COUNT(*) AS n FROM articles
     WHERE (event_type IS NULL OR event_type = '') AND COALESCE(irrelevant, 0) = 0`
  ).get().n;

  const hidden = db.prepare(`
    SELECT COUNT(CASE WHEN irrelevant = 1 THEN 1 END) AS flagged_count,
           COUNT(CASE WHEN irrelevant = 2 THEN 1 END) AS auto_hidden_count
    FROM articles
  `).get();

  res.json({ ...stats, ...hidden, industry_news_count, isFetching, lastFetchTime });
});

// ── Cron: every 2 hours ────────────────────────────────────────────────────
cron.schedule('0 */2 * * *', runAllFetchers);

// ── Decode HTML entities in existing articles ──────────────────────────────
function cleanupEntityEncoding() {
  const rows = db.prepare('SELECT id, title, description, source_name, author FROM articles').all();
  const update = db.prepare('UPDATE articles SET title=?, description=?, source_name=?, author=? WHERE id=?');
  const tx = db.transaction(() => {
    let n = 0;
    for (const r of rows) {
      const t = decodeEntities(r.title);
      const d = r.description ? decodeEntities(r.description) : null;
      const s = r.source_name ? decodeEntities(r.source_name) : null;
      const a = r.author      ? decodeEntities(r.author)      : null;
      if (t !== r.title || d !== r.description || s !== r.source_name || a !== r.author) {
        update.run(t, d, s, a, r.id);
        n++;
      }
    }
    return n;
  });
  const n = tx();
  if (n > 0) console.log(`[DB] Decoded HTML entities in ${n} articles`);
}

// ── Purge irrelevant articles from Currents and GNews sources ─────────────
function cleanupIrrelevantAPIArticles() {
  const rows = db.prepare(
    `SELECT id, title, description FROM articles WHERE source_type IN ('currents', 'gnews')`
  ).all();
  if (!rows.length) return;
  const del = db.prepare('DELETE FROM articles WHERE id = ?');
  const tx  = db.transaction(() => {
    let n = 0;
    for (const r of rows) {
      const companies = detectCompanies(r.title, r.description);
      if (!isRelevant(r.title, r.description, companies)) { del.run(r.id); n++; }
    }
    return n;
  });
  const n = tx();
  if (n > 0) console.log(`[DB] Removed ${n} irrelevant Currents/GNews articles`);
}

// ── Recompute is_breaking using title-only check ───────────────────────────
// Clears stale flags set by the old description-inclusive isBreaking() logic.
function recomputeBreakingFlags() {
  const rows = db.prepare('SELECT id, title FROM articles WHERE is_breaking = 1').all();
  if (!rows.length) return;
  const clear = db.prepare('UPDATE articles SET is_breaking = 0 WHERE id = ?');
  const tx = db.transaction(() => {
    let n = 0;
    for (const r of rows) {
      if (!isBreaking(r.title, null)) { clear.run(r.id); n++; }
    }
    return n;
  });
  const n = tx();
  if (n > 0) console.log(`[DB] Cleared stale is_breaking flag from ${n} articles`);
}

// ── Reclassify fundraising → ipo for articles saved before the split ───────
function reclassifyIPOEventType() {
  const rows = db.prepare(
    `SELECT id, title, description FROM articles WHERE event_type = 'fundraising'`
  ).all();
  if (!rows.length) return;
  const update = db.prepare(`UPDATE articles SET event_type = 'ipo' WHERE id = ?`);
  const tx = db.transaction(() => {
    let n = 0;
    for (const r of rows) {
      if (detectEventType(r.title, r.description) === 'ipo') { update.run(r.id); n++; }
    }
    return n;
  });
  const n = tx();
  if (n > 0) console.log(`[DB] Reclassified ${n} fundraising articles as ipo`);
}

// ── Migrate crypto → digital_assets ───────────────────────────────────────
function migrateCryptoToDigitalAssets() {
  const { changes } = db.prepare(
    `UPDATE articles SET industry = 'digital_assets' WHERE industry = 'crypto'`
  ).run();
  if (changes > 0) console.log(`[DB] Migrated ${changes} articles: crypto → digital_assets`);
}

// ── Remove leadership tag from articles that fail the new two-condition check ─
function recomputeLeadershipTags() {
  const rows = db.prepare(
    `SELECT id, title, companies FROM articles WHERE event_type = 'leadership'`
  ).all();
  if (!rows.length) return;
  const clear = db.prepare(`UPDATE articles SET event_type = NULL WHERE id = ?`);
  const tx = db.transaction(() => {
    let n = 0;
    for (const r of rows) {
      const companies = r.companies ? r.companies.split(',').filter(Boolean) : [];
      if (!isLeadershipEvent(r.title, companies)) { clear.run(r.id); n++; }
    }
    return n;
  });
  const n = tx();
  if (n > 0) console.log(`[DB] Cleared leadership tag from ${n} unqualified articles`);
}

// ── Remove Visa false positives saved before exclusion fix ────────────────
function removeVisaFalsePositives() {
  const rows = db.prepare(
    `SELECT id, title, description, companies, industry FROM articles WHERE companies LIKE '%Visa%'`
  ).all();
  if (!rows.length) return;
  const update = db.prepare(`UPDATE articles SET companies = ?, industry = ? WHERE id = ?`);
  const tx = db.transaction(() => {
    let n = 0;
    for (const r of rows) {
      // LIKE '%Visa%' is broad; confirm Visa is actually in the stored list
      const stored = (r.companies || '').split(',').map(c => c.trim());
      if (!stored.includes('Visa')) continue;
      const redetected = detectCompanies(r.title, r.description);
      if (redetected.includes('Visa')) continue;
      const newCompanies = redetected.join(',');
      const newIndustry  = detectIndustry(redetected, r.title, r.description) || r.industry;
      update.run(newCompanies, newIndustry, r.id);
      n++;
    }
    return n;
  });
  const n = tx();
  if (n > 0) console.log(`[DB] Removed Visa false positives from ${n} articles`);
}

// ── Remove Plaid fashion false positives saved before the context check ───
// Re-runs detection on every article that mentions "plaid". If it no longer
// detects Plaid the company, Plaid is dropped from its tags; if nothing else
// makes it relevant, the article is deleted (same rule a new fetch applies).
function removePlaidFalsePositives() {
  const rows = db.prepare(
    `SELECT id, title, description, companies, industry FROM articles
     WHERE LOWER(title) LIKE '%plaid%' OR LOWER(COALESCE(description, '')) LIKE '%plaid%'`
  ).all();
  if (!rows.length) return;
  const update = db.prepare(`UPDATE articles SET companies = ?, industry = ? WHERE id = ?`);
  const del    = db.prepare(`DELETE FROM articles WHERE id = ?`);
  const tx = db.transaction(() => {
    let updated = 0, deleted = 0;
    for (const r of rows) {
      const redetected = detectCompanies(r.title, r.description);
      if (redetected.includes('Plaid')) continue;
      if (!isRelevant(r.title, r.description, redetected)) { del.run(r.id); deleted++; continue; }
      const stored = (r.companies || '').split(',').map(c => c.trim()).filter(Boolean);
      if (stored.includes('Plaid')) {
        const newIndustry = detectIndustry(redetected, r.title, r.description) || r.industry;
        update.run(redetected.join(',') || null, newIndustry, r.id);
        updated++;
      }
    }
    return { updated, deleted };
  });
  const { updated, deleted } = tx();
  if (updated || deleted) console.log(`[DB] Plaid false positives: removed ${deleted}, re-tagged ${updated}`);
}

// ── Backfill is_breaking for articles fetched before this field existed ────
function backfillBreaking() {
  const rows = db.prepare('SELECT id, title, description FROM articles WHERE is_breaking IS NULL').all();
  if (!rows.length) return;
  const update = db.prepare('UPDATE articles SET is_breaking = 1 WHERE id = ?');
  const tx = db.transaction(() => {
    let n = 0;
    for (const r of rows) { if (isBreaking(r.title, r.description)) { update.run(r.id); n++; } }
    return n;
  });
  const n = tx();
  if (n > 0) console.log(`[DB] Backfilled ${n} breaking articles`);
}

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\nMarketPulse → http://localhost:${PORT}\n`);
  cleanupEntityEncoding();
  cleanupIrrelevantAPIArticles();
  migrateCryptoToDigitalAssets();
  recomputeBreakingFlags();
  reclassifyIPOEventType();
  recomputeLeadershipTags();
  removeVisaFalsePositives();
  removePlaidFalsePositives();
  backfillBreaking();
  try { applyLearnedFilter(); } catch (err) { console.error('[Learn]', err.message); }
  const count = db.prepare('SELECT COUNT(*) as n FROM articles').get().n;
  if (count === 0) {
    console.log('Empty database — running initial fetch...');
    setTimeout(runAllFetchers, 1500);
  }
});
