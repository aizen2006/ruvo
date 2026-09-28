# RUVO architecture

This page explains how a request becomes a dataset, where each part lives in the code, and
the design rules that keep the system predictable. Paths are relative to `apps/server/src`
unless noted.

## Design rules

1. **The LLM proposes; deterministic code compiles and executes.** Models write small, typed drafts: a contract, a plan, a recipe. Code checks, clamps and expands those drafts, then runs them. A model's output never runs unchecked.
2. **Every value carries evidence**: method, source URL, stored page, snippet, locator, a verified flag and a confidence score. A value the LLM extracted is kept only if its quoted text is found on the page.
3. **Every AI step has a fallback**: the template planner, a rules-only decider, parsers for Hacker News posts, and local selector repair before LLM rediscovery.
4. **Everything nondeterministic is cached.** That covers pages (per URL and transport), LLM calls (per input hash) and decisions (per task and state hash). Re-runs are therefore reproducible, a crashed run can resume by replaying from the caches, and demos can run offline.
5. **Postgres is the only source of truth, including the job queue.** Qdrant and the decision provider are accelerators: when they fail, RUVO skips them.
6. **Fetching is polite and safe.** RUVO sends an honest User-Agent, follows robots.txt (a 4xx robots file means everything is allowed, a 5xx means nothing is; `Crawl-delay` is honoured up to 10 s), applies per-host rate limits and circuit breakers, blocks requests to private networks, and caps response size. It never uses stealth techniques or solves captchas.

## From request to dataset

```
prompt ─ compile (gpt-6-sol) ─▶ DatasetContract ─ user edits while reviewing ─▶ contract vN
       ─ discover sources (registry, ATS auto-detect, Hacker News, linked pages) ─▶ candidates
       ─ plan (workflow memory, else gpt-6-sol, else template) ─▶ PlanDraft ─ IR compiler ─▶ WorkflowIR vN
       ─ start ─▶ worker claims the run ─▶ one branch per source (3 at a time):
            collect → prefilter → triage | extract_text → enrich → match → validate → store
       ─ dedupe across sources ─▶ quality report, run diff, recipe repairs, memory ─▶ dataset
```

### Run lifecycle (`db/queue.ts`, `runs/worker.ts`)

```
queued → compiling → planning → awaiting_approval ─start─▶ queued_run → running → completed | failed | cancelled
                    (or straight to queued_run when the run was created with autoStart and has sources)
```

- **API process** (`index.ts`): it only reads and writes rows.
- **Worker process** (`worker.ts`): it claims runs with `FOR UPDATE SKIP LOCKED`. It sends a heartbeat every few seconds and checks for cancellation on each one.
- **Stale runs**: a run whose heartbeat stops is requeued, up to 2 attempts. A requeued run replays from the caches, and records are written with upserts keyed on `(run_id, item_key)`, so replaying never duplicates them.
- **Preparation** (`runs/prepare.ts`): compile, discover, plan, save.
- **Execution** (`runs/pipeline.ts` → `execute/executor.ts`): execute the workflow, then record repairs and remember the plan.

### Contract (`compile/`)

1. `requirementCompiler.ts` asks the planner model for a contract. The contract lists fields, criteria, assumptions, dedupe keys and source hints.
2. `normalize.ts` then repairs it deterministically:
   - field names become unique snake_case
   - criteria must point at real fields
   - job contracts always include company, title and url
   - linked URLs are normalized
   - "good companies" becomes a visible assumption

Edits made during review go through the same normalization. They produce a new contract version and recompile the IR, with no LLM call.

### Sources (`plan/discovery.ts`, `plan/atsDetect.ts`, `adapters/`)

**Discovery order:**
1. Pages the user linked.
2. For job requests only, registry companies: the ones named in the request (suffixes such as "Inc" are ignored); otherwise, unless the user linked pages, those whose tags match.
3. For job requests that ask for startups or broad coverage, the Hacker News "Who is hiring?" thread.

Requests for any other kind of data use linked pages only; without one, the run stops for review and asks for a page.

**Auto-detection:** a named company missing from the registry is looked up by probing slug variants on Greenhouse, Ashby, Lever and Workable. A board with postings is added to the registry.

**Adapters** return items whose fields already carry evidence:

| Adapter | Reads | Evidence |
|---|---|---|
| `greenhouse`, `ashby`, `lever`, `workable` | Public board APIs | `API`, with a JSON path |
| `hn_whoishiring` | Top-level comments from Algolia | Header parser, then `REGEX` / `LLM` |
| `html_list` | Any list page: fetched over HTTP, or rendered in a browser if it is a JavaScript shell | `DOM`, with a CSS locator |

### Planning (`plan/planner.ts`, `plan/irCompiler.ts`)

The planner writes a **PlanDraft**: which candidates to include, why, how many items to keep from each, and an LLM budget.

**Planner order:**
1. Workflow memory is checked first (`memory/workflowMemory.ts`). A stored plan is reused when similarity is at least 0.9 and at least 80% of its sources are still candidates.
2. Otherwise `gpt-6-sol` writes the draft.
3. If that fails, the template plan is used.

