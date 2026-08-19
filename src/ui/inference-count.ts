/**
 * Inference count control handler for demo pages.
 * Allows users to select how many inferences to run (1, 20, 50, 100, 1000).
 */

export function setupInferenceCount(): void {
  const slider = document.getElementById('inference-count') as HTMLInputElement;
  const display = document.getElementById('inference-count-display') as HTMLElement;
  const presets = document.querySelectorAll('.inference-count-preset');

  if (!slider || !display) {
    console.warn('Inference count elements not found');
    return;
  }

  // Update display when slider changes
  slider.addEventListener('input', () => {
    const value = parseInt(slider.value, 10);
    display.textContent = value.toString();
    updateActivePreset(value);
    dispatchInferenceCountEvent(value);
  });

  // Handle preset button clicks
  presets.forEach(preset => {
    preset.addEventListener('click', () => {
      const value = parseInt(preset.getAttribute('data-value') || '1', 10);
      slider.value = value.toString();
      display.textContent = value.toString();
      updateActivePreset(value);
      dispatchInferenceCountEvent(value);
    });
  });

  // Initialize active state
  updateActivePreset(parseInt(slider.value, 10));
}

function updateActivePreset(value: number): void {
  const presets = document.querySelectorAll('.inference-count-preset');
  presets.forEach(preset => {
    const presetValue = parseInt(preset.getAttribute('data-value') || '1', 10);
    if (presetValue === value) {
      preset.classList.add('active');
    } else {
      preset.classList.remove('active');
    }
  });
}

function dispatchInferenceCountEvent(count: number): void {
  const event = new CustomEvent('inferenceCountChanged', {
    detail: { count }
  });
  document.dispatchEvent(event);
}
