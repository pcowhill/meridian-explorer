import { expect, test, type Page } from '@playwright/test';
import { failOnPageErrors, inspector, inspectorTitle, open, searchAndPick } from './helpers';

const node = (page: Page, id: string) => page.locator(`[data-testid="atlas-node"][data-entity="${id}"]`);

test.describe('Architecture Atlas', () => {
  test('starts from a single Meridian node and expands hierarchically in place (Scenario A)', async ({ page }) => {
    const errors = failOnPageErrors(page);
    await open(page, '#/atlas');
    await expect(page.getByTestId('atlas-root')).toBeVisible();
    await expect(page.getByTestId('atlas-node')).toHaveCount(1);
    await expect(node(page, 'meridian')).toContainText('Meridian');

    // Clicking Meridian reveals its applications.
    await node(page, 'meridian').click();
    for (const app of ['customer', 'operations', 'backend']) await expect(node(page, app)).toBeVisible();
    await expect(node(page, 'meridian')).toHaveAttribute('data-expanded', 'true');

    // Clicking Backend API reveals its internals while the other apps stay visible.
    await node(page, 'backend').click();
    await expect(node(page, 'be.money')).toBeVisible();
    await expect(node(page, 'be.http')).toBeVisible();
    await expect(node(page, 'customer')).toBeVisible();
    await expect(node(page, 'operations')).toBeVisible();
    await expect(inspectorTitle(page)).toHaveText('Backend API');

    // Children are drawn inside their parent's region.
    const parent = await node(page, 'backend').boundingBox();
    const child = await node(page, 'be.money').boundingBox();
    expect(parent && child && child.x >= parent.x && child.y >= parent.y && child.x + child.width <= parent.x + parent.width + 1 && child.y + child.height <= parent.y + parent.height + 1).toBeTruthy();

    // Drill down to a function.
    await node(page, 'be.money').click();
    await node(page, 'be:money/movements').click();
    await node(page, 'be:money/movements#createTransfer').click();
    await expect(inspectorTitle(page)).toHaveText('createTransfer');
    expect(page.url()).toContain('be:money/movements');
    expect(errors).toEqual([]);
  });

  test('relationships are inspectable and distinguish HTTP from real-time', async ({ page }) => {
    await open(page, '#/atlas?x=meridian');
    const http = page.locator('[data-testid="atlas-edge"][data-edge*="customer"][data-edge*="backend"][data-edge$="|http"]').first();
    await expect(http).toBeAttached();
    await http.click({ force: true });
    await expect(inspectorTitle(page)).toContainText('HTTPS');
    await expect(page.getByTestId('edge-endpoints')).toContainText('/api/transfers');

    // Real-time exists between the operations console and the backend, not for the customer app.
    await expect(page.locator('[data-testid="atlas-edge"][data-edge*="operations"][data-edge$="|realtime"]').first()).toBeAttached();
    await expect(page.locator('[data-testid="atlas-edge"][data-edge*="customer"][data-edge$="|realtime"]')).toHaveCount(0);
  });

  test('relationship filters hide and show channels', async ({ page }) => {
    await open(page, '#/atlas?x=meridian');
    const httpEdges = page.locator('[data-testid="atlas-edge"][data-edge$="|http"]');
    await expect(httpEdges.first()).toBeAttached();
    await page.getByTestId('channel-http').click();
    await expect(httpEdges).toHaveCount(0);
    await page.getByTestId('channel-http').click();
    await expect(httpEdges.first()).toBeAttached();
  });

  test('focus isolates a subsystem and the breadcrumb returns to the whole system', async ({ page }) => {
    await open(page, '#/atlas?x=meridian,backend&sel=e:backend');
    await page.keyboard.press('f');
    await expect(node(page, 'be.money')).toBeVisible();
    await expect(node(page, 'customer')).toHaveCount(0);
    expect(page.url()).toContain('f=backend');
    await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Backend API');
    await page.getByTestId('atlas-breadcrumb').getByText('Meridian', { exact: true }).click();
    await expect(node(page, 'customer')).toBeVisible();
    expect(page.url()).not.toContain('f=backend');
  });

  test('collapsing a container hides its contents; the toggle and E both work', async ({ page }) => {
    await open(page, '#/atlas?x=meridian,backend&sel=e:backend');
    await expect(node(page, 'be.money')).toBeVisible();
    await page.keyboard.press('e');
    await expect(node(page, 'be.money')).toHaveCount(0);
    await expect(node(page, 'backend')).toHaveAttribute('data-expanded', 'false');
    await node(page, 'backend').getByTestId('node-toggle').click();
    await expect(node(page, 'be.money')).toBeVisible();
  });

  test('search reveals a deep component on the map and the tree stays in sync', async ({ page }) => {
    await open(page, '#/atlas');
    await searchAndPick(page, 'deriveBalances', 'entity:sh:ledger#deriveBalances');
    await expect(node(page, 'sh:ledger#deriveBalances')).toBeVisible();
    await expect(inspectorTitle(page)).toHaveText('deriveBalances');
    await expect(page.locator('[data-tree-entity="sh:ledger#deriveBalances"]')).toBeVisible();
    await page.locator('[data-tree-entity="db"]').click();
    await expect(inspectorTitle(page)).toHaveText('SQLite Database');
  });

  test('the detail dial controls which children appear, without hiding the selection', async ({ page }) => {
    await open(page, '#/atlas?x=meridian&d=1&aud=executive');
    await expect(node(page, 'backend')).toBeVisible();
    await expect(node(page, 'shared')).toHaveCount(0);
    await expect(page.getByTestId('reveal-hidden').first()).toBeVisible();
    await page.keyboard.press('=');
    await page.keyboard.press('=');
    await expect(node(page, 'shared')).toBeVisible();
  });

  test('a deep link restores expansion and selection; database tables show their data', async ({ page }) => {
    await open(page, '#/atlas?sel=e:db:LedgerEntry&x=meridian,db');
    await expect(node(page, 'db:LedgerEntry')).toBeVisible();
    await expect(inspectorTitle(page)).toHaveText('LedgerEntry');
    await inspector(page).getByRole('tab', { name: 'Data' }).click();
    await expect(inspector(page).getByTestId('field-table').first()).toContainText('amountMinor');
  });

  test('hypothetical components are added non-destructively and drawn as hypothetical (Scenario F)', async ({ page }) => {
    await open(page, '#/atlas?x=meridian,backend,be.http,be:routes/money&sel=e:ep:POST%20/api/movements');
    await page.getByRole('button', { name: 'Add hypothetical component' }).first().click();
    await page.getByLabel('Component name').fill('PayLink service');
    await page.getByRole('button', { name: 'Add component' }).click();
    const hypo = page.locator('[data-testid="atlas-node"][data-entity^="hypo:paylink-service"]');
    await expect(hypo).toBeVisible();
    await expect(inspector(page).locator('[data-confidence="hypothetical"]').first()).toBeVisible();
    await expect(page.getByTestId('layers-button')).toContainText('1 on');

    // Discarding the layer removes it; the baseline is untouched.
    await page.keyboard.press('h');
    await page.getByRole('button', { name: 'Discard all my layers' }).click();
    await page.keyboard.press('Escape');
    await expect(hypo).toHaveCount(0);
    await expect(node(page, 'backend')).toBeVisible();
  });

  test('the shipped SimPay layer appears on the map when switched on', async ({ page }) => {
    await open(page, '#/atlas?x=meridian,backend,boundary:external&layers=layer:simpay');
    await expect(node(page, 'hypo:simpay')).toBeVisible();
    await expect(node(page, 'hypo:be.partner')).toBeVisible();
    await node(page, 'hypo:simpay').click();
    await expect(inspector(page).locator('[data-confidence="hypothetical"]').first()).toBeVisible();
  });

  test('a related workflow opens in the Theater from the Atlas', async ({ page }) => {
    await open(page, '#/atlas?x=meridian,backend,be.http,be:routes/money&sel=e:ep:POST%20/api/transfers');
    await inspector(page).getByRole('tab', { name: /Workflows/ }).click();
    await inspector(page).locator('[data-scenario="transfer"]').click();
    await expect(page.getByTestId('theater-root')).toBeVisible();
    expect(page.url()).toContain('s=transfer');
  });
});
