/** Promise-based sleep, used to throttle API calls between requests. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Guarantee exactly one trailing slash so `new URL()` joins paths predictably. */
export function withTrailingSlash(input: string): string {
  return input.endsWith('/') ? input : `${input}/`;
}
