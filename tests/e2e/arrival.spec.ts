import { readFile, mkdir } from 'node:fs/promises';
import { expect, test } from './fixtures';

const evidenceDirectory = process.env.E2E_EVIDENCE_DIR ? `${process.env.E2E_EVIDENCE_DIR}/arrival` : '.local/qa/onboarding-v5';
test.use({ baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:3000' });
test('new visitors see the illustrated launch, can pause questions and navigate back from home', async ({ page }) => {
  await page.goto('/');
  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toContainText('可以先在这里练一遍');
  const wall = page.getByRole('region', { name: '校园里真实出现过的知乎问题' });
  const links = wall.getByRole('link'); expect(await links.count()).toBeGreaterThan(8);
  await expect(links.first()).toHaveAttribute('href', /^https:\/\/www.zhihu.com\/question\/\d+$/);
  await page.getByRole('button', { name: '暂停流动', exact: true }).click();
  await expect(page.getByRole('button', { name: '继续流动' })).toHaveAttribute('aria-pressed', 'true');
  expect(await wall.locator('[class*="track"]').evaluateAll(elements => elements.every(el => getComputedStyle(el).animationPlayState === 'paused'))).toBe(true);
  await expect.poll(() => page.getByRole('img').evaluateAll(elements => elements.every(el => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await mkdir(evidenceDirectory, { recursive: true }); await page.screenshot({ path: `${evidenceDirectory}/launch-desktop.png`, fullPage: true });
  await page.getByRole('link', { name: '进入经验练习场', exact: true }).click();
  await expect(page).toHaveURL(/view=home/); await expect(heading).toHaveText('今天，想先练哪件事？');
  await page.reload(); await expect(heading).toHaveText('今天，想先练哪件事？');
  await page.goBack(); await expect(heading).toContainText('可以先在这里练一遍');
});

test('320px and doubled text keep entry controls usable; reduced motion stops the question lanes', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 850 }); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(await page.locator('[class*="track"]').evaluateAll(elements => elements.every(el => getComputedStyle(el).animationName === 'none'))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${evidenceDirectory}/launch-320.png`, fullPage: true });
  await page.evaluate(() => { const nodes = [...document.querySelectorAll('h1,p,button,a,small')]; const sizes = nodes.map(el => getComputedStyle(el).fontSize); nodes.forEach((el, i) => (el as HTMLElement).style.fontSize = `${parseFloat(sizes[i]) * 2}px`); });
  const enter = page.getByRole('link', { name: '进入经验练习场', exact: true }); await enter.focus(); await expect(enter).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await enter.click(); await expect(page.getByRole('heading', { name: '今天，想先练哪件事？' })).toBeVisible();
});

test('illustrated explanation leads to the labelled demo and readable sources replace raw API pages', async ({ page }) => {
  await page.goto('/how-it-works'); await expect(page.getByRole('heading', { level: 1 })).toContainText('这里可以');
  await expect(page.getByRole('main').getByRole('img')).toHaveCount(2);
  await expect(page.getByRole('region', { name: '用一件事，走过这五步', exact: true }).getByRole('listitem')).toHaveCount(5);
  await page.screenshot({ path: `${evidenceDirectory}/how-desktop.png`, fullPage: true });
  await page.getByRole('link', { name: '点开一个小示范', exact: true }).click();
  await expect(page.getByText('90 秒上手 · 预设互动示范')).toBeVisible();
  await page.goto('/sources/1393937473601368064'); await expect(page.getByRole('heading', { level: 1 })).toContainText('明确目标');
  await expect(page.getByText('官方接口返回的内容存在截断。', { exact: false })).toBeVisible();
  expect(await page.locator('a[href*="api.zhihu.com"]').count()).toBe(0);
});

test('fixed chapter exports readable text with the saved next step and keeps JSON as an explicit secondary export', async ({ page }) => {
  await page.goto('/?view=home'); await page.getByText('也可以体验三个完整章节', { exact: true }).click();
  await page.getByRole('button', { name: '进入职场协商练习', exact: true }).click();
  await page.getByRole('button', { name: '项目资料', exact: true }).click(); await page.getByRole('button', { name: '两项已明确的任务', exact: true }).click();
  await expect(page.getByText('资料已展开在上方。现在可以向对方问一句，或提出自己的安排。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '先练到这里', exact: true }).click();
  const report = page.getByRole('dialog', { name: '把这一次，留给下一次', exact: true }); await expect(report).toBeVisible();
  await report.getByLabel('写给下一次的自己', { exact: false }).fill('明天先向负责人确认摘要用途。');
  const download = page.waitForEvent('download'); await report.getByRole('button', { name: '导出文字记录', exact: true }).click();
  const result = await download; expect(result.suggestedFilename()).toMatch(/\.txt$/); const path = await result.path(); const text = await readFile(path!, 'utf8');
  expect(text).toContain('答案之外｜我的经验练习记录'); expect(text).toContain('明天先向负责人确认摘要用途。'); expect(text).toContain('仍需确认的事');
  await expect(report.getByRole('button', { name: '导出原始数据 JSON', exact: true })).toBeVisible();
});

// With scripts disabled, these actions cannot rely on a hydrated React handler.
test.describe('启动页原生导航', () => {
  test.use({ javaScriptEnabled: false });
  for (const entry of [
    { label: '进入经验练习场', path: '/?view=home', expected: '今天，想先练哪件事？' },
    { label: '先看一个小示范', path: '/?view=demo', expected: '90 秒上手 · 预设互动示范' },
  ]) test(`未加载客户端脚本时，${entry.label}仍能进入对应页面`, async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: 'scope', description: '禁用浏览器JavaScript，验证服务端HTML真实链接原生导航；不调用模型。' });
    await page.goto('/');
    const link = page.getByRole('link', { name: entry.label, exact: true });
    await expect(link).toHaveAttribute('href', entry.path);
    await link.click();
    await expect(page).toHaveURL(new RegExp(entry.path.replace('?', '\\?') + '$'));
    await expect(page.getByText(entry.expected, { exact: true })).toBeVisible();
    await testInfo.attach(`native-${entry.path.includes('home') ? 'home' : 'demo'}-without-js`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  });
});
