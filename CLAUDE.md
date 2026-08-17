# webnn-litert

A demo site for **LiteRT.js** running `.tflite` models in the browser on **WebGPU**,
**WebNN GPU**, and **WebNN NPU** — with proof that the requested backend actually ran.

Design doc: [`docs/designs/litert-js-webnn-demo-site.md`](docs/designs/litert-js-webnn-demo-site.md) (APPROVED).
Model URLs: [`docs/model.md`](docs/model.md).

## This is a demo site, not a benchmark

Read this before designing any page. `web-ai-run` is the benchmark tool and already exists
— **do not rebuild it here.**

The hero of every page is the **visual output**: segmentation over a webcam, a depth map,
an upscaled image, a classification result. Big, immediate, working. A visitor should see
something impressive within seconds and understand what WebNN does without reading a
number.

Metrics are **receipts** — small, secondary, present so the visual claim is trustworthy.
They are not the content.

Concretely, this means **no**:

- Tables of p90 / best / average / throughput. That's a benchmark report.
- Iteration-count and warmup-count inputs. Visitors don't configure a benchmark.
- A "Run" button as the primary interaction. Demos run on load, or run continuously.
- Dense numeric grids as the page's main visual weight.

And **yes** to: live output, continuous webcam where the model suits it, one legible
latency figure, the delegation badge, and a load state that is honest about WebNN's
~2 second compile rather than looking broken during it.

The side-by-side compare view is **three live outputs next to each other**, each with a
small latency figure and badge underneath — not three rows in a table. Same input, three
pictures, three numbers. That is the screenshot that makes the WebNN case.

## Stack

**TypeScript + Vite. No UI framework.** Not React, not Next, not Svelte, not Lit — all
considered and rejected in the design doc. The framework would only serve the shell, and
the shell is six components; demos are framework-agnostic by contract. Vite still handles
the build, dev-server isolation headers, worker bundling and multi-page output.

Do not add a UI framework or a component library. `@material/web` is specifically
excluded — it is what would make this look like another Google demo page.

## Target browsers

**Chrome M153+ stable and Chrome Canary. Nothing else.** No legacy paths, no
version-gating UI, no polyfills. `OffscreenCanvas`, top-level await and recent WebGPU
features are all fair game.

## The one rule that matters

**Never display a latency number without its delegation receipt.**

LiteRT.js reports success while running part of a model on WASM CPU. From
`litert/js/packages/core/src/litert_web.ts:198`:

```ts
if (acceleratorRequested && !compiledModel.isFullyAccelerated) {
  if (isJspiSupported()) {
    console.warn(`Model not fully compiled for ${accelerator}. Partially delegating to WASM.`);
    // keeps the model. options.accelerator still says 'webnn'.
  } else {
    compiledModel.delete();
    return this.loadAndCompile(modelData, {accelerator: 'wasm'});
  }
}
```

Every target user is on the JSPI branch, so:

- The **total fallback never fires**. The visible failure — a model relabelled `wasm` —
  cannot happen here.
- **Partial delegation** is what happens instead: `options.accelerator` still reads
  `'webnn'` while an unknown fraction of the graph runs on CPU.
- **`model.options.accelerator` is therefore useless as evidence.** It always equals the
  request. Do not ship it as a receipt.

**Two signals carry the entire credibility argument:**

1. `compiledModel.isFullyAccelerated`
2. LiteRT's `console.warn` — emitted nowhere else, which makes
   `console_mirror.ts` load-bearing infrastructure, not observability polish

`isFullyAccelerated === false` is the **expected** outcome for WebNN runs, not an edge
case — op coverage is still filling in. Build the partially-delegated result card first
and the fully-delegated one second. A partial or failed delegation must never render its
latency as a headline number.

Treat any change that weakens this as a bug. It is the project's reason to exist.

## Chrome vs stage — the element-identity rule

Two zones per demo page, with opposite properties:

- **Chrome** (shell-owned): backend picker, receipt badges, metric rows, status, console.
  A pure function of run state, holds nothing, rebuild freely.
- **Stage** (demo-owned): created once per backend, **never replaced**. Holds state the
  shell didn't put there — canvas pixels, a live `MediaStream`, an `<img>` with a
  `createObjectURL` blob, a file input's selection, focus, scroll.

All the churn is in the chrome; all the statefulness is in the stage. So naive full
re-render is safe **provided it is never pointed at a stage**.

This is not a canvas rule. `mobilenetv2` uses no canvas (`<img>` input, text output) and
still breaks if its region is rebuilt — it would lose the uploaded image and the file
selection.

```ts
interface DemoDefinition {
  slug: string;
  title: string;
  model: { url: string; labels?: string };   // HF URLs from docs/model.md
  backends: Backend[];
  mountStage(container: HTMLElement): Stage;  // once per backend; demo builds its own DOM
  preprocess(input: DemoInput): Tensor;
  postprocess(out: Tensor): DemoOutput;
  render(out: DemoOutput, stage: Stage): void;
}
```

## Other invariants

