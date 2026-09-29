# RUVO design: Resolve

RUVO turns the noisy web into a clean list you can trust. The design shows exactly that: noise
on one side, resolved rows on the other. Everything is monochrome and quiet, the imagery is
dithered and dot-matrix, and one warm signal colour marks what was found.

Tokens live in `apps/web/app/globals.css`. In development, `/design` renders every token and
component on one page.

## Where it comes from

The references share one language, and RUVO takes these parts of it:

- **Images made of dots**: halftone, ordered dither, dot-matrix and ASCII. RUVO has no photos,
  so it draws its own noise field in dots and lets it settle into rows.
- **A dot-matrix display face** for the few big moments (the question, the row count).
- **A clean grotesk with a mono sibling** for everything you read and press.
- **Soft grey paper, true black, and one warm accent** used sparingly.
- **Frosted panels that float** over the dot field; everything else sits flat on the paper.

## Principles

1. **Noise resolves into rows.** The dot field is the one memorable thing. It appears on the ask
   screen and while collecting, where it settles into lines as rows arrive. Nowhere else.
2. **Signal means found.** The orange signal marks found, proven or chosen: quoted evidence,
   the selected option, progress. It is always a background behind black text, never text or
   decoration.
3. **Quiet around the loud part.** Flat paper, hairlines, no shadows on static content, no cards
   inside cards. Only things that float (composer, menus, drawers) are frosted.
4. **Plain words first, details on request.** The pipeline stays behind **Show details**.
5. **Money and time are always visible.** An estimate before a run, what it spent after.

## Colour

| Token | Hex | Use |
|---|---|---|
| `canvas` | `#E9E9E6` | Page paper, a soft neutral grey |
| `sheet` | `#F7F7F5` | Flat surfaces: table, tiles; frosted panels use it at 72% |
| `ink` | `#000000` | Text, primary buttons, focus outline, dots |
| `graphite` | `#3D3D3B` | Secondary text |
| `pencil` | `#62625F` | Placeholders, hints, inactive labels |
| `hairline` / `hairline-strong` | `#D2D2CE` / `#B4B4AF` | Rules, control outlines |
| `highlighter` (signal) | `#FF7A2E` | Found, proven, chosen; always behind black text |
| `highlighter-wash` | `#FFE3D1` | Focus halo, new-row flash |
| `void` | `#000000` | The dark panel the dot field sits on while collecting |
| `stamp` / `amber` / `brick` (+ `-wash`) | `#1D7248` / `#8F5400` / `#AE2116` | Sure / check this / error |

The token names predate this design and are kept so components need no renaming:
`highlighter` is the signal colour.

Meaning colours always come with a word or an icon. Contrast (AA needs 4.5:1): black on
`canvas` 17.3, `graphite` 8.9, `pencil` 5.0; black on `highlighter` 8.1; `stamp`, `amber` and
`brick` pass on their washes (`#DDEFE4` 4.9, `#F8EBD4` 5.2, `#F9E2DF` 5.6).

## Type

| Face | Role |
|---|---|
| **Doto** (dot-matrix, weight 800–900, `ROND` 0) | The ask question, page titles, the big row count and live count. Nothing under 32px. |
| **Geist** | Everything you read: body, tables, drawers. |
| **Geist Mono** | Everything you press or scan: buttons, tabs, chips, column headers, nav; and text quoted from a source page. |

Sentence case everywhere, no all-caps labels, no tracking tricks.

| Name | Size / line height | Face | Use |
|---|---|---|---|
| `text-display` | 64 / 64 | Doto | The ask question |
| `text-count` | 96 / 88 | Doto | Row count, live count |
| `text-title` | 40 / 44 | Doto | A dataset's name |
| `text-heading` | 20 / 28 | Geist 600 | Section headings, drawer titles |
| `text-body` | 16 / 24 | Geist | Default |
| `text-small` | 14 / 20 | Geist / Geist Mono | Tables, controls |
| `text-micro` | 12 / 16 | Geist Mono | Column headers, hints |

On phones `display` drops to 40/40, `count` to 64/60, `title` to 28/32.

## Space, shape, surface, motion

- **Rhythm** on a 4px grid: `tight` 8, `item` 16, `group` 24, `stack` 32, `section` 48.
- **Width**: 1200px frame; reading columns stay under 72 characters.
- **Alignment**: left aligned throughout. The dot field bleeds to the right edge.
- **Radius by role**: controls 6px, chips and toggles full, frosted panels 16px, drawers 20px.
- **Surfaces**: flat (`sheet`, 1px hairline) for content; frosted (`sheet` at 72%, 16px
  backdrop blur, 1px white inner edge, one soft shadow) only for things that float.
