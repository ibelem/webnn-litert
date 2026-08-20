/**
 * LiteRT.js version dropdown handler.
 * Fetches available versions from npm registry and provides a dropdown selector.
 * Supports URL parameter: ?litertjs=x.x.x
 */

import {DEFAULT_LITERT_VERSION, isValidVersion} from '../runner/loader';

interface NpmPackageInfo {
  versions: Record<string, unknown>;
  'dist-tags': {
    latest: string;
  };
}

/**
 * Fetch available LiteRT.js versions from npm registry.
 * Returns versions sorted semantically (newest first).
 */
export async function fetchLiteRtVersions(): Promise<string[]> {
  try {
    const response = await fetch('https://registry.npmjs.org/@litertjs/core');
    if (!response.ok) {
      throw new Error(`Failed to fetch versions: ${response.status}`);
    }
    
    const data: NpmPackageInfo = await response.json();
    const versions = Object.keys(data.versions);
    
    // Filter out pre-release versions (those with -alpha, -beta, etc.)
    const stableVersions = versions.filter(v => {
      // Allow stable versions and pre-release versions that are commonly used
      // For now, include all versions but sort them properly
      return isValidVersion(v);
    });
    
    // Sort versions semantically (newest first)
    stableVersions.sort((a, b) => {
      const partsA = a.split('.').map(Number);
      const partsB = b.split('.').map(Number);

      for (let i = 0; i < 3; i++) {
        const partA = partsA[i] ?? 0;
        const partB = partsB[i] ?? 0;
        if (partA !== partB) {
          return partB - partA; // Descending order
        }
      }
      return 0;
    });
    
    return stableVersions;
  } catch (error) {
    console.error('Failed to fetch LiteRT versions:', error);
    // Return default version as fallback
    return [DEFAULT_LITERT_VERSION];
  }
}

/**
 * Sets up the LiteRT version dropdown.
 * Fetches versions, populates dropdown, and handles user selection.
 */
export async function setupLiteRtVersionDropdown(): Promise<void> {
  const select = document.getElementById('litert-version') as HTMLSelectElement;
  
  if (!select) {
    console.warn('LiteRT version dropdown not found');
    return;
  }
  
  // Disable while loading
  select.disabled = true;
  select.innerHTML = '<option value="">Loading versions...</option>';
  
  try {
    const versions = await fetchLiteRtVersions();
    
    // Clear loading option
    select.innerHTML = '';
    
    // Populate dropdown
    versions.forEach(version => {
      const option = document.createElement('option');
      option.value = version;
      option.textContent = version;
      select.appendChild(option);
    });
    
    // Initialize from URL parameter if present
    const params = new URLSearchParams(location.search);
    const urlVersion = params.get('litertjs');
    
    if (urlVersion && isValidVersion(urlVersion) && versions.includes(urlVersion)) {
      select.value = urlVersion;
    } else {
      select.value = DEFAULT_LITERT_VERSION;
    }
    
    // Enable dropdown
    select.disabled = false;
    
    // Listen for changes
    select.addEventListener('change', () => {
      const selectedVersion = select.value;
      if (selectedVersion && isValidVersion(selectedVersion)) {
        updateUrlParameter(selectedVersion);
        dispatchVersionChangedEvent(selectedVersion);
      }
    });
    
    // Sole trigger for a page's very first run — see each demo's main.ts,
    // which relies on this instead of also calling runAll() itself
    // (that would double-log "select at least one backend" on every load).
    dispatchVersionChangedEvent(select.value);
    
  } catch (error) {
    console.error('Failed to setup version dropdown:', error);
    select.innerHTML = `<option value="${DEFAULT_LITERT_VERSION}">${DEFAULT_LITERT_VERSION}</option>`;
    select.disabled = false;
    // Still the sole trigger for a page's first run (see the success path's
    // "Dispatch initial event") — a registry outage must not leave the page
    // permanently un-run.
    dispatchVersionChangedEvent(DEFAULT_LITERT_VERSION);
  }
}

function updateUrlParameter(version: string): void {
  const params = new URLSearchParams(location.search);
  params.set('litertjs', version);
  const newUrl = `${location.pathname}?${params.toString()}`;
  history.replaceState({}, '', newUrl);
}

function dispatchVersionChangedEvent(version: string): void {
  const event = new CustomEvent('litertVersionChanged', {
    detail: { version }
  });
  document.dispatchEvent(event);
}