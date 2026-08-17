import {DEMOS} from '../registry';

/**
 * The home page is generated from the registry, never hand-written. Adding a
 * demo to registry.ts is what makes it appear here.
 */
const grid = document.getElementById('demo-grid');
if (!grid) throw new Error('#demo-grid missing from index.html');

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
    link.append(h2, p);
    li.append(link);
  } else {
    li.append(h2, p);
    const tag = document.createElement('span');
    tag.className = 'pending-tag';
    tag.textContent = 'not built yet';
    li.append(tag);
  }

  grid.append(li);
}
