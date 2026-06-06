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
