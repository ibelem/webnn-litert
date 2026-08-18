import {BACKENDS, type Backend} from './runner/types';

/**
 * Single source of truth for demos. The home page and every detail page are
 * generated from this array, so they cannot diverge.
 *
 * Model URLs live here and nowhere else, sourced from docs/model.md — all five
 * are mirrored under the webnn/ HuggingFace org, so re-pointing a demo at a
 * different mirror is a one-line change.
 *
 * M1 adds the per-demo pieces (mountStage / preprocess / postprocess / render).
 * Until then this carries only what the debug harness needs.
 */
export interface DemoEntry {
  slug: string;
  title: string;
  /** One line, shown on the home page card. */
  blurb: string;
  model: {url: string; labels?: string};
  backends: readonly Backend[];
  /** False until the demo's visual stage exists. Home page shows it as pending. */
  implemented: boolean;
  /**
   * NOT CURRENTLY CONSUMED BY ANY CODE. Left here as a documented future
   * requirement, not a live setting — no stage reads this field.
   *
   * Was meant to cap input resolution when a demo runs the side-by-side
   * compare view, because the output readback (runner/measure.ts) is timed
   * deliberately and its cost scales with output size: real-esrgan at 4x on
   * an arbitrary-size photo could turn a 512px input into a 2048x2048
   * output per backend. That concern only exists for the reference's
   * full-image tiling pipeline (crop into overlapping model-input-sized
   * tiles, upscale each, stitch back together) — real-esrgan here upscales
   * exactly ONE fixed-size tile instead (see demos/real-esrgan/preprocess.ts's
   * scope note), so there is no variable-size input to cap. Wire this in
   * for real if/when arbitrary-image tiling is built; don't add fake
   * enforcement now just to say the field is used.
   */
  maxCompareInput?: {width: number; height: number};
}

export const DEMOS: readonly DemoEntry[] = [
  {
    slug: 'mobilenetv2',
    title: 'MobileNetV2',
    blurb: 'Image classification. Confirmed fully delegated to WebNN NPU on 2.5.3.',
    model: {
      url: 'https://huggingface.co/webnn/torchvision-mobilenet-v2/resolve/main/tflite/model.tflite',
      labels: 'https://huggingface.co/webnn/torchvision-mobilenet-v2/resolve/main/tflite/imagenet_labels.txt',
    },
    backends: BACKENDS,
    implemented: true,
  },
  {
    slug: 'selfie-multiclass',
    title: 'Selfie segmentation',
    blurb: 'One webcam snapshot, multiclass segmentation at 256x256.',
    model: {
      url: 'https://huggingface.co/webnn/selfie-multiclass-256x256/resolve/main/tflite/model.tflite',
    },
    backends: BACKENDS,
    implemented: true,
  },
  {
    slug: 'efficientvit-seg',
    title: 'EfficientViT segmentation',
    blurb: 'ADE20K scene segmentation at 512x512.',
    model: {
      url: 'https://huggingface.co/webnn/efficientvit-seg-l2-ade20k-r512x512/resolve/main/tflite/model.tflite',
    },
    backends: BACKENDS,
    implemented: true,
  },
  {
    slug: 'depth-anything',
    title: 'Depth Anything V2',
    blurb: 'Monocular depth. int8 weights — the shape NPUs are happiest with.',
    model: {
      url: 'https://huggingface.co/webnn/depth-anything-v2-small/resolve/main/tflite/depth_anything_v2_small_wi8_afp32.tflite',
    },
    backends: BACKENDS,
    implemented: true,
  },
  {
    slug: 'real-esrgan',
    title: 'Real-ESRGAN x4',
    blurb: '4x super-resolution upscaling, one tile. Heaviest of the five demos.',
    model: {
      url: 'https://huggingface.co/webnn/Real-ESRGAN-x4plus/resolve/main/tflite/model.tflite',
    },
    backends: BACKENDS,
    implemented: true,
    // Unused — see the field's doc comment above. Arbitrary-image tiling
    // (what would make this field meaningful) wasn't built.
    maxCompareInput: {width: 256, height: 256},
  },
];

export function findDemo(slug: string): DemoEntry | undefined {
  return DEMOS.find((d) => d.slug === slug);
}
