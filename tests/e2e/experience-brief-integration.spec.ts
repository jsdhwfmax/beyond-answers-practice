import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { test, expect, type Page, type TestInfo } from './fixtures';
import type { CampusCorpusQuestion } from '../../src/content/campus-corpus';
import { activeCustomBranch, type CustomAction, type CustomPracticeView } from '../../src/domain/custom-practice';

test.use({ baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:3000' });
const evidenceDirectory = process.env.E2E_EVIDENCE_DIR ? `${process.env.E2E_EVIDENCE_DIR}/experience-brief` : 'docs/verification/friend-d-v14/integrated-ui';
const CAMPUS_CORPUS = JSON.parse(readFileSync('src/content/campus-corpus-data.json', 'utf8')) as CampusCorpusQuestion[];
const reviewed = CAMPUS_CORPUS.find(item => item.id === 'zhihu-q-40645474')!;
const excerptOnly = CAMPUS_CORPUS.find(item => item.id === 'zhihu-q-19931588')!;
const summary = '遇到学习困惑时，可以主动向有相关经历的人请教具体方法。';

// Actual local application rendering; every API request is intercepted. The
// public source snapshots are real, but all practice/goal replies are synthetic.
async function practiceMock(page: Page, questions: CampusCorpusQuestion[]) {
  const now = new Date().toISOString(); const branchId = randomUUID();
  const session: CustomPracticeView = {
    id: randomUUID(), version: 1, topic: '我想向同专业学姐请教一门课的复习方法。', createdAt: now, updatedAt: now,
    expiresAt: new Date(Date.now() + 86400000).toISOString(), activeBranchId: branchId, generating: false,
    pendingAction: null, sourceVersion: 'browser-integration-source-snapshot',
    branches: [{ id: branchId, label: '第一次尝试', parentId: null, accepted: true, finished: false, createdAt: now, turns: [],
      setup: { title: '向学姐请教复习方法', userRole: '希望了解复习方法的同学', counterpartRole: '同专业学姐', goal: '说明自己的困惑，问问对方是否愿意分享一个复习方法', userFacts: ['我想向同专业学姐请教一门课的复习方法。'], assumptions: ['对方愿意听我说明来意'], openingLine: '有什么想问的？我还有一会儿时间。' },
      sourceContext: { version: 'browser-integration-source-snapshot', match: questions.length ? 'matched' : 'none', questions: structuredClone(questions), note: '浏览器验收固定的公开来源；对话为模拟接口数据。', basis: 'scenario' },
    }],
  };
  const unexpected: string[] = []; const actions: string[] = [];
  await page.addInitScript(id => localStorage.setItem('practice-custom-selected', id), session.id);
  await page.route('**/api/**', async route => {
    const request = route.request(); const pathname = new URL(request.url()).pathname;
    if (request.method() === 'GET' && pathname === '/api/custom-practices') {
      await route.fulfill({ json: { available: true, sessions: [{ id: session.id, title: session.branches[0].setup.title, updatedAt: now, turns: 0, ready: true }] } }); return;
    }
    if (request.method() === 'GET' && pathname === `/api/custom-practices/${session.id}`) {
      await route.fulfill({ json: { session } }); return;
    }
    if (request.method() === 'POST' && pathname === `/api/custom-practices/${session.id}`) {
      const action = request.postDataJSON() as CustomAction; const branch = activeCustomBranch(session)!; actions.push(action.kind);
      if (action.kind === 'say') branch.turns.push({ id: action.actionId, userText: action.text, reply: '可以，你先说说是哪一部分不太明白。', reflection: '这次想问清楚哪一个具体问题？', supportedQuote: action.text, sourceId: null, createdAt: now });
      else if (action.kind === 'finish') branch.finished = true;
      else { unexpected.push(`${request.method()} ${pathname} ${action.kind}`); await route.fulfill({ status: 503, json: { error: { message: '本检查没有模拟这个操作。' } } }); return; }
      session.version++; await route.fulfill({ json: { session } }); return;
    }
    if (request.method() !== 'GET') unexpected.push(`${request.method()} ${pathname}`);
    await route.fulfill({ status: 503, json: { error: { message: '集成验收隔离接口，不调用真实服务或模型。' } } });
  });
  await page.goto('/?mode=custom');
  await expect(page.getByLabel('如果现在面对对方，你会怎么说？')).toBeVisible();
  return { session, unexpected, actions };
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await mkdir(evidenceDirectory, { recursive: true });
  const metrics = await page.evaluate(() => {
    const card = document.querySelector('[aria-label="先借一条经验"]'); const input = document.getElementById('custom-say') ?? document.getElementById('custom-takeaway');
    return { viewport: { width: innerWidth, height: innerHeight }, scroll: { x: scrollX, y: scrollY }, documentWidth: document.documentElement.scrollWidth,
      card: card ? { height: card.getBoundingClientRect().height, top: card.getBoundingClientRect().top } : null,
      input: input ? { height: input.getBoundingClientRect().height, top: input.getBoundingClientRect().top } : null,
      focused: document.activeElement?.id || document.activeElement?.tagName };
  });
  await writeFile(`${evidenceDirectory}/${name}-metrics.json`, JSON.stringify(metrics, null, 2));
  await testInfo.attach(name, { body: await page.screenshot({ path: `${evidenceDirectory}/${name}.png`, fullPage: true }), contentType: 'image/png' });
}

test('集成：活跃对话直接提炼、原摘要核对与关闭来源回输入', async ({ page }, testInfo) => {
  const mock = await practiceMock(page, [reviewed]);
  const brief = page.getByRole('region', { name: '先借一条经验', exact: true }); const input = page.getByLabel('如果现在面对对方，你会怎么说？');
  await expect(brief).toContainText(summary); await expect(brief.getByText('这次可以试', { exact: true })).toBeVisible();
  await expect(brief).not.toContainText('更能有效提升成绩');
  await capture(page, testInfo, 'active-desktop');
  await input.fill('学姐，方便听我说说这门课的问题吗？');
  await brief.getByText('适用提醒与作者原话', { exact: true }).click();
  await expect(brief).toContainText('没有证明请教一定提分');
  await brief.getByText('查看站内完整摘要与出处', { exact: true }).click();
  await expect(brief.getByRole('link', { name: '在知乎读这条回答' })).toHaveAttribute('href', reviewed.answers[0].url);
  await expect(brief.locator('blockquote').last()).toHaveText(reviewed.answers[0].excerpt);
  await brief.getByRole('button', { name: '查看来源对照' }).click();
  const sources = page.getByRole('region', { name: '自由练习的知乎经验依据' });
  await expect(sources.getByRole('heading', { level: 2 })).toBeFocused();
  await expect(sources).toContainText(summary); await expect(sources).not.toContainText('更能有效提升成绩');
  await capture(page, testInfo, 'active-sources');
  await sources.getByRole('button', { name: '收起经验片段' }).click();
  await expect(sources).toHaveCount(0); await expect(input).toBeFocused(); await expect(input).toBeInViewport({ ratio: 1 });
  await capture(page, testInfo, 'active-source-return');
  await expect(input).toHaveValue('学姐，方便听我说说这门课的问题吗？');
  await page.getByRole('button', { name: '说给对方听', exact: true }).click();
  await expect(input).toHaveValue(''); expect(mock.actions).toEqual(['say']); expect(mock.unexpected).toEqual([]);
});

test('集成：收束保留经验并能在收起来源后填写自己的收获', async ({ page }, testInfo) => {
  const mock = await practiceMock(page, [reviewed]);
  await page.getByLabel('如果现在面对对方，你会怎么说？').fill('我想先问问你是否方便分享一个复习方法。');
  await page.getByRole('button', { name: '说给对方听', exact: true }).click();
  await page.getByRole('button', { name: '先练到这里，保存复盘', exact: true }).click();
  const report = page.getByRole('region', { name: '本次练习复盘' });
  await expect(report).toContainText(summary); await expect(page.locator('#custom-say')).toHaveCount(0);
  await report.locator('#custom-takeaway').fill('先问对方是否方便，再提出一个具体问题。');
  await report.getByRole('button', { name: '查看来源对照' }).click();
  await page.getByRole('region', { name: '自由练习的知乎经验依据' }).getByRole('button', { name: '收起经验片段' }).click();
  await expect(report.locator('#custom-takeaway')).toHaveValue('先问对方是否方便，再提出一个具体问题。');
  await expect(report.locator('#custom-takeaway')).toBeFocused(); await expect(report.locator('#custom-takeaway')).toBeInViewport({ ratio: 1 });
  await capture(page, testInfo, 'finished-source-return');
  expect(mock.actions).toEqual(['say', 'finish']); expect(mock.unexpected).toEqual([]);
});

test('集成：未逐条核读题直呈原摘要，不冒充团队提炼', async ({ page }, testInfo) => {
  const mock = await practiceMock(page, [excerptOnly]); const brief = page.getByRole('region', { name: '先借一条经验', exact: true });
  await expect(brief.locator('[data-brief-kind="excerpt"]')).toBeVisible(); await expect(brief).toContainText('先看这段原摘要，想想哪里适合你。');
  await expect(brief).not.toContainText('团队提炼');
  const visibleQuote = await brief.locator('blockquote').first().innerText(); expect(excerptOnly.answers[0].excerpt).toContain(visibleQuote.replace(/…$/, ''));
  await brief.getByText('查看站内完整摘要与出处', { exact: true }).click(); await expect(brief.locator('blockquote').last()).toHaveText(excerptOnly.answers[0].excerpt);
  await capture(page, testInfo, 'excerpt-only-active'); expect(mock.actions).toEqual([]); expect(mock.unexpected).toEqual([]);
});

test('集成：没有匹配题也可在站内借用明确标注的通用方法', async ({ page }, testInfo) => {
  const mock = await practiceMock(page, []); const brief = page.getByRole('region', { name: '先借一条经验', exact: true });
  await expect(brief).toContainText('通用方法，未匹配到相近经历'); await expect(brief.locator('[data-question-id]')).toHaveCount(0);
  await brief.getByText('适用提醒与作者原话', { exact: true }).click(); await expect(brief).toContainText('王明伟');
  await expect(brief.getByRole('link', { name: '阅读站内来源片段' })).toHaveAttribute('href', '/sources/1393937473601368064');
  await capture(page, testInfo, 'general-source-active'); expect(mock.actions).toEqual([]); expect(mock.unexpected).toEqual([]);
});

test('集成：发现页同时展示已核读提炼与未核读原片段，阅读不触发练习', async ({ page }, testInfo) => {
  const writes: string[] = [];
  await page.route('**/api/**', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (request.method() !== 'GET') writes.push(`${request.method()} ${url.pathname}`);
    if (request.method() === 'GET' && url.pathname === '/api/discover') {
      const common = { version: 'browser-integration-source-snapshot', filters: {}, total: 2 };
      await route.fulfill({ json: url.searchParams.has('preview') ? { ...common, kind: 'count_preview', relaxations: [] } : { ...common, offset: 0, limit: 8, matches: [reviewed, excerptOnly].map(question => ({ question, evidence: [] })) } }); return;
    }
    await route.fulfill({ status: 503, json: { error: { message: '本检查隔离所有其他 API。' } } });
  });
  await page.goto('/discover'); await page.getByRole('button', { name: '查找相近的问题', exact: true }).click();
  await expect(page.getByRole('heading', { name: '可浏览 2 个问题' })).toBeVisible();
  const first = page.locator(`[data-discovery-question="${reviewed.id}"]`); const second = page.locator(`[data-discovery-question="${excerptOnly.id}"]`);
  await expect(first.locator('[data-brief-kind="reviewed"]')).toContainText(summary);
  await expect(second.locator('[data-brief-kind="excerpt"]')).toContainText('原摘要预览'); await expect(second).not.toContainText('团队提炼');
  await first.getByText('在这里核对摘要与出处', { exact: true }).click();
  await expect(first).toContainText('没有证明请教一定提分'); await expect(first.locator('blockquote')).toHaveText(reviewed.answers[0].excerpt);
  await second.getByText('在这里核对摘要与出处', { exact: true }).click(); await expect(second.locator('blockquote').last()).toHaveText(excerptOnly.answers[0].excerpt);
  await capture(page, testInfo, 'discover-reviewed-excerpt'); expect(writes).toEqual([]);
});

test('集成：320px及200%文字下卡片、原摘要与输入均可操作且无横向溢出', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 850 }); const mock = await practiceMock(page, [reviewed]);
  const brief = page.getByRole('region', { name: '先借一条经验', exact: true });
  await page.getByRole('button', { name: '先借一条经验', exact: true }).click();
  await expect(page.locator('#active-experience-brief')).toBeFocused();
  await expect(brief).toBeInViewport();
  await capture(page, testInfo, 'active-320');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(321);
  const changed = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll<HTMLElement>('main *')];
    const original = nodes.map(element => ({ element, size: parseFloat(getComputedStyle(element).fontSize) }));
    for (const { element, size } of original) element.style.fontSize = `${size * 2}px`;
    return original.length;
  }); expect(changed).toBeGreaterThan(20);
  await brief.getByText('适用提醒与作者原话', { exact: true }).click();
  await expect(brief).toContainText('没有证明请教一定提分');
  await capture(page, testInfo, 'active-320-text200');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(321);
  await brief.getByRole('button', { name: '查看来源对照' }).click();
  await page.getByRole('region', { name: '自由练习的知乎经验依据' }).getByRole('button', { name: '收起经验片段' }).click();
  const input = page.getByLabel('如果现在面对对方，你会怎么说？'); await expect(input).toBeFocused(); await expect(input).toBeInViewport({ ratio: 1 });
  await input.fill('学姐，方便请教一个问题吗？'); await page.getByRole('button', { name: '说给对方听', exact: true }).click();
  await expect(input).toHaveValue(''); expect(mock.actions).toEqual(['say']); expect(mock.unexpected).toEqual([]);
});
