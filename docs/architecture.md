# RUVO architecture

This page explains how a request becomes a dataset, where each part lives in the code, and
the design rules that keep the system predictable. Paths are relative to `apps/server/src`
unless noted.

## Design rules

1. **The LLM proposes; deterministic code compiles and executes.** Models write small, typed drafts: a contract, a plan, a recipe. Code checks, clamps and expands those drafts, then runs them. A model's output never runs unchecked.
2. **Every value carries evidence**: method, source URL, stored page, snippet, locator, a verified flag and a confidence score. A value the LLM extracted is kept only if its quoted text is found on the page.
3. **Every AI step has a fallback**: the template planner, a rules-only decider, parsers for Hacker News posts, and local selector repair and Scrapling relocation before LLM rediscovery.
4. **Everything nondeterministic is cached.** That covers pages (per URL and transport), web searches (per query), LLM calls (per input hash) and decisions (per task and state hash). Re-runs are therefore reproducible, a crashed run can resume by replaying from the caches, and demos can run offline.
5. **Postgres is the only source of truth, including the job queue.** The decision provider is an accelerator: when it fails, RUVO skips it.
6. **Fetching uses the cheapest method that works, and stays within limits.** Scrapling fetches pages with its full toolbox (Chrome impersonation, a browser, and a stealth browser that solves Cloudflare checks), moving to a stronger method only when a cheaper one fails; with a key, Firecrawl reads what Scrapling could not. RUVO still follows robots.txt (a 4xx robots file means everything is allowed, a 5xx means nothing is; `Crawl-delay` is honoured up to 10 s), applies per-host rate limits and circuit breakers, stops a source on HTTP 451, caps response size, and never logs in. A SOCKS guard checks every connection Scrapling makes, browsers included, so no request reaches a private network. Receipts record how each page was fetched.

## From request to dataset

```
prompt ─ compile (planner model) ─▶ DatasetContract ─ user edits while reviewing ─▶ contract vN
       ─ discover sources (registry, ATS auto-detect, Hacker News, linked pages, web search) ─▶ candidates
       ─ plan (workflow memory, else planner model, else template) ─▶ PlanDraft ─ IR compiler ─▶ WorkflowIR vN
       ─ start ─▶ worker claims the run ─▶ one branch per source (3 at a time):
            collect → [triage → extract_text] → prefilter → [enrich] → match → validate → store
            (triage and extract_text only for free-text sources, enrich only for columns the source lacks)
       ─ short of good leads, with time left ─▶ up to 2 more rounds: new searches → new sources → their branches
       ─ dedupe across sources ─▶ quality report, run diff, recipe repairs, memory ─▶ dataset
```

### Run lifecycle (`db/queue.ts`, `runs/worker.ts`)

```
queued → compiling → awaiting_approval ─start─▶ queued_run → running → completed | failed | cancelled
                     (or straight to queued_run when the run was created with autoStart and has sources)
```

- **API process** (`index.ts`): it only reads and writes rows.
- **Worker process** (`worker.ts`): it claims runs with `FOR UPDATE SKIP LOCKED`. It sends a heartbeat every few seconds and checks for cancellation on each one.
- **Stale runs**: a run whose heartbeat stops is requeued, up to 2 attempts. A requeued run replays from the caches, and records are written with upserts keyed on `(run_id, item_key)`, so replaying never duplicates them.
- **Preparation** (`runs/prepare.ts`): compile, discover, plan, save. The status stays `compiling` throughout; the separate `stage` column shows understanding, planning and discovering.
- **Execution** (`runs/pipeline.ts` → `execute/executor.ts`): execute the workflow, with extra rounds when it is short of good leads, then record repairs and remember the plan.

### Contract (`compile/`)

1. `requirementCompiler.ts` asks the planner model for a contract. The contract lists fields, criteria, assumptions, dedupe keys and source hints.
2. `normalize.ts` then repairs it deterministically:
   - field names become unique snake_case
   - criteria must point at real fields; an exact-match criterion on a catalog field the model left out (say, `remote`) adds that field as optional
   - job contracts always include company, title and url
   - linked URLs are normalized
   - "good companies" becomes a visible assumption

