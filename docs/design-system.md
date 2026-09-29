# RUVO design system

RUVO is for anyone who needs a list: a recruiter, a job seeker, a student, a researcher.
They describe the list, check a short plan, and download a sheet they can trust. The design
serves that job and hides the machinery until someone asks for it.

The look is a Swiss, slightly brutalist magazine: huge condensed type, black ink on white paper,
thick rules, square blocks, and the highlighter as the one colour. Tokens live in
`apps/web/app/globals.css`. In development, `/design` renders every token and component on one page.

## Principles

1. **A list-maker with receipts.** The product is a sheet of rows. Every value has a receipt:
   where it came from and the words it was read from.
2. **One highlighter.** Yellow means *found, proven or chosen*: quoted source text, the option
   you picked, the rows RUVO found (the row count and live count sit on a yellow block), values
   checked against their page, and progress. Hovering a button marks it yellow because you are
   about to choose it. It is always a background behind black ink, never a text colour.
3. **Set the numbers big.** Row counts, prices and percentages are set in the condensed display
   cut at poster sizes, with a plain sentence beside them saying what they mean.
4. **Rules, not boxes.** Structure comes from ink rules of set weights and from square frames on
   things you can press. No rounded corners, no soft shadows, no cards inside cards.
5. **Plain words first, details on request.** The default screens speak in everyday terms. The
   pipeline (contract, workflow, recipes, decisions, event log) sits behind one **Show details**
   switch.
6. **Money and time are always visible.** Before a run: an estimate. After: what it spent.

## Colour

| Token | Hex | Use |
|---|---|---|
| `canvas`, `sheet` | `#FFFFFF` | Paper: the page and every surface |
| `newsprint` | `#EDEDED` | Quotes, zebra rows, empty progress, disabled controls |
| `ink` | `#000000` | Text, rules, control outlines, primary buttons, the top bar, focus |
| `graphite` | `#474747` | Secondary text |
| `pencil` | `#666666` | Placeholders, hints, inactive labels |
| `hairline` | `#D4D4D4` | Row rules inside tables and lists (`hairline-strong` is ink) |
| `highlighter` | `#FFE500` | The signature: found, proven, chosen, progress |
| `highlighter-wash` | `#FFF6A3` | Row hover, focused fields |
| `stamp` (+ `-wash`) | `#0F6B3F` | Sure, verified, done |
| `amber` (+ `-wash`) | `#8A4F00` | Check this, warnings |
| `brick` (+ `-wash`) | `#C0150C` | Errors, destructive actions |

`structured`, `pattern`, `model` and `derived` colour the trust tiers in the charts behind
*Show details*. Meaning colours always come with a word or an icon, never colour alone.

Contrast (WCAG AA needs 4.5:1 for text): `ink` 21 on paper; `graphite` 9.3 / 7.9 and `pencil`
5.7 / 4.9 on paper / `newsprint`. Ink on `highlighter` is 16.5:1, graphite on it 7.3:1. On the
black bar, white is 21:1 and 75% white 11:1. `stamp`, `amber` and `brick` pass on their washes
(5.5, 5.6, 5.2).

## Type

- **Archivo**, one grotesque in two widths, the way Swiss designers used one family (Univers)
  across widths. `font-display` sets its width axis to 62 (extra condensed); use it black (900)
  for headlines and big numbers. Text is Archivo at normal width.
- **Spline Sans Mono** only for text quoted from a source page, because that text is a quote.
- Sentence case everywhere. No all-caps labels.

| Name | Size / line height | Use |
|---|---|---|
| `text-mega` | 80–176 / 0.8 | Row count, live count |
| `text-display` | 52–104 / 0.86 | The ask question, a dataset's name, page titles |
| `text-title` | 36–56 / 0.95 | Section titles, "rows" beside the count |
| `text-heading` | 22 / 28 | Composer text, a receipt's values, the request quote |
| `text-body` | 16 / 24 | Default |
| `text-small` | 14 / 20 | Tables, controls, secondary copy |
| `text-micro` | 12 / 16 | Badges, receipt footnotes |

The three display sizes scale with the viewport (`clamp`), so phones get the same hierarchy.
Smaller display-cut labels (tile names, prices, list titles) use arbitrary sizes of 28–44px.

## Space, rules, elevation, motion

- **Rhythm** on a 4px grid: `tight` 8, `item` 16, `group` 24, `stack` 32, `section` 56
  (`gap-item`, `space-y-group`, `py-section`, …).
- **Width**: 1280px. The ask screen is asymmetric: the question and composer take eight
  columns, the examples a black four-column block.
- **Rules** have four weights: hairline 1px (rows), 2px ink (controls, items in a receipt),
  3px ink (table heads, framed blocks), 6px ink (section openers above tables, lists, trust
  figures).
- **Radius** is 0 everywhere; `rounded-control/panel/sheet` stay as names at 0. Status
  dots are square too.
- **Elevation**: `shadow-raised` is a hard 6px ink offset, for menus and dialogs. The receipt
  drawer is a full-height sheet with a thick left rule and a black masthead.
- **Focus** is a 3px ink outline (highlighter on black blocks, via `.on-ink`). The composer
  lifts on focus with a highlighter block framed in ink behind it.
- **Motion**: 120 / 200 / 320 ms on one standard easing. Only two moments are choreographed:
  the progress fill and new rows arriving (they flash highlighter). Reduced motion is respected.

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

Buttons say what happens: **Make my list**, **Start**, **Stop**, **Run again**, **Find more**,
**Download**. A toast repeats the verb ("Started"). Errors say what happened and what to do.

## Components

Base components are shadcn/ui-style files on the `radix-ui` package, restyled to the tokens,
in `apps/web/components/ui/`:

| Component | Notes |
|---|---|
| `Button` | Square, bold. `primary` (ink block), `secondary` (2px ink frame), `quiet` (underlined), `danger` (brick frame); enabled buttons turn highlighter on hover. Sizes `sm`, `md`, `lg`, `icon` |
| `Input`, `Textarea` | 2px ink frame; the field turns highlighter-wash on focus |
| `Badge` | Square. Tones `sure`, `check`, `error`, `chosen`, `neutral`, `outline` |
| `RadioGroup`, `RadioTile` | Ink-framed blocks; the chosen one fills highlighter |
| `Select` | Ink frame; open and highlighted options are highlighter. Options can carry a hint line |
| `Switch` | Square track; the ink thumb turns highlighter when on |
| `Sheet` | Right-hand drawer on Dialog with a black masthead: focus trap, Escape, focus return |
| `Table` | 3px ink rule under the header, hairline rows, zebra in newsprint |
| `Tabs` | On a 3px rule; the active tab is a black block |
| `Dialog`, `DropdownMenu`, `Tooltip`, `Skeleton`, `Toaster` | Square; toasts are black with a highlighter edge |

Do: one primary button per view; say the cost next to the action that spends it; put a plain
sentence beside every big number.
Don't: use the highlighter as decoration or as text colour, round a corner, or show a percentage
where Sure / Likely / Check this will do.
