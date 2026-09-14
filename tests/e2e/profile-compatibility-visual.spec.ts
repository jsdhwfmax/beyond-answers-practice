import { expect, test } from './fixtures';
import { mkdir } from 'node:fs/promises';

test.use({ baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:3000' });

test('[发现页联动真实页面] 插画在桌面和320px完整加载，专科选项与键盘焦点可见', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/discover');
  const image = page.getByRole('img', { name: '四位同学在校园的共享书架旁交流，身后小路通往不同的学习空间' });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
  await page.getByRole('combobox', { name: '学历', exact: true }).selectOption('junior_college');
  const school = page.getByRole('combobox', { name: '院校类型', exact: true });
  await expect(school.locator('option')).toHaveText(['不限', '高职 / 专科院校']);
  const screenshotRoot = process.env.E2E_EVIDENCE_DIR || (process.env.E2E_BASE_URL?.startsWith('https:') ? '.local/qa/profile-v5/production' : '.local/qa/profile-v5/local');
  await mkdir(screenshotRoot, { recursive: true });
  await page.screenshot({ path: `${screenshotRoot}/discover-junior-college-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 320, height: 850 });
  await school.focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect(school).toHaveValue('vocational_college');
  await expect(school).toBeFocused();
  await expect(school).toHaveAccessibleDescription(/专科阶段/);
  expect(await school.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe('none');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.screenshot({ path: `${screenshotRoot}/discover-junior-college-320.png`, fullPage: true });
  await testInfo.attach('discover-compatible-college-320', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
});