Edits made during review go through the same normalization. They produce a new contract version and recompile the IR, with no LLM call.

### Sources (`plan/discovery.ts`, `plan/webDiscovery.ts`, `plan/atsDetect.ts`, `adapters/`)

**Discovery order:**
1. Pages the user linked.
2. For job requests only, registry companies: the ones named in the request (suffixes such as "Inc" are ignored); otherwise, unless the user linked pages, those whose tags match.
3. For job requests that ask for startups or broad coverage, the Hacker News "Who is hiring?" thread.

4. Web search (`plan/boardSearch.ts`, `plan/webDiscovery.ts`): always, for every request, whenever SearXNG or Firecrawl is set up, in rounds until the mode's search budget is spent or a round finds nothing new; later rounds use new queries the worker model writes from the ones already tried. For job requests each round also searches Greenhouse, Lever, Ashby and Workable postings, turns them into those companies' boards (verified, recorded in the registry, read through their APIs), and caps how many new companies a run adds (Quick 5, Balanced 15, Thorough 30). The contract's `searchQueries` run through a cached, budgeted search runner (`search/`). Hits are classified from URL, title and snippet (one batched worker-LLM call for unclear ones) into list pages (`html_list`), single-record pages (`html_record`) and profiles on sites that forbid crawlers (`search_hits`, grouped per site). Pages robots.txt forbids are dropped.

If nothing is found, the run stops for review and says what was searched.

