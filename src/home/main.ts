import {DEMOS} from '../registry';

/**
 * The home page is generated from the registry, never hand-written. Adding a
 * demo to registry.ts is what makes it appear here.
 */
const grid = document.getElementById('demo-grid');
if (!grid) throw new Error('#demo-grid missing from index.html');

for (const demo of DEMOS) {
  const li = document.createElement('li');
  li.className = 'demo-card';
  li.dataset.pending = String(!demo.implemented);

  const h2 = document.createElement('h2');
  h2.textContent = demo.title;

  const p = document.createElement('p');
  p.textContent = demo.blurb;

  li.append(h2, p);

  if (!demo.implemented) {
    const tag = document.createElement('span');
    tag.className = 'pending-tag';
    tag.textContent = 'not built yet';
    li.append(tag);
  }

  grid.append(li);
}
