import { mkdir } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';

test.use({ baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:3000' });
const evidenceDirectory = process.env.E2E_EVIDENCE_DIR || '.local/qa/scene-guide-v10/readonly-local';

async function readOnlyApi(page: Page) {
  const writes: string[] = [];
  await page.route('**/api/**', route => {
    if (route.request().method() !== 'GET') { writes.push(route.request().method()); return route.abort(); }
    return route.continue();
  });
  return writes;
}

test('[只读页面] 玩法说明明确场景提示后由用户先开口，未谈妥事项保持待定', async ({ page }) => {
  const writes = await readOnlyApi(page);
  await page.setViewportSize({ width: 360, height: 850 });
  await page.goto('/how-it-works');
  const guide = page.getByRole('region', { name: '“跳到之后的时间或场景”，什么时候用？', exact: true });
  await expect(guide).toContainText('切换后先显示场景提示，由你开口后，对方才会回应');
  await expect(guide).toContainText('没有谈妥的事仍然待定');
  await expect(guide).toContainText('不会替你同意、回应或完成任务');
  await mkdir(evidenceDirectory, { recursive: true });
  await guide.screenshot({ path: `${evidenceDirectory}/how-scene-guide-360.png` });
  expect(writes).toEqual([]);
});

test('[只读页面] 手机新练习入口仍可见说明与自己的描述框', async ({ page }) => {
  const writes = await readOnlyApi(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/?mode=custom&intent=new');
  const help = page.getByRole('link', { name: /第一次来？先看怎么玩/ });
  await expect(help).toBeVisible();
  await expect(help).toHaveAttribute('href', '/how-it-works');
  const box = await help.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(800);
  await expect(page.getByRole('heading', { name: '有句话，想先练着说？', exact: true })).toBeVisible();
  await expect(page.getByLabel('我想练习……', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await mkdir(evidenceDirectory, { recursive: true });
  await page.screenshot({ path: `${evidenceDirectory}/custom-entry-320.png` });
  expect(writes).toEqual([]);
});
