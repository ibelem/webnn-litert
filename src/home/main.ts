import {DEMOS} from '../registry';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Arrow-up-right "open" affordance on each card — replaces a `::after`
 *  Unicode arrow, which can't take stroke width or line caps. `currentColor`
 *  so it inherits `.demo-card__cta`'s (token-driven) color in both themes. */
function createCtaIcon(): HTMLDivElement {
  const chip = document.createElement('div');
  chip.className = 'demo-card__cta';

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('demo-card__cta-icon');

  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M7 17L17 7M17 7H8M17 7V16');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);

  chip.append(svg);
  return chip;
}

/**
 * The home page is generated from the registry, never hand-written. Adding a
 * demo to registry.ts is what makes it appear here.
 */
const grid = document.getElementById('demo-grid');
if (!grid) throw new Error('#demo-grid missing from index.html');

// Update demo count
const demoCount = document.getElementById('demo-count');
if (demoCount) {
  const implementedCount = DEMOS.filter(d => d.implemented).length;
  demoCount.textContent = `${implementedCount} available`;
}

// Convention: a demo's page lives at `${slug}.html`, registered under that
// same key in vite.config.ts's rollupOptions.input. Not stored on the
// registry entry itself because it's a build-time routing fact, not data
// about the demo.
for (const demo of DEMOS) {
  const li = document.createElement('li');
  li.className = 'demo-card';
  li.dataset.pending = String(!demo.implemented);

  const h2 = document.createElement('h2');
  h2.textContent = demo.title;

  const p = document.createElement('p');
  p.textContent = demo.blurb;

  if (demo.implemented) {
    // Linked with the .html extension so this works identically in `vite
    // dev` (no cleanUrls) and in production, where Vercel's cleanUrls
    // redirects the .html link to the clean path rather than requiring it.
    const link = document.createElement('a');
    link.href = `${demo.slug}.html`;

    if (demo.thumbnail) {
      // Title + blurb sit directly on the photo (a scrim keeps them
      // readable) instead of a separate text block below it.
      const img = document.createElement('img');
      img.className = 'demo-card__thumb';
      img.src = demo.thumbnail;
      img.alt = '';
      img.loading = 'lazy';

      const overlay = document.createElement('div');
      overlay.className = 'demo-card__overlay';
      overlay.append(h2, p);

      link.append(img, overlay);
    } else {
      const body = document.createElement('div');
      body.className = 'demo-card__body';
      body.append(h2, p);
      link.append(body);
    }

    link.append(createCtaIcon());
    li.append(link);
  } else {
    const body = document.createElement('div');
    body.className = 'demo-card__body';
    body.append(h2, p);
    const tag = document.createElement('span');
    tag.className = 'pending-tag';
    tag.textContent = 'not built yet';
    body.append(tag);
    li.append(body);
  }

  grid.append(li);
}
