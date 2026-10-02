# RUVO server

The Express 5 API and the run worker, on Bun. The repository [README](../../README.md) has the
overview and quick start; [docs/architecture.md](../../docs/architecture.md) explains the code.

## Setup

```bash
pip install "scrapling[all]"      # the fetch service's Python library
scrapling install                 # and its browsers
docker compose up -d --wait       # from the repo root: postgres
cp .env.example .env              # then set OPENAI_API_KEY (TYPESAFE_API_KEY is optional)
bun install
bun run db:migrate                # create or update the tables
bun run smoke                     # checks every external dependency
bun run dev                       # API on :3000, the worker, and the fetch service with its guard
```

`SCRAPLING_URL` (default `http://127.0.0.1:8001`) is where the fetch service listens, and
`SCRAPLING_PYTHON` is the Python that runs it (`python` on Windows, `python3` elsewhere).

## Scripts

| Script | Purpose |
|---|---|
| `dev` | API and worker in watch mode |
| `start` / `start:worker` | API / worker without watch mode |
| `test` / `check-types` | Tests (against their own `ruvo_test` database) / TypeScript check |
| `db:generate` / `db:migrate` | Create a migration from `src/db/schema.ts` / apply migrations |
| `smoke` | Postgres, OpenAI, decision provider, fetch service |
| `eval` | Golden prompts with checks on each compiled contract |
| `e2e` | The demo request end to end against the running stack, plus a re-run |
| `seed:demo` | Warms caches for the demo and resets the demo site (see `docs/demo-script.md`) |
| `calibrate` | Chooses the decision layer's confidence bands from labelled samples |
| `probe:registry` | Checks every curated company board |

## Environment findings (2026-09-27)

- The Workable board renders 5,189 characters of text in a browser, against 31 over plain HTTP.
- OpenAI SDK 7.x exposes `zodTextFormat` from `openai/helpers/zod`, and `responses.parse` returns the parsed result in `output_parsed`.
