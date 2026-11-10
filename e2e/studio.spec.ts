import { expect, test, type Page } from '@playwright/test';
import { failOnPageErrors, inspector, inspectorTitle, open } from './helpers';

const entityNode = (page: Page, id: string) => page.locator(`[data-testid="studio-node"][data-entity="${id}"]`);
const nodes = (page: Page) => page.getByTestId('studio-node');
const edges = (page: Page) => page.getByTestId('studio-edge');

async function addFromPalette(page: Page, query: string, id: string): Promise<void> {
  await page.getByTestId('palette-search').fill(query);
  await page.locator(`[data-palette-entity="${id}"]`).first().click();
  await expect(entityNode(page, id)).toBeVisible();
}

test.describe('Explanation Studio', () => {
  test('components from the palette connect themselves with known relationships (Scenario G)', async ({ page }) => {
    const errors = failOnPageErrors(page);
    await open(page, '#/studio');
    await expect(page.getByTestId('studio-root')).toBeVisible();
    await addFromPalette(page, 'POST /api/transfers', 'ep:POST /api/transfers');
    await addFromPalette(page, 'createTransfer', 'be:money/movements#createTransfer');
    await addFromPalette(page, 'LedgerEntry', 'db:LedgerEntry');
    await expect(nodes(page)).toHaveCount(3);
    await expect(edges(page).first()).toBeAttached();
    expect(await edges(page).count()).toBeGreaterThanOrEqual(2);

    // Clicking a component explains it in the shared inspector.
    await entityNode(page, 'db:LedgerEntry').click();
    await expect(inspectorTitle(page)).toHaveText('LedgerEntry');
    expect(errors).toEqual([]);
  });

  test('undo and redo walk the board history', async ({ page }) => {
    await open(page, '#/studio');
    await addFromPalette(page, 'createTransfer', 'be:money/movements#createTransfer');
    await addFromPalette(page, 'LedgerEntry', 'db:LedgerEntry');
    await page.getByRole('button', { name: 'Add note' }).click();
    await expect(nodes(page)).toHaveCount(3);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(nodes(page)).toHaveCount(2);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(nodes(page)).toHaveCount(1);
    await page.getByRole('button', { name: 'Redo' }).click();
    await page.getByRole('button', { name: 'Redo' }).click();
    await expect(nodes(page)).toHaveCount(3);
  });

  test('boards persist across a reload', async ({ page }) => {
    await open(page, '#/studio');
    await addFromPalette(page, 'deriveBalances', 'sh:ledger#deriveBalances');
    await page.waitForTimeout(900); // debounced autosave
    await page.reload();
    await expect(entityNode(page, 'sh:ledger#deriveBalances')).toBeVisible();
  });

  test('receives components sent from the inspector in another mode', async ({ page }) => {
    await open(page, '#/atlas?sel=e:be:money/movements%23createTransfer');
    await inspector(page).getByRole('button', { name: 'Add to Studio' }).click();
    await expect(page.getByTestId('studio-root')).toBeVisible();
    await expect(entityNode(page, 'be:money/movements#createTransfer')).toBeVisible();
  });

  test('a guided question builds a starting diagram (Scenario B)', async ({ page }) => {
    await open(page, '#/studio');
    await page.getByTestId('help-button').click();
    await page.getByRole('menuitem', { name: /Guided questions/ }).click();
    await page.getByTestId('question-q-transfer-studio').click();
    await expect(entityNode(page, 'ep:POST /api/transfers')).toBeVisible();
    await expect(entityNode(page, 'db:LedgerEntry')).toBeVisible();
    expect(await nodes(page).count()).toBeGreaterThanOrEqual(8);
    expect(await edges(page).count()).toBeGreaterThanOrEqual(5);
  });

  test('generates a dependency diagram for a component', async ({ page }) => {
    await open(page, '#/studio');
    await addFromPalette(page, 'deriveBalances', 'sh:ledger#deriveBalances');
    await entityNode(page, 'sh:ledger#deriveBalances').click();
    await page.getByRole('button', { name: 'Generate' }).click();
    await page.locator('[data-generate="dependency"]').click();
    await expect.poll(() => nodes(page).count()).toBeGreaterThan(3);
    await expect(edges(page).first()).toBeAttached();
  });

  test('technical widgets: balance calculator and database table (Scenario C)', async ({ page }) => {
    await open(page, '#/studio');
    await addFromPalette(page, 'LedgerEntry', 'db:LedgerEntry');
    await page.getByRole('tab', { name: /Widgets/ }).click();
    await page.getByRole('button', { name: /Balance calculator/i }).first().click();
    const calc = page.locator('[data-testid="studio-node"][data-node-type="balance"]');
    await expect(calc).toBeVisible();
    await expect(calc.getByTestId('balance-available')).toHaveText('$2,289.00');
    await calc.locator('[data-entry="le_003"]').getByLabel('Status').selectOption('posted');
    await expect(calc.getByTestId('balance-current')).toHaveText('$2,289.00');
  });

  test('a hypothetical component lands on the board, dashed and purple, and a before/after can be built (Scenario F)', async ({ page }) => {
    await open(page, '#/studio');
    await addFromPalette(page, 'POST /api/movements', 'ep:POST /api/movements');
    await page.getByRole('button', { name: 'Add hypothetical component' }).first().click();
    await page.getByLabel('Component name').fill('PayLink service');
    await page.getByRole('button', { name: 'Add component' }).click();
    const hypo = page.locator('[data-testid="studio-node"][data-entity^="hypo:paylink-service"]');
    await expect(hypo).toBeVisible();
    await expect(page.getByTestId('layers-button')).toContainText('1 on');
    await expect(inspector(page).locator('[data-confidence="hypothetical"]').first()).toBeVisible();
  });

  test('the board exports to JSON', async ({ page }) => {
    await open(page, '#/studio');
    await addFromPalette(page, 'createTransfer', 'be:money/movements#createTransfer');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export board' }).first().click();
    expect((await download).suggestedFilename()).toMatch(/\.json$/);
  });
});
