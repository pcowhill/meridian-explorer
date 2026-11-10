import { expect, type Page } from '@playwright/test';

/** Open the app at a hash with the first-run tour already dismissed and a clean workspace. */
export async function open(page: Page, hash = '#/atlas', opts: { tour?: boolean } = {}): Promise<void> {
  await page.addInitScript((showTour) => {
    if (sessionStorage.getItem('e2e-init')) return;
    sessionStorage.setItem('e2e-init', '1');
    localStorage.clear();
    if (!showTour) localStorage.setItem('meridian-explorer:workspace:v1', JSON.stringify({ state: { tourSeen: true }, version: 1 }));
  }, !!opts.tour);
  await page.goto(`./${hash}`);
  await expect(page.getByTestId('app')).toBeVisible();
}

export const inspector = (page: Page) => page.getByTestId('inspector');
export const inspectorTitle = (page: Page) => page.getByTestId('inspector-title');

/** Search with the command palette and choose a result by its index key. */
export async function searchAndPick(page: Page, query: string, resultKey: string): Promise<void> {
  await page.keyboard.press('/');
  await page.getByTestId('command-input').fill(query);
  await page.locator(`[data-result="${resultKey}"]`).first().click();
}

/** Fail the test on any uncaught page error. */
export function failOnPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}
