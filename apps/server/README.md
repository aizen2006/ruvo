# RUVO server

Express 5 API + run worker, on Bun.

## Setup

```bash
docker compose up -d              # from the repo root: postgres + qdrant
cp .env.example .env              # then fill OPENAI_API_KEY and TYPESAFE_API_KEY
bun install
bun run browsers                  # installs Chromium for Playwright
bun run smoke                     # checks every external dependency
bun run dev                       # API on :3000
```

## Scripts

| Script | Purpose |
|---|---|
| `dev` | API with watch mode |
| `test` / `check-types` | Unit tests / TypeScript check |
| `smoke` | Postgres, Qdrant, OpenAI, decision provider, Playwright |
| `db:push` | Apply the Drizzle schema to the dev database |

## Environment findings (2026-09-27)

- **Playwright runs natively under Bun 1.4.2 on Windows** → `BROWSER_MODE=native`.
  The Workable board renders 5,189 chars of text in a browser vs 31 over plain HTTP.
  `waitUntil: "networkidle"` took ~45 s there, so the browser pool waits for stable text instead.
- OpenAI SDK 7.x exposes `zodTextFormat` from `openai/helpers/zod` and `responses.parse` → `output_parsed`.
