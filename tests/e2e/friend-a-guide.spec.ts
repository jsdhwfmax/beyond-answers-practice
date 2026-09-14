import { mkdir } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

test.use({ baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:3000' });
const evidenceDirectory = process.env.E2E_EVIDENCE_DIR || '.local/qa/friend-a-guide';

for (const entry of [{ path: '/', name: 'launch', heading: '可以先在这里练一遍' }, { path: '/?view=home', name: 'home', heading: '今天，想先练哪件事？' }]) {
  test(`${entry.name}: 手机首屏可直接看玩法，键盘打开后返回仍在原入口`, async ({ page }) => {
    const writes: string[] = [];
    await page.route('**/api/**', route => {
      if (route.request().method() !== 'GET') { writes.push(route.request().method()); return route.abort(); }
      return route.continue();
    });
    await page.setViewportSize({ width: 320, height: 640 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(entry.path);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(entry.heading);
    const guide = page.getByRole('link', { name: '第一次来？先看怎么玩', exact: true });
    await expect(guide).toHaveAttribute('href', '/how-it-works');
    const box = await guide.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(640);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    await guide.focus();
    await expect(guide).toBeFocused();
    expect(await guide.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
    await mkdir(evidenceDirectory, { recursive: true });
    await page.screenshot({ path: `${evidenceDirectory}/${entry.name}-320-first-screen.png` });
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/how-it-works$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('这里可以');
    await page.goBack();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(entry.heading);
    await expect(guide).toBeVisible();
    expect(writes).toEqual([]);
  });
}

test('玩法说明用五步区分整理、对话和跳到约定时刻，320px 双倍文字与示范导航可用', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 850 });
  await page.goto('/how-it-works');
  const steps = page.getByRole('region', { name: '用一件事，走过这五步', exact: true });
  await expect(steps.getByRole('listitem')).toHaveCount(5);
  await expect(steps.getByRole('heading', { name: '整理方向：还没有开始聊天', exact: true })).toBeVisible();
  await expect(steps).toContainText('建议只填入草稿');
  await expect(steps).toContainText('设定合适，开始对话');
  await expect(steps).toContainText('系统不会默认替你发言');
  const scene = page.getByRole('region', { name: '“跳到之后的时间或场景”，什么时候用？', exact: true });
  await expect(scene).toContainText('它不是“让 AI 继续说”的按钮');
  await expect(scene).toContainText('明晚 8 点见');
  await expect(scene).toContainText('不代表简历已经改好');
  await page.getByRole('link', { name: '看看具体怎么操作', exact: true }).click();
  await expect(page).toHaveURL(/#steps-title$/);
  expect(await steps.boundingBox()).not.toBeNull();
  await mkdir(evidenceDirectory, { recursive: true });
  await scene.screenshot({ path: `${evidenceDirectory}/how-scene-320.png` });
  await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('h1,h2,h3,p,blockquote,a,small,li>span,li')];
    const sizes = nodes.map(el => getComputedStyle(el).fontSize);
    nodes.forEach((el, i) => { (el as HTMLElement).style.fontSize = `${parseFloat(sizes[i]) * 2}px`; });
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await scene.scrollIntoViewIfNeeded();
  await mkdir(evidenceDirectory, { recursive: true });
  await scene.screenshot({ path: `${evidenceDirectory}/how-scene-320-double-text.png` });
  const demo = page.getByRole('link', { name: '点开一个小示范', exact: true });
  await page.getByRole('link', { name: '看看具体怎么操作', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(demo).toBeFocused();
  expect(await demo.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
  await page.keyboard.press('Enter');
  await expect(page.getByText('90 秒上手 · 预设互动示范')).toBeVisible();
});
