# RUVO

RUVO turns a plain-language data request into a clean, structured dataset where every value
can be traced back to its source.

> "Find me backend + AI engineering roles, preferably remote, from good technology companies.
> Return company, title, location, salary if available, job URL, and why the role matches."

RUVO does not simply ask a model to write a table. It works through the request in stages:

1. It compiles the request into a **dataset contract**: the columns, which of them are required, how each record is judged, and the assumptions it made. You can review and edit the contract before anything is collected.
2. It plans a **workflow** you can inspect: which sources to use, the steps for each, and the budgets.
3. It collects from permitted sources: public job-board APIs, rendered web pages, and free-text threads. It uses plain HTTP first and a headless browser only when a page needs one.
4. It extracts every field with **evidence**: the method, source URL, snippet, locator and a confidence score. A value an AI model extracted is kept only if the model's quoted source text is found on the page.
5. It validates, deduplicates and scores the records, then reports on quality and on what changed since the last run.

Work RUVO has done once is reused:

- **Page recipes** record how to read a page, so the next run replays them without AI.
- When a site changes, RUVO **repairs** the recipe and saves it as a new version.
- A plan that produced a good dataset is **remembered**, so a rephrased request reuses it.

## What is in the box

| | |
|---|---|
| **Dataset contract** | Compiled by `gpt-6-sol`, then checked and normalized by deterministic code. Vague phrases such as "good companies" become assumptions you can see and edit. |
| **Workflow IR** | The LLM proposes a small plan. A compiler checks it, clamps the budgets, and expands it into typed steps. The template planner is the fallback. |
| **Sources** | Greenhouse, Ashby, Lever and Workable APIs; Workable boards rendered in a browser; Hacker News "Who is hiring?"; and any list page you link. Job boards are auto-detected for companies you name. |
| **Record and replay** | An AI model proposes CSS selectors. RUVO runs them on the page and saves them only if they pass acceptance checks. Later runs replay them with cheerio and no AI. |
| **Self-repair** | When a recipe stops fitting its page, RUVO works out what failed and picks an action: retry, switch to the browser, fix the selectors locally, or rediscover the recipe with the LLM. Each fix is saved as a new recipe version and a new workflow version. |
| **Evidence** | Every value records how it was found. Confidence starts from a per-method baseline (API 0.99 down to a quote-verified LLM value at 0.75). Unverified values are dropped. |
| **Decision layer** | Judgement calls go through tiers in order: rules, then cached answers, then [Jev](https://typesafe.ai) (TypeSafe's System One API), then a batched LLM judge, then a fixed default. The Decisions tab shows which tier decided what, and what it cost. |
| **Workflow memory** | Qdrant stores plans whose runs produced at least 20 valid records. A request that means the same thing reuses the stored plan without a planner call. |
| **Run diff** | Each re-run shows new, removed and changed records compared with the previous run. |
| **Dashboard** | Next.js with tabs for the contract (editable), the workflow (including recipe versions), the dataset with its evidence, quality, decisions and live activity. |

How it fits together: [docs/architecture.md](docs/architecture.md). Walkthrough: [docs/demo-script.md](docs/demo-script.md).

## Quick start

Requirements: [Bun](https://bun.sh) 1.4.2 or later, Docker, an OpenAI API key, and optionally a TypeSafe API key for Jev.

```bash
docker compose up -d                       # Postgres 17 and Qdrant
bun install
cp apps/server/.env.example apps/server/.env
#   then set OPENAI_API_KEY (and TYPESAFE_API_KEY, or DECIDER_PROVIDER=off)
cd apps/server
bun run db:migrate                         # create the tables
bun run browsers                           # install Chromium for Playwright
bun run smoke                              # check every external dependency
cd ../..
bun run dev                                # API :3000, worker, dashboard :3001
```

Open http://localhost:3001, describe the data you need, review the contract, and start collecting.

To prepare a demo, run `bun run seed:demo` in `apps/server` while `bun run dev` is running.

## Scripts (in `apps/server`)

| Script | What it does |
|---|---|
| `dev` | API and worker, both in watch mode (`bun run dev` at the root also starts the dashboard) |
| `test` / `check-types` | Unit and integration tests (they create their own `ruvo_test` database) / TypeScript |
| `smoke` | Checks Postgres, Qdrant, OpenAI, the decision provider and Playwright |
| `eval` | Golden prompts with checks on each compiled contract; run it after changing a prompt |
| `e2e` | The demo request end to end against the running stack, plus a re-run |
| `seed:demo` | Warms the caches with the demo requests and resets the demo site |
| `calibrate` | Chooses the decision layer's confidence bands from labelled samples |
| `probe:registry` | Checks that every curated company's job board still answers |

## Configuration

All settings live in `apps/server/.env` (see `.env.example`). The ones worth knowing:

| Variable | Default | Meaning |
|---|---|---|
| `FETCH_CACHE_MODE` | `ttl` | `prefer_cache` for repeatable demos; `cache_only` for fully offline replays |
| `LLM_CACHE_MODE` | `on` | Identical LLM calls are answered from the `llm_calls` table |
| `DECIDER_PROVIDER` / `DECIDER_MODE` | `jev` / `active` | `off` uses rules and the LLM judge only; `shadow` records Jev's answers without acting on them |
| `MAX_PAGES`, `MAX_BROWSER_PAGES`, `MAX_LLM_CALLS`, `MAX_RUN_MS` | 150, 10, 60, 4 min | Caps on each run's budgets; plans are clamped to these |
| `WORKER_INLINE` | `false` | Runs the worker inside the API process (one process instead of two) |

## Project layout

```
apps/server        Express 5 API and run worker (Bun, Drizzle, Playwright, cheerio)
apps/web           Next.js 16 dashboard (Tailwind v4, Radix, TanStack Query)
packages/contracts zod schemas shared by both: contract, plan, workflow IR, records, runs
docker-compose.yml Postgres and Qdrant (plus an optional self-hosted Laya decider)
```

## Limitations

- **Jobs are the one fully built domain.** Other kinds of data work only from list pages you link. RUVO reads one page per link: it does not follow pagination, click, or log in.
- **Some sites refuse automated access.** RUVO respects robots.txt and stops on a 403; it never works around a block. For example, lib.rs refuses RUVO's crawler.
- **Enrichment is shallow.** Detail pages are read for JSON-LD and with regex and the LLM, capped at 15 fetches per source. Embedded app state (`__NEXT_DATA__` and similar) is not mapped yet.
- **The AI judge makes mistakes.** Semantic checks sometimes reject a good match. One observed case: "Senior Member of Technical Staff, Multimodal AI" was judged not to be an AI role. Rules settle the clear cases first, so the judge only sees ambiguous ones.
- **Run metrics miss some LLM cost.** The LLM calls made while compiling and planning are logged in `llm_calls` but not counted in the run's metrics.
- **Memory thresholds are hand-tuned.** The 0.9 similarity threshold comes from a handful of measured requests (a paraphrase scored 0.98; an unrelated job request scored 0.80).
- **Parsers are heuristic.** Salary parsing handles common formats, lakh grouping and currency scaling, but does no currency conversion. Number columns are stored as numeric strings.
- **No accounts.** The API has no authentication and is meant for a local, single-user setup.
