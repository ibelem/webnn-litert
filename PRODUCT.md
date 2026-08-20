# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two confirmed audiences, not one:

1. **Web developers evaluating WebNN** — deciding whether to adopt WebNN (and
   specifically WebNN NPU) in their own products. They want visual proof plus real
   numbers, not marketing claims about hardware acceleration that may silently be
   running on CPU.
2. **The Chrome/WebNN/LiteRT engineering team** — the audience for `/debug`, which is
   built as "what you attach to a LiteRT bug report": raw per-backend × per-litertjs-
   version × per-browser-channel delegation truth, reproducible evidence for filing
   op-coverage gaps.

## Product Purpose

Prove whether WebNN GPU/NPU delegation actually happens when running real LiteRT.js
models in Chrome — not simulate it, not benchmark it in the abstract. LiteRT.js reports
success even when it silently falls back to partial WASM CPU execution, so the product
exists to make that distinction visible. Success is a visitor understanding within
seconds what backend ran and whether it was fully or partially delegated, and an
engineer being able to attach a `/debug` result to a bug report as reproducible
evidence.

## Positioning

No existing demo site does this for LiteRT.js on WebNN. Microsoft's
`webnn-developer-preview` proves the analogous pattern for ONNX Runtime Web, but nothing
shows LiteRT.js + WebNN with delegation proof attached. The mechanism a copycat demo
can't casually replicate: every displayed latency number is paired with a delegation
receipt (`isFullyAccelerated` plus captured `console.warn` output) — because
`model.options.accelerator` alone always just echoes the request and proves nothing.

## Operating Context

- Chrome M153+ stable and Chrome Canary only — no legacy paths, no version-gating UI,
  no polyfills.
- Public deployment on Vercel; PR previews give every change a shareable URL. Built to
  be shown to people outside the immediate team — a public showcase / blog / talk
  artifact, not an internal-only tool.
- Five live demo pages (mobilenetv2, selfie-multiclass, efficientvit-seg,
  depth-anything, real-esrgan) plus `/debug` (the raw delegation-truth harness) and a
  side-by-side compare view.
- LiteRT.js is loaded from CDN at runtime (esm.sh + jsDelivr), never bundled. Models are
  mirrored under the `webnn/` HuggingFace org rather than bundled or served from
  Google's GCS bucket.

## Capabilities and Constraints

- WebNN is `[experimental]` and only partially wired into LiteRT.js's TypeScript layer
  today (e.g. `accelerator_types.ts` has no `'webnn'` entry yet).
- NPU availability is hardware-gated, not just browser-gated — detected by attempting
  the compile and reading the receipt, never by feature-testing the API alone.
- No Playwright, no visual regression testing, no screenshot diffing — a deliberate
  constraint. Every page renders live inference output and live timings, so a
  screenshot baseline can't be deterministic; manual Chrome verification is the only way
  to confirm real hardware delegation actually happened.
- One worker per backend: WebGPU and WebNN need `jspi: true`, the WASM baseline needs
  `threads: true` — they can't share a worker or a `globalThis.Module`.
- Backends are measured serially and presented simultaneously, never concurrently —
  concurrent backends contend for memory bandwidth/thermal headroom and corrupt each
  other's timings.

## Brand Commitments

Derived from webnn.io / `ibelem/webnn-docs` — same audience, so family resemblance is
deliberate, not incidental. Instrument Sans (headings, 700), Geist (body), Intel One
Mono (code and all numbers). Navy ↔ cyan primary flip between light and dark. Same
accent ramp as the upstream docs site. `@material/web` is explicitly excluded — it's
what would make this read as another generic Google demo page.

## Evidence on Hand

- `docs/designs/litert-js-webnn-demo-site.md` — the approved design doc, including a
  "Build Status" section for current state.
- `docs/model.md` — upstream-demo → original-source → HuggingFace URL mapping for all
  five models.
- `DESIGN.md` — the full visual-system contract (token architecture, the two-color-
  channel problem, locked components).

No testimonials, case studies, customer names, or usage metrics exist for this project.
None should be invented — this is a technical demonstration, not a marketed product.

## Product Principles

1. Never display a latency number without its delegation receipt — the project's entire
   reason to exist.
2. Compute the full metrics schema, display almost none of it on the page — two numbers
   visible, everything else goes to the console for a bug report.
3. This is a demo site, not a benchmark: live visual output is the hero, numbers are
   receipts, not the content.
4. Structural enforcement over CI where CI can't reach — locked components, registry-
   generated pages, stylelint's raw-value ban — because there is no visual regression
   testing to catch drift.
5. Never aggregate across backend × browser channel × LiteRT.js version. Canary and
   M153 stable are not necessarily the same WebNN implementation.
