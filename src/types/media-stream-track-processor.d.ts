// Corrects an incomplete ambient declaration in this project's TypeScript
// version (7.0.2): its bundled lib.webworker.d.ts declares
// MediaStreamTrackProcessorInit with only `maxBufferSize?: number`, missing
// `track`, which is REQUIRED per spec
// (https://w3c.github.io/mediacapture-transform/#dom-mediastreamtrackprocessorinit).
// lib.dom.d.ts doesn't declare this interface at all in this TS version —
// it's a niche, Chromium-only API still being fleshed out upstream.
//
// Declaration merging: this ADDS the missing `track` member to the existing
// interface rather than redeclaring it, so it can't conflict with whatever
// this TS version ships. Verify this file can be deleted whenever the
// TypeScript version bundled here ships a corrected lib.webworker.d.ts.
interface MediaStreamTrackProcessorInit {
  track: MediaStreamTrack;
}