- **WebNN is `[experimental]` and half-wired in the TS layer:** `accelerator_types.ts:22`
  exports `ACCELERATORS = ['webgpu', 'wasm']` with no `'webnn'`, and
  `AcceleratorDefaultTensorBufferType` has no `webnn` key, while
  `wasm_binding_types.ts:107` accepts it.
- **One worker per backend.** Not a performance choice. `loadLiteRt` mode and version are
  module-global per worker, and switching either needs `unloadLiteRt()` + reload. WebNN
  and WebGPU need `jspi: true` while the CPU baseline wants `threads: true`, so those
  cannot coexist in one worker — and `globalThis.Module` is a global two loads would race
  on. One worker each, all compiled and ready, scheduler gates who *runs*.
- **Measure serially, present simultaneously.** The compare view must not run backends
  concurrently; they contend for memory bandwidth and thermal headroom and corrupt each
  other's timings. One measurement token at a time, progressive reveal, and the UI says
  "measured sequentially".
- **Three measurement axes: backend × browser channel × LiteRT.js version.** Record all
  three on every result set and **never aggregate across any of them.** Canary and M153
  stable are not necessarily the same WebNN implementation, and neither are 2.5.0 and
  2.5.3.
- **COOP/COEP** in both `vercel.json` and `vite.config.ts` (`server.headers`). Verify
  `crossOriginIsolated === true` in production, not just localhost.
- **NPU availability is hardware-gated, not browser-gated.** `isWebNnSupported()` does
  not report which `devicePreference` values resolve; detect by attempting the compile
  and reading the receipt.

## Backend mapping

| URL param | Compile options |
|---|---|
| `?backend=webgpu` | `{accelerator: 'webgpu'}` + `setWebGpuDevice(device)` |
| `?backend=webnn-gpu` | `{accelerator: 'webnn', webNNOptions: {devicePreference: 'gpu'}}` |
| `?backend=webnn-npu` | `{accelerator: 'webnn', webNNOptions: {devicePreference: 'npu'}}` |
| `?backend=wasm` | `{accelerator: 'wasm'}` — opt-in CPU baseline |

Comma-separated for comparison: `?backend=webnn-npu,webgpu`.

## Runtime loading and `&litertjs=`

LiteRT.js is **loaded from CDN at runtime, never bundled.** Keep `@litertjs/core` as a
devDependency for types only (`import type`); the runtime comes from esm.sh. Pattern
ported from web-ai-run's `inference.worker.ts`:

