/**
 * Image upload handler for demo pages.
 * Allows users to upload custom images for inference.
 */

const DEFAULT_IMAGE_SRC = '/images/sample-dog.jpg';

/** Whatever image is currently shown in the sidebar preview — the bundled
 *  sample, or a data: URL from a user upload. Stages read this at inference
 *  time instead of hardcoding the sample path, so an upload actually reaches
 *  the model. */
export function getCurrentImageSrc(): string {
  const demoImage = document.getElementById('demo-image') as HTMLImageElement | null;
  return demoImage?.src || DEFAULT_IMAGE_SRC;
}

/** Natural pixel size of whatever image is currently shown, for sizing an
 *  output canvas to match its aspect ratio. Null before the image has
 *  decoded (naturalWidth/Height are 0 until then) — callers fall back to a
 *  default size in that case. */
export function getCurrentImageSize(): {width: number; height: number} | null {
  const demoImage = document.getElementById('demo-image') as HTMLImageElement | null;
  if (!demoImage || !demoImage.naturalWidth || !demoImage.naturalHeight) return null;
  return {width: demoImage.naturalWidth, height: demoImage.naturalHeight};
}

export function setupImageUpload(): void {
  const fileInput = document.getElementById('image-upload') as HTMLInputElement;
  const demoImage = document.getElementById('demo-image') as HTMLImageElement;
  const imageAttribution = document.getElementById('image-attribution') as HTMLElement;

  if (!fileInput || !demoImage || !imageAttribution) {
    console.warn('Image upload elements not found');
    return;
  }

  fileInput.addEventListener('change', (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    // Validate it's an image
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }

    // Read the file and display it
    const reader = new FileReader();
    reader.onload = (e) => {
      const imageUrl = e.target?.result as string;

      // Hide the attribution text for custom images
      imageAttribution.style.display = 'none';

      // Wait for decode before announcing the upload — naturalWidth/Height
      // (getCurrentImageSize) are 0 until the <img> has actually loaded, and
      // a listener resizing an output canvas to match this image's aspect
      // ratio needs those to be populated already, not a moment later.
      demoImage.onload = () => {
        const customEvent = new CustomEvent('imageUploaded', {
          detail: { imageUrl, file }
        });
        document.dispatchEvent(customEvent);
      };
      demoImage.src = imageUrl;
    };
    reader.readAsDataURL(file);
  });
}
