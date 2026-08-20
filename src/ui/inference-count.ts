/**
 * Inference count control handler for demo pages.
 * Allows users to select how many inferences to run (1, 20, 50, 100, 1000).
 * Supports URL parameter: ?inference=N
 */

/** Resolves the run count a page should start with — the slider's default
 *  (1) or a valid `?inference=` override. Read this BEFORE constructing the
 *  compare controller so its first run matches what the slider displays;
 *  compare-controller.ts has no other way to learn this since setup runs
 *  after it's constructed and only reacts to the user changing the slider. */
export function getInitialInferenceCount(): number {
  const value = parseInt(new URLSearchParams(location.search).get('inference') ?? '', 10);
  return !isNaN(value) && value >= 1 && value <= 1000 ? value : 1;
}

export function setupInferenceCount(): void {
  const slider = document.getElementById('inference-count') as HTMLInputElement;
  const controlDiv = document.querySelector('.inference-count-control');
  const presets = document.querySelectorAll('.inference-count-preset');

  if (!slider || !controlDiv) {
    console.warn('Inference count elements not found');
    return;
  }

  // Find the title element within the parent controls group
  const group = controlDiv.closest('.demo-controls-group');
  const legend = group?.querySelector('.demo-controls-group__title');

  // Reflect the resolved value (default or URL override) in the slider UI —
  // getInitialInferenceCount() already told the controller what to use.
  const initial = getInitialInferenceCount();
  slider.value = initial.toString();
  updateLegend(initial);
  updateActivePreset(initial);

  // Update legend when slider changes
  slider.addEventListener('input', () => {
    const value = parseInt(slider.value, 10);
    updateLegend(value);
    updateActivePreset(value);
    updateUrlParameter(value);
    dispatchInferenceCountEvent(value);
  });

  // Handle preset button clicks
  presets.forEach(preset => {
    preset.addEventListener('click', () => {
      const value = parseInt(preset.getAttribute('data-value') || '1', 10);
      slider.value = value.toString();
      updateLegend(value);
      updateActivePreset(value);
      updateUrlParameter(value);
      dispatchInferenceCountEvent(value);
    });
  });

  function updateLegend(value: number): void {
    if (legend) {
      legend.textContent = `Inference Count (${value})`;
    }
  }
}

function updateUrlParameter(value: number): void {
  const params = new URLSearchParams(location.search);
  params.set('inference', value.toString());
  const newUrl = `${location.pathname}?${params.toString()}`;
  history.replaceState({}, '', newUrl);
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