**The IR compiler never trusts the draft:**
- It drops unknown or duplicate sources.
- It builds each branch's steps in canonical order.
- It relaxes required fields that no source can produce.
- It clamps budgets to the environment caps.
- It raises the LLM budget to at least what the steps need (for example, recipe discovery on a list page).

Every change the compiler makes is recorded in `provenance.warnings`.

### Fetching (`fetch/`)

**Checks, in order:** cache → private-network guard → circuit breaker → robots.txt → budget → per-host rate-limited transport, with retries and `Retry-After`.

**Fetch modes:**
- `http`: plain request.
- `browser`: Playwright render.
- `auto`: plain request first. The page is rendered in the browser if it has under 500 characters of text, or shows single-page-app markers with under 2,000 (`sufficiency.ts`).

**Browser pool:** each page gets its own browser context. Images, fonts and media are blocked, and every request the page makes has its host resolved and checked against private networks. The pool waits for the text to stop changing rather than for network idle, and returns HTML only.

### Pages and recipes (`page/`, `recipes/`)

**`toPageState`** extracts text, links, JSON-LD, embedded state, and repeated sibling groups (the likely list items). Stable selectors are preferred to generated class names. `pageSkeleton` compresses a page into an outline the LLM can read.

**A recipe** is an item selector plus one selector and attribute per field. It is:
- discovered by the LLM,
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
- **Diff**: new, removed and changed records compared with the previous completed run of the same request, matched by canonical key.

### Self-repair (`repair/`)

When a recorded recipe no longer fits its page, `html_list` hands the failure to `repair/repairRecipe.ts`.

1. **Classify** (`classify.ts`): `SELECTOR_MISS` or `PARTIAL_FILL`. If the page came back with almost no text, it is `EMPTY_RENDER` instead.
2. **Choose an action** (`policy.ts`, the `REPAIR_ACTION` task):
   - Clear cases are settled by rules: blocked → stop; empty over HTTP → switch to the browser; a transient error → retry.
   - Selector problems go to the decider, which weighs a cheap local fix against rediscovery.
3. **Repair**:
   - **Local fix** (`relax.ts`): turn generated class names into prefix matches, try the page's repeated groups as the item selector, and fall back to generic places for the title (headings) and url (links). It is accepted only if it passes the recipe's acceptance checks.
   - **LLM rediscovery**: the LLM is given the failure report and the previous recipe.
4. **Record**: the fix is saved as recipe v+1, with the broken version as its parent. The run then saves workflow v+1 (`plannedBy: "repair"`) listing what changed, and later re-runs start from it.

**Demo triggers:**
- `POST /api/recipes/:id/simulate-drift {minor|major}` records a deliberately broken recipe version (origin `simulated_drift`).
- `POST /fixtures/careers/version {2}` switches the local Northwind demo site to a redesigned page at the same URL.

### Budgets and time limits

**Budgets:** each run has page, browser-page and LLM-call budgets. Steps ask the budget before spending, and when it refuses, they degrade instead of failing the run. The first refusal of each budget is announced in Activity.

**Time limit:** the run's limit (`MAX_RUN_MS`) stops slow work such as collection and enrichment. Records that were already gathered still go through match, validate and store.

## Data model (`db/schema.ts`)

| Table | Holds |
|---|---|
| `requests` | The prompt (plus an idempotency key) |
| `dataset_contracts` | Contract versions per request (written by the LLM, the template, or a user edit) |
| `workflows` | IR versions with parent and reused-from links and the PlanDraft |
| `runs` | Status, stage, attempt, heartbeat, metrics, quality report, diff, error |
| `run_events` | The run's activity feed, numbered per run |
| `pages` | Fetched pages: the fetch cache and the evidence snapshots |
| `records` | One row per item, with status, scores, signals, dedupe keys |
| `evidence` | One row per field value, with method, locator, snippet, confidence |
| `recipes` | Versioned page recipes with parent, origin and usage stats |
| `registry_companies` | Curated and auto-detected job boards |
| `decisions` | Every judgement, with the tier that made it (also the decision cache) |
| `llm_calls` | Every LLM call with tokens and cost (also the LLM cache) |

Qdrant holds one collection, `workflow_memory`. Each point is an embedding of a contract summary, with the plan stored as payload.

## API (`api/`)

| Route | Purpose |
|---|---|
| `POST /api/runs` | Create a run from a prompt (`autoStart`, `Idempotency-Key`) |
| `GET /api/runs`, `GET /api/runs/:id` | History and run detail |
| `POST /api/runs/:id/start`, `/cancel`, `/rerun` | Run actions |
| `PATCH /api/runs/:id/contract` | Edit the contract while reviewing (recompiles the IR) |
| `GET /api/runs/:id/workflow`, `/events?after=`, `/records`, `/evidence/:recordId`, `/quality`, `/diff`, `/decisions` | Everything the dashboard shows |
| `GET /api/datasets/:runId/export?format=csv\|json&scope=valid\|all` | Export |
| `GET /api/recipes?host=`, `POST /api/recipes/:id/simulate-drift` | Recipe lineage and the drift demo |