**Web search** (`search/cache.ts`, `search/searxng.ts`, `search/firecrawl.ts`): each query goes to SearXNG first. It is the metasearch engine docker compose runs on this machine (`SEARXNG_URL`, settings in `infra/searxng/settings.yml`), asked for JSON, and it costs nothing. Firecrawl, with a key, is asked only when SearXNG fails or finds nothing; an empty answer because SearXNG's engines refused (a CAPTCHA, too many requests) counts as a failure. A live search takes one unit from the run's `searches` budget, whichever provider answers. Results are cached in `search_calls` by query and limit, so a re-run replays the same hits whichever provider gave them; the cache follows `FETCH_CACHE_MODE`. Each row records the provider and its cost (Firecrawl's credits times `FIRECRAWL_USD_PER_CREDIT`). When every provider fails, the search reports the first one's error.

**Auto-detection:** a named company missing from the registry is looked up by probing slug variants on Greenhouse, Ashby, Lever and Workable. A board with postings is added to the registry.

**Adapters** return items whose fields already carry evidence:

| Adapter | Reads | Evidence |
|---|---|---|
| `greenhouse`, `ashby`, `lever`, `workable` | Public board APIs | `API`, with a JSON path |
| `hn_whoishiring` | Top-level comments from Algolia | Header parser, then `REGEX` / `LLM` |
| `html_list` | Any list page: fetched over HTTP, or rendered in a browser if it is a JavaScript shell; follows "next page" links up to the mode's cap (`page/pagination.ts`) | `DOM`, with a CSS locator |
| `html_record` | One page, one record: JSON-LD first, then the LLM for missing columns with quotes verified on the page | `JSON_LD` / `LLM` |
| `search_hits` | Search results only (title and snippet); the profile page is never fetched | `SEARCH`, linking the profile |

### Planning (`plan/planner.ts`, `plan/irCompiler.ts`)

The planner writes a **PlanDraft**: which candidates to include, why, how many items to keep from each, and an LLM budget.

**Planner order:**
1. Workflow memory is checked first (`memory/workflowMemory.ts`). A stored plan is reused when the trigram similarity (pg_trgm) of the two contract summaries is at least 0.7, at least 80% of its sources are still candidates, and the run it came from produced at least 20 valid records.
2. Otherwise the planner model writes the draft.
3. If that fails, the template plan is used.

**The IR compiler never trusts the draft:**
- It drops unknown or duplicate sources.
- It builds each branch's steps in canonical order.
- It relaxes required fields that no source can produce.
- It clamps budgets to the environment caps.
- It raises the LLM budget to at least what the steps need (for example, recipe discovery on a list page).

Every change the compiler makes is recorded in `provenance.warnings`.

### More leads within a run (`execute/executor.ts`, `runs/moreLeads.ts`)

When the planned branches are done and the run has fewer valid records than the contract's `maxRecords`, it looks for more sources itself, the way **Find more** does:

1. The worker model writes up to 3 new search queries, given every query tried so far.
2. They are searched and sorted like a round of planning's searches (`searchRound` in `plan/boardSearch.ts`). For a job request they also search Greenhouse, Ashby, Lever and Workable, and the boards behind the postings found become sources read through their APIs, up to the mode's number of new companies a round (Quick 5, Balanced 15, Thorough 30); a posting is never read as a page. Sources the workflow already has are skipped.
3. The new sources are saved as workflow v+1 (`plannedBy: "more_leads"`), so a re-run reads them too, and their branches run with the run's budgets and time limit.

A run takes at most 2 such rounds, each only while a third of its time limit is left: a round takes about a minute, searching and then a first read of each new page. The rounds stop at the first one that finds no new source, when the AI-call or search budget is used up, or on cancellation. A failure while looking ends them with a warning, not the run. They need web search (SearXNG or Firecrawl). Valid records are counted before duplicates are merged; dedupe, the quality report, the diff and the summary run once, at the end, over every source read.

### Fetching (`fetch/`)

**Checks, in order:** cache → private-network guard → circuit breaker → robots.txt → budget → per-host rate-limited transport, with retries and `Retry-After`. Every step of the ladder below goes through the same checks.

**The fetch service** (`infra/scrapling/server.py`, client in `fetch/scrapling.ts`): a small Python server around Scrapling, at `SCRAPLING_URL`. `POST /fetch` takes a URL and an engine and returns the status, final URL, headers and body. It has three engines, each one fetch per call, so no cookies are shared between pages:
- `http`: a plain request with Chrome's TLS and header fingerprint.
- `browser`: a Chromium render that waits for the network to go idle. Images, fonts and media are blocked; stylesheets load.
- `stealth`: Scrapling's stealth browser, which solves Cloudflare checks. At most two browser or stealth fetches run at once.

`POST /relocate` serves self-repair, not fetching: given the page a recipe last read, the changed page, and the recipe's item selector and fields, Scrapling's adaptive parser finds where that item and each field are on the changed page and returns their CSS paths (see Self-repair).

Page fetches go through the service. The job-board and Hacker News JSON APIs (`fetcher.json()`) and the dev demo site keep RUVO's in-process HTTP path. If the service is unreachable, the fetch fails as `service_down`; that is not retried and never counts against a site's circuit breaker. A blank `SCRAPLING_URL` turns the service off: pages are then fetched in-process over plain HTTP only, and the ladder below never moves to the browser, the stealth browser or Firecrawl.

**The egress guard** (`fetch/egressGuard.ts`): Scrapling's only way out is a SOCKS5 proxy run by RUVO. The guard resolves each target, checks the addresses with the same rule as `assertPublicUrl` (`fetch/ssrf.ts`), and connects only to the addresses it checked, so a DNS rebind has nothing to change. Browsers use it too, so every request a page makes is checked. In development `bun run dev` starts the guard on 127.0.0.1:1080 and the service behind it (`scripts/fetch-service.ts`).

**The ladder:**
- `http` mode: the `http` engine only.
- `browser` mode: the `browser` engine.
- `auto` mode: a stored copy from an earlier escalation (stealth, then browser, then Firecrawl) first, then `http`. The page goes to the browser if it has under 500 characters of text, or shows single-page-app markers with under 2,000 (`sufficiency.ts`).
- In any mode, a bot challenge (status 403, 429 or 503 with `cf-mitigated: challenge` or a Cloudflare challenge marker in the body) goes to the `stealth` engine once.
- Last, with a Firecrawl key, Firecrawl's scrape reads a page (never a JSON API) that Scrapling could not: when the service is down, or when the stealth browser still met a bot check, a 403 or a 429. It never reads past an HTTP 451. A Firecrawl read passes the same checks and counts as a browser page in the budget; its credits are recorded in `search_calls` (keyed by the page's URL), so the run's cost and the daily budget include them. If Firecrawl fails too, the fetch fails with Scrapling's error.
- HTTP 451, and any status of 400 or more left after the ladder, stop the source. A browser, stealth or Firecrawl result with such a status, or a stealth or Firecrawl page still showing a challenge, is an error and is never saved.

