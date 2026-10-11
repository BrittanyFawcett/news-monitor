# MarketPulse

Fintech news intelligence platform. Aggregates articles from NewsAPI, RSS feeds, SEC EDGAR 8-K filings, press releases, Currents API, and GNews — filtered to tracked companies and fintech industry keywords, classified by industry and event type.

## Local development

```bash
npm install
cp .env.example .env   # fill in your API keys
npm start              # http://localhost:3000
```

## Deploy to Replit

1. Import this repo on [replit.com](https://replit.com) via **+ Create Repl → Import from GitHub**
2. Set these Secrets in Replit (lock icon in sidebar):

   | Key | Value |
   |-----|-------|
   | `NEWSAPI_KEY` | your NewsAPI key |
   | `CURRENTS_API_KEY` | your Currents API key |
   | `GNEWS_API_KEY` | your GNews API key |
   | `USER_EMAIL` | your email (required for SEC EDGAR) |

3. If `better-sqlite3` fails to load, run in the Replit Shell: `npm rebuild better-sqlite3`
4. Click **Run**

## Updating Replit after a GitHub push

**One-time setup** — run this once in the Replit Shell to install the `update` alias:

```bash
bash setup.sh
source ~/.bashrc
```

**Every time you push from local** — open the Replit Shell and type:

```bash
update
```

This stops the running server, pulls the latest code from GitHub, and restarts.

## Local deploy script

From your local machine, commit and push all changes in one command:

```bash
./deploy.sh
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEWSAPI_KEY` | Yes | [newsapi.org](https://newsapi.org) API key |
| `CURRENTS_API_KEY` | No | [currentsapi.services](https://currentsapi.services) key |
| `GNEWS_API_KEY` | No | [gnews.io](https://gnews.io) key |
| `USER_EMAIL` | Yes | Contact email for SEC EDGAR User-Agent header |
| `PORT` | No | Server port (default: 3000) |

## Flagging irrelevant articles

Every article card has a **Flag as irrelevant** toggle. Flagged articles leave the feed, and the dashboard learns from them (`learn.js`):

- A word or phrase becomes a *learned term* once it appears in at least 2 flagged articles and is at least 10× more common in flagged articles than in the ones you keep. Company names (Visa, Citi, Apple Pay…) are never learned on their own.
- An article is hidden automatically only if it shares 2+ learned terms with one specific flagged article. The reason is shown on the card.
- **Hidden articles** (sidebar → Review) lists everything flagged or auto-hidden, plus the learned terms. Switch a toggle off to restore an article; an auto-hidden article you restore is never hidden again. Un-flagging an article you flagged also un-hides whatever it caused.
- The filter re-runs after every flag, after every fetch, and on startup.

## Flagging breaking news

Every card also has a **Flag as breaking** toggle. It's on whenever the article is in Breaking News, whether the keyword rules, you, or the learner put it there.

- **On** adds the article to Breaking News (tagged *Your flag*) and teaches the dashboard. Once two or more articles you flagged share distinctive terms, similar articles are promoted automatically (tagged *Learned*; hover for the matched terms). Same rules as the irrelevant filter in `learn.js`.
- **Off** takes it out of Breaking News and stays off, even for articles the keyword rules flagged. Switched-off articles also count as evidence against those terms.
- Both learners re-run after every toggle, after every fetch, and on startup. Hidden articles are never promoted.
