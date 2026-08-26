// `HTMLVideoElement.captureStream()` is a Chromium-only API (part of the
// Media Capture from DOM Elements spec, https://w3c.github.io/mediacapture-
// fromelement/#dom-htmlmediaelement-capturestream) that lib.dom.d.ts in
// this project's TypeScript version does not declare. Used by
// object-detection's live mode to turn an uploaded video file's playback
// into the same kind of MediaStreamTrack a webcam's getUserMedia() returns
// — see demos/object-detection/main.ts.
//
// Declaration merging: this ADDS the missing member to the existing
// interface rather than redeclaring it, so it can't conflict with whatever
// this TS version ships. Verify this file can be deleted whenever the
// TypeScript version bundled here ships this declaration itself.
interface HTMLVideoElement {
  captureStream(): MediaStream;
}