**robots.txt behind a bot check:** when robots.txt itself answers with a challenge, it is read through the stealth browser, so the challenge is never mistaken for a 4xx that allows everything.

**Receipts:** each page records how it was fetched in `pages.via` (`http`, `browser`, `stealth`, `firecrawl` or `search`), and each value's evidence carries it as `fetchedVia`. The receipt shows it in words, for example "Opened in a stealth browser, past a bot check" or "Read through Firecrawl".

### Pages and recipes (`page/`, `recipes/`)

**`toPageState`** extracts text, links, JSON-LD, embedded state, and repeated sibling groups (the likely list items). Stable selectors are preferred to generated class names. `pageSkeleton` compresses a page into an outline the LLM can read.

**A recipe** is an item selector plus one selector and attribute per field. It is:
- discovered seed-first (`recipes/seed.ts`): the LLM quotes one example record from a pruned page view (`page/fitText.ts`), code finds that record and its similar siblings (`page/similar.ts`) and writes the selectors; the whole-page LLM prompt is the fallback,
- **executed and checked before saving**: at least 3 items; title and url filled for at least 80% of items; other required fields for at least 25%,
- stored per host and URL pattern (`apply.workable.com/*`),
- replayed with cheerio on later runs, unless it does not read a field the current request requires (then a new one is recorded).

### Extraction and evidence (`extract/`)

Adapters fill what their source states directly (API fields, or the recorded recipe on a list page). The enrich step then fills the gaps, stopping per field at the first verified value:
1. Regex on the text already collected (salary, arrangement)
2. The posting's detail page: JSON-LD, then regex (at most 15 pages per source)
3. LLM, for required fields that are still missing

The LLM rung must return a verbatim quote. `verifyQuote` checks that it is on the stored page, and the value is kept only if the quote actually states it (salary and arrangement are compared after parsing).

**Confidence baselines by method:**

| Method | Confidence |
|---|---|
| API | 0.99 |
| JSON-LD | 0.95 |
| Embedded JSON (reserved; not produced yet) | 0.93 |
| DOM | 0.88 |
| Derived | 0.85 |
| Regex | 0.80 |
| Quote-verified LLM | 0.75 |
| Search-result snippet | 0.70 |

A record's confidence is that of its least certain required value.

### Judging records (`execute/steps/match.ts`, `decide/`)

**Criteria:**
- Hard criteria reject a record.
- Soft criteria add to its match score.
- Semantic criteria ("is this an AI-infrastructure role?") go to the decider.

**The decider's tiers, in order:**
1. **Rules**: counting, dates and numbers are always rules, because Jev is weak at them.
2. **Cached decisions.**
3. **Jev**: the System One wire format with a pinned model. Confidence bands come from calibration (`decide/calibration.json`).
4. **Batched LLM judge**: 20 records per call.
5. **Fixed default.**

Every decision is stored with the tier that made it. The Decisions tab shows how many each tier settled, per task, and how often Jev and the LLM judge agreed.

### Validation, dedupe, quality, diff (`execute/`)

- **Validate**: a required field counts only if its value is verified. Records are `valid`, `incomplete` (a required value is missing) or `invalid` (a hard criterion failed).
- **Dedupe**: records are grouped across sources by the contract's dedupe keys, typically canonical URL and normalized company, title and location. The record with the strongest evidence is kept.
- **Quality report**: the record funnel, completeness per field, the extraction-method mix, the verification rate, a confidence histogram, reject reasons, and per-source counts.
- **Diff**: new, removed and changed records compared with the previous completed run of the same request, matched by canonical key. Once the diff names that run, a records list marks the kept records it didn't have (`isNew`) and can show only those.
- **Lead score** (`leadOf`, `packages/contracts/src/plain.ts`): each valid record scores 0–100, half from its match score and half from its confidence; Strong from 80, Good from 60, else Possible. Lists and exports put the best leads first and exports carry the tier and score.
- **Funnel** (`db/repos/funnel.ts`): the run detail counts web searches and sources (from the workflow), collected (raw records), qualified (not invalid), complete (valid) and ready leads (valid, not a duplicate), so it also reads while collecting. It names the step that lost the most with its most common reason: a failed hard criterion, a missing required field, or duplicates.

