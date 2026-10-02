# RUVO

**Ask for a dataset in plain words. Get one back with receipts.**

You write something like

> Find me backend + AI engineering roles, preferably remote, from good technology companies.
> Return company, title, location, salary if available, job URL, and why the role matches.

and RUVO returns a table of a few hundred postings. The difference from asking a chatbot is
that no cell is taken on faith. Every value carries a receipt: where it came from, how it was
read, and how sure RUVO is. Here is one row from a real run:

```
Research Engineer, Life Sciences at Anthropic
────────────────────────────────────────────────────────────────────────────────────────
title     Research Engineer, Life Sciences   API     0.99   $.jobs[365].title
location  San Francisco, CA                  API     0.99   $.jobs[365].location.name
remote    onsite                             API     0.99   $.jobs[365].metadata[0].value
salary    USD 350,000–500,000 / year         REGEX   0.80   "$350,000—$500,000 USD", chars 2815–2836
why       Matches: backend or AI engineering title; relevant engineering work;
          relevant technology company. Not confirmed: remote preferred.
source    https://job-boards.greenhouse.io/anthropic/jobs/5265365008
```

Values that came straight from an API get 0.99. A salary pulled out of the description by a
pattern gets 0.80, with the exact characters it was read from. A value the AI extracted is kept
only if its quote is found on the page and actually states that value. Anything unverified is
dropped, not guessed.

## What happens between the prompt and the table

1. **The request becomes a contract.** An LLM drafts the columns, which ones are required, how
   each record is judged, and the assumptions it made ("good companies" → companies tagged as AI
   labs or dev tools). Code checks it. You review and edit it before anything is collected.
2. **The contract becomes a plan you can read.** It lists the sources, why each was chosen, the
   steps per source, and the page, browser and AI-call budgets. The LLM proposes the plan;
   a compiler checks it, clamps the budgets, and turns it into typed steps.
