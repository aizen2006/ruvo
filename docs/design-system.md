# RUVO design system

RUVO is for anyone who needs a list: a recruiter, a job seeker, a student, a researcher.
They describe the list, check a short plan, and download a sheet they can trust. The design
serves that job and hides the machinery until someone asks for it.

Tokens live in `apps/web/app/globals.css`. In development, `/design` renders every token and
component on one page.

## Principles

1. **A list-maker with receipts.** The product is a sheet of rows. Every value has a receipt:
   where it came from and the words it was read from.
2. **One highlighter.** The yellow mark means *found, proven or chosen*. It appears on quoted
   source text in a receipt, on the option you picked, and on progress. It appears nowhere else,
   and it is always a background behind ink, never a text colour.
3. **Quiet everywhere else.** Ink on cool paper, hairlines instead of boxes, no shadows on static
   panels. Buttons are ink, not brand colour.
4. **Plain words first, details on request.** The default screens speak in everyday terms. The
   pipeline (contract, workflow, recipes, decisions, event log) sits behind one **Show details**
   switch.
5. **Money and time are always visible.** Before a run: an estimate. After: what it spent.

## Colour

| Token | Hex | Use |
|---|---|---|
| `canvas` | `#EEF1F3` | Page background |
| `sheet` | `#FFFFFF` | Surfaces: composer, table, drawers |
| `ink` | `#16202A` | Text, primary buttons, focus outline |
| `graphite` | `#4A5761` | Secondary text |
| `pencil` | `#6E7A84` | Placeholders and micro text, on `sheet` only |
| `hairline` / `hairline-strong` | `#DCE2E6` / `#C5CED4` | Rules, borders, control outlines |
| `highlighter` | `#FFE45C` | The signature: evidence quotes, the chosen option, progress |
| `highlighter-wash` | `#FFF6C7` | Focus halo, new-row flash |
| `stamp` (+ `-wash`) | `#1E7A4F` | Sure, verified, done |
| `amber` (+ `-wash`) | `#9A5B00` | Check this, warnings |
| `brick` (+ `-wash`) | `#B42318` | Errors, destructive actions |

`structured`, `pattern`, `model` and `derived` colour the trust tiers in the charts behind
*Show details*. Meaning colours always come with a word or an icon, never colour alone.

Contrast: `ink` and `graphite` pass WCAG AA on both `canvas` and `sheet`. `pencil` reaches
4.5:1 only on `sheet`, so it is used there and only for placeholders and micro text.

## Type

- **Bricolage Grotesque** for everything. It has character at display sizes and stays plain at
  14px.
- **Spline Sans Mono** only for text quoted from a source page, because that text is a quote.
- Sentence case everywhere. No all-caps labels.

| Name | Size / line height | Use |
|---|---|---|
| `text-display` | 44 / 48 | The ask screen's question |
| `text-title` | 28 / 34 | Page titles (a dataset's name) |
| `text-heading` | 20 / 28 | Section headings, drawer titles |
| `text-body` | 16 / 24 | Default |
| `text-small` | 14 / 20 | Tables, controls, secondary copy |
| `text-micro` | 12 / 16 | Column headers, hints |

## Space, radius, elevation, motion

- **Rhythm** on a 4px grid: `tight` 8, `item` 16, `group` 24, `block` 32, `section` 48
  (`gap-item`, `space-y-group`, `py-section`, …).
- **Width**: 720px for asking and checking the plan, 1200px for results.
- **Radius** follows hierarchy: `rounded-control` 8 (buttons, inputs), `rounded-panel` 14
  (composer, table frame, tiles), `rounded-sheet` 20 (drawers, dialogs), full for chips.
- **Elevation**: one level, `shadow-raised`, for things that float (drawers, menus, toasts).
  Focus is a 2px ink outline, with a highlighter-wash halo on text fields.
- **Motion**: 120 / 200 / 320 ms on one standard easing. Only two moments are choreographed:
  the progress fill and new rows arriving. Reduced motion is respected.

## Words

The default screens use this vocabulary (`apps/web/lib/plain.ts`):

| Inside RUVO | On screen |
|---|---|
| run | a **dataset** (while collecting: a search) |
| contract, criteria | the **plan**; rules are **must have** and **nice to have** |
| confidence ≥ 0.9 / ≥ 0.75 / lower | **Sure** / **Likely** / **Check this** |
| `API` | From the site's data feed |
| `JSON_LD` | From the page's listing data |
| `EMBEDDED_JSON` | From data inside the page |
| `DOM` | Read from the page |
| `REGEX` | Found in the text |
| `LLM` | Found by AI, quote checked |
| `DERIVED` | Worked out by RUVO |
| budgets, LLM calls | "up to N pages", dollars |
| planner / worker model | the model that **understands your request** / **reads the pages** |
| workflow, recipes, decisions, events | behind **Show details** |

Buttons say what happens: **Make my list**, **Start**, **Stop**, **Run again**,
**Download**. A toast repeats the verb ("Started"). Errors say what happened and what to do.

## Components

Base components are shadcn/ui-style files on the `radix-ui` package, restyled to the tokens,
in `apps/web/components/ui/`:

| Component | Notes |
|---|---|
| `Button` | `primary` (ink), `secondary`, `quiet`, `danger`; sizes `sm`, `md`, `lg`, `icon` |
| `Input`, `Textarea` | Ink border and highlighter-wash halo on focus |
| `Badge` | Tones `sure`, `check`, `error`, `chosen`, `neutral`, `outline` |
| `RadioGroup`, `RadioTile` | Tiles; the chosen one has an ink border and the highlighter bar |
| `Select` | Options can carry a hint line (a model's price) |
| `Switch` | The thumb turns highlighter when on |
| `Sheet` | Right-hand drawer on Dialog: focus trap, Escape, focus return |
| `Dialog`, `DropdownMenu`, `Tooltip`, `Table`, `Skeleton`, `Tabs`, `Toaster` | |

Do: one primary button per view; say the cost next to the action that spends it.
Don't: use the highlighter as decoration, stack cards inside cards, or show a percentage where
Sure / Likely / Check this will do.
