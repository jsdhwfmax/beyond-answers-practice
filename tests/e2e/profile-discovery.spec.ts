import { expect, test, type Page } from './fixtures';
import { mkdir } from 'node:fs/promises';
import type { Route } from '@playwright/test';
import type { CampusCorpusQuestion } from '../../src/content/campus-corpus';
import type { CampusDiscoveryResult, CampusProfileFilters } from '../../src/domain/campus-profile-options';

test.use({ baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:3000' });

// These profiles and replies are explicitly synthetic browser contract fixtures.
// The server's strict same-context matching has separate domain/service tests.
const question: CampusCorpusQuestion = {
  id: 'zhihu-q-123456789', questionId: '123456789', title: '普通本科的新生，怎样适应大学学习？', questionUrl: 'https://www.zhihu.com/question/123456789', category: '合作学习', tags: ['新生', '本科'],
  answers: [{ answerId: '987654321', url: 'https://www.zhihu.com/question/123456789/answer/987654321', author: '浏览器测试作者', voteCount: 428, fetchedAt: '2026-09-14T00:00:00.000Z', excerpt: '浏览器测试摘要：普通本科的新生可以先了解课程要求，再向同学询问如何安排一周的学习。', summaryKind: 'search_excerpt', sourceContentId: 'browser-fixture', searchHashId: 'browser-fixture', viewpoints: ['先弄清具体要求，再商量自己的学习安排。', '向同学请教一个可以着手的小方法。'] }],
  scenarioSeed: { userRole: '刚入学的本科生', counterpartRole: '同专业学姐', situation: '刚开始大学课程，想了解怎样安排学习。', goal: '向学姐说清自己的困惑，并获得一个具体建议。' },
};
const filterValues = { education: 'bachelor', schoolTier: 'ordinary_undergraduate', stage: 'entering' } as const;
function filtersFrom(url: URL): CampusProfileFilters {
  return Object.fromEntries(['education', 'schoolTier', 'stage'].flatMap(key => url.searchParams.get(key) ? [[key, url.searchParams.get(key)]] : [])) as CampusProfileFilters;
}
function resultFor(url: URL, total = 17): CampusDiscoveryResult {
  const filters = filtersFrom(url); const offset = Number(url.searchParams.get('offset') ?? 0);
  const evidence = [
    ...(filters.education ? [{ dimension: 'education' as const, label: '本科', source: 'question' as const, quote: question.title, matchLabel: '原题的新生求助情境' }] : []),
    ...(filters.schoolTier ? [{ dimension: 'schoolTier' as const, label: '普通本科', source: 'answer_excerpt' as const, quote: question.answers[0].excerpt, answerId: question.answers[0].answerId, matchLabel: '原题的新生求助情境' }] : []),
    ...(filters.stage ? [{ dimension: 'stage' as const, label: '入学适应', source: 'question' as const, quote: question.title, matchLabel: '原题的新生求助情境' }] : []),
  ];
  return { version: 'browser-profile-fixture-v1', filters, total, offset, limit: 8, matches: total ? [{ question: { ...question, title: offset ? `第二页：${question.title}` : question.title }, evidence, contextLabel: '匹配的是题目中的新生求助情境，不是作者身份。' }] : [] };
}
// Existing cases count explicit full-question searches, not the new lightweight preview.
async function serveCountPreview(route: Route): Promise<boolean> {
  const url = new URL(route.request().url());
  if (!url.searchParams.has('preview')) return false;
  await route.fulfill({ json: { kind: 'count_preview', version: 'browser-profile-fixture-v1', filters: filtersFrom(url), total: 17, relaxations: [] } });
  return true;
}
async function preventModelWrites(page: Page) {
  const writes: string[] = [];
  await page.route('**/api/practice-intake', async route => { writes.push(route.request().url()); await route.fulfill({ status: 503, json: { error: { message: '此浏览器验收不请求模型。' } } }); });
  await page.route('**/api/custom-practices', async route => { if (route.request().method() !== 'GET') writes.push(route.request().url()); await route.fulfill({ json: { sessions: [], available: true } }); });
  return writes;
}
async function chooseAll(page: Page) {
  await page.getByRole('combobox', { name: '学历', exact: true }).selectOption(filterValues.education);
  await page.getByRole('combobox', { name: '院校类型', exact: true }).selectOption(filterValues.schoolTier);
  await page.getByRole('combobox', { name: '当前阶段', exact: true }).selectOption(filterValues.stage);
}

test('[发现页联动] 切换学历只保留适用院校，清除冲突时播报且不自动查询', async ({ page }) => {
  const requests: string[] = [];
  await page.route('**/api/discover?*', async route => { if (await serveCountPreview(route)) return; requests.push(route.request().url()); await route.fulfill({ json: resultFor(new URL(route.request().url()), 0) }); });
  await page.goto('/discover');
  const education = page.getByRole('combobox', { name: '学历', exact: true });
  const school = page.getByRole('combobox', { name: '院校类型', exact: true });
  const stage = page.getByRole('combobox', { name: '当前阶段', exact: true });
  await expect(school.locator('option')).toHaveText(['不限', '985', '211', '双一流', '普通院校 / 双非', '高职 / 专科院校']);
  await school.selectOption('985'); await stage.selectOption('internship_job_search');
  await education.selectOption('junior_college');
  await expect(school).toHaveValue(''); await expect(school.locator('option')).toHaveText(['不限', '高职 / 专科院校']);
  await expect(page.getByRole('status')).toContainText('已选择专科，已清除不适用的“985”院校类型');
  await expect(stage).toHaveValue('internship_job_search');
  await expect(education).toHaveAccessibleDescription(/同一就读阶段|专科阶段/);
  expect(requests).toHaveLength(0);
  await school.selectOption('vocational_college'); await education.selectOption('master');
  await expect(school).toHaveValue(''); await expect(page.getByRole('status')).toContainText('已选择硕士，已清除不适用的“高职 / 专科院校”院校类型');
  for (const value of ['bachelor', 'master', 'doctor']) {
    await education.selectOption(value);
    await expect(school.locator('option')).toHaveText(['不限', '985', '211', '双一流', '普通院校 / 双非']);
  }
  await school.selectOption('211'); await education.selectOption('bachelor'); await expect(school).toHaveValue('211');
  await education.selectOption(''); await expect(school).toHaveValue('211'); await expect(school.locator('option')).toHaveCount(6);
  expect(requests).toHaveLength(0);
});

for (const prior of [
  { education: 'junior_college', schoolTier: '985', stage: 'internship_job_search' },
  { education: 'junior_college', schoolTier: '211', stage: 'studying' },
  { education: 'master', schoolTier: 'vocational_college', stage: 'graduation_further_study' },
]) test(`[发现页联动] 旧本机冲突 ${prior.education}/${prior.schoolTier} 恢复为兼容选择并写回`, async ({ page }) => {
  const requests: URL[] = [];
  await page.goto('/discover');
  await expect(page.getByRole('combobox', { name: '学历', exact: true })).toBeEnabled();
  await page.evaluate(saved => localStorage.setItem('practice-discovery-filters:v1', JSON.stringify({ version: 1, filters: saved })), prior);
  await page.route('**/api/discover?*', async route => { if (await serveCountPreview(route)) return; const url = new URL(route.request().url()); requests.push(url); await route.fulfill({ json: resultFor(url, 0) }); });
  await page.reload();
  await expect(page.getByRole('combobox', { name: '学历', exact: true })).toHaveValue(prior.education);
  await expect(page.getByRole('combobox', { name: '院校类型', exact: true })).toHaveValue('');
  await expect(page.getByRole('combobox', { name: '当前阶段', exact: true })).toHaveValue(prior.stage);
  await expect(page.getByRole('status')).toContainText('已清除不适用');
  const expected = { education: prior.education, stage: prior.stage };
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('practice-discovery-filters:v1')!))).toEqual({ version: 1, filters: expected });
  expect(requests).toHaveLength(0);
  await page.getByRole('button', { name: '查找相近的问题', exact: true }).click();
  await expect(page.getByRole('heading', { name: '找到 0 个相近问题' })).toBeVisible();
  expect(filtersFrom(requests[0])).toEqual(expected);
  await page.reload(); await expect(page.getByRole('status')).toHaveText('已恢复这个浏览器的选择，点击查找即可。');
  await expect(page.getByRole('combobox', { name: '院校类型', exact: true })).toHaveValue(''); expect(requests).toHaveLength(1);
});

