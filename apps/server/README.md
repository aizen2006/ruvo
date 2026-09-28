# RUVO server

The Express 5 API and the run worker, on Bun. The repository [README](../../README.md) has the
overview and quick start; [docs/architecture.md](../../docs/architecture.md) explains the code.

## Setup

```bash
docker compose up -d              # from the repo root: postgres + qdrant
cp .env.example .env              # then set OPENAI_API_KEY and TYPESAFE_API_KEY (or DECIDER_PROVIDER=off)
bun install
bun run db:migrate                # create or update the tables
bun run browsers                  # installs Chromium for Playwright
bun run smoke                     # checks every external dependency
bun run dev                       # API on :3000 plus the worker
```

## Scripts

| Script | Purpose |
|---|---|
| `dev` | API and worker in watch mode |
| `start` / `start:worker` | API / worker without watch mode |
| `test` / `check-types` | Tests (against their own `ruvo_test` database) / TypeScript check |
| `db:generate` / `db:migrate` | Create a migration from `src/db/schema.ts` / apply migrations |
| `smoke` | Postgres, Qdrant, OpenAI, decision provider, Playwright |
| `eval` | Golden prompts with checks on each compiled contract |
| `e2e` | The demo request end to end against the running stack, plus a re-run |
| `seed:demo` | Warms caches for the demo and resets the demo site (see `docs/demo-script.md`) |
| `calibrate` | Chooses the decision layer's confidence bands from labelled samples |
| `probe:registry` | Checks every curated company board |

## Environment findings (2026-09-27)

- **Playwright runs natively under Bun 1.4.2 on Windows**, so `BROWSER_MODE=native`.
  The Workable board renders 5,189 characters of text in a browser, against 31 over plain HTTP.
  `waitUntil: "networkidle"` took about 45 s there, so the browser pool waits for the text to stop changing instead.
- OpenAI SDK 7.x exposes `zodTextFormat` from `openai/helpers/zod`, and `responses.parse` returns the parsed result in `output_parsed`.
