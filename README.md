# OddsMister

OddsMister is a football match and odds analytics application built with Next.js App Router and TypeScript. It combines API-Football match data, cached odds and prediction feeds, and match-level visual analysis.

## Stack

- Next.js 16 and React 19
- TypeScript
- API-Football (API-Sports)
- Upstash Redis for shared cache and scheduled jobs
- Redux Toolkit and SWR
- Vercel deployment and GitHub Actions CI

## Requirements

- Node.js 20.x
- npm 10.x
- An API-Football API key
- An Upstash Redis database

## Local setup

1. Clone the repository and install dependencies:

   ```bash
   git clone https://github.com/latifiss/oddsweb.git
   cd oddsweb
   npm ci
   ```

2. Copy `.env.example` to `.env.local` and provide the required values:

   | Variable | Required | Purpose |
   | --- | --- | --- |
   | `API_FOOTBALL_KEY` | Yes | API-Football authentication |
   | `UPSTASH_REDIS_REST_URL` | Yes | Upstash REST endpoint (HTTPS) |
   | `UPSTASH_REDIS_REST_TOKEN` | Yes | Upstash REST token |
   | `CRON_SECRET` | Yes in production | Protects cron and maintenance endpoints |
   | `NEXT_PUBLIC_BASE_URL` | No | Public app origin |

3. Start the development server:

   ```bash
   npm run dev
   ```

4. Run the checks before opening a pull request:

   ```bash
   npm run lint
   npm run typecheck
   npm run build
   ```

## Production deployment

1. Import the repository into Vercel.
2. Configure the environment variables above in the Production environment. Use a high-entropy value for `CRON_SECRET`; do not expose it through a `NEXT_PUBLIC_*` variable.
3. Confirm the Vercel project is using Node.js 20 and the correct production domain.
4. Deploy and verify the deployment's build output.
5. Confirm the daily Vercel Cron invocation succeeds. Vercel sends the configured cron secret as a bearer authorization header when `CRON_SECRET` is configured.

The prediction update endpoint is intentionally protected. Requests without a valid `Authorization: Bearer <CRON_SECRET>` header are rejected. Redis-backed features require a working Upstash connection; the app does not silently pretend that a process-local cache is production-safe.

## Operational notes

- API-Football requests use bounded retries and request timeouts.
- API responses are cached in Redis with endpoint-specific TTLs.
- Prediction refreshes preserve the last successful feed if the provider fails for every selected fixture.
- Cron jobs use Redis-backed claims to reduce duplicate work across serverless instances.
- GitHub Actions runs lint, TypeScript checks, and a production build on pushes and pull requests.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` | Create a production build |
| `npm start` | Run the production server |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript without emitting files |
| `npm run test:e2e` | Run Cypress end-to-end tests |

## Security

- Never commit `.env.local`, API keys, Redis tokens, or cron secrets.
- Rotate any credential that has been exposed.
- Do not make diagnostic or cache-management endpoints public.
- Prediction outputs are informational analytics, not guarantees of match outcomes. Users should make independent decisions and comply with local laws and bookmaker terms.
