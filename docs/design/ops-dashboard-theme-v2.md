# Ops Dashboard — Theme v2 (design proposal)

Status: **proposal, not implemented.** Nothing in `web/` changes until the founder picks a
direction. This doc exists so whichever variant is chosen can be "followed forward" — every future
screen (ticket portal, admin panels) should pull from these same tokens instead of inventing new
ones.

Two variants are provided as static mockups, both rendering the *real* dashboard widgets with
realistic sample data:

- `ops-dashboard-mockup-v2-dark.html` — **Slate/Indigo** (refined dark, evolves v1)
- `ops-dashboard-mockup-v2-light.html` — **Daylight Neutral** (new light alternative)

Both mockups use the same layout and the same honesty rules as the live app (see "Non-negotiables
preserved" below) — only the visual treatment differs. Pick one, or mix (e.g. dark as default with
the light palette values kept on file for a future light-mode toggle).

---

## 1. Slate/Indigo (dark)

Evolution of the v1 ops-console mockup, not a reset: same bones (dark surface, mono for numbers,
card-based grid), refined for a "considered tool" feel over a "generic dark admin theme" feel —
tighter type scale, a distinct accent hue, subtle top-edge highlight on cards instead of flat
borders, soft ambient glow instead of hard corner gradients.

### Color tokens

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0a0d13` | Page background |
| `--surface` | `#12151e` | Card / panel background |
| `--surface-raised` | `#191d29` | Hover state, track backgrounds, skeletons |
| `--border` | `#232838` | Card borders |
| `--border-soft` | `#1a1e2a` | Internal dividers (table rows, panel headers) |
| `--text` | `#eef1f7` | Primary text |
| `--text-muted` | `#9aa3b8` | Secondary text, sub-captions |
| `--text-faint` | `#626c83` | Labels, timestamps, least-important text |
| `--accent` | `#7c8cf8` | Primary interactive / neutral-metric accent (indigo — was blue `#5aa2e6` in v1) |
| `--good` | `#3ecf8e` | Healthy / good-tone values |
| `--warn` | `#eaa64a` | At-risk / warning-tone values |
| `--critical` | `#f2596f` | Breach / error-tone values |

Each semantic color also has a `-dim` variant at ~12% opacity for chip/badge backgrounds
(`--good-dim`, `--warn-dim`, `--critical-dim`, `--accent-dim`).

### Why indigo instead of v1's blue

v1's blue (`#5aa2e6`) sits close to the good-green in perceived "positive" register and is a common
default in dark admin templates. Indigo reads as a deliberate brand choice, stays clearly distinct
from green/amber/red at a glance (important since color is one of the only differentiators between
"neutral" and "good" metric cards), and gives the console a slightly more premium, less
generic-SaaS-dashboard feel.

### Type scale

| Role | Size | Weight | Notes |
|---|---|---|---|
| Metric value | 32px | 600 | Mono, tabular-nums, `-0.01em` tracking |
| Metric unit | 13px | 500 | Muted color, sits at baseline of value |
| Panel heading (h2) | 13px | 650 | |
| Metric label | 10.5px | 650 | Uppercase, `0.08em` tracking, faint color |
| Body / sub-caption | 12px | 400 | Muted color |
| Table header | 10.5px | 650 | Uppercase, faint color |
| Table cell primary | 13px | 600 | |
| Mono data (IDs, SLA timers, latency) | 11–12px | 400–650 | Always tabular-nums |

