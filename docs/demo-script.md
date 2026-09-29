# RUVO demo script

About 8 minutes. The demo shows the whole path: a plain request becomes a plan you can check,
the plan becomes a list where every value has a receipt, and the machinery stays one switch
away. It then shows re-runs, self-repair and plan reuse.

## Before the demo

Set up as in the README (install, migrate, browsers), then:

```bash
docker compose up -d --wait
bun run dev                          # terminal 1, repo root: API :3000, worker, dashboard :3001
cd apps/server && bun run seed:demo  # terminal 2: warms caches, resets the demo site, prints run links
```

- **Repeatable timing:** after seeding, set `FETCH_CACHE_MODE=prefer_cache` in `apps/server/.env` and restart `bun run dev`. Pages then come from the cache, so a live run takes seconds.
- **No network:** the same, with `FETCH_CACHE_MODE=cache_only` and `LLM_CACHE_MODE=cache_only`.
- **Jev unavailable:** set `DECIDER_PROVIDER=off`. The decider then uses rules and the LLM judge only, and the Decisions view shows that honestly.

Keep the seeded "golden run" link open in a tab as a fallback for steps 3 to 6.

## 1. The request (30 s)

Open http://localhost:3001/new. Under **Or try one**, choose *Backend and AI roles at good tech companies*. It fills in:

> Find me backend + AI engineering roles, preferably remote, from good technology companies. Return company, title, location, salary if available, job URL, and why the role matches.

Point at the three modes; each shows what it costs and how long it may take. Open **Choose models** to show you can pick the model for each job, then close it. Leave **Balanced**, leave **Start without checking the plan** off, and press **Make my list**.

Say: RUVO first writes down what it understood, and nothing is collected until you agree.

## 2. Check the plan (1 min)

- **The columns**: solid chips are must-haves, dashed chips are nice to have. `salary` is dashed because the prompt said "if available".
- **The rules**: "Keeps only rows that" holds the role rules; "Ranks higher when" holds remote and good company.
- **How RUVO read your words**: "good technology companies" is written down as an interpretation (registry tags such as AI labs and dev tools), not stated as a fact.
- **Cost and time**: what understanding and planning already cost, and what collecting should cost.
- Press **Remote preferred**, choose **Make it a must**, then **Save changes**. The toast says *Plan updated*: the plan was recompiled with no AI call.

## 3. The machinery, on request (1 min)

Switch on **Show details**. Under **Behind the scenes**, the **Workflow** tab shows:

- the planner's reason for each source
- the steps per source (Fetch → Keyword filter → Enrich → Score → Validate → Save)
- the limits

*Show the workflow as JSON* shows the compiled IR: typed, versioned and re-runnable.

Press **Start collecting**.

## 4. Watching it run (1 min)

The page switches to a collecting view:

- five plain steps with a progress fill
- a live count ("340 found so far")
- the first rows as they arrive

The status line speaks plainly, for example "Opening a page in a browser, because it needs one" or "Reading a page the same way as last time".

With details on, the **Activity** tab has the raw log:

- `apply.workable.com: only 0 characters of text over HTTP, rendered in the browser`
- `replayed recipe v1, 8 items, no LLM needed`

## 5. The list and its receipts (1.5 min)

The finished page leads with:

- the row count
- the sources and the time taken
- one line on trust: how many values came straight from the sites' own data

Click a row to open its receipt:

- **Title**: *From the site's data feed*, **Sure**, with the text it was read from highlighted and a link to the page.
- **Company**: *Worked out by RUVO* on Ashby and Lever, whose APIs do not state it. The highlight is on the board's address.
- **Salary**: the pay range with its source text highlighted. On a Hacker News row it may be *Found by AI, quote checked*: RUVO keeps it only because the quote was found on the page.

Then filter by **Has a salary**, **Sure only** and **Remote**. Open **Download** and choose **Excel workbook (.xlsx)**: it has the rows, a receipt for every value, and how the list was made.

## 6. Quality and decisions (1 min)

Under **Behind the scenes**:

- **Quality**:
  - the funnel from postings to valid records
  - completeness per column
  - where values came from
  - the confidence spread
  - why records were set aside
- **Decisions**: how many judgement calls each tier settled (rules, Jev, LLM judge), and how often Jev and the LLM judge agreed. Every call settled by rules or Jev is one the LLM didn't have to make.

## 7. Run again: reuse and "what changed" (45 s)

Press **Run again**. It finishes in seconds and costs almost nothing, because recipes replay and caches answer. A line under the row count says what is new, gone or changed since the last run, and **See the rows** lists them.

## 8. Self-repair (1.5 min)

From **Your datasets**, open the seeded **Northwind** dataset (the fictional demo site at `/fixtures/careers`) and switch on **Show details**. In **Workflow → Page recipes**:

1. Press **Simulate a redesign**, or **Simulate a small site change**, which only renames the item wrapper. RUVO records version N+1 with stale selectors, labelled *Simulated drift*. Press **Run again**.
2. While it runs, the status line says "A website changed; adjusting to it". In **Activity**:
   - `recipe vN+1 no longer fits the page (SELECTOR_MISS…)`
   - `SELECTOR_MISS → CHANGE_SELECTOR (decided by decider)`: Jev chose the cheap fix
   - `recipe … fixed selectors locally, no LLM needed`
   - `Saved workflow vK with 1 recipe repair`
3. In **Workflow**, the new version shows **What self-repair changed**, and the recipe history shows every version with its origin.

For a real redesign, switch the site's markup (same URL, new HTML), then press **Run again**:

```bash
curl -X POST localhost:3000/fixtures/careers/version -H 'content-type: application/json' -d '{"version":2}'
```

This time the local fix fails the acceptance checks, because the location moved. RUVO asks the LLM to rediscover the recipe and sends the failure report with the request. The result is saved as *Rediscovered by AI*.

## 9. Plan reuse (30 s)

On the home page, enter a paraphrase of a request you have already run, for example:

> Find remote roles in backend or AI infra engineering at AI research labs; include salary if they publish it

With details on, the **Workflow** tab shows a **Reused workflow** notice. It links to the earlier run and gives the similarity (about 98%). No planner call was made.

## 10. Close (15 s)

**Your datasets** lists every list with its status, rows and spend. Any of them can be opened or run again.

Close by recapping the path: a plain request, then a plan you can check, then a list where every value has a receipt. Each step can be inspected and re-run, and RUVO repairs itself when sites change.

## If something goes wrong

| Symptom | What to do |
|---|---|
| A source "couldn't be read" | With details on, Activity gives the reason (for example "refused automated access"). RUVO never works around blocks; the other sources still complete. |
| The live run is slow | Switch to the golden-run tab from `seed:demo`. |
| Jev errors or is slow | `DECIDER_PROVIDER=off`; Decisions then shows rules and the LLM judge only. |
| No network | `FETCH_CACHE_MODE=cache_only`, `LLM_CACHE_MODE=cache_only` (after seeding). |
| The Northwind recipe is in an odd state after rehearsals | Run `bun run seed:demo` again. It resets the site to version 1 and re-runs the Northwind request, which repairs a stale recipe as a side effect. |
