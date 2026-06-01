const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'news.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS articles (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    description TEXT,
    url         TEXT UNIQUE NOT NULL,
    source_name TEXT,
    source_type TEXT NOT NULL,
    industry    TEXT NOT NULL,
    published_at TEXT,
    fetched_at  TEXT DEFAULT (datetime('now')),
    author      TEXT,
    image_url   TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_published_at ON articles(published_at DESC);
  CREATE INDEX IF NOT EXISTS idx_industry     ON articles(industry);
  CREATE INDEX IF NOT EXISTS idx_source_type  ON articles(source_type);
  CREATE INDEX IF NOT EXISTS idx_fetched_at   ON articles(fetched_at DESC);
`);

// Migrate: add columns if they don't exist
try { db.exec('ALTER TABLE articles ADD COLUMN event_type  TEXT'); } catch {}
try { db.exec('ALTER TABLE articles ADD COLUMN companies   TEXT'); } catch {}
try { db.exec('ALTER TABLE articles ADD COLUMN is_breaking INTEGER DEFAULT 0'); } catch {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_event_type  ON articles(event_type)'); } catch {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_is_breaking ON articles(is_breaking)'); } catch {}

// Clear stale data if the DB still has old industry categories
const OLD_INDUSTRIES = new Set(['tech', 'healthcare', 'finance', 'energy']);
const sample = db.prepare('SELECT industry FROM articles LIMIT 1').get();
if (sample && OLD_INDUSTRIES.has(sample.industry)) {
  db.exec('DELETE FROM articles');
  console.log('[DB] Cleared old industry data — ready for new fintech categories');
}

// ── URL normalization: strip tracking params & fragment ────────────────────
function normalizeUrl(raw) {
  try {
    const u = new URL(raw);
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|_ga|_gid|mc_|ref$|source$)/.test(key)) {
        u.searchParams.delete(key);
      }
    }
    const s = u.toString();
    return s.endsWith('/') ? s.slice(0, -1) : s;
  } catch {
    return raw;
  }
}

// ── Dedup-aware insert — skips on matching URL (normalized) or title ────────
const _checkUrl   = db.prepare('SELECT 1 FROM articles WHERE url = ? LIMIT 1');
const _checkTitle = db.prepare('SELECT 1 FROM articles WHERE title = ? LIMIT 1');
const _insert     = db.prepare(`
  INSERT OR IGNORE INTO articles
    (title, description, url, source_name, source_type, industry, published_at,
     author, image_url, event_type, companies, is_breaking)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

function saveArticle(a) {
  if (!a.title || !a.url) return false;
  const url = normalizeUrl(a.url);
  if (_checkUrl.get(url)) return false;
  if (_checkTitle.get(a.title)) return false;
  try {
    _insert.run(
      a.title, a.description ?? null, url,
      a.source_name ?? null, a.source_type, a.industry,
      a.published_at ?? null, a.author ?? null, a.image_url ?? null,
      a.event_type ?? null, a.companies ?? null, a.is_breaking ?? 0
    );
    return true;
  } catch {
    return false;
  }
}

module.exports = db;
module.exports.saveArticle = saveArticle;
