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
   * Caps input resolution when this demo runs in the side-by-side compare
   * view with multiple backends live at once. `undefined` means no cap.
   *
   * Exists because the output readback (see runner/measure.ts) is timed
   * deliberately, and its cost scales with output size: real-esrgan at 4x
   * turns a 512px input into a 2048x2048 output per backend — ~16MB of
   * readback each, ~64MB across four backends, on top of four resident
   * compiled models. Uncapped, that is a plausible tab crash on a mid-range
   * laptop, not just a slow number.
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
    implemented: false,
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
    implemented: false,
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
    blurb: '4x image upscaling. Heaviest of the five in the compare view.',
    model: {
      url: 'https://huggingface.co/webnn/Real-ESRGAN-x4plus/resolve/main/tflite/model.tflite',
    },
    backends: BACKENDS,
    implemented: false,
    // 4x of this is already 1024x1024 per backend — see the field doc above.
    maxCompareInput: {width: 256, height: 256},
  },
];

export function findDemo(slug: string): DemoEntry | undefined {
  return DEMOS.find((d) => d.slug === slug);
}