```ts
const litert   = await import(/* @vite-ignore */ `https://esm.sh/@litertjs/core@${v}`);
const wasmRoot = `https://cdn.jsdelivr.net/npm/@litertjs/core@${v}/wasm`;
```

Two CDNs deliberately — esm.sh for the module graph, jsDelivr for raw `wasm/` assets. Not
interchangeable.

**Default version `2.5.3`. Override with `&litertjs=x.x.x`**, e.g.
`?backend=webnn-npu&litertjs=2.5.0`.

**Validate the version before it reaches `import()`.** Interpolating raw user input into a
module URL is arbitrary module execution — `&litertjs=1.0.0/../../@x/evil` walks out of
the package and `import()` runs whatever resolves. Strict semver minimum; prefer a
known-good allowlist:

```ts
const VERSION_RE = /^\d+\.\d+\.\d+(-[a-z0-9.]+)?$/;
```

Three non-obvious requirements:

1. **Set `locateFile` on `globalThis.Module`** before loading. `loadLiteRt(wasmRoot)`
   alone does not redirect Emscripten's own `.wasm` fetches.
2. **Re-host the threaded pthread script same-origin** as a blob URL: fetch
   `${wasmRoot}/litert_wasm_threaded_internal.js` as text, wrap in a `Blob`, pass as
   `mainScriptUrlOrBlob`. This is what makes threaded WASM work cross-origin under COEP.
3. **Guard on API existence** (`if (litert.loadLiteRt)`) — older published builds lack
   exports. Probe, don't assume.

Load mode follows the backend: `jspi: true` for WebNN and WebGPU, `threads: true` for the
CPU baseline, `threads: false` otherwise.

## Models

All five come from the **`webnn/` HuggingFace org** — see `docs/model.md` for the
mapping of upstream demo → original source → HF URL. Not bundled, not from Google's GCS
bucket. Model URLs belong in registry entries only, so re-pointing a demo is a one-line
change.

## Metrics

### Compute the full schema, display almost none of it

**Compute** (ported from [`ibelem/web-ai-run`](https://github.com/ibelem/web-ai-run)'s
`computeMetrics`, don't redesign): `load_and_compile_ms`, `first_inference_ms`,
`time_to_first_ms`, `average_ms`, `median_ms`, `best_ms`, `p90_ms`, `throughput_fps`, raw
`inference_times[]`. Warmup runs timed but **excluded from statistics**; first run
special-cased as `first_inference_ms`. Keep all of it — it costs nothing, it goes to the
devtools console, and it's there if a future export or a LiteRT bug report needs it.

**Display** only these, because this is a demo site:

| Shown | Where |
|---|---|
| Current / rolling inference latency | Under the output, one figure |
| FPS | Only on continuous (webcam) demos, where it's meaningful |
| Load + compile, once | In the load state, then it stops being interesting |
| Delegation badge | Always, next to the latency |

`p90`, `best`, `average`, `throughput_fps` as a labelled statistic — **do not render
these.** They're benchmark furniture and they turn a demo into a report.

### What is inside the measured region

Decided, applied identically to **all four backends**, and not to be changed casually:

**input upload → `run()` → output readback.** Both ends included.

- **The readback is mandatory.** WebGPU submits asynchronously — `run()` resolves once
  commands are enqueued, not once they have executed. Without `await tensor.data()` the
  timer measures submission and produces impossible numbers: the first spike run reported
  **0.2 ms / 3055 fps** for MobileNetV2 on WebGPU. WebNN under JSPI appears to be
  genuinely synchronous through `run()`, but the readback is applied to every backend
  anyway, because uniformity is what makes the numbers comparable.
- **Upload is included** because a webcam demo really does upload a fresh frame per
  inference. It is part of what the user waits for.
- The metric is therefore **time to usable output**, not kernel time. Say so in the UI.
- Note this differs from web-ai-run, which excludes upload and reads back only on
  WebGPU — so do not compare numbers between the two projects.

`load_and_compile_ms` is measured separately and matters more than expected: WebNN graph
building took **~2000 ms** vs WebGPU's ~35 ms for MobileNetV2. Show `time_to_first_ms`
prominently; for short-lived demo visits it dominates the experience.

## Design system

Full contract in [`DESIGN.md`](DESIGN.md). Implementation in `src/ui/tokens.css` — the
**only** source of color, spacing, type and radius. Identity derived from webnn.io /
`ibelem/webnn-docs`: Instrument Sans 700 headings, Geist body, Intel One Mono for code and
all numbers, navy↔cyan primary flip.

Rules that matter while coding:

- **Never write a raw hex or raw px outside `tokens.css`.** stylelint enforces it; with no
  framework this is the design system's only hard boundary.
- **Never write `.dark .something { ... }`.** Dark mode swaps token *values*. If a
  component needs to change in dark mode, it needs a token.
- **Backend hue and delegation status are separate colour channels.** Backends get
  blue/cyan/purple (wasm neutral, it's a baseline and should recede). Delegation uses
  orange/pink, which no backend uses, so they never collide. Delegation status always
  carries text and a non-colour treatment too — never hue alone.
- **Fully-delegated is the *unmarked* state.** Partial delegation is the expected outcome,
  so marking success green would make the site look broken by default. The marked state is
  the informative one.
- **Every measured number gets `.num`** (tabular figures), or the compare grid jitters as
  values update.
- **`receipt-badge` and `metric-row` take no style overrides** — no variants, no size
  props, no class passthrough. Load-bearing for credibility, not decoration.
- Demos cannot express visual style: they supply data and a `render()` into a stage the
  shell created. No per-demo HTML, no per-demo CSS.

Font `.woff2` files go in `public/fonts/`, copied from `webnn-docs` (`app/fonts/`). All
three families are OFL.

Layout and composition are not yet designed — notably the compare grid at N=2 vs N=4 with
mixed stage aspect ratios.

## Testing

**No Playwright. No end-to-end browser tests. No visual regression / screenshot
diffing.** Project constraint — do not add these, and do not propose them.

What that leaves:

- **Unit tests** for the pure parts, which is most of what matters: `computeMetrics`,
  version validation, URL param parsing, receipt classification, registry integrity.
- **stylelint** for the design-system boundary (raw hex / raw px outside `tokens.css`).
- **`tsc --noEmit`** for typechecking against `@litertjs/core` types.
- **Manual verification in Chrome**, which is unavoidable anyway: WebNN NPU delegation
  depends on real hardware, so no headless runner could confirm the thing this site
  exists to show.

Consequence to be aware of: nothing automated guards visual consistency or the live
inference path. `/design-review` and `/qa` cover those by inspection.

## `reference/` is read-only and gitignored

`reference/litert` (Google LiteRT) and `reference/webnn-developer-preview` (Microsoft)
are vendored for reading only. `.gitignore` excludes them, so **nothing there ships** —
port code into `src/`, never import or symlink.

Highest-value reading:

- `reference/litert/litert/js/apps/model_tester/src/litert_model_runner.ts:100-107` —
  compiles all three backends in one pass; the reference for the runner
- `reference/litert/litert/js/apps/model_tester/src/console_mirror.ts` — capturing
  LiteRT's console warnings into a UI. Port this; it's half your evidence.
- `reference/litert/litert/js/demos/selfie_multiclass/src/index.ts:81` — the only
  upstream demo with a wasm/webgpu/webnn switch
- `reference/webnn-developer-preview/demos/webnn-perf.js` — Microsoft's perf
  instrumentation via the W3C Performance API

Note the upstream demos are a mix: `model_tester`, `depth_anything` and `real_esrgan`
are Lit; `mobilenetv2`, `selfie_multiclass` and `efficientvit_segmentation` are raw DOM.
Port the logic, not the framework.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec
