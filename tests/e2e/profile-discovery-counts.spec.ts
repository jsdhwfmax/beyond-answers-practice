import { expect, test, type Page } from './fixtures';
import type { Route } from '@playwright/test';
import type { CampusDiscoveryPreview, CampusProfileFilters } from '../../src/domain/campus-profile-options';

test.use({ baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:3000' });
const selected = { education: 'doctor', schoolTier: '985', stage: 'entering' } as const;
const getFilters = (url: URL): CampusProfileFilters => Object.fromEntries(['education', 'schoolTier', 'stage'].flatMap(key => url.searchParams.get(key) ? [[key, url.searchParams.get(key)]] : [])) as CampusProfileFilters;
const countFor = (filters: CampusProfileFilters) => filters.education === 'doctor' && filters.schoolTier === '985' ? 0 : filters.education === 'doctor' ? 4 : 6;
function previewFor(url: URL, version = 'count-fixture-v1'): CampusDiscoveryPreview {
  const filters = getFilters(url); const total = countFor(filters); const relaxed = { ...filters }; delete relaxed.schoolTier;
  return { kind: 'count_preview', version, filters, total, relaxations: total ? [] : [{ removedFields: ['schoolTier'], filters: relaxed, total: 4 }] };
}
function resultFor(url: URL, version = 'count-fixture-v1') {
  const filters = getFilters(url); const total = countFor(filters);
  return { version, filters, total, offset: Number(url.searchParams.get('offset') || 0), limit: 8, matches: total ? [{ evidence: [], question: {
    id: 'zhihu-q-123456789', questionId: '123456789', title: '合成验收题：如何适应新阶段？', questionUrl: 'https://www.zhihu.com/question/123456789', category: '合成验收', tags: [],
    answers: [{ answerId: '987654321', author: '测试作者', url: 'https://www.zhihu.com/question/123456789/answer/987654321', voteCount: 1, fetchedAt: '2026-09-14', excerpt: '仅用于浏览器契约测试的摘要。', viewpoints: ['测试归纳。'] }],
  } }] : [] };
}
async function choose(page: Page) {
  await page.getByRole('combobox', { name: '学历', exact: true }).selectOption(selected.education);
  await page.getByRole('combobox', { name: '院校类型', exact: true }).selectOption(selected.schoolTier);
  await page.getByRole('combobox', { name: '当前阶段', exact: true }).selectOption(selected.stage);
}
async function fixture(page: Page, handler?: (route: Route, url: URL) => Promise<boolean>) {
  const full: URL[] = []; const previews: URL[] = [];
  await page.route('**/api/discover?*', async route => {
    const url = new URL(route.request().url()); (url.searchParams.has('preview') ? previews : full).push(url);
    if (await handler?.(route, url)) return;
    await route.fulfill({ json: url.searchParams.has('preview') ? previewFor(url) : resultFor(url) });
  });
  return { full, previews };
}

test('[计数 mock] 零结果先给明确放宽，条件不自动改变；窄屏键盘应用并可恢复原条件', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 850 });
  const requests = await fixture(page); await page.goto('/discover'); await choose(page);
  const preview = page.getByRole('region', { name: '当前筛选预览', exact: true });
  await expect(preview).toContainText('当前条件暂时没有相近问题');
  expect(requests.full).toHaveLength(0);
  await expect(page.getByRole('combobox', { name: '院校类型', exact: true })).toHaveValue('985');
  const broaden = preview.getByRole('button', { name: '放宽院校类型，可看 4 题', exact: true });
  await broaden.focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
  await expect(broaden).toBeFocused(); expect(await broaden.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe('none');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '找到 4 个相近问题' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: '学历', exact: true })).toHaveValue('doctor');
  await expect(page.getByRole('combobox', { name: '院校类型', exact: true })).toHaveValue('');
  await expect(page.getByRole('combobox', { name: '当前阶段', exact: true })).toHaveValue('entering');
  await expect(page.getByRole('status')).toContainText('已将院校类型设为不限，其余条件保留');
  expect(getFilters(requests.full[0])).toEqual({ education: 'doctor', stage: 'entering' });
  await expect(page.getByRole('link', { name: '从这题开始练习', exact: true })).toHaveAttribute('href', '/?mode=custom&intent=new&sourceQuestionId=zhihu-q-123456789');
  await expect(page.getByRole('link', { name: '读知乎原回答', exact: true })).toHaveAttribute('href', 'https://www.zhihu.com/question/123456789/answer/987654321');
  await preview.getByRole('button', { name: '恢复放宽前的条件', exact: true }).click();
  await expect(preview).toContainText('当前条件暂时没有相近问题');
  expect(requests.full).toHaveLength(1);
  await expect(page.getByRole('combobox', { name: '院校类型', exact: true })).toHaveValue('985');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('practice-discovery-filters:v1')!).filters)).toEqual(selected);
  await page.reload(); await expect(preview).toContainText('当前条件暂时没有相近问题');
  await page.evaluate(() => { for (const element of document.querySelectorAll<HTMLElement>('main *')) if (element.children.length === 0 || element.matches('button,label,select')) element.style.fontSize = `${parseFloat(getComputedStyle(element).fontSize) * 2}px`; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await testInfo.attach('count-preview-zero-320-double-text', { body: await page.getByRole('form', { name: '按处境筛选' }).screenshot(), contentType: 'image/png' });
});

test('[计数 mock] 旧条件的预览晚到不会覆盖新计数或重新展示旧放宽按钮', async ({ page }) => {
  let release!: () => void; const waiting = new Promise<void>(resolve => { release = resolve; }); let delayed = false;
  await fixture(page, async (route, url) => {
    if (url.searchParams.has('preview') && url.searchParams.get('education') === 'doctor' && url.searchParams.get('schoolTier') === '985') {
      delayed = true; await waiting; await route.fulfill({ json: previewFor(url) }).catch(() => undefined); return true;
    }
    return false;
  });
  await page.goto('/discover'); await choose(page); await expect.poll(() => delayed).toBe(true);
  await page.getByRole('combobox', { name: '学历', exact: true }).selectOption('bachelor');
  const preview = page.getByRole('region', { name: '当前筛选预览' }); await expect(preview).toContainText('当前条件有 6 个问题');
  release();
  await expect(preview).toContainText('当前条件有 6 个问题'); await expect(preview.getByRole('button', { name: /放宽/ })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: '学历', exact: true })).toHaveValue('bachelor');
});

test('[计数 mock] 发布版本变化先清理旧数量并重新核对，未混用旧计数和新题目', async ({ page }) => {
  let version = 'count-fixture-v1'; const requests = await fixture(page, async (route, url) => {
    if (url.searchParams.has('preview')) await route.fulfill({ json: previewFor(url, version) });
    else if (url.searchParams.get('expectedSourceVersion') === 'count-fixture-v1') {
      version = 'count-fixture-v2'; await route.fulfill({ status: 409, json: { error: { code: 'SOURCE_VERSION_CHANGED' } } });
    } else await route.fulfill({ json: resultFor(url, version) });
    return true;
  });
  await page.goto('/discover'); const preview = page.getByRole('region', { name: '当前筛选预览' });
  await expect(preview).toHaveAttribute('data-preview-version', 'count-fixture-v1');
  await page.getByRole('button', { name: '查找相近的问题', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '题库已更新' })).toBeVisible(); await expect(page.locator('[data-discovery-question]')).toHaveCount(0);
  await expect(preview).toHaveAttribute('data-preview-version', 'count-fixture-v2');
  await page.getByRole('button', { name: '查找相近的问题', exact: true }).click();
  await expect(page.getByRole('heading', { name: '可浏览 6 个问题' })).toBeVisible();
  expect(requests.full.map(url => url.searchParams.get('expectedSourceVersion'))).toEqual(['count-fixture-v1', 'count-fixture-v2']);
});

test('[计数 mock] 不接受偷偷改另一个条件的放宽响应，仍可按原条件查找', async ({ page }) => {
  const requests = await fixture(page, async (route, url) => {
    if (!url.searchParams.has('preview')) return false;
    const preview = previewFor(url);
    if (preview.relaxations.length) preview.relaxations[0].filters.education = 'bachelor';
    await route.fulfill({ json: preview }); return true;
  });
  await page.goto('/discover'); await choose(page);
  const preview = page.getByRole('region', { name: '当前筛选预览' });
  await expect(preview).toContainText('放宽建议与当前选择不符'); await expect(preview.getByRole('button', { name: /放宽.*题/ })).toHaveCount(0);
  await page.getByRole('button', { name: '查找相近的问题', exact: true }).click();
  await expect(page.getByRole('heading', { name: '找到 0 个相近问题' })).toBeVisible(); expect(getFilters(requests.full[0])).toEqual(selected);
});

test('[计数 mock] 未等预览直接查找时，晚到的旧版题目不能覆盖已核对的新版本', async ({ page }) => {
  let release!: () => void; const waiting = new Promise<void>(resolve => { release = resolve; }); let fullStarted = false;
  let allowPreview!: () => void; const afterSearch = new Promise<void>(resolve => { allowPreview = resolve; });
  const requests = await fixture(page, async (route, url) => {
    if (url.searchParams.has('preview')) { await afterSearch; await route.fulfill({ json: previewFor(url, 'count-fixture-v2') }); }
    else { fullStarted = true; allowPreview(); await waiting; await route.fulfill({ json: resultFor(url, 'count-fixture-v1') }).catch(() => undefined); }
    return true;
  });
  await page.goto('/discover');
  // A click before the debounce expires is still allowed; the eventual response must agree.
  await page.getByRole('button', { name: '查找相近的问题', exact: true }).click();
  await expect.poll(() => fullStarted).toBe(true);
  expect(requests.full[0].searchParams.has('expectedSourceVersion')).toBe(false);
  await expect(page.getByRole('region', { name: '当前筛选预览' })).toHaveAttribute('data-preview-version', 'count-fixture-v2');
  release();
  await expect(page.getByRole('alert').filter({ hasText: '来源版本不同' })).toBeVisible();
  await expect(page.locator('[data-discovery-question]')).toHaveCount(0);
  await expect(page.getByRole('region', { name: '当前筛选预览' })).toHaveAttribute('data-preview-version', 'count-fixture-v2');
});
