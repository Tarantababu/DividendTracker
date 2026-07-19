# Dividend Tracker

Local web app that connects to your Trading212 account and shows:

- **Macro overview** — total value, invested, unrealised/realised P/L, cash, trailing 12-month dividends, average monthly income, portfolio yield
- **Monthly dividend income** — bar chart over the last 24 months with 12-month average line
- **Road to financial freedom** — projects when dividend income covers your target monthly income; adjustable monthly deposit, dividend growth, capital growth, reinvestment
- **Detailed holdings** — sortable table with value, weight, P/L, trailing 12-month dividends, yield and yield-on-cost per position
- **Allocation donut** and **full dividend payment history**

Everything runs on your machine. API credentials are read server-side from `.env.local` and never reach the browser or leave your computer (other than calls to Trading212 itself).

## Setup

1. Generate API credentials in the Trading212 app: **Settings → API**. Read-only scopes are enough (account data, portfolio, history).
2. Copy the env template and fill in your credentials:

   ```bash
   cp .env.example .env.local
   ```

   ```
   T212_API_KEY=...
   T212_API_SECRET=...
   ```

3. Install and run:

   ```bash
   npm install
   npm run dev
   ```

4. Open http://localhost:3000

## Notes

- **Dividend history cache** — Trading212 limits the dividend endpoint to 6 requests/minute. The full history is fetched once, cached in `.cache/dividends.json`, and refreshed incrementally (only new payments) afterwards. A very long first sync pauses automatically to respect the rate limit. Use the **Refresh** button to force a sync.
- **Practice account** — set `T212_HOST=https://demo.trading212.com` in `.env.local`.
- **Forecast model** — starts from your portfolio's actual trailing 12-month yield; deposits and (optionally) reinvested dividends compound monthly, the payout rate grows by the configured dividend-growth rate, holdings appreciate by the capital-growth rate. Estimates only, not financial advice.
