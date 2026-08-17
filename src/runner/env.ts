import {errorMessage} from './loader';

/**
 * Browser channel and version are part of every measurement, not metadata.
 * Canary and M153 stable are not necessarily the same WebNN implementation, so
 * numbers must never be aggregated across them.
 */
export interface Environment {
  crossOriginIsolated: boolean;
  sharedArrayBuffer: boolean;
  webnn: boolean;
  webgpu: boolean;
  hardwareConcurrency: number;
  browser: string;
  gpuAdapter: string;
}

interface UserAgentBrand {
  brand: string;
  version: string;
}

interface UADataLike {
  getHighEntropyValues(hints: string[]): Promise<{fullVersionList?: UserAgentBrand[]}>;
}

export async function readEnvironment(): Promise<Environment> {
  return {
    crossOriginIsolated: self.crossOriginIsolated,
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    webnn: 'ml' in navigator,
    webgpu: 'gpu' in navigator,
    hardwareConcurrency: navigator.hardwareConcurrency,
    browser: await readBrowser(),
    gpuAdapter: await readGpuAdapter(),
  };
}

async function readBrowser(): Promise<string> {
  const uaData = (navigator as {userAgentData?: UADataLike}).userAgentData;
  if (!uaData) return navigator.userAgent;
  try {
    const hv = await uaData.getHighEntropyValues(['fullVersionList']);
    const list = hv.fullVersionList?.map((b) => `${b.brand} ${b.version}`).join(', ');
    return list ?? navigator.userAgent;
  } catch {
    return navigator.userAgent;
  }
}

async function readGpuAdapter(): Promise<string> {
  if (!('gpu' in navigator)) return '(no WebGPU)';
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return '(no adapter)';
    const info = adapter.info;
    const parts = [info?.vendor, info?.architecture, info?.description].filter(Boolean);
    return parts.length ? parts.join(' / ') : '(no adapter info)';
  } catch (e) {
    return `error — ${errorMessage(e)}`;
  }
}
