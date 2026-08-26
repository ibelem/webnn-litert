import type {TensorDetails} from '@litertjs/core';

import type {OutputData} from '../../runner/measure';

/**
 * COCO class labels for YOLO detection.
 * 80 classes from the COCO dataset.
 */
export const COCO_LABELS = [
  'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat',
  'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench', 'bird', 'cat',
  'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe', 'backpack',
  'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee', 'skis', 'snowboard', 'sports ball',
  'kite', 'baseball bat', 'baseball glove', 'skateboard', 'surfboard', 'tennis racket',
  'bottle', 'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple',
  'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair',
  'couch', 'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse',
  'remote', 'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink', 'refrigerator',
  'book', 'clock', 'vase', 'scissors', 'teddy bear', 'hair drier', 'toothbrush',
];

/**
 * Detection result with bounding box and class information.
 */
export interface Detection {
  box: [number, number, number, number]; // [y1, x1, y2, x2] in normalized coordinates
  score: number;
  classId: number;
  className: string;
}

/**
 * Postprocess YOLO output to extract detections.
 * 
 * YOLOv2.6 output format:
 * - Shape: [1, 84, 8400] where 84 = 4 (bbox) + 80 (classes), 8400 = number of anchors
 * - Bbox format: [x_center, y_center, width, height] in normalized coordinates
 * 
 * This function:
 * 1. Extracts bounding boxes and class scores
 * 2. Applies confidence threshold
 * 3. Applies Non-Maximum Suppression (NMS) to remove overlapping boxes
 * 4. Returns filtered detections
 */
export function postprocessYolo26(
    outputDetails: readonly TensorDetails[],
    data: OutputData,
    confidenceThreshold: number = 0.25,
    iouThreshold: number = 0.45,
): Detection[] {
  // Get the first output tensor
  const output = outputDetails[0];
  if (!output) throw new Error('yolo26: model declares no outputs');

  const values = data[output.name];
  if (!values) throw new Error(`yolo26: no output data for "${output.name}"`);

  const shape = Array.from(output.shape);

  // Expected shape: [1, 84, 8400] or [1, 8400, 84]
  // 84 = 4 bbox coords + 80 class scores
  // 8400 = number of anchor boxes
  const [batch, dim1, dim2] = shape;
  if (batch !== 1) throw new Error(`yolo26: expected batch size 1, got ${batch}`);

  // Determine if shape is [1, 84, 8400] or [1, 8400, 84]
  const numClasses = 80;
  const numAnchors = 8400;
  const isDim1Classes = dim1 === numClasses + 4 && dim2 === numAnchors;
  const isDim2Classes = dim2 === numClasses + 4 && dim1 === numAnchors;

  if (!isDim1Classes && !isDim2Classes) {
    throw new Error(`yolo26: unexpected output shape [${shape}], expected [1, 84, 8400] or [1, 8400, 84]`);
  }

  const numDetections = isDim1Classes ? dim2 : dim1;

  // Extract all detections above confidence threshold
  const candidates: Array<{box: [number, number, number, number]; score: number; classId: number}> = [];

  for (let i = 0; i < numDetections; i++) {
    // Get class scores for this anchor
    let maxScore = 0;
    let maxClassId = -1;

    for (let c = 0; c < numClasses; c++) {
      const idx = isDim1Classes
        ? (4 + c) * numAnchors + i  // [1, 84, 8400]: class scores are in dim1
        : i * (numClasses + 4) + (4 + c); // [1, 8400, 84]: class scores are in dim2
      const score = values[idx] ?? 0;
      if (score > maxScore) {
        maxScore = score;
        maxClassId = c;
      }
    }

    // Filter by confidence threshold
    if (maxScore < confidenceThreshold) continue;

    // Get bounding box: [x_center, y_center, width, height]
    const xCenterIdx = isDim1Classes ? 0 * numAnchors + i : i * (numClasses + 4) + 0;
    const yCenterIdx = isDim1Classes ? 1 * numAnchors + i : i * (numClasses + 4) + 1;
    const widthIdx = isDim1Classes ? 2 * numAnchors + i : i * (numClasses + 4) + 2;
    const heightIdx = isDim1Classes ? 3 * numAnchors + i : i * (numClasses + 4) + 3;

    const xCenter = values[xCenterIdx] ?? 0;
    const yCenter = values[yCenterIdx] ?? 0;
    const w = values[widthIdx] ?? 0;
    const h = values[heightIdx] ?? 0;

    // Convert to [y1, x1, y2, x2] format
    const x1 = xCenter - w / 2;
    const y1 = yCenter - h / 2;
    const x2 = xCenter + w / 2;
    const y2 = yCenter + h / 2;

    // Clamp to [0, 1]
    const clampedBox: [number, number, number, number] = [
      Math.max(0, Math.min(1, y1)),
      Math.max(0, Math.min(1, x1)),
      Math.max(0, Math.min(1, y2)),
      Math.max(0, Math.min(1, x2)),
    ];

    candidates.push({
      box: clampedBox,
      score: maxScore,
      classId: maxClassId,
    });
  }

  // Apply NMS per class
  const detections: Detection[] = [];
  const processed = new Set<number>();

  // Sort by score (descending)
  candidates.sort((a, b) => b.score - a.score);

  for (let i = 0; i < candidates.length; i++) {
    if (processed.has(i)) continue;

    const candidate = candidates[i];
    if (!candidate) continue;

    detections.push({
      box: candidate.box,
      score: candidate.score,
      classId: candidate.classId,
      className: COCO_LABELS[candidate.classId] || `class_${candidate.classId}`,
    });

    // Remove overlapping boxes of the same class
    for (let j = i + 1; j < candidates.length; j++) {
      if (processed.has(j)) continue;
      const other = candidates[j];
      if (!other) continue;
      if (other.classId !== candidate.classId) continue;

      const iou = calculateIoU(candidate.box, other.box);
      if (iou > iouThreshold) {
        processed.add(j);
      }
    }
  }

  return detections;
}

/**
 * Calculate Intersection over Union (IoU) for two bounding boxes.
 * Boxes are in [y1, x1, y2, x2] format with normalized coordinates.
 */
function calculateIoU(box1: [number, number, number, number], box2: [number, number, number, number]): number {
  const [y1_1, x1_1, y2_1, x2_1] = box1;
  const [y1_2, x1_2, y2_2, x2_2] = box2;

  // Calculate intersection
  const interX1 = Math.max(x1_1, x1_2);
  const interY1 = Math.max(y1_1, y1_2);
  const interX2 = Math.min(x2_1, x2_2);
  const interY2 = Math.min(y2_1, y2_2);

  const interWidth = Math.max(0, interX2 - interX1);
  const interHeight = Math.max(0, interY2 - interY1);
  const interArea = interWidth * interHeight;

  // Calculate union
  const area1 = (x2_1 - x1_1) * (y2_1 - y1_1);
  const area2 = (x2_2 - x1_2) * (y2_2 - y1_2);
  const unionArea = area1 + area2 - interArea;

  // Avoid division by zero
  if (unionArea === 0) return 0;

  return interArea / unionArea;
}