- **Buttons**: primary is black with mono label. Secondary is a bevel: `sheet` face, 1px light
  top-left edge and 1px dark bottom-right edge, pressed state inverts the bevel.
- **Motion**: 120 / 200 / 320 ms, one easing. Two choreographed moments only: the dot field
  settling while collecting, and new rows arriving. `prefers-reduced-motion` freezes the field
  on one frame.

## The dot field (`components/dot-field.tsx`)

One canvas component, no images or libraries.

- A smooth noise field (a few octaves of value noise) drifting slowly.
- Rendered with an 8×8 Bayer ordered dither into square dots on a 6px grid, like the halftone
  and dither references.
- `resolve` (0–1) blends the noise towards horizontal bands, so as rows are collected the
  field settles into lines, the look of a table.
- `tone`: `ink` (black dots on paper, ask screen) or `void` (paper dots on black, collecting).
  A few dots take the signal colour where rows were found.
- Pauses when off screen and freezes under reduced motion; `aria-hidden`.

## Screens

**Ask** (the only hero):

```
┌ ruvo ▪▪ ───────────────────────────── Your datasets   [New list] ┐
│                                                                  │
│  What do you need          ░░▒▒▓▓▓▓▒▒░  dot field, ink tone,     │
│  a list of?   (Doto 64)   ░▒▓▓██▓▓▒░░   bleeds to the right      │
│                            ░░▒▒▓▓▒▒░░                            │
│  ╭ frosted composer ─────────────────╮                           │
│  │ Remote backend jobs, with salary  │                           │
│  │ + Add a website          ◉ Speak  │                           │
│  ╰───────────────────────────────────╯                           │
│  [ Quick ][ Balanced ][ Thorough ]   mode tiles, chosen = signal │
│  about $0.03   up to 4 min           [ Make my list ]           │
│                                                                  │
│  Or try one: plain links in two columns                          │
└──────────────────────────────────────────────────────────────────┘
```

**Collecting**: a black `void` panel with the dot field settling as `resolve` rises; the live
count in Doto on top; the step track below it; first rows underneath on paper.

**Result**: the dataset name in Doto, the row count in Doto with "rows" in Geist beside it (no
coloured block), the trust summary as dot-matrix bars (rows of squares, filled in `ink`, the
"checked against the page" share in signal), then the table.

**Table**: Geist Mono column headers on a 2px ink rule, hairline rows, no zebra.

**Receipt drawer**: frosted, 20px radius. Each value's quote is set in Geist Mono on `sheet`
with the found words behind signal.

**Datasets**: a flat list; each row shows the name, a small static dot-field thumbnail seeded
from the dataset id, the row count in mono, and status.

## Words

The default screens use this vocabulary (`packages/contracts/src/plain.ts`, re-exported by
`apps/web/lib/plain.ts`):

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
| `SEARCH` | From search results |
| `DERIVED` | Worked out by RUVO |
| budgets, LLM calls | "up to N pages", dollars |
| planner / worker model | the model that **understands your request** / **reads the pages** |
| workflow, recipes, decisions, events | behind **Show details** |

Buttons say what happens: **Make my list**, **Start**, **Stop**, **Run again**, **Find more**,
**Download**. A toast repeats the verb ("Started"). Errors say what happened and what to do.

## Components

Base components are shadcn/ui-style files on `radix-ui`, restyled to the tokens, in
`apps/web/components/ui/`:

| Component | Notes |
|---|---|
| `Button` | `primary` (black, mono label), `secondary` (bevel), `quiet`, `danger`; sizes `sm`, `md`, `lg`, `icon` |
| `Input`, `Textarea` | Hairline outline, black outline and signal-wash halo on focus |
| `Badge` | Pills: `sure`, `check`, `error`, `chosen` (signal), `neutral`, `outline`; a 6px square dot before the word |
| `RadioGroup`, `RadioTile` | Flat tiles; the chosen one fills with signal |
| `Select`, `DropdownMenu`, `Tooltip` | Frosted popovers |
| `Switch` | Full-radius track; the thumb turns signal when on |
| `Sheet`, `Dialog` | Frosted; focus trap, Escape, focus return |
| `Tabs` | Mono labels; the active tab has a 2px ink underline |
| `Table`, `Skeleton`, `Toaster` | Skeletons shimmer as a dither pattern, not a gradient |

Do: one primary button per view; say the cost next to the action that spends it.
Don't: use signal as decoration, put the dot field anywhere but the ask and collecting screens,
stack frosted panels, or show a percentage where Sure / Likely / Check this will do.
