# Design System — webnn-litert

The contract for how this site looks. `/design-review` and `/plan-design-review` read
this file. Tokens live in [`src/ui/tokens.css`](src/ui/tokens.css) — that file is the
implementation, this file is the reasoning.

## Lineage

Derived from [webnn.io](https://webnn.io/) / [`ibelem/webnn-docs`](https://github.com/ibelem/webnn-docs).
The audience for this site is the same audience, so family resemblance is a feature —
someone arriving from the WebNN docs should recognise where they are.

**Inherited:**

- The three-font trio — the strongest identity signal in the original.
- The navy ↔ cyan primary flip between light and dark. That's webnn.io's signature move.
- The accent ramp: `#f72684` `#7209b7` `#3a0ca3` `#4361ee` `#4cc9f0` `#eb6424`.
- The per-framework tint pattern (`--webnn-005`, `--onnx-005`, …) at 5–10% alpha,
  repurposed here as **per-backend** tints.

**Deliberately not inherited:**

- `webnn-docs` has no dark-mode variable block; dark mode overrides component selectors
  (`.dark .logo .c1 { fill: var(--dark) }`). Here, **dark mode swaps token values only**.
  If you're writing a `.dark .something` rule, add a token instead.
- Opaque names (`--c`, `--d`, `--n-1`…`--n-7`, and `--dark` meaning "the cyan used in
  dark mode"). Layer 2 tokens here are named for their role.
- Tailwind. This site has no CSS framework — see `CLAUDE.md`.
- `@material/web`, which `model_tester` uses. It's what would make this read as another
  Google demo page.

## Fonts

| Role | Family | Weights |
|---|---|---|
| Headings | **Instrument Sans** | 700 |
| Body | **Geist** | 400, 600 |
| Code + all numbers | **Intel One Mono** | 400 |

All three are OFL and self-hosted. Copy the `.woff2` files from `webnn-docs`
(`app/fonts/`) into `public/fonts/`. Self-host rather than using a font CDN — under COEP
`require-corp` a third-party font host is one more cross-origin dependency to verify, for
no benefit.

## Token architecture

Three layers, and components may only read Layer 2.

1. **Layer 1 — raw palette.** `--wn-navy`, `--wn-purple`, `--gray-800`. Never referenced
   outside `tokens.css`.
2. **Layer 2 — semantic roles.** `--color-bg`, `--color-fg-muted`, `--backend-webnn-npu`,
   `--delegation-partial`. This is the public API.
3. **Layer 3 — component-local**, only where a component genuinely needs its own knob.

Dark mode is three-state: `:root` carries light values, `@media (prefers-color-scheme: dark)`
guarded by `:root:not(.light)` handles system preference, and `:root.dark` lets an explicit
toggle win in both directions.

## The two-colour-channel problem

This is the central design decision, and it comes straight out of the project's premise:
**delegation truth is co-equal with latency.**

Every result card has to communicate two independent facts at once:

1. **Which backend is this?** (wasm / webgpu / webnn-gpu / webnn-npu)
2. **Did it actually run there?** (fully delegated / partially delegated / failed)

Encode both as colour naively and a reader cannot tell "this is the NPU card" from "this
one delegated cleanly." So the channels are separated:

**Backend = hue.** A coloured label chip and a tinted card surface.

| Backend | Colour | Why |
|---|---|---|
| `wasm` | neutral grey | It's the baseline. It should recede. |
| `webgpu` | `--wn-blue` | |
| `webnn-gpu` | `--wn-sky` / cyan | The WebNN family colour |
| `webnn-npu` | `--wn-purple` | Most distinct — it's the headline backend |

**Delegation = a reserved, separate set.** Orange and pink are used by no backend, so
there is no collision:

| State | Treatment |
|---|---|
| Fully delegated | **Unmarked.** Muted text, no colour, no icon. |
| Partially delegated | `--delegation-partial` (orange) border + tint + explicit op count |
| Failed / fell back | `--delegation-failed` (pink) + latency suppressed |

### Why "fully delegated" is the *quiet* state

Counter-intuitive, and important. Under our Chrome M153+/Canary target, LiteRT.js never
takes the total-fallback branch — so **partial delegation is the expected outcome for
WebNN runs**, not an edge case, because op coverage is still filling in.

If full delegation were green-with-a-checkmark, the site would look broken by default and
readers would learn to ignore the signal. Inverting it means the marked state is the
informative one, and it stays informative as coverage improves: a site that gets quieter
over time is a site whose data is improving.

### Never hue alone

Delegation status must survive greyscale and colour-blindness. Every non-full state
carries **text** ("Partially delegated — 12 of 47 ops on CPU") and a non-colour treatment
(border weight, hatch, or icon). Colour reinforces; it never carries the meaning.

## Numbers

Every measured value uses `.num` — Intel One Mono with `font-variant-numeric: tabular-nums`.

Non-negotiable on this site: without tabular figures, digits shift width as values update
and the whole compare grid jitters during a run. It reads as broken even when it isn't.

## Type scale

`--text-2xs` 11px · `--text-xs` 12px · `--text-sm` 13px · `--text-base` 15px ·
`--text-lg` 18px · `--text-xl` 24px · `--text-2xl` 36px

Seven steps, no more. A data-dense site needs the small end of the scale to be finely
graded and the large end barely at all.

## Locked components

`receipt-badge` and `metric-row` accept **no style overrides** — no variants, no size
props, no class passthrough, no `::part()`.

Not an aesthetic rule. These two carry the site's credibility, and every layout will
eventually present a reason to shrink the badge to fit. Once that's possible it happens,
and the site quietly becomes the thing it was built to replace. Treat a PR that adds a
size prop to either as a bug.

## Enforcement

Structural where it can be, CI where it can't:

- **Demos cannot express visual style.** They supply data and a `render()` into a stage
  the shell created. No per-demo HTML, no per-demo CSS. Home page and detail pages are
  both generated from the registry, so they cannot diverge.
- **stylelint** — `declaration-property-value-disallowed-list` banning raw hex and raw px
  outside `tokens.css`. With no framework there's no scoping mechanism, so this rule is
  the design system's **only** automated boundary. Wire it in M1, before there are
  components to retrofit.

**No visual regression testing.** No Playwright, no screenshot diffing. Two reasons, and
the second is the real one:

1. Every page here renders live inference output and live timings, so a screenshot is
   non-deterministic by construction. Baselines would need masking so aggressive that
   they'd stop covering the interesting parts.
2. It's an explicit project constraint — see `CLAUDE.md`.

The honest consequence: **visual consistency is enforced by structure and review, not by
CI.** The structural parts still hold — demos can't express style, pages are generated
from the registry, locked components take no overrides — but drift in spacing, weight or
hierarchy inside the shell will only be caught by a human looking. Run `/design-review`
periodically instead of assuming a green build means the design held.

## Open

- Layout and composition are unspecified — this covers the system, not the page designs.
  The compare grid in particular needs a real layout pass: N backends side by side has to
  work at N=2 and N=4, on a laptop, with stages of wildly different aspect ratios
  (mobilenetv2's label list vs real_esrgan's 4× canvas).
- No motion tokens yet. Probably correct to keep it that way: on a site measuring
  latency, animation actively competes with the thing being measured.
