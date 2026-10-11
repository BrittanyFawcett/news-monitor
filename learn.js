// ── Learned relevance filter ───────────────────────────────────────────────
// Learns from the articles you flag as irrelevant and hides new or existing
// articles that look like them. Deliberately simple and explainable:
//
//  1. Every article's title + description is broken into words and two-word
//     phrases ("h-1b", "visa fee", "world cup").
//  2. A phrase becomes a learned "signal term" when it appears in at least
//     MIN_FLAGGED_DOCS flagged articles AND is at least MIN_RATIO times more
//     common in flagged articles than in the articles you keep.
//  3. An article is hidden only if it shares at least MIN_MATCHED_TERMS signal
//     terms with ONE specific flagged article. The hidden_reason column records
//     which terms matched and which flagged article it resembles.
//
// Safeguards:
//  - Company names and their match terms ("visa", "citi", "apple pay") are
//    never learned on their own, so flagging off-topic Visa articles can't
//    teach the filter to hide all Visa news. Phrases that include them
//    ("visa fee") can still be learned.
//  - Auto-hidden articles are not used for training (no self-reinforcement).
//  - An article you restore from Hidden is never auto-hidden again, and counts
//    KEPT_WEIGHT times as evidence that its terms are relevant.
//  - The whole set is re-evaluated after each flag/restore and after each
//    fetch, so un-flagging an article also un-hides what it caused.

const db = require('./db');
const { ALL_COMPANIES, COMPANY_GROUPS } = require('./fetchers/classify');

const MIN_FLAGGED_DOCS  = 2;   // a term must appear in ≥ 2 flagged articles
const MIN_RATIO         = 10;  // …and be ≥ 10× more common in flagged than kept
const MIN_MATCHED_TERMS = 2;   // an article must share ≥ 2 terms with one flagged article
const KEPT_WEIGHT       = 10;  // a restored article counts as 10 kept articles

const STOPWORDS = new Set(`
a about above after again against all also am an and any are as at be because been
before being below between both but by can could did do does doing down during each
few for from further had has have having he her here hers him his how i if in into
is it its itself just me more most my no nor not now of off on once only or other
our ours out over own same she should so some such than that the their theirs them
then there these they this those through to too under until up very was we were
what when where which while who whom why will with would you your yours
new says said say may might could one two three first last year years week weeks
day days today amid via per after over report reports reported according inc corp
co ltd llc plc company companies group us u.s
`.split(/\s+/).filter(Boolean));