### Self-repair (`repair/`)

When a recorded recipe no longer fits its page, `html_list` hands the failure to `repair/repairRecipe.ts`.

1. **Classify** (`classify.ts`): `SELECTOR_MISS` or `PARTIAL_FILL`. If the page came back with almost no text, it is `EMPTY_RENDER` instead.
2. **Choose an action** (`policy.ts`, the `REPAIR_ACTION` task):
   - Clear cases are settled by rules: blocked → stop; empty over HTTP → switch to the browser; a transient error → retry.
   - Selector problems go to the decider, which weighs a cheap fix (`CHANGE_SELECTOR`) against rediscovery (`ESCALATE`).
3. **Repair**, cheapest first. `CHANGE_SELECTOR` tries the local fix, then Scrapling relocation, then LLM rediscovery. `ESCALATE` skips the local fix but still tries relocation before the LLM, except for an `EMPTY_RENDER`, where there is nothing on the page to search.
   - **Local fix** (`relax.ts`): turn generated class names into prefix matches, try the page's repeated groups as the item selector, and fall back to generic places for the title (headings) and url (links).
   - **Scrapling relocation** (`relocate.ts`): the fetch service's `POST /relocate` gets the last page the recipe read and the changed page. The last page read is the newest stored copy of the URL that records cite as `DOM` evidence and that the recipe still reads (cited pages are never pruned). Scrapling's adaptive parser finds the recipe's item and each field on the changed page, and RUVO writes selectors for them the way discovery does. No AI is used. It is skipped without the fetch service or such a page: a recipe that never worked, such as a simulated drift, has none.
   - **LLM rediscovery**: the LLM is given the failure report and the previous recipe.

   Every fix is accepted only if it passes the recipe's acceptance checks. A fix made without the LLM is saved with origin `local_repair`, and the run's activity says which way it was found.
4. **Record**: the fix is saved as recipe v+1, with the broken version as its parent. The run then saves workflow v+1 (`plannedBy: "repair"`) listing what changed, and later re-runs start from it.

**Demo triggers:**
- `POST /api/recipes/:id/simulate-drift {minor|major}` records a deliberately broken recipe version (origin `simulated_drift`).
- `POST /fixtures/careers/version {2}` switches the local Northwind demo site to a redesigned page at the same URL.

### Budgets and time limits

**Modes** (`runs/modes.ts`): a run is Quick, Balanced or Thorough. The mode picks the planner and worker models (unless the user chose them) and sets the budgets. The environment's `MAX_*` values are ceilings no mode exceeds. The models are stored on the run; `scopeLlm` (`llm/client.ts`) gives compile, plan and every in-run call the run's models, and tags each call with the run id.

**Budgets:** each run has page, browser-page, LLM-call and web-search budgets. Steps ask the budget before spending, and when it refuses, they degrade instead of failing the run. The first refusal of each budget is announced in Activity.

**Time limit:** the run's time limit (from its mode) stops slow work such as collection and enrichment. Records that were already gathered still go through match, validate and store.

**Cost:** `llm_calls` and `search_calls` are the record of spend. A run's `costUsd` is the sum of its AI calls (understanding and planning included) and its Firecrawl searches and page reads. `DAILY_BUDGET_USD` adds up the same rows over the last 24 hours. `estimateRunCost` (`packages/contracts/src/options.ts`) is shared by the server and the dashboard. It turns a mode's models and AI-call budget into a typical figure and an upper figure, using token averages measured from real runs.

### The AI account (`llm/client.ts`, `llm/models.ts`)

