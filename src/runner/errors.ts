/** Shared by loader.ts, fetch-retry.ts and measure.ts — kept in its own file
 *  so none of them need to import from each other just for this. */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