// Words that identify tracked companies — never learned as signals by themselves
const PROTECTED = (() => {
  const set = new Set();
  const addPhrase = p => {
    const words = p.toLowerCase().split(/[^a-z0-9.&'-]+/).filter(Boolean);
    words.forEach(w => set.add(w.replace(/[.'-]+$/, '')));
  };
  for (const c of ALL_COMPANIES) {
    addPhrase(c.name);
    (c.terms || []).forEach(addPhrase);
  }
  for (const g of Object.values(COMPANY_GROUPS)) g.companies.forEach(addPhrase);
  ['bank', 'banks', 'bancorp', 'citigroup', 'citibank', 'bofa', 'financial'].forEach(w => set.add(w));
  return set;
})();

function isProtected(term) {
  return term.split(' ').every(w => PROTECTED.has(w));
}

// Returns a Set of unigrams + adjacent bigrams for an article
function tokenize(title, description) {
  const text = `${title || ''} ${description || ''}`.toLowerCase().replace(/[’‘]/g, "'");
  const raw  = text.match(/[a-z0-9$][a-z0-9$&'.-]*/g) || [];
  const words = [];
  for (let w of raw) {
    w = w.replace(/'s$/, '').replace(/[.'-]+$/, '');
    if (!w || STOPWORDS.has(w)) continue;
    if (/^[\d.,$%-]+$/.test(w)) continue;            // bare numbers / amounts
    if (w.length < 3 && !/\d/.test(w)) continue;      // "of", "ai" etc.
    words.push(w);
  }
  const terms = new Set(words);
  for (let i = 0; i < words.length - 1; i++) {
    if (words[i] !== words[i + 1]) terms.add(`${words[i]} ${words[i + 1]}`);
  }
  return terms;
}

// Builds a model from labelled rows. `isFlagged(r)` marks the articles you
// flagged; every other row is the contrast set, weighted by `weightOf(r)`.
// Cheap enough to rebuild on every click.
function buildModel(rows, isFlagged, weightOf) {
  const dfFlagged = new Map();
  const dfKept    = new Map();
  const flaggedDocs = [];
  let nFlagged = 0, nKept = 0;

  for (const r of rows) {
    const terms = tokenize(r.title, r.description);
    if (isFlagged(r)) {
      nFlagged++;
      flaggedDocs.push({ id: r.id, title: r.title, terms });
      for (const t of terms) dfFlagged.set(t, (dfFlagged.get(t) || 0) + 1);
    } else {
      const w = weightOf(r);
      nKept += w;
      for (const t of terms) dfKept.set(t, (dfKept.get(t) || 0) + w);
    }
  }

  const signals = new Map();
  if (nFlagged >= MIN_FLAGGED_DOCS) {
    for (const [t, df] of dfFlagged) {
      if (df < MIN_FLAGGED_DOCS || isProtected(t)) continue;
      const rateFlagged = df / nFlagged;
      const rateKept    = ((dfKept.get(t) || 0) + 1) / (nKept + 1);
      const ratio = rateFlagged / rateKept;
      if (ratio >= MIN_RATIO) signals.set(t, { flagged: df, kept: dfKept.get(t) || 0, ratio });
    }
  }

  // Each flagged article keeps only its signal terms, for matching + explanations
  for (const f of flaggedDocs) f.terms = new Set([...f.terms].filter(t => signals.has(t)));

  return { signals, flaggedDocs: flaggedDocs.filter(f => f.terms.size), nFlagged };
}

// Irrelevant model: your irrelevant flags vs. the visible articles you keep.
// Auto-hidden articles are excluded so the filter never trains on its own output.
function train() {
  const rows = db.prepare(
    `SELECT id, title, description, irrelevant, user_kept FROM articles WHERE irrelevant IN (0, 1)`
  ).all();
  return buildModel(rows, r => r.irrelevant === 1, r => (r.user_kept ? KEPT_WEIGHT : 1));
}

// Breaking model: articles you flagged as breaking vs. other visible articles.
// Articles promoted by the learner are excluded (no self-reinforcement); ones
// you switched off as "not breaking" count KEPT_WEIGHT times as contrast.
function trainBreaking() {
  const rows = db.prepare(
    `SELECT id, title, description, breaking_user FROM articles
     WHERE COALESCE(irrelevant, 0) = 0
       AND (COALESCE(breaking_user, 0) != 0 OR COALESCE(breaking_auto, 0) = 0)`
  ).all();
  return buildModel(rows, r => r.breaking_user === 1, r => (r.breaking_user === -1 ? KEPT_WEIGHT : 1));
}

// Counts shared terms, not double-counting a word already covered by a shared phrase
function distinctShared(shared) {
  const bigramWords = new Set();
  for (const t of shared) if (t.includes(' ')) t.split(' ').forEach(w => bigramWords.add(w));
  return shared.filter(t => t.includes(' ') || !bigramWords.has(t));
}

function match(model, title, description) {
  if (!model.flaggedDocs.length) return null;
  const terms = tokenize(title, description);
  let best = null;
  for (const f of model.flaggedDocs) {
    const shared = distinctShared([...f.terms].filter(t => terms.has(t)));
    if (shared.length >= MIN_MATCHED_TERMS && (!best || shared.length > best.terms.length)) {
      best = { terms: shared, example: f.title, exampleId: f.id };
    }
  }
  return best;
}

function reasonText(m, what = 'an article you flagged') {
  const terms = m.terms.slice(0, 5).map(t => `"${t}"`).join(', ');
  return `Matched ${terms} — similar to ${what}: ${m.example}`;
}

// Re-trains and re-evaluates every article that isn't a direct decision of yours.
// Returns the ids it newly hid and newly un-hid.
function applyLearnedFilter() {
  const model = train();
  const rows = db.prepare(
    `SELECT id, title, description, irrelevant FROM articles
     WHERE irrelevant IN (0, 2) AND COALESCE(user_kept, 0) = 0`
  ).all();

  const hide    = db.prepare(`UPDATE articles SET irrelevant = 2, hidden_reason = ? WHERE id = ?`);
  const reason  = db.prepare(`UPDATE articles SET hidden_reason = ? WHERE id = ?`);
  const unhide  = db.prepare(`UPDATE articles SET irrelevant = 0, hidden_reason = NULL WHERE id = ?`);
  const hidden = [], restored = [];

  db.transaction(() => {
    for (const r of rows) {
      const m = match(model, r.title, r.description);
      if (m && r.irrelevant === 0)      { hide.run(reasonText(m), r.id); hidden.push(r.id); }
      else if (m && r.irrelevant === 2) { reason.run(reasonText(m), r.id); }
      else if (!m && r.irrelevant === 2) { unhide.run(r.id); restored.push(r.id); }
    }
  })();

  if (hidden.length || restored.length) {
    console.log(`[Learn] ${model.signals.size} learned terms — auto-hid ${hidden.length}, restored ${restored.length}`);
  }
  return { hidden, restored, signalCount: model.signals.size };
}

// Re-trains the breaking model and promotes visible articles that resemble the
// ones you flagged as breaking. Articles you decided on yourself (flagged as
// breaking, or switched off as not breaking) are left alone.
function applyBreakingLearner() {
  const model = trainBreaking();
  const rows = db.prepare(
    `SELECT id, title, description, breaking_auto FROM articles
     WHERE COALESCE(irrelevant, 0) = 0 AND COALESCE(breaking_user, 0) = 0`
  ).all();

  const promote = db.prepare(`UPDATE articles SET breaking_auto = 1, breaking_reason = ? WHERE id = ?`);
  const reason  = db.prepare(`UPDATE articles SET breaking_reason = ? WHERE id = ?`);
  const demote  = db.prepare(`UPDATE articles SET breaking_auto = 0, breaking_reason = NULL WHERE id = ?`);
  const promoted = [], demoted = [];

  db.transaction(() => {
    for (const r of rows) {
      const m = match(model, r.title, r.description);
      const text = m && reasonText(m, 'an article you flagged as breaking');
      if (m && !r.breaking_auto)      { promote.run(text, r.id); promoted.push(r.id); }
      else if (m && r.breaking_auto)  { reason.run(text, r.id); }
      else if (!m && r.breaking_auto) { demote.run(r.id); demoted.push(r.id); }
    }
    // Articles that left the candidate pool (hidden, or decided by you) drop the learned flag
    db.prepare(`UPDATE articles SET breaking_auto = 0, breaking_reason = NULL
                WHERE breaking_auto = 1 AND (COALESCE(irrelevant, 0) != 0 OR COALESCE(breaking_user, 0) != 0)`).run();
  })();

  if (promoted.length || demoted.length) {
    console.log(`[Learn] ${model.signals.size} breaking terms — promoted ${promoted.length}, demoted ${demoted.length}`);
  }
  return { promoted, demoted, signalCount: model.signals.size };
}

// Runs both learners. Hiding runs first so hidden articles aren't promoted.
function applyAllLearners() {
  const irrelevant = applyLearnedFilter();
  const breaking   = applyBreakingLearner();
  return { ...irrelevant, ...breaking };
}

// For the Hidden view: what the filter has learned so far
function learningSummary() {
  const model = train();
  const terms = [...model.signals.entries()]
    .sort((a, b) => b[1].flagged - a[1].flagged || b[1].ratio - a[1].ratio)
    .slice(0, 20)
    .map(([term, s]) => ({ term, flagged: s.flagged }));
  return { flaggedCount: model.nFlagged, terms, minFlagged: MIN_FLAGGED_DOCS };
}

module.exports = { applyLearnedFilter, applyBreakingLearner, applyAllLearners, learningSummary,
                   tokenize, train, trainBreaking, match };
