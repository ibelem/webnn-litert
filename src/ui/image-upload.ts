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
      demoImage.src = imageUrl;

      // Hide the attribution text for custom images
      imageAttribution.style.display = 'none';

      // Dispatch a custom event so the demo can react to the new image
      const customEvent = new CustomEvent('imageUploaded', {
        detail: { imageUrl, file }
      });
      document.dispatchEvent(customEvent);
    };
    reader.readAsDataURL(file);
  });
}
