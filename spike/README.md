# M0 spike — delegation truth harness

Answers the question the whole project rests on: **for a given `.tflite` model, LiteRT.js
version and backend, does the model actually run where it claims?**

No build step, no dependencies.

```bash
node spike/serve.mjs
# -> http://localhost:8099
```

Open in **Chrome M153+ or Canary**. Pick a model, pick backends, hit Run.

URL parameters (same names the real site will use):

```
?litertjs=2.5.0&model=depth&backend=webnn-npu,webgpu
```

`litertjs` defaults to `2.5.3` and is validated as strict semver before it reaches
`import()` — it becomes part of a module URL, so it is untrusted input.

## What to record

For each model × version × backend:

- **`fully delegated` vs `partially delegated`** — the actual finding. Latency is greyed
  out when delegation isn't full, because a partial number is not a WebNN number.
- **The captured console panel** — LiteRT reports partial delegation *only* via
  `console.warn`, nowhere else.
- **The Environment block** — `crossOriginIsolated`, WebNN/WebGPU presence, GPU adapter,
  and the full browser version. Never compare numbers across browser channels or LiteRT
  versions.

Full per-backend records also go to devtools console as objects.

## Known limitations

Deliberate, because this is a spike and not M1:

- **Main thread, single LiteRT instance, `{jspi: true}` for every backend.** Load mode is
  module-global, so the `wasm` row shows "does it run", not a fair threaded-CPU baseline.
  M1 fixes this with one worker per backend at its own mode.
- **Zero-filled inputs** of whatever shape the model declares. This measures delegation
  and latency, not accuracy — no preprocessing, no labels, no images.
- **No visual output.** Stages arrive in M1.

## Priority

Run `depth-anything-v2-small` first. It's `wi8_afp32` — int8 weights — which is the shape
NPUs are happiest with, so it's plausibly the most likely of the five to fully delegate,
despite being last in the build order.

Then sweep a few versions on whichever model delegates best. Those results seed the
version allowlist for the real site.
