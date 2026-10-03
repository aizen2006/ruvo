<div align="center">

# RUVO

### Ask for a list in plain words. Get leads back with receipts.

Every value says where it came from, how it was read, and how sure RUVO is.<br>
Nothing is guessed. Everything runs on your machine.

[![License: MIT](https://img.shields.io/badge/license-MIT-black)](LICENSE)
![Bun](https://img.shields.io/badge/Bun-1.4-black?logo=bun)
![Scrapling](https://img.shields.io/badge/fetching-Scrapling-black)
![SearXNG](https://img.shields.io/badge/search-SearXNG-black)
![Postgres](https://img.shields.io/badge/Postgres-17-black?logo=postgresql&logoColor=white)

</div>

---

You type:

> Find me backend + AI engineering roles, preferably remote, from good technology companies.
> Return company, title, location, salary if available, job URL, and why the role matches.

A few minutes later you have a table. In one real run it held **190 postings**, and every one of
them can show its work:

```
Research Engineer, Life Sciences at Anthropic
───────────────────────────────────────────────────────────────────────────────────────────
title     Research Engineer, Life Sciences   API     0.99   $.jobs[365].title
location  San Francisco, CA                  API     0.99   $.jobs[365].location.name
remote    onsite                             API     0.99   $.jobs[365].metadata[0].value
salary    USD 350,000–500,000 / year         REGEX   0.80   "$350,000—$500,000 USD", chars 2815–2836
why       Matches: backend or AI engineering title; relevant engineering work;
          relevant technology company. Not confirmed: remote preferred.
source    https://job-boards.greenhouse.io/anthropic/jobs/5265365008   (read directly)
```

A chatbot would have written that row from memory. RUVO read it. The title came straight from
Anthropic's job API, so it scores 0.99. The salary was found in characters 2815–2836 of the
description, so it scores 0.80 and shows you those characters. A value an AI extracts survives
only if its quote is on the page and actually says that value. Anything RUVO can't prove is
dropped, not guessed.

## By the numbers

| | |
|---|---|
| **190** | valid postings from one run of the request above |
| **49** | candidate sources for a junior backend request that used to find 17 |
| **26 s** | to read a page behind a Cloudflare check that used to stop RUVO cold |
| **33 → 97** | good leads when a run went back for two more rounds on its own |
| **0** | AI calls to read a list page RUVO has seen before |
| **500+** | tests, run by CI on every push |

## What makes it different

**It always goes and looks.** Every request searches the web, in rounds, while its search budget
lasts and each round still finds something new. The search engine is [SearXNG](https://github.com/searxng/searxng), running in Docker on
your machine, so it costs nothing. Job requests also turn up more companies hiring on Greenhouse,
Lever, Ashby and Workable, and RUVO reads those boards through their official APIs. A built-in list
of companies is one source among many, never the only one.

**It gets the page.** [Scrapling](https://github.com/D4Vinci/Scrapling) fetches every web page,
cheapest method first: a plain request that looks like Chrome, then a real browser when the page
is an empty JavaScript shell, then a stealth browser when a bot check stands in the way. If even
that fails and you have a Firecrawl key, Firecrawl gets one try. Every receipt says which of these
read its page.

**It keeps going until it has enough.** If the planned sources leave a run short of the rows you
asked for, it searches again with new queries and reads what it finds: up to two more rounds,
while the run's time and budgets last. It all happens inside the same run, and the activity log
says how many leads each round added.

**It learns a site once.** The first time RUVO meets a list page, an LLM proposes CSS selectors.
RUVO runs them, keeps them only if they pass acceptance checks, and replays them on every later
visit with no AI at all.

**It fixes itself, cheaply.** When a site is redesigned and a recipe stops fitting, RUVO retries,
renders the page in the browser, or patches the selectors locally. Next, Scrapling looks for the
recipe's fields on the new page, starting from the last page the recipe read. That is still no AI.
Only then does an LLM rediscover the recipe. Every fix is saved as a new recipe version you can
compare with the old one.

**It judges like a careful person.** Rules settle the obvious cases. Ambiguous ones go to
[Jev](https://typesafe.ai), a small decision model, and only what Jev isn't sure about reaches an
LLM judge. Duplicates across sources merge, keeping the strongest evidence.

**It stays polite, and it stays home.** robots.txt is obeyed, even when the file itself hides
behind a bot check. Each site gets its own rate limit and circuit breaker, and HTTP 451 stops a
source. A guard checks every connection Scrapling makes, browsers included, at connect time, so
nothing reaches your own network. Postgres and SearXNG run in Docker; Scrapling runs on your own
Python.

**Bring your own AI.** Use an OpenAI API key, or sign in with your ChatGPT plan from the
dashboard's Settings page and pay nothing per call.

## The pipeline

```
   "backend roles, preferably remote…"
                    │
                    ▼
   ┌─────────────────────────────────┐
   │ CONTRACT                        │  columns, rules and the assumptions behind them;
   │ you read and edit it first      │  an LLM drafts it, code checks it
   └────────────────┬────────────────┘
                    ▼
   ┌─────────────────────────────────┐
   │ SEARCH                          │  SearXNG in rounds · job boards found on the web
   │ always, every request           │  · a curated registry · pages you link
   └────────────────┬────────────────┘
                    ▼
   ┌─────────────────────────────────┐
   │ FETCH                           │  plain → browser → stealth browser → Firecrawl,
   │ through the private-network     │  robots.txt and per-site limits on every rung
   │ guard                           │
   └────────────────┬────────────────┘
                    ▼
   ┌─────────────────────────────────┐
   │ READ                            │  official APIs · recorded recipes · JSON-LD;
   │ every value with its evidence   │  AI extraction only with a verified quote
   └────────────────┬────────────────┘
                    ▼
   ┌─────────────────────────────────┐
   │ JUDGE                           │  rules → Jev → LLM judge; missing details filled
   │ filter, enrich, merge           │  from the posting itself; duplicates merged
   └────────────────┬────────────────┘
                    ▼
        short of leads? ── yes ──▶  back to SEARCH with new queries
                    │               (up to two more rounds, while time lasts)
                    │ no
                    ▼
   ┌─────────────────────────────────┐
   │ LEADS                           │  the table · a receipt per value · spreadsheet
   │                                 │  · a quality report · what changed since last time
   └─────────────────────────────────┘
```

Each run also leaves something behind: repaired recipes, and a remembered plan that the next
similar request reuses without calling the planner.

## Run it

You need **Bun 1.4.2+**, **Node 24+**, **Docker**, **Python with Scrapling**, and either an
**OpenAI API key** or a **ChatGPT plan**. A TypeSafe key for Jev is optional; without one, rules and
the LLM judge make every call.

```bash
pip install "scrapling[all]"   # Scrapling, its fetchers, and the small web server RUVO's fetch service uses
scrapling install              # the Chromium and the stealth browser Scrapling drives

git clone https://github.com/aizen2006/ruvo && cd ruvo
bun install
bun run setup        # env files, Postgres 17 and SearXNG in Docker, tables, then a dependency check
                     # set OPENAI_API_KEY (or use ChatGPT, below) and TYPESAFE_API_KEY in apps/server/.env
bun run doctor       # re-checks every dependency; run it after changing settings
bun run dev          # API :3000, worker, fetch service and its guard, dashboard :3001
```

Then open **http://localhost:3001/new**:

1. **Say what you want a list of**, or pick an example. Add websites if you want them read too.
2. **Choose how thorough**: Quick, Balanced or Thorough. Each shows what it will cost and how long
   it may take. *Choose models* lets you pick the model for each job.
3. **Check the plan.** Columns (must have or nice to have), rules, how RUVO read vague words, and
   where it will look. Fix anything that's wrong, then press **Start collecting**.
4. **Open the list.** Click a row for its receipt: each value, how sure RUVO is, how its page was
   fetched, and the source text with the value highlighted. **Download** gives you a spreadsheet.

The contract, workflow, recipes, decisions and full activity log stay one click away, behind
**Show details**. To rehearse a demo with a live self-repair on a bundled careers site, follow
[docs/demo-script.md](docs/demo-script.md).

### Use your ChatGPT plan instead of an API key

Open **Settings** in the dashboard and press **Sign in with ChatGPT**. OpenAI's login page opens;
once you're in, RUVO starts the sign-in server for you. **Sign out** on the same page stops it and
deletes the saved sign-in (the Codex CLI shares it). From a terminal it's:

```bash
bunx openai-oauth login      # once: sign in with your ChatGPT account
bunx openai-oauth --detach   # the sign-in server, on http://127.0.0.1:10531
```

Then set `AI_ACCOUNT=chatgpt` in `apps/server/.env` (`OPENAI_API_KEY` can stay empty) and run
`bun run doctor`. RUVO uses the plan's own models, and the dashboard says "Included in your ChatGPT
plan" instead of showing dollar estimates. If your `.env` came from an older template and has a
`MODEL_PLANNER=gpt-6-sol` line, remove it: ChatGPT plans don't offer that model.

openai-oauth is not an official OpenAI tool. It reuses the Codex CLI's sign-in, so it could stop
working at any time, and using it could put your ChatGPT account at risk.

## Modes

Every run has a mode, and the mode sets its budgets. A run that hits a budget doesn't fail: the
remaining steps carry on without what ran out, and the run says so.

| Mode | Understands with | Reads with | Pages (browser) | AI calls | Web searches | Time |
|---|---|---|---|---|---|---|
| Quick | planner | worker | 40 (3) | 15 | 3 | 2 min |
| Balanced (default) | planner | worker | 150 (10) | 60 | 8 | 4 min |
| Thorough | planner | planner | 300 (20) | 150 | 20 | 8 min |

Quick keeps the planner model for understanding the request because the golden eval fails with
`gpt-6-luna` there: it reads "preferably remote" as a hard requirement. A run's cost counts every
AI call made for it, including understanding and planning; estimates use token averages from real
runs. On a ChatGPT plan, AI calls are included and count as $0.

## Settings

Everything lives in `apps/server/.env`; the template lists every variable with its default. These
are the ones worth knowing:

| Setting | Default | Change it when |
|---|---|---|
| `AI_ACCOUNT` | `api_key` | You use your ChatGPT plan instead of an API key: `chatgpt` (see above). |
| `OPENAI_API_KEY` | — | Always, with `api_key`. Understanding, planning, recipe discovery and the judge use it. |
| `OPENAI_OAUTH_URL` | `http://127.0.0.1:10531/v1` | With `chatgpt`, the sign-in server listens somewhere else. |
| `MODEL_PLANNER`, `MODEL_WORKER` | `gpt-6-sol`, `gpt-6-luna`; with `chatgpt`, `gpt-5.6-terra`, `gpt-6-luna` | You want different default models. The modes are built from this pair. |
| `TYPESAFE_API_KEY`, `DECIDER_PROVIDER` | unset, `jev` | You have Jev access. `off` uses rules and the LLM judge only. For a self-hosted Laya, run `docker compose --profile laya up -d` and set `laya` with `DECIDER_BASE_URL=http://localhost:8000`. |
| `SEARXNG_URL` | `http://127.0.0.1:8888` | SearXNG runs somewhere else. Blank turns it off; web search then needs a Firecrawl key. |
| `FIRECRAWL_API_KEY`, `MAX_SEARCHES` | unset, 20 | You want a backup for when SearXNG finds nothing, and a last way to read pages Scrapling can't. Its credits count in each run's cost. `MAX_SEARCHES` caps searches per run. |
| `SCRAPLING_URL` | `http://127.0.0.1:8001` | Port 8001 is taken, or the fetch service runs elsewhere. Blank turns Scrapling off: pages are read with plain requests only (no browser, no stealth), for a server without Python. |
| `SCRAPLING_PYTHON` | `python` on Windows, `python3` elsewhere | The Python that has Scrapling is another one, such as a virtualenv's. |
| `FETCH_CACHE_MODE` | `ttl` | You want repeatable demos (`prefer_cache`) or no network at all (`cache_only`). |
| `LLM_CACHE_MODE` | `on` | Identical LLM calls are answered from Postgres. `cache_only` replays offline. |
| `MAX_PAGES`, `MAX_BROWSER_PAGES`, `MAX_LLM_CALLS`, `MAX_RUN_MS` | 300, 20, 150, 8 min | These are ceilings no mode goes above. Lower them to cap what anyone can spend. |
| `DAILY_BUDGET_USD` | unset | You want a hard daily cap: new runs are refused once the last 24 hours of AI and Firecrawl spend reach it. API keys only. |
| `PORT` | 3000 | If you change it, change `NEXT_PUBLIC_API_URL` in `apps/web/.env.local` to match. |

## Commands

Run these from the repo root, or drop the `--filter server` inside `apps/server`.

| Command | What it does |
|---|---|
| `bun run setup` | Local setup, safe to re-run: env files, Postgres and SearXNG, migrations, a dependency check |
| `bun run doctor` | Checks Postgres, both models through your AI account, the decision provider, Scrapling and the fetch service, and a search on SearXNG. A service that's off or not started yet is a "skip", not a failure |
| `bun run dev` | API, worker, fetch service and dashboard, with reload |
| `bun run check-types` | TypeScript across every package |
| `cd apps/server && bun test` | 500+ tests against a throwaway `ruvo_test` database. They need only Postgres: the fetch service, SearXNG and the AI providers are faked |
| `bun run --filter server eval` | Golden prompts with checks on each compiled contract; run it after changing a prompt |
| `bun run --filter server e2e` | The example request end to end against the running stack, then a re-run |
| `bun run --filter server seed:demo` | Warms the caches with the demo requests and resets the demo site |
| `bun run --filter server calibrate` | Re-derives Jev's confidence bands from a finished run |
| `bun run --filter server probe:registry` | Re-verifies the curated job boards |
| `bun run --filter server prune` | Frees space: deletes stored pages older than 30 days (`--days N`) that no record cites, and duplicate LLM outputs |

CI (`.github/workflows/ci.yml`) runs the type checks, the server tests and a production build of
the dashboard on every push to `main` and every pull request.

## Under the hood

```
apps/server         Bun + Express 5 API and a separate run worker. Drizzle on Postgres, which
                    also holds the job queue. cheerio, OpenAI, Jev, and the SOCKS guard in
                    front of the fetch service.
infra/scrapling     The fetch service: a small Python server around Scrapling.
infra/searxng       SearXNG's settings for the local web search.
apps/web            Next.js 16 dashboard: Tailwind v4, shadcn/ui-style components on Radix,
                    TanStack Query. docs/design.md covers its tokens, words and components.
packages/contracts  zod schemas both sides share: contract, plan, workflow IR, records, runs.
docs/               architecture.md walks the whole path through the code;
                    demo-script.md is an 8-minute walkthrough; deploy.md runs it in Docker.
```

Five rules shaped the code:

- **The model proposes; code decides.** An LLM writes small typed drafts: a contract, a plan, a
  recipe. Deterministic code checks each one and runs it. If a draft fails, the fallback is a
  template, not another prompt.
- **Postgres is the only source of truth.** The queue, the page cache, the LLM cache, the decision
  cache, the evidence and the remembered plans all live there. Jev only speeds things up; when it
  fails, RUVO skips it.
- **Everything nondeterministic is cached.** Re-runs are reproducible, a crashed run resumes by
  replaying, and a demo can run fully offline.
- **Budgets degrade a run instead of failing it.** Out of AI budget, the remaining steps carry on
  without AI. At the time limit, slow steps stop and what was gathered is still saved.
- **The cheapest method that works, and only where allowed.** A browser or the stealth browser
  only when a cheaper method fails; Firecrawl, which costs credits, only for what Scrapling can't
  read. robots.txt, rate limits and circuit breakers always apply, HTTP 451 stops a source, and
  RUVO never logs in or reaches your own network.

`docker compose -f docker-compose.prod.yml up -d --build` runs the whole stack in Docker;
[docs/deploy.md](docs/deploy.md) covers configuration, scaling workers, backups, and why the API
must sit behind your own HTTPS and authentication before it faces the internet.

## Limits, honestly

- **Jobs are the deep domain.** Other kinds of data come from web search and pages you link. RUVO
  follows "next page" links but doesn't click, scroll or log in.
- **Search is only as good as the engines SearXNG can reach.** Public engines sometimes rate-limit
  it or show it a CAPTCHA. A search then finds less, or falls back to Firecrawl if you have a key.
- **Social profiles come from search snippets only.** Instagram, X, LinkedIn and similar sites
  forbid crawlers, so RUVO never fetches them. It reads what the search result shows (name,
  handle, bio, sometimes a follower count) and labels those values "From search results".
- **The stealth browser gets past sites' bot checks.** That can break a site's terms of use, and
  the risk sits with whoever runs RUVO. Receipts mark every page fetched that way. robots.txt is
  still obeyed (`Crawl-delay` up to 10 seconds), and a site that answers HTTP 451 is left alone.
- **The AI judge can be wrong.** It once rejected "Senior Member of Technical Staff, Multimodal
  AI" as not an AI role. Rules settle the clear cases first, so the judge only sees ambiguous ones.
- **The private-network guard is strict for pages, looser for APIs.** Every connection Scrapling
  makes is checked at connect time and pinned to the address that was checked. RUVO's own calls to
  the job-board and Hacker News JSON APIs check DNS just before connecting, so a hostile DNS server
  could still rebind a name between the two lookups.
- **ChatGPT plans have usage limits.** Hitting one mid-run counts as a spent AI budget: the
  remaining steps carry on without AI. Hitting it while RUVO reads your request fails the run;
  start again once the limit resets.
- **Some numbers are approximate.** Cost estimates are averages, budgets cap the number of AI
  calls rather than their length, and the plan-memory threshold (0.7 similarity) is tuned on a
  handful of requests.
- **There are no accounts.** The API has no authentication. RUVO is built for one person on one
  machine.

## License

[MIT](LICENSE).