3. **Sources are found, then collected politely.** Greenhouse, Ashby, Lever and Workable APIs,
   the Hacker News hiring thread, and any page you link. RUVO also searches the web for list
   pages, single-record pages and public profiles, so you don't have to name a site. The search
   is [SearXNG](https://github.com/searxng/searxng), which runs on your machine in Docker and
   costs nothing; with a Firecrawl key, Firecrawl is the backup when SearXNG fails or finds
   nothing. List pages are followed across their "next page" links. Pages are fetched by
   [Scrapling](https://github.com/D4Vinci/Scrapling), cheapest method first: a plain request
   with Chrome's fingerprint, then a browser when a page is an empty JavaScript shell, then a
   stealth browser when a site shows a bot check. If Scrapling still can't read a page,
   Firecrawl (with a key) reads it. robots.txt is still obeyed. A guard checks every connection
   Scrapling makes, so nothing reaches your private network. Each receipt says how its page was
   fetched.
4. **Web pages are read with recorded recipes.** The first time RUVO sees a list page, an LLM
   proposes CSS selectors. RUVO runs them on the page and keeps them only if they pass
   acceptance checks. Every later run replays them with no AI at all.
5. **Records are judged, checked and merged.** Clear cases are settled by rules. Ambiguous
   titles go to [Jev](https://typesafe.ai), a small decision model, and only what Jev is unsure
   about reaches an LLM judge. Duplicates across sources are merged, keeping the best evidence.
6. **The run leaves something behind.** A quality report, a diff against the previous run,
   repaired recipes, and a remembered plan. The next similar request reuses that plan without
   calling the planner.

When a site changes and a recipe stops fitting, RUVO works out what broke. It then retries,
switches to the browser, or patches the selectors locally. If that isn't enough, Scrapling
looks for the recipe's fields on the changed page, starting from the last page the recipe read.
Only when that fails too does RUVO ask the LLM to rediscover the recipe. The fix is saved as a
new version next to the old one, so you can see what changed and why.

## Run it

You need **Bun 1.4.2+**, **Node 24+**, **Docker** (it runs Postgres and SearXNG), **Python with
Scrapling**, and either an **OpenAI API key** or a **ChatGPT plan**. A TypeSafe key for Jev is
optional; without one, rules and the LLM judge make the calls.

Install Scrapling with its extras, then the browsers it drives:

```bash
pip install "scrapling[all]"   # Scrapling, its fetchers, and the small web server RUVO's fetch service uses
scrapling install              # Scrapling's Chromium and stealth browser
```

RUVO runs Scrapling on your machine, not in Docker. Then:

```bash
git clone https://github.com/aizen2006/ruvo && cd ruvo
bun install
bun run setup        # env files, Postgres 17 and SearXNG, tables, then a dependency check
                     # set OPENAI_API_KEY (or use ChatGPT, below) and TYPESAFE_API_KEY in apps/server/.env
bun run doctor       # re-check every dependency after changing settings
bun run dev          # API :3000, worker, fetch service and its guard, dashboard :3001
```

**To use your ChatGPT plan instead of an API key**, sign in once, then keep the sign-in server
running in the background. The easy way is **Sign in with ChatGPT** on the dashboard's
**Settings** page, which opens OpenAI's login page and then starts the sign-in server (**Sign out**
there stops the server and deletes the saved sign-in, which the Codex CLI shares); or from a
terminal:

```bash
bunx openai-oauth login      # once: sign in with your ChatGPT account
bunx openai-oauth --detach   # the sign-in server, on http://127.0.0.1:10531
```

Then set `AI_ACCOUNT=chatgpt` in `apps/server/.env` (`OPENAI_API_KEY` can stay empty) and run
`bun run doctor`. RUVO then uses the plan's own models, and the dashboard shows "Included in
your ChatGPT plan" instead of dollar estimates. If your `.env` came from an older template and
has a `MODEL_PLANNER=gpt-6-sol` line, remove it: ChatGPT plans don't offer that model.
openai-oauth is not an official OpenAI tool. It reuses the Codex CLI's sign-in, so it could stop
working at any time, and using it could put your ChatGPT account at risk.

Open **http://localhost:3001/new**:

1. **Say what you want a list of**, or pick an example. You can add websites for RUVO to read.
2. **Choose how thorough**: Quick, Balanced or Thorough. Each shows what it will cost and how
   long it may take. *Choose models* picks the model for each job yourself.
3. **Check the plan.** It lists the columns (must have or nice to have), the rules, how RUVO
   read vague words, and where it will look. Change anything that's wrong, then press
   **Start collecting**.
4. **Open the list.** Click a row to see its receipt: each value, how sure RUVO is, and the
   source text with the value highlighted. **Download** gives you a spreadsheet.

The contract, workflow, recipes, decisions and full activity log are all still there, behind
**Show details**.

To rehearse a full demo, including a live self-repair on a bundled fake careers site, follow
[docs/demo-script.md](docs/demo-script.md).

## Deploy

`docker compose -f docker-compose.prod.yml up -d --build` runs the whole stack with Docker.
[docs/deploy.md](docs/deploy.md) covers configuration, scaling workers, backups, and why the API
must sit behind your own HTTPS and authentication before it faces the internet.

## The few settings that matter

All settings live in `apps/server/.env`. The template lists every variable with its default.

| Setting | Default | Change it when |
|---|---|---|
| `AI_ACCOUNT` | `api_key` | You use your ChatGPT plan instead of an API key: `chatgpt` (see [Run it](#run-it)). |
| `OPENAI_API_KEY` | — | Always, with `api_key`. Compiling, planning, recipe discovery and the judge use it. |
| `OPENAI_OAUTH_URL` | `http://127.0.0.1:10531/v1` | With `chatgpt`, the sign-in server listens somewhere else. |
| `TYPESAFE_API_KEY`, `DECIDER_PROVIDER` | unset, `jev` | You have Jev access. `off` uses rules and the LLM judge only. For a self-hosted Laya, run `docker compose --profile laya up -d` and set `laya` with `DECIDER_BASE_URL=http://localhost:8000`. |
| `FETCH_CACHE_MODE` | `ttl` | You want repeatable demos (`prefer_cache`) or no network at all (`cache_only`). |
| `LLM_CACHE_MODE` | `on` | Identical LLM calls are answered from Postgres. Use `cache_only` for offline replays. |
| `MAX_PAGES`, `MAX_BROWSER_PAGES`, `MAX_LLM_CALLS`, `MAX_RUN_MS` | 300, 20, 150, 8 min | These are ceilings. No mode goes above them, so lower them to cap what anyone can spend. |
| `DAILY_BUDGET_USD` | unset | You want a hard daily cap. New runs are refused once the last 24 hours of AI and Firecrawl spend reach it. API keys only: with `chatgpt` there is no cap. |
| `MODEL_PLANNER`, `MODEL_WORKER` | `gpt-6-sol`, `gpt-6-luna`; with `chatgpt`, `gpt-5.6-terra`, `gpt-6-luna` | You want different default models. The modes are built from this pair. |
| `SEARXNG_URL` | `http://127.0.0.1:8888` | SearXNG runs somewhere else. Blank turns it off; web search then needs a Firecrawl key. |
| `FIRECRAWL_API_KEY`, `MAX_SEARCHES` | unset, 20 | You want a backup for when SearXNG fails or finds nothing, and a last way to read pages Scrapling can't. Its credits count in each run's cost. `MAX_SEARCHES` caps the searches per run. |
| `SCRAPLING_URL` | `http://127.0.0.1:8001` | Port 8001 is taken, or the fetch service runs elsewhere. `bun run dev` starts the service on this URL's port. Blank turns Scrapling off: pages are read with plain requests only (no browser, no stealth), for a server without Python. |
| `SCRAPLING_PYTHON` | `python` on Windows, `python3` elsewhere | The Python that has Scrapling installed is another one, such as a virtualenv's. |
| `PORT` | 3000 | If you change it, change `NEXT_PUBLIC_API_URL` in `apps/web/.env.local` to match. |

Each run has a mode, and the mode sets its budgets:

| Mode | Understands with | Reads with | Pages (browser) | AI calls | Time |
|---|---|---|---|---|---|
| Quick | planner | worker | 40 (3) | 15 | 2 min |
| Balanced (default) | planner | worker | 150 (10) | 60 | 4 min |
| Thorough | planner | planner | 300 (20) | 150 | 8 min |

Quick keeps the planner model for understanding the request because the golden eval fails with
`gpt-6-luna` there: it reads "preferably remote" as a hard requirement. A run's cost counts
every AI call made for it, including understanding and planning. Estimates use token averages
measured from real runs. On a ChatGPT plan the AI calls are included, so they count as $0.
Modes also cap web searches (3, 8, 20) and the pages followed per list (2, 5, 10).

## Commands

Run these from the repo root, or drop the `--filter server` inside `apps/server`.

| Command | What it does |
|---|---|
| `bun run setup` | Local setup, safe to re-run: env files, Postgres and SearXNG, migrations, dependency check |
| `bun run doctor` | Checks Postgres, both models through your AI account (the API key, or the ChatGPT sign-in server), the decision provider, Scrapling and the fetch service, and a JSON search on SearXNG. The fetch service or SearXNG, when off or not running yet, is a "skip", not a failure |
| `bun run dev` | API, worker, fetch service and dashboard, with reload |
| `bun run check-types` | TypeScript across every package |
| `cd apps/server && bun test` | About 520 tests against a throwaway `ruvo_test` database (Postgres must be up; nothing else). Run it from `apps/server` so `.env.test` applies. |
| `bun run --filter server eval` | Golden prompts with checks on each compiled contract; run it after changing a prompt |
| `bun run --filter server e2e` | The example request end to end against the running stack, then a re-run |
| `bun run --filter server seed:demo` | Warms the caches with the demo requests and resets the demo site |
| `bun run --filter server calibrate` | Re-derives Jev's confidence bands from a finished run (writes `src/decide/calibration.json`) |
| `bun run --filter server probe:registry` | Re-verifies the curated job boards (rewrites `src/plan/data/companies.json`) |
| `bun run --filter server prune` | Frees space: deletes stored pages older than 30 days (`--days N`) that no record cites, and duplicate LLM outputs |

CI (`.github/workflows/ci.yml`) runs the type checks, the server tests and a production build of
the dashboard on every push to `main` and every pull request. The tests need only Postgres; the
fetch service, SearXNG and the AI providers are faked.

## How it's built

```
apps/server         Bun + Express 5 API and a separate run worker. Drizzle on Postgres
                    (including the job queue), cheerio, OpenAI, Jev, and the SOCKS guard
                    in front of the fetch service.
infra/scrapling     The fetch service: a small Python server around Scrapling.
infra/searxng       SearXNG's settings for the local web search.
apps/web            Next.js 16 dashboard: Tailwind v4, shadcn/ui-style components on Radix,
                    TanStack Query. docs/design.md covers tokens, words and components.
packages/contracts  zod schemas both sides share: contract, plan, workflow IR, records, runs.
docs/               architecture.md explains the whole path through the code;
                    demo-script.md is an 8-minute walkthrough.
```

A few rules shaped the code:

- **The model proposes; code decides.** An LLM writes small typed drafts: a contract, a plan,
  a recipe. Deterministic code checks each draft and runs it. If a draft fails, the fallback is
  a template, not another prompt.
- **Postgres is the only source of truth.** It holds the queue, the page cache, the LLM cache,
  the decision cache, the evidence and the remembered plans. Jev only speeds things up; when it
  fails, RUVO skips it.
- **Everything nondeterministic is cached.** That makes re-runs reproducible, lets a crashed run
  resume by replaying, and lets a demo run fully offline.
- **Budgets degrade a run instead of failing it.** When the AI budget runs out, remaining steps
  carry on without AI and the run says so. At the time limit, slow steps stop and what was
  gathered is still saved.
- **Fetch with the cheapest method that works, and only where allowed.** Scrapling moves to a
  browser or the stealth browser only when a cheaper method fails, and Firecrawl, which costs
  credits, reads only what Scrapling can't. robots.txt, per-site rate limits and circuit
  breakers still apply, HTTP 451 stops a source, and RUVO never logs in or reaches your private
  network.

## Limits, honestly

- **Jobs are the deep domain.** Other kinds of data come from web search and pages you link.
  RUVO follows "next page" links but does not click, scroll, or log in.
- **Search is only as good as the engines SearXNG can reach.** SearXNG asks public search
  engines, which sometimes rate-limit it or show it a CAPTCHA. Then a search finds less, or falls
  back to Firecrawl if you have a key.
- **Social profiles come from search snippets only.** Instagram, X, LinkedIn and similar sites
  forbid crawlers, so RUVO never fetches them. It reads what the search result itself shows (name,
  handle, bio, sometimes a follower count) and labels those values "From search results".
- **The stealth browser gets past sites' bot checks.** That can break a site's terms of use, and
  the risk sits with whoever runs RUVO. Receipts mark every page fetched that way. robots.txt is
  still obeyed (`Crawl-delay` up to 10 seconds), and a site that answers HTTP 451 is left alone.
- **The AI judge can be wrong.** It once rejected "Senior Member of Technical Staff, Multimodal
  AI" as not an AI role. Rules settle the clear cases first, so the judge only sees ambiguous ones.
- **The private-network guard is strict for pages, looser for APIs.** Every connection Scrapling
  makes, browsers included, is checked at connect time and pinned to the address that was
  checked. RUVO's own API calls (the job-board and Hacker News JSON APIs) still check DNS just
  before connecting, so a hostile DNS server could rebind a name between the two lookups.
- **Some numbers are approximate.** Cost estimates are averages; budgets cap the number of AI
  calls, not their length. The workflow-memory threshold (0.7 similarity) is tuned on a handful
  of requests.
- **ChatGPT plans have usage limits.** When the limit is reached during a run, RUVO treats it as
  a spent AI budget: the remaining steps carry on without AI, and the run says so. If it is
  reached while RUVO reads your request, the run fails; start it again once the limit resets.
- **There are no accounts.** The API has no authentication. It is built for one person on one
  machine.

## License

[MIT](LICENSE).
