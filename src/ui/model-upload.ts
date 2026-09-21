/**
 * Local `.tflite` upload for demo pages.
 *
 * The registry URL (src/registry.ts) stays the default model for every demo;
 * this is the escape hatch for running a build that isn't published there yet
 * — a freshly converted yolo26n.tflite sitting on disk, say, or a quantized
 * variant being compared against the published one.
 *
 * Bytes are held in memory only: no OPFS write, no object URL. The model
 * cache in runner/opfs-cache.ts keys on filename + ETag and a local File has
 * neither, so caching one would risk shadowing a real model under a
 * colliding name for every later visit.
 *
 * Nothing here knows about a specific demo. A page opts in purely by having
 * a `#model-upload` file input; pages without one never dispatch the event
 * and keep fetching from the registry.
 */

export interface LocalModel {
  name: string;
  bytes: ArrayBuffer;
  /**
   * Identifies THESE bytes. Changes on every upload, which is what lets a
   * stage that caches model bytes tell a second upload from the first and
   * drop its copy — keyed on presence alone, re-uploading kept silently
   * running the previously chosen file.
   */
  tag: string;
}

let current: LocalModel | null = null;
let uploadCount = 0;

/** The model the visitor uploaded, or null to use the registry URL. Read by
 *  stages at load time rather than pushed to them, so a stage created before
 *  the upload still picks it up on its next run. */
export function getLocalModel(): LocalModel | null {
  return current;
}

function formatSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

/**
 * Wires `#model-upload` (a file input) and `#model-upload-name` (its status
 * line). Dispatches `modelUploaded` on `document` once the bytes are in
 * memory — fired AFTER getLocalModel() would return them, so a listener may
 * act on the new model immediately.
 */
export function setupModelUpload(): void {
  const input = document.getElementById('model-upload') as HTMLInputElement | null;
  const nameEl = document.getElementById('model-upload-name');
  if (!input) return;

  const status = (message: string): void => {
    if (nameEl) nameEl.textContent = message;
  };

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;

    // Extension, not MIME type: Chrome reports .tflite as an empty type or
    // application/octet-stream depending on the OS, so type is no signal.
    if (!file.name.toLowerCase().endsWith('.tflite')) {
      status(`${file.name} — not a .tflite file`);
      input.value = '';
      return;
    }

    void (async () => {
      try {
        const bytes = await file.arrayBuffer();
        current = {name: file.name, bytes, tag: `local:${++uploadCount}:${file.name}`};
        status(`${file.name} · ${formatSize(bytes.byteLength)}`);
        document.dispatchEvent(new CustomEvent<LocalModel>('modelUploaded', {detail: current}));
      } catch (e) {
        status(`${file.name} — ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        // Cleared so re-picking the SAME path fires `change` again, which is
        // how a model being iterated on in an export script gets reloaded.
        input.value = '';
      }
    })();
  });
}
