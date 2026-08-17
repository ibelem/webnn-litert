# Fonts — not yet committed

`src/ui/tokens.css` declares three families and the build currently warns that none of
them resolve. Until the `.woff2` files land here, every page falls back to
Helvetica/Arial and the site loses its typographic identity.

Copy from [`ibelem/webnn-docs`](https://github.com/ibelem/webnn-docs) (`app/fonts/`) into
these exact paths:

```
public/fonts/instrument-sans-v1-latin/instrument-sans-v1-latin-700.woff2
public/fonts/geist-v1-latin/geist-v5-latin-regular.woff2
public/fonts/geist-v1-latin/geist-v1-latin-600.woff2
public/fonts/intel-one-mono/IntelOneMono-Regular.woff2
```

All three families are OFL-licensed, so self-hosting is fine. Self-host rather than using
a font CDN: under COEP `require-corp` a third-party font host is one more cross-origin
dependency to verify, for no benefit.

Anything under `public/` is copied to the root of `dist/` verbatim, so these resolve at
`/fonts/...` in both dev and production with no config.
