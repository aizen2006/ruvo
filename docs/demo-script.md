# RUVO demo script

About 8 minutes. The demo shows the whole path: a request becomes a reviewed contract, the
contract becomes an inspectable workflow, and the workflow produces an evidence-backed
dataset. It then shows re-runs, self-repair and plan reuse.

## Before the demo

```bash
docker compose up -d
bun run dev                          # at the repo root: API :3000, worker, dashboard :3001
cd apps/server && bun run seed:demo  # warms caches, resets the demo site, prints run links
```

- **Repeatable timing:** restart the API and worker with `FETCH_CACHE_MODE=prefer_cache` after seeding. Pages then come from the cache, so a live run takes seconds.
- **No network:** use `FETCH_CACHE_MODE=cache_only` and `LLM_CACHE_MODE=cache_only`.
- **Jev unavailable:** set `DECIDER_PROVIDER=off`. The decider then uses rules and the LLM judge only, and the Decisions tab shows that honestly.

Keep the seeded "golden run" link open in a tab as a fallback for steps 3 to 6.

## 1. The request (30 s)

Open http://localhost:3001 and choose the first example:

> Find me backend + AI engineering roles, preferably remote, from good technology companies. Return company, title, location, salary if available, job URL, and why the role matches.

Leave **Start collecting without review** off and press **Compile request**.

Say: RUVO first writes down what it understood, and nothing is collected until you agree.

## 2. Contract tab: what RUVO understood (1 min)

- The prompt is shown with numbered margin notes. Each note is an interpretation, for example **"good companies"** → registry tags such as `ai_lab` and `devtools`, shown as an assumption rather than a fact.
- **Columns**: `salary` is optional because the prompt said "if available".
- **How records are judged**:
  - "Must match" holds the role keywords (titles only, a broad filter) and the semantic check ("is this backend or AI engineering?").
  - "Preferences" holds remote and good company.
- Make **remote** required (*Make required*) and press **Save changes**. The message confirms the workflow was recompiled as version 2, with no LLM call.

## 3. Workflow tab: the plan (1 min)

- Each source has the planner's reason for choosing it: Greenhouse, Ashby, Lever and Workable APIs for the chosen companies, plus the Hugging Face board page.
- Each source shows its steps (Fetch → Keyword filter → Enrich → Score → Validate → Save) and its limits (pages, browser pages, LLM calls, minutes).
- *Show the workflow as JSON* shows the compiled IR: typed, versioned and re-runnable.

Press **Start collecting**.

## 4. Watching it run (1 min)

In the timeline and the Activity tab, point out:
- APIs are collected first, and the keyword filter reports "N of M match".
- `apply.workable.com: only 0 characters of text over HTTP, rendered in the browser`: RUVO escalates to the browser only when a page needs it.
- `replayed recipe v1, 8 items, no LLM needed`: RUVO read the page the way it did last time, using the selectors it recorded.

## 5. Dataset tab: evidence (1.5 min)

Click a row to open its evidence:
- **Title / url**: `API`, 99%, with the JSON path it was read from and a link to the source.
- **Company**: `DERIVED` from the registry.
- **Salary**: `REGEX` or `JSON-LD` with the snippet it was read from. On a Hacker News row it may be `LLM`, which RUVO keeps only because the quote was found on the page.

Then filter: **Status** valid, **Remote** remote, **Salary** yes, **Confidence** 90% or more. Press **Download CSV**.

## 6. Quality and Decisions (1 min)

- **Quality**: the funnel from postings to valid records, completeness per column, where values came from (grouped by how much they can be trusted), the confidence spread, and why records were set aside.
- **Decisions**: how many judgement calls each tier settled (rules, Jev, LLM judge), and the LLM calls and dollars the decision layer avoided.

## 7. Run again: reuse and "what changed" (45 s)

Press **Run again**.
- It finishes in seconds with (nearly) 0 LLM calls: recipes replay and caches answer.
- On the Quality tab, **What changed since the previous run** lists new, removed and changed records.

## 8. Self-repair (1.5 min)

Open the seeded **Northwind** run (the fictional demo site at `/fixtures/careers`). In **Workflow → Page recipes**:

1. Press **Simulate a redesign**. RUVO records version N+1 with stale selectors, labelled *Simulated drift*, then press **Run again**.
2. In Activity:
   - `recipe vN+1 no longer fits the page (SELECTOR_MISS…)`
   - `SELECTOR_MISS → CHANGE_SELECTOR (decided by decider)`: Jev chose the cheap fix
   - `recipe … fixed selectors locally, no LLM needed`
   - `Saved workflow vK with 1 recipe repair`
3. In Workflow, the new version shows **What self-repair changed**, and the recipe history shows every version with its origin.

For a real redesign, switch the site's markup (same URL, new HTML), then press **Run again**:

```bash
curl -X POST localhost:3000/fixtures/careers/version -H 'content-type: application/json' -d '{"version":2}'
```

This time the local fix fails the acceptance checks (the location moved), so RUVO asks the LLM to rediscover the recipe. The failure report goes with the request, and the result is saved as *Rediscovered by AI*.

## 9. Plan reuse (30 s)

On the home page, enter a paraphrase of a request you have already run, for example:

> Find remote roles in backend or AI infra engineering at AI research labs; include salary if they publish it

On the Workflow tab, a **Reused workflow** notice links to the earlier run and gives the similarity (about 98%). No planner call was made.

## 10. Close (15 s)

The **History** page lists every run and its status; any of them can be opened or run again.

Close by recapping the path: prompt → contract → workflow → evidence-backed dataset. Each step can be inspected, re-run, and repairs itself, and every value can be traced to its source.

## If something goes wrong

| Symptom | What to do |
|---|---|
| A source shows "could not be collected" | Point out the reason (for example "refused automated access"). RUVO never works around blocks; the other sources still complete. |
| The live run is slow | Switch to the golden-run tab from `seed:demo`. |
| Jev errors or is slow | `DECIDER_PROVIDER=off`; the Decisions tab then shows rules and the LLM judge only. |
| No network | `FETCH_CACHE_MODE=cache_only`, `LLM_CACHE_MODE=cache_only` (after seeding). |
| The Northwind recipe is in an odd state after rehearsals | Run `bun run seed:demo` again; it resets the site to version 1 and repairs the recipe if needed. |