Base font: system stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue",
Arial, sans-serif`), same as v1 — no web fonts, zero load cost, matches OS conventions.

### Spacing & shape

- Card / panel radius: **14px** (v1 was 12px — slightly softer)
- Card padding: 20–22px horizontal, 20px top
- Grid gap: 16–20px
- Card border: 1px solid `--border`, plus a 1px top-edge gradient highlight in the card's semantic
  color at 35% opacity (replaces v1's flat single-color border top)
- Elevation: a soft two-layer shadow (`0 1px 2px rgba(0,0,0,.35), 0 12px 32px -16px rgba(0,0,0,.55)`)
  instead of relying on border contrast alone — cards read as "raised" against the page background

### Component treatments

- **Metric card**: label row → mono value row → sub-caption. Tone (`good`/`warn`/`critical`/`neutral`)
  colors the value and the top-edge highlight only — never the whole card background, so five cards
  side by side don't turn into a traffic light.
- **Pending / honest-empty card**: distinct treatment — warm amber tint background (`--warn-dim`),
  title styled as a sentence ("Eval health — pending real gate") instead of a number, because there
  is no number to show. This must never be visually confusable with the error state below.
- **Error card**: red-tinted background (`--critical-dim`), bold red title ending in "failed to
  load", monospace error detail truncated to ~200 chars. Every widget on the page fails
  independently into this state — never a blank page.
- **Chips** (ticket state): pill, 6px radius, semantic-dim background + semantic text color.
- **Status pill** (top bar "All systems nominal"): full pill, dot + label, good-tone by default.

---

## 2. Daylight Neutral (light)

A genuinely different alternative, not just an inverted dark theme — warm-neutral grays (not stark
white-on-white), higher card elevation via shadow instead of borders (borders read as "heavier" on
light backgrounds), semantic colors pulled from a well-tested accessible palette so contrast is
correct by construction rather than by luck.

### Color tokens

| Token | Value | Use | Contrast on white |
|---|---|---|---|
| `--bg` | `#f6f7f9` | Page background | — |
| `--surface` | `#ffffff` | Card / panel background | — |
| `--surface-raised` | `#f0f1f4` | Hover, track backgrounds | — |
| `--border` | `#e2e4ea` | Card borders, dividers | — |
| `--text` | `#14171f` | Primary text | ~17.7:1 |
| `--text-muted` | `#4b5266` | Secondary text | ~9.4:1 |
| `--text-faint` | `#6b7280` | Labels, timestamps | ~4.8:1 (passes AA 4.5:1 for normal text) |
| `--accent` | `#0969da` | Primary interactive | ~4.6:1 |
| `--good` | `#1a7f37` | Healthy / good-tone | ~4.5:1 |
| `--warn` | `#9a6700` | At-risk / warning-tone | ~4.6:1 |
| `--critical` | `#cf222e` | Breach / error-tone | ~4.5:1 |

All five colored-text tokens were chosen specifically to clear WCAG AA (4.5:1) as **text** on white,
not just as accents — this is the constraint most light themes get wrong (muted grays and amber
tones routinely fail as text color even though they look fine to a sighted designer at a glance).
`--text-faint` is the tightest margin in the system; do not introduce a fainter tier without
re-checking contrast.

### Type scale, spacing, shape

Identical scale and spacing to the dark variant (32px mono metric values, 14px card radius, etc.) —
only color and elevation strategy change. Card elevation on light uses a lighter, closer shadow
(`0 1px 2px rgba(20,23,31,.04), 0 4px 14px -6px rgba(20,23,31,.08)`) plus a thin border, because a
dark-theme-style deep shadow reads as dirty/muddy on a light background.

### Component treatments

Same structural treatments as Slate/Indigo (metric card / pending card / error card / chips /
status pill) — see above. The only change is a 3px solid top accent bar on metric cards instead of
a gradient highlight (a gradient gets lost against white; a solid bar reads clearly).

---

## Non-negotiables preserved in both variants (do not paper over on restyle)

These came out of prior decisions and must survive any future implementation of this theme in
`web/`:

1. **Eval health** shows a "pending real gate" sentence, never a fabricated pass-rate number, until
   a real CI run posts a result.
2. **Agent cost** shows real USD and — while the LangFuse pricing-gap (T-58) is open — explicitly
   labels a `$0.00` reading as a known gap, not implied zero usage.
3. **Auto-resolved / deflection** is always captioned as an "upper-bound proxy," never presented as
   a true deflection rate, until a human-handoff path exists.
4. **Platform incidents** renders an explained empty state ("real and empty, not a stub") rather
   than hiding the panel or faking rows, until the Cstate feed (T-38) is wired in.
5. Every widget fails **independently** into its own error card — one broken query never blanks the
   whole page.

## What changed vs. v1, and why

v1 proved the layout and information architecture work (four pillars up top, queue + rail below,
one page, no training needed) — that structure carries forward unchanged in both new variants. What
changes is the *visual finish*: v1's flat blue accent and hard-edged cards read as a fast
first-pass dark-admin template, so Slate/Indigo swaps in a distinct indigo accent, softer
top-edge card highlights, and real elevation (shadow, not just border contrast) to feel like a
considered product rather than a scaffold; Daylight Neutral is offered as a genuine second option
built on accessible-by-construction color tokens, in case the founder wants a lighter, less
"ops-console-at-2am" feel for a tool used throughout the business day. Both mockups were rebuilt
against the *current* dashboard components (`PillarCards.tsx`, `TicketQueue.tsx`,
`PipelinePanel.tsx`, `SystemHealthPanel.tsx`, `PlatformIncidentsPanel.tsx`, `TopBar.tsx`,
`ErrorNote.tsx`) rather than reused from v1's sample data, so the honesty states — pending eval
gate, the cost pricing-gap note, the deflection upper-bound caption, and the explained-empty
incidents panel — are represented accurately instead of the "everything looks great" placeholder
numbers v1 shipped with.
