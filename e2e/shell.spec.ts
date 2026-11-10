import { expect, test } from '@playwright/test';
import { failOnPageErrors, inspector, inspectorTitle, open, searchAndPick } from './helpers';

test.describe('shared shell', () => {
  test('first visit shows the tour, which introduces the three modes', async ({ page }) => {
    await open(page, '#/atlas', { tour: true });
    await expect(page.getByRole('dialog', { name: /Welcome to Meridian Explorer/ })).toBeVisible();
    for (const mode of ['atlas', 'theater', 'studio']) await expect(page.getByTestId(`tour-${mode}`)).toBeVisible();
    await page.getByTestId('tour-done').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('app')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('search finds a function and the inspector reaches its contract, data, code and impact', async ({ page }) => {
    const errors = failOnPageErrors(page);
    await open(page);
    await searchAndPick(page, 'POST /api/transfers', 'entity:ep:POST /api/transfers');
    await expect(inspectorTitle(page)).toHaveText('POST /api/transfers');
    await inspector(page).getByRole('tab', { name: /Contract/ }).click();
    await expect(page.getByTestId('contract-auth')).toContainText('Session required');
    await expect(page.getByTestId('contract-errors')).toContainText('insufficient_funds');
    await expect(page.getByTestId('contract-flow').locator('li').first()).toBeVisible();

    await inspector(page).getByRole('tab', { name: /Code/ }).click();
    await expect(page.getByTestId('code-block').first()).toContainText('/api/transfers');
    await expect(inspector(page).getByRole('link', { name: /on GitHub/ }).first()).toHaveAttribute('href', /github\.com\/pcowhill\/claude-banking-project\/blob\/53bb9ab/);

    await inspector(page).getByRole('tab', { name: /Impact/ }).click();
    await expect(page.getByTestId('impact-tab')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('a deep link restores mode, selection, audience and detail', async ({ page }) => {
    await open(page, '#/theater?sel=e:db:LedgerEntry&aud=dba&d=5');
    await expect(page.getByTestId('app')).toHaveAttribute('data-mode', 'theater');
    await expect(inspectorTitle(page)).toHaveText('LedgerEntry');
    await expect(page.getByTestId('audience-button')).toContainText('DBA');
    await inspector(page).getByRole('tab', { name: 'Data' }).click();
    await expect(page.getByTestId('balance-calculator')).toBeVisible();
    await expect(page.getByTestId('state-machine')).toBeVisible();
  });

  test('the balance calculator recomputes current and available', async ({ page }) => {
    await open(page, '#/atlas?sel=e:db:LedgerEntry');
    await inspector(page).getByRole('tab', { name: 'Data' }).click();
    const calc = page.getByTestId('balance-calculator');
    await expect(calc.getByTestId('balance-available')).toHaveText('$2,289.00');
    await calc.locator('[data-entry="le_003"]').getByLabel('Status').selectOption('failed');
    await expect(calc.getByTestId('balance-available')).toHaveText('$2,409.00');
    await expect(calc.getByTestId('balance-current')).toHaveText('$2,409.00');
  });

  test('mode switching keeps the selection and back returns', async ({ page }) => {
    await open(page);
    await searchAndPick(page, 'deriveBalances', 'entity:sh:ledger#deriveBalances');
    await page.keyboard.press('2');
    await expect(page.getByTestId('app')).toHaveAttribute('data-mode', 'theater');
    await expect(inspectorTitle(page)).toHaveText('deriveBalances');
    await page.keyboard.press('3');
    await expect(page.getByTestId('app')).toHaveAttribute('data-mode', 'studio');
    await expect(inspectorTitle(page)).toHaveText('deriveBalances');
    await page.getByTestId('nav-back').click();
    await expect(page.getByTestId('app')).toHaveAttribute('data-mode', 'theater');
    expect(page.url()).toContain('#/theater');
  });

  test('audience presets and the detail dial are independent', async ({ page }) => {
    await open(page);
    await page.getByTestId('audience-button').click();
    await page.getByRole('menuitem', { name: /Executive/ }).click();
    await expect(page.getByTestId('audience-button')).toContainText('Exec');
    expect(page.url()).toContain('d=1');
    await page.keyboard.press('=');
    await page.keyboard.press('=');
    expect(page.url()).toContain('d=3');
    expect(page.url()).toContain('aud=executive');
  });

  test('a hypothetical field is recorded in a layer and can be discarded', async ({ page }) => {
    await open(page, '#/atlas?sel=e:sh:money-movement%23ExternalMovementRequest');
    await inspector(page).getByRole('button', { name: /What if/ }).click();
    await page.getByRole('menuitem', { name: /Add a field/ }).click();
    await page.getByPlaceholder('externalReference').fill('partnerRef');
    await page.getByRole('button', { name: 'Add proposed field' }).click();
    await expect(page.getByTestId('impact-tab')).toBeVisible();
    await inspector(page).getByRole('tab', { name: 'Data' }).click();
    await expect(inspector(page).locator('[data-field="partnerRef"]')).toContainText('proposed');
    await expect(page.getByTestId('layers-button')).toContainText('1 on');

    await page.keyboard.press('h');
    await expect(page.getByTestId('layer-list')).toContainText('My proposal');
    await page.getByRole('button', { name: 'Discard all my layers' }).click();
    await page.keyboard.press('Escape');
    await expect(inspector(page).locator('[data-field="partnerRef"]')).toHaveCount(0);
  });

  test('the shipped SimPay example is clearly hypothetical and off by default', async ({ page }) => {
    await open(page);
    await page.keyboard.press('/');
    await page.getByTestId('command-input').fill('SimPay');
    await expect(page.locator('[data-result="entity:hypo:simpay"]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.getByTestId('layers-button').click();
    await page.getByTestId('layers-menu').getByRole('switch').first().click();
    await page.keyboard.press('Escape');
    await searchAndPick(page, 'SimPay', 'entity:hypo:simpay');
    await expect(inspector(page).locator('[data-confidence="hypothetical"]').first()).toBeVisible();
    expect(page.url()).toContain('layers=layer:simpay');
  });

  test('views can be saved, survive a reload and be reopened', async ({ page }) => {
    await open(page, '#/atlas?sel=e:be:money/movements%23createTransfer');
    await page.keyboard.press('b');
    await page.getByTestId('view-name').fill('Transfer function');
    await page.getByTestId('save-view').click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(page.getByTestId('top-bar')).toBeVisible();
    await page.getByTestId('views-button').click();
    await expect(page.getByTestId('saved-views').getByLabel('Rename view')).toHaveValue('Transfer function');
    await page.getByTestId('open-view').click();
    await expect(inspectorTitle(page)).toHaveText('createTransfer');
  });

  test('the workspace exports as validated JSON', async ({ page }) => {
    await open(page);
    await page.getByTestId('help-button').click();
    await page.getByRole('menuitem', { name: /Export, import/ }).click();
    const download = page.waitForEvent('download');
    await page.getByTestId('export-workspace').click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/meridian-explorer-workspace-.*\.json/);
  });

  test('the evaluation worksheet records notes and ratings and exports', async ({ page }) => {
    await open(page);
    await page.getByTestId('help-button').click();
    await page.getByRole('menuitem', { name: /Evaluation worksheet/ }).click();
    await page.getByTestId('eval-scenario-B').click();
    await page.getByTestId('eval-note-B-theater').fill('Very clear step by step.');
    await page.getByRole('tab', { name: /Rubric/ }).click();
    await page.getByTestId('rate-theater-clarity-5').click();
    await expect(page.getByTestId('avg-theater')).toHaveText('5.0');
    const download = page.waitForEvent('download');
    await page.getByTestId('export-evaluation').click();
    expect((await download).suggestedFilename()).toBe('meridian-explorer-evaluation.md');
  });

  test('keyboard shortcut reference and glossary open from the keyboard', async ({ page }) => {
    await open(page);
    await page.keyboard.press('?');
    await expect(page.getByTestId('shortcut-list')).toContainText('Switch to Scenario Theater');
    await page.keyboard.press('Escape');
    await page.keyboard.press('g');
    await page.getByLabel('Filter glossary').fill('ledger');
    await expect(page.getByTestId('glossary-list')).toContainText(/ledger/i);
  });

  test('presenter mode hides the chrome and Escape restores it', async ({ page }) => {
    await open(page, '#/atlas?sel=e:backend');
    await page.keyboard.press('p');
    await expect(page.getByTestId('presenter-bar')).toBeVisible();
    await expect(inspector(page)).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('top-bar')).toBeVisible();
    await expect(inspector(page)).toBeVisible();
  });

  test('the live probe is offered only for public read-only endpoints', async ({ page }) => {
    await open(page, '#/atlas?sel=e:ep:GET%20/status');
    await inspector(page).getByRole('tab', { name: /Contract/ }).click();
    await expect(page.getByTestId('live-probe')).toContainText('no credentials sent');
    await open(page, '#/atlas?sel=e:ep:POST%20/api/transfers');
    await inspector(page).getByRole('tab', { name: /Contract/ }).click();
    await expect(page.getByTestId('contract-view')).toBeVisible();
    await expect(page.getByTestId('live-probe')).toHaveCount(0);
  });
});