The AI account follows one rule: an API key, when set, overrides the ChatGPT sign-in. `config/envSchema.ts` derives the account from `OPENAI_API_KEY`, and `openaiFor` builds the one OpenAI SDK client that every call and the doctor use:

- **`api_key`** (whenever `OPENAI_API_KEY` is set): OpenAI's API with that key. Calls are priced from the list prices in `llm/models.ts`.
- **`chatgpt`** (no key): the user's ChatGPT plan, through the openai-oauth sign-in server at `OPENAI_OAUTH_URL` (default `http://127.0.0.1:10531/v1`). The server holds the ChatGPT session, so RUVO sends it no key. openai-oauth is unofficial: it reuses the Codex CLI's sign-in.

Each account has its own default models (`ACCOUNT_MODELS` in `config/envSchema.ts`): `gpt-6-sol` and `gpt-6-luna` with an API key; `gpt-5.6-terra` and `gpt-6-luna` on a ChatGPT plan, which doesn't offer `gpt-6-sol`. `MODEL_PLANNER` and `MODEL_WORKER` override them. On a ChatGPT plan:

- `GET /api/options` lists the plan's own models with no prices, and the dashboard shows "Included in your ChatGPT plan" instead of dollar estimates.
- Every call costs $0, and `DAILY_BUDGET_USD` is ignored.
- A usage-limit or rate-limit reply counts as a spent AI budget (`chatgptFailure`): the run's remaining AI calls are used up, so later steps carry on without AI and Activity says so. During understanding, which has no run budget to spend, it fails the run.
- An unreachable sign-in server fails the call with a message that says how to start it.

## Data model (`db/schema.ts`)

| Table | Holds |
|---|---|
| `requests` | The prompt (plus an idempotency key) |
| `dataset_contracts` | Contract versions per request (written by the LLM, the template, or a user edit) |
| `workflows` | IR versions with parent and reused-from links and the PlanDraft |
| `runs` | Status, stage, mode and models, attempt, heartbeat, metrics, quality report, diff, error |
| `run_events` | The run's activity feed, numbered per run |
| `pages` | Fetched pages and how each was fetched (`via`): the fetch cache and the evidence snapshots |
| `records` | One row per item, with status, scores, signals, dedupe keys |
| `evidence` | One row per field value, with method, locator, snippet, confidence |
| `recipes` | Versioned page recipes with parent, origin and usage stats |
| `registry_companies` | Curated and auto-detected job boards |
| `decisions` | Every judgement, with the tier that made it (also the decision cache) |
| `llm_calls` | Every LLM call with tokens and cost (also the LLM cache) |
| `search_calls` | Every web search (SearXNG or Firecrawl) and Firecrawl page read, with its provider, results and cost (also the search cache) |
| `workflow_memory` | Plans from good runs, with the contract summary they are matched on |

Plan memory lives in Postgres too: `workflow_memory` keeps each remembered plan next to a canonical summary of its contract, and pg_trgm's `similarity()` finds the closest one, so no embedding model or vector database is needed.

## API (`api/`)

| Route | Purpose |
|---|---|
| `GET /api/options` | Modes with their budgets, the AI account, and the models on offer with prices |
| `POST /api/runs` | Create a run from a prompt (`mode`, optional `models`, `autoStart`, `Idempotency-Key`) |
| `GET /api/runs`, `GET /api/runs/:id` | History and run detail (with its funnel) |
| `POST /api/runs/:id/start`, `/cancel`, `/rerun`, `/more` | Run actions (`/more` searches the web for sources not read yet) |
| `PATCH /api/runs/:id/contract` | Edit the contract while reviewing (recompiles the IR) |
| `GET /api/runs/:id/workflow`, `/events?after=`, `/records`, `/evidence/:recordId`, `/quality`, `/diff`, `/decisions` | Everything the dashboard shows (records come best lead first; `?isNew=true` keeps the new ones) |
| `GET /api/datasets/:runId/export?format=csv\|json\|xlsx&scope=valid\|all` | Export |
| `GET /api/recipes?host=`, `POST /api/recipes/:id/simulate-drift` | Recipe lineage and the drift demo |
