import { test, expect } from 'playwright/test';

// Sidebar order is fixed in App.tsx buildNavSections (labels vary per theme,
// positions don't): overview, chat, talk, tasks, goals, orch, editor, skills, plan.
const NAV_ORDER = ['overview', 'chat', 'talk', 'tasks', 'goals', 'orch', 'editor', 'skills', 'plan'];

test.describe('Helm shell smoke', () => {
  test('boots with the default theme and sidebar', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('The Helm — OpenClaw control');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'blizzard');
    await expect(page.locator('#sidebar')).toBeVisible();
    await expect(page.locator('.nav-item')).toHaveCount(NAV_ORDER.length);
  });

  test('theme selector swaps the data-theme token set', async ({ page }) => {
    await page.goto('/');
    const select = page.locator('.topbar-theme-select');
    await select.selectOption('assay');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'assay');
    await select.selectOption('politburo');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'politburo');
    await select.selectOption('blizzard');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'blizzard');
  });

  test('sidebar navigation routes between screens', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#screen-overview')).toBeVisible();
    for (const id of ['tasks', 'goals', 'editor', 'plan']) {
      await page.locator('.nav-item').nth(NAV_ORDER.indexOf(id)).click();
      await expect(page.locator(`#screen-${id}`), `screen-${id} after nav click`).toBeVisible();
    }
    // and back to overview
    await page.locator('.nav-item').nth(0).click();
    await expect(page.locator('#screen-overview')).toBeVisible();
  });

  test('screens render their disconnected states without a token', async ({ page }) => {
    await page.goto('/');
    await page.locator('.nav-item').nth(NAV_ORDER.indexOf('editor')).click();
    // Editor's tree pane reports connection state instead of crashing.
    await expect(page.locator('.editor-tree')).toContainText(/Connecting…|Not connected|Agent/);
  });
});
