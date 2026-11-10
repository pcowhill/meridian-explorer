import { expect, test, type Page } from '@playwright/test';
import { failOnPageErrors, inspectorTitle, open } from './helpers';

const counter = (page: Page) => page.getByTestId('step-counter');
const stepNumber = async (page: Page) => Number(/(\d+)\s*of/i.exec((await counter(page).textContent()) ?? '')?.[1]);
const stepTotal = async (page: Page) => Number(/of\s*(\d+)/i.exec((await counter(page).textContent()) ?? '')?.[1]);

test.describe('Scenario Theater', () => {
  test('lists scenarios and opens one from the library', async ({ page }) => {
    await open(page, '#/theater');
    await expect(page.getByTestId('theater-root')).toBeVisible();
    for (const id of ['transfer', 'ops-approval', 'account-balances', 'clock-advance', 'fraud-alert', 'app-communication', 'transaction-validation']) {
      await expect(page.locator(`[data-scenario="${id}"]`).first()).toBeVisible();
    }
    await page.locator('[data-scenario="transfer"]').first().click();
    await expect(counter(page)).toContainText(/1\s*of/i);
    expect(page.url()).toContain('s=transfer');
  });

  test('steps forward and back, restarts, and plays (Scenario B)', async ({ page }) => {
    const errors = failOnPageErrors(page);
    await open(page, '#/theater?s=transfer&d=5&aud=developer');
    await expect(page.getByTestId('step-title')).toBeVisible();
    expect(await stepNumber(page)).toBe(1);
    const first = await page.getByTestId('step-title').textContent();

    await page.getByRole('button', { name: 'Next step' }).click();
    await page.keyboard.press('ArrowRight');
    expect(await stepNumber(page)).toBe(3);
    expect(page.url()).toContain('i=2');
    await page.getByRole('button', { name: 'Previous step' }).click();
    expect(await stepNumber(page)).toBe(2);
    await page.getByRole('button', { name: 'Restart' }).click();
    expect(await stepNumber(page)).toBe(1);
    await expect(page.getByTestId('step-title')).toHaveText(first!);

    // Play advances on its own; Pause stops it.
    await page.keyboard.press('.');
    await page.keyboard.press('.');
    await page.getByRole('button', { name: 'Play' }).click();
    await expect.poll(() => stepNumber(page), { timeout: 15_000 }).toBeGreaterThan(2);
    await page.getByRole('button', { name: 'Pause' }).click();
    const paused = await stepNumber(page);
    await page.waitForTimeout(1500);
    expect(await stepNumber(page)).toBe(paused);
    expect(errors).toEqual([]);
  });

  test('shows the data exchanged and the database before and after', async ({ page }) => {
    await open(page, '#/theater?s=transfer&d=5&aud=developer');
    const panel = page.getByTestId('step-panel');
    // Walk to the end; along the way the request payload and ledger writes appear.
    let sawPayload = false;
    let sawLedger = false;
    const total = await stepTotal(page);
    for (let i = 1; i < total; i++) {
      if (!sawPayload && (await panel.getByTestId('json-view').count())) sawPayload = true;
      if (!sawLedger && (await panel.getByTestId('db-table-LedgerEntry').count())) sawLedger = true;
      await page.keyboard.press('ArrowRight');
    }
    expect(sawPayload).toBe(true);
    expect(sawLedger).toBe(true);
    expect(await stepNumber(page)).toBe(total);
    await expect(panel.getByTestId('source-ref').first()).toBeAttached();
  });

  test('alternative outcomes: a decision switches the path taken', async ({ page }) => {
    await open(page, '#/theater?s=transfer&d=5');
    const select = page.getByTestId('variant-select');
    await expect(select).toBeVisible();
    const successTotal = await stepTotal(page);
    if ((await select.evaluate((el) => el.tagName)) === 'SELECT') await select.selectOption('insufficient-funds');
    else {
      await select.click();
      await page.locator('[data-variant="insufficient-funds"]').click();
    }
    expect(page.url()).toContain('v=insufficient-funds');
    expect(await stepTotal(page)).not.toBe(successTotal);
    await page.keyboard.press('End');
    await expect(page.getByTestId('step-panel')).toContainText(/insufficient|available balance/i);
  });

  test('an operator approval flips the pending entry to posted (Scenario D)', async ({ page }) => {
    await open(page, '#/theater?s=ops-approval&d=5&aud=dba');
    await page.keyboard.press('End');
    const total = await stepTotal(page);
    expect(await stepNumber(page)).toBe(total);
    // Jump back through database-changing steps and find the ledger update.
    let found = false;
    for (let i = 0; i < total && !found; i++) {
      const table = page.getByTestId('step-panel').getByTestId('db-table-LedgerEntry');
      if ((await table.count()) && (await table.locator('[data-change="changed"]').count())) {
        await expect(table).toContainText('posted');
        found = true;
      } else await page.keyboard.press('ArrowLeft');
    }
    expect(found).toBe(true);
    await expect(page.getByTestId('step-panel').getByTestId('balance-pill').first()).toBeVisible();
  });

  test('three views of the same steps', async ({ page }) => {
    await open(page, '#/theater?s=fraud-alert');
    const views = page.getByTestId('view-switch');
    for (const v of ['stage', 'timeline', 'sequence']) {
      await views.locator(`[data-view="${v}"]`).click();
      if (v !== 'sequence') expect(page.url()).toContain(`view=${v}`);
      await page.keyboard.press('ArrowRight');
      await expect(page.getByTestId('step-title')).toBeVisible();
    }
  });

  test('detail and audience change what is shown, not what happened', async ({ page }) => {
    await open(page, '#/theater?s=transfer&aud=executive&d=1');
    const outline = await stepTotal(page);
    await page.keyboard.press('=');
    await page.keyboard.press('=');
    await page.keyboard.press('=');
    await page.keyboard.press('=');
    const full = await stepTotal(page);
    expect(full).toBeGreaterThan(outline);
    expect(outline).toBeGreaterThan(0);
  });

  test('a trace is assembled for any endpoint and can be edited, saved and replayed (Scenario G)', async ({ page }) => {
    await open(page, '#/theater');
    await page.getByRole('button', { name: 'New scenario from endpoint' }).first().click();
    await page.getByTestId('endpoint-search').fill('/api/accounts');
    await page.locator('[data-endpoint="ep:GET /api/accounts"]').click();
    await expect(counter(page)).toContainText(/1\s*of/i);
    expect(decodeURIComponent(page.url())).toContain('trace:ep:GET /api/accounts');
    const before = await stepTotal(page);

    await page.getByRole('button', { name: 'Edit scenario' }).click();
    await page.getByRole('button', { name: 'Save scenario' }).click();
    await page.reload();
    await expect(page.getByTestId('theater-root')).toBeVisible();
    await expect(counter(page)).toBeVisible();
    expect(await stepTotal(page)).toBeGreaterThanOrEqual(before);
  });

  test('a deep link opens a scenario at a step; lanes select components', async ({ page }) => {
    await open(page, '#/theater?s=ops-approval&v=reject&i=4&d=5');
    expect(await stepNumber(page)).toBe(5);
    await page.locator('[data-lane]').first().click();
    await expect(inspectorTitle(page)).toBeVisible();
  });

  test('context carries over from a selected component', async ({ page }) => {
    await open(page, '#/theater?sel=e:be:ops/requests%23applyOperatorAction');
    await expect(page.getByTestId('theater-root')).toContainText(/Workflows involving/i);
    await expect(page.locator('[data-scenario="ops-approval"]').first()).toBeVisible();
  });

  test('the proposed SimPay flow is playable and marked hypothetical (Scenario F)', async ({ page }) => {
    await open(page, '#/theater?s=simpay-payment&layers=layer:simpay&d=5');
    await expect(page.getByTestId('step-title')).toContainText('SimPay');
    await expect(page.getByTestId('step-panel').locator('[data-confidence="hypothetical"]').first()).toBeVisible();
    await page.keyboard.press('End');
    await expect(page.getByTestId('step-title')).toContainText(/Webhook/i);
  });
});