test('[发现页联动真实接口] 冲突筛选返回明确400，兼容专科筛选保留完整条件', async ({ request }) => {
  const conflict = await request.get('/api/discover?education=junior_college&schoolTier=985&stage=studying');
  expect(conflict.status()).toBe(400);
  expect(await conflict.json()).toMatchObject({ error: { code: 'INCOMPATIBLE_FILTERS', message: expect.stringContaining('同一就读阶段') } });
  const valid = await request.get('/api/discover?education=junior_college&schoolTier=vocational_college&stage=studying');
  expect(valid.ok()).toBe(true);
  expect(await valid.json()).toMatchObject({ filters: { education: 'junior_college', schoolTier: 'vocational_college', stage: 'studying' } });
});

test('[发现页 mock] 三项选填显式提交，完整条件请求，原文依据与阅读练习入口可查', async ({ page }, testInfo) => {
  const requests: URL[] = []; const writes = await preventModelWrites(page);
  await page.route('**/api/discover?*', async route => { if (await serveCountPreview(route)) return; const url = new URL(route.request().url()); requests.push(url); await route.fulfill({ json: resultFor(url) }); });
  await page.goto('/discover'); await expect(page.getByRole('heading', { name: '找到和你处境相近的问题' })).toBeVisible();
  for (const label of ['学历', '院校类型', '当前阶段']) await expect(page.getByRole('combobox', { name: label, exact: true })).toHaveValue('');
  await chooseAll(page); expect(requests).toHaveLength(0); expect(writes).toEqual([]); expect(new URL(page.url()).search).toBe('');
  await page.getByRole('button', { name: '查找相近的问题', exact: true }).click();
  await expect(page.getByRole('heading', { name: '找到 17 个相近问题' })).toBeVisible();
  expect(filtersFrom(requests[0])).toEqual(filterValues); expect(requests[0].searchParams.get('limit')).toBe('8');
  const card = page.locator(`[data-discovery-question="${question.id}"]`); await expect(card.getByRole('region', { name: '匹配依据' })).toContainText('原题提到'); await expect(card.getByRole('region', { name: '匹配依据' })).toContainText('回答摘要提到');
  const evidence = card.getByRole('region', { name: '匹配依据' });
  await expect(evidence.locator('q')).toHaveCount(2);
  await expect(evidence.locator('q').filter({ hasText: question.title })).toHaveCount(1);
  await expect(evidence.getByText('本科 · 入学适应', { exact: true })).toBeVisible();
  await expect(card).toContainText('428 赞同 · 截至 2026-09-14'); await expect(card).toContainText('浏览器测试作者');
  await expect(card.getByRole('link', { name: '读知乎原回答' })).toHaveAttribute('href', question.answers[0].url);
  await expect(card.getByRole('link', { name: '从这题开始练习' })).toHaveAttribute('href', `/?mode=custom&intent=new&sourceQuestionId=${question.id}`);
  await card.getByText('在这里核对摘要与出处', { exact: true }).click(); await expect(card.getByRole('heading', { name: '已取得的知乎摘要节选' })).toBeVisible(); await expect(card).toContainText('原摘要预览'); await expect(card).not.toContainText('团队提炼'); await expect(card.locator('blockquote').last()).toHaveText(question.answers[0].excerpt);
  expect(writes).toEqual([]);
  await testInfo.attach('profile-matched-evidence-mock', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
});

test('[发现页 mock] 相同文字只有同来源及同回答才合并', async ({ page }) => {
  const sharedQuote = '同一段文字，分别保留原题与不同回答的出处。';
  await page.route('**/api/discover?*', async route => { if (await serveCountPreview(route)) return;
    const result = resultFor(new URL(route.request().url()), 1);
    result.matches[0].evidence = [
      { dimension: 'education', label: '本科', source: 'question', quote: sharedQuote, matchLabel: '测试情境' },
      { dimension: 'schoolTier', label: '985', source: 'answer_excerpt', quote: sharedQuote, answerId: 'answer-one', matchLabel: '测试情境' },
      { dimension: 'stage', label: '在读学习', source: 'answer_excerpt', quote: sharedQuote, answerId: 'answer-two', matchLabel: '测试情境' },
    ];
    await route.fulfill({ json: result });
  });
  await page.goto('/discover'); await chooseAll(page); await page.getByRole('button', { name: '查找相近的问题', exact: true }).click();
  const evidence = page.getByRole('region', { name: '匹配依据' });
  await expect(evidence.locator('q')).toHaveCount(3);
  await expect(evidence.locator('li')).toHaveCount(3);
});

test('[发现页真实题库] 本科985在读的同一依据只显示一次并保留三个标签', async ({ page }, testInfo) => {
  const writes = await preventModelWrites(page);
  await page.goto('/discover');
  await page.getByRole('combobox', { name: '学历', exact: true }).selectOption('bachelor');
  await page.getByRole('combobox', { name: '院校类型', exact: true }).selectOption('985');
  await page.getByRole('combobox', { name: '当前阶段', exact: true }).selectOption('studying');
  const pendingResult = page.waitForResponse(response => new URL(response.url()).pathname === '/api/discover' && response.request().method() === 'GET');
  await page.getByRole('button', { name: '查找相近的问题', exact: true }).click();
  const response = await pendingResult; expect(response.ok()).toBe(true);
  const result = await response.json() as CampusDiscoveryResult;
  expect(result.filters).toEqual({ education: 'bachelor', schoolTier: '985', stage: 'studying' });
  const repeated = result.matches.find(match => match.evidence.length === 3 && match.evidence.every(item => item.source === match.evidence[0].source && item.answerId === match.evidence[0].answerId && item.quote === match.evidence[0].quote));
  expect(repeated, '真实题库应包含同一原文支持三个维度的情境').toBeDefined();
  const card = page.locator(`[data-discovery-question="${repeated!.question.id}"]`);
  const evidence = card.getByRole('region', { name: '匹配依据' });
  await expect(evidence.locator('q')).toHaveCount(1);
  await expect(evidence.locator('q')).toHaveText(repeated!.evidence[0].quote);
  await expect(evidence.getByText('本科 · 985 · 在读学习', { exact: true })).toBeVisible();
  expect(writes).toEqual([]);
  if (process.env.E2E_BASE_URL === 'https://practice.wredamancy.com') {
    await mkdir('.local/qa/profile-v4', { recursive: true });
    await page.screenshot({ path: '.local/qa/profile-v4/production-profile.png', fullPage: true });
  }
  await testInfo.attach('profile-discovery-grouped-real-evidence', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
});

test('[发现页 mock] 没有结果不放宽条件，修改和清除均不自动发起查询', async ({ page }) => {
  const requests: URL[] = [];
  await page.route('**/api/discover?*', async route => { if (await serveCountPreview(route)) return; const url = new URL(route.request().url()); requests.push(url); await route.fulfill({ json: resultFor(url, 0) }); });
  await page.goto('/discover'); await chooseAll(page); await page.getByRole('button', { name: '查找相近的问题', exact: true }).click();
  await expect(page.getByRole('heading', { name: '找到 0 个相近问题' })).toBeVisible(); await expect(page.getByText(/当前资料里，暂时没有同时满足这些条件/)).toBeVisible(); expect(requests).toHaveLength(1); expect(filtersFrom(requests[0])).toEqual(filterValues);
  await page.getByRole('combobox', { name: '学历', exact: true }).selectOption('master'); await expect(page.getByText(/筛选已修改。下方仍是上一次的结果/)).toBeVisible(); expect(requests).toHaveLength(1);
  await page.getByRole('button', { name: '清除选择', exact: true }).click(); for (const label of ['学历', '院校类型', '当前阶段']) await expect(page.getByRole('combobox', { name: label, exact: true })).toHaveValue('');
  expect(await page.evaluate(() => localStorage.getItem('practice-discovery-filters:v1'))).toBeNull(); expect(requests).toHaveLength(1); await expect(page.locator('[data-discovery-question]')).toHaveCount(0);
});

test('[发现页 mock] 本机选择可恢复，旧非法枚举丢弃，分页只使用已经提交的条件', async ({ page }) => {
  const requests: URL[] = [];
  await page.addInitScript(() => localStorage.setItem('practice-discovery-filters:v1', JSON.stringify({ version: 1, filters: { education: 'bachelor', schoolTier: '211_non985', stage: 'entering' } })));
  await page.route('**/api/discover?*', async route => { if (await serveCountPreview(route)) return; const url = new URL(route.request().url()); requests.push(url); await route.fulfill({ json: resultFor(url) }); });
  await page.goto('/discover'); await expect(page.getByRole('combobox', { name: '学历', exact: true })).toHaveValue('bachelor'); await expect(page.getByRole('combobox', { name: '院校类型', exact: true })).toHaveValue(''); await expect(page.getByRole('combobox', { name: '当前阶段', exact: true })).toHaveValue('entering'); expect(requests).toHaveLength(0);
  await page.getByRole('button', { name: '查找相近的问题', exact: true }).click(); await expect(page.getByRole('heading', { name: '找到 17 个相近问题' })).toBeVisible();
  await page.getByRole('button', { name: '下一页', exact: true }).click(); await expect(page.getByText('第 2 / 3 页', { exact: true })).toBeVisible(); expect(requests[1].searchParams.get('offset')).toBe('8'); expect(filtersFrom(requests[1])).toEqual({ education: 'bachelor', stage: 'entering' });
  await page.getByRole('combobox', { name: '学历', exact: true }).selectOption('doctor'); await expect(page.getByRole('button', { name: '下一页', exact: true })).toBeDisabled(); await expect(page.getByText('本次同时筛选：本科 ／ 入学适应')).toBeVisible(); expect(requests).toHaveLength(2);
});

test('[发现页 mock] 清除选择取消在途结果，晚到响应不能重新显示旧匹配', async ({ page }) => {
  let release!: () => void; const waiting = new Promise<void>(resolve => { release = resolve; }); let requested = false;
  await page.route('**/api/discover?*', async route => { if (await serveCountPreview(route)) return; const url = new URL(route.request().url()); requested = true; await waiting; await route.fulfill({ json: resultFor(url) }).catch(() => undefined); });
  await page.goto('/discover'); await chooseAll(page); await page.getByRole('button', { name: '查找相近的问题', exact: true }).click(); await expect.poll(() => requested).toBe(true);
  await page.getByRole('button', { name: '清除选择', exact: true }).click(); release();
  await expect(page.getByText('已清除选择。可以重新挑选，也可以不限条件查找。', { exact: true })).toBeVisible(); await expect(page.locator('[data-discovery-question]')).toHaveCount(0); await expect(page.getByRole('button', { name: '查找相近的问题', exact: true })).toBeEnabled();
});

test('[发现页 mock] 请求失败保留三项选择，重试仍提交相同条件', async ({ page }) => {
  const requests: URL[] = [];
  await page.route('**/api/discover?*', async route => { if (await serveCountPreview(route)) return; const url = new URL(route.request().url()); requests.push(url); await route.fulfill(requests.length === 1 ? { status: 503, json: { error: { message: '测试边界：题库暂未就绪。' } } } : { json: resultFor(url) }); });
  await page.goto('/discover'); await chooseAll(page); await page.getByRole('button', { name: '查找相近的问题', exact: true }).click(); await expect(page.getByRole('alert').filter({ hasText: '测试边界' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: '学历', exact: true })).toHaveValue('bachelor'); await expect(page.getByRole('combobox', { name: '院校类型', exact: true })).toHaveValue('ordinary_undergraduate'); await expect(page.getByRole('combobox', { name: '当前阶段', exact: true })).toHaveValue('entering');
  await page.getByRole('button', { name: '重新查找', exact: true }).click(); await expect(page.getByRole('heading', { name: '找到 17 个相近问题' })).toBeVisible(); expect(filtersFrom(requests[1])).toEqual(filterValues);
});

test('[发现页 mock] 精确题目链接只填草稿，修改后刷新保留，不自动请求模型', async ({ page }) => {
  const writes = await preventModelWrites(page); const ids: string[] = [];
  await page.route('**/api/discover?*', async route => { if (await serveCountPreview(route)) return; const url = new URL(route.request().url()); await route.fulfill({ json: resultFor(url, 1) }); });
  await page.route('**/api/campus-library/*', async route => { ids.push(new URL(route.request().url()).pathname.split('/').at(-1)!); await route.fulfill({ json: { question } }); });
  await page.goto('/discover'); await page.getByRole('button', { name: '查找相近的问题', exact: true }).click(); await page.getByRole('link', { name: '从这题开始练习', exact: true }).click();
  const draft = page.getByLabel('我想练习……', { exact: true }); await expect(draft).toHaveValue(/刚入学的本科生/); await expect(page.getByRole('link', { name: question.title, exact: true })).toHaveAttribute('href', question.questionUrl);
  await draft.fill('我想先向同专业学姐请教选课，不是原来的学习安排。'); await page.reload(); await expect(draft).toHaveValue('我想先向同专业学姐请教选课，不是原来的学习安排。'); expect(writes).toEqual([]); expect(ids.every(id => id === question.id)).toBe(true);
});

test('[发现页 mock] 320px与200%文字下条件、长出处和操作不横向溢出，键盘焦点可见', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 850 });
  await page.route('**/api/discover?*', async route => { if (await serveCountPreview(route)) return; const url = new URL(route.request().url()); const result = resultFor(url, 1); result.matches[0].question = { ...question, title: question.title.repeat(5), answers: [{ ...question.answers[0], author: '很长的作者昵称'.repeat(9) }] }; await route.fulfill({ json: result }); });
  await page.goto('/discover'); await chooseAll(page); const submit = page.getByRole('button', { name: '查找相近的问题', exact: true }); await submit.focus(); await page.keyboard.press('Enter'); await expect(page.getByRole('heading', { name: '找到 1 个相近问题' })).toBeFocused();
  await page.getByText('在这里核对摘要与出处', { exact: true }).click();
  await page.evaluate(() => { for (const element of document.querySelectorAll<HTMLElement>('main *')) { if (element.children.length === 0 || element.matches('button,label,summary,input,select')) element.style.fontSize = `${parseFloat(getComputedStyle(element).fontSize) * 2}px`; } });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(321);
  const practice = page.getByRole('link', { name: '从这题开始练习' }); await practice.focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab'); await expect(practice).toBeFocused(); expect(await practice.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe('none');
  await testInfo.attach('profile-discovery-320-double-text-mock', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
});

