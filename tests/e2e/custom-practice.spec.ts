import { test, expect, type Page } from './fixtures';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { activeCustomBranch, type CustomAction, type CustomPracticeView, type CustomSetup, type CustomSourceContext } from '../../src/domain/custom-practice';
import type { CampusCorpusQuestion } from '../../src/content/campus-corpus';

// These are client recovery tests with an explicitly mocked HTTP/model boundary.
// They do not claim a real model call. Server ownership/concurrency has separate
// real-file service tests in custom-practice.test.ts.
test.use({ baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:3000' });
const topic = '租来的房间漏水了，我想和房东商量维修安排，但不想把关系弄僵。';
const setup: CustomSetup = { title: '和房东谈维修安排', userRole: '租住这间房的人', counterpartRole: '房东', goal: '说清漏水情况，商量怎样确认维修安排', userFacts: [topic], assumptions: ['房东还没有亲眼看过漏水的位置'], openingLine: '你说房间有点问题，方便说一下是什么情况吗？' };
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function mockApi(page: Page, options: { available?: boolean; loseReply?: boolean; failCreate?: boolean; delayCreate?: ReturnType<typeof deferred>; delaySay?: ReturnType<typeof deferred>; failSay?: boolean; goalOnSay?: boolean; goalMode?: 'legacy' | 'no_agreement'; sourceContext?: CustomSourceContext; counterpartRole?: string; customSetup?: CustomSetup; sayReply?: string; sceneOpeningKind?: 'guide' | 'counterpart' } = {}) {
  let session: CustomPracticeView | null = null; let sayings = 0; let lost = false; let writes = 0; let sourceQuestionId: string | undefined;
  await page.route('**/api/practice-intake', async route => {
    const input = route.request().postDataJSON() as { requestId: string; text: string };
    await route.fulfill({ json: { intake: { version: 'practice-intake-v1', requestId: input.requestId, originalText: input.text, status: 'ready', reason: '客户端边界测试：已有明确模拟方向。', evidenceQuotes: [input.text], questions: [], suggestions: [], canStartPractice: true } } });
  });
  await page.route('**/api/custom-practices**', async route => {
    const req = route.request(); const list = new URL(req.url()).pathname === '/api/custom-practices';
    if (req.method() === 'GET') {
      const body = list ? { sessions: session ? [{ id: session.id, title: setup.title, updatedAt: session.updatedAt, turns: activeCustomBranch(session)?.turns.length ?? 0, ready: Boolean(activeCustomBranch(session)) }] : [], available: options.available ?? true } : { session };
      await route.fulfill({ json: body }); return;
    }
    writes++;
    if (req.method() === 'DELETE') { session = null; await route.fulfill({ json: { deleted: true } }); return; }
    if (list) {
      const input = req.postDataJSON() as { id: string; topic: string; sourceQuestionId?: string };
      if (session?.id === input.id && session.sourceQuestionId !== input.sourceQuestionId) { await route.fulfill({ status: 409, json: { error: { message: '同一条创建记录不能更换来源问题。' } } }); return; }
      sourceQuestionId = input.sourceQuestionId;
      const branchId = randomUUID(); const now = new Date().toISOString();
      session = { id: input.id, version: 1, topic: input.topic, createdAt: now, updatedAt: now, expiresAt: new Date(Date.now() + 86_400_000).toISOString(), activeBranchId: branchId, branches: [{ id: branchId, label: '第一次尝试', parentId: null, setup: structuredClone(setup), accepted: false, finished: false, turns: [], createdAt: now }], generating: false, pendingAction: null, sourceVersion: 'test-fixture' };
      if (input.sourceQuestionId) session.sourceQuestionId = input.sourceQuestionId;
      if (options.customSetup) session.branches[0].setup = structuredClone(options.customSetup);
      if (options.counterpartRole) session.branches[0].setup.counterpartRole = options.counterpartRole;
      if (options.sourceContext) session.branches[0].sourceContext = structuredClone(options.sourceContext);
      if (options.failCreate) { session.branches = []; session.activeBranchId = null; session.version = 0; await route.fulfill({ status: 503, json: { error: { message: '情境生成暂时中断，可以稍后恢复。' } } }); return; }
      if (options.delayCreate) await options.delayCreate.promise;
      await route.fulfill({ json: { session } }); return;
    }
    const action = req.postDataJSON() as CustomAction; const branch = activeCustomBranch(session!)!;
    if (action.kind === 'accept_setup') { branch.setup = action.setup; branch.accepted = true; }
    if (action.kind === 'say') {
      if (options.delaySay) await options.delaySay.promise;
      if (options.failSay) { await route.fulfill({ status: 503, json: { error: { code: 'MOCK_DELAY_FAILURE', message: '客户端模拟：回应暂未完成，原话仍在。' } } }); return; }
      sayings++; branch.turns.push({ id: action.actionId, userText: action.text, reply: options.sayReply ?? '可以，先把漏水的位置发给我，我们再商量维修安排。', reflection: '你会怎样确认下一步由谁来做？', supportedQuote: action.text, sourceId: '1393937473601368064', createdAt: new Date().toISOString() });
    }
    if ((action.kind === 'say' && options.goalOnSay) || action.kind === 'review_goal') {
      const turn = branch.turns.at(-1)!;
      const evidence = [{ turnId: turn.id, speaker: 'user' as const, quote: turn.userText }, { turnId: turn.id, speaker: 'counterpart' as const, quote: turn.reply }];
      const legacy = options.goalMode === 'legacy' && action.kind !== 'review_goal';
      branch.goalProgress = { status: 'achieved', summary: '不能展示的自由转述：双方已约定加微信，今晚发送重点框架。', evidence,
        ...(legacy ? {} : { verificationVersion: 'goal-progress-v2' as const }),
        agreements: legacy ? [{ text: '不能展示的旧约定：加微信并于今晚发送框架。', evidence }] : options.goalMode ? [] : [{ text: turn.userText, evidence, certification: { version: 'proposal-acceptance-v1', proposal: evidence[0], acceptance: evidence[1] } }],
        openQuestions: [], evaluatedThroughTurnId: turn.id, evaluatedAt: new Date().toISOString() };
    }
    if (action.kind === 'advance_scene') {
      (branch.scenes ??= []).push({ id: action.actionId, label: action.label, ...(options.sceneOpeningKind ? { openingKind: options.sceneOpeningKind } : {}), openingLine: options.sceneOpeningKind === 'guide' ? '已进入你选择的模拟场景。你准备先对对方说什么？' : '现在到了约好的时间。我们先具体看漏水位置，再商量怎么检查维修结果。', turnIndex: branch.turns.length, createdAt: new Date().toISOString() });
    }
    if (action.kind === 'rewind') {
      const next = structuredClone(branch); next.id = randomUUID(); next.label = `第${session!.branches.length + 1}次尝试`; next.parentId = branch.id; next.finished = false;
      if (next.scenes?.at(-1)?.turnIndex === next.turns.length) next.scenes.pop(); else if (next.turns.length) next.turns.pop(); else next.accepted = false; session!.branches.push(next); session!.activeBranchId = next.id;
    }
    if (action.kind === 'edit_counterpart_reply') {
      const next = structuredClone(branch); next.id = randomUUID(); next.label = '调整对方回应 2'; next.parentId = branch.id; next.finished = false;
      const turn = next.turns.at(-1)!;
      turn.replyOrigin = { kind: 'user_edit', branchId: branch.id, turnId: turn.id }; turn.id = action.actionId; turn.reply = action.reply; turn.reflection = ''; turn.supportedQuote = ''; turn.sourceId = null;
      delete turn.goalProgress; delete next.goalProgress;
      session!.branches.push(next); session!.activeBranchId = next.id;
    }
    if (action.kind === 'switch_branch') session!.activeBranchId = action.branchId;
    if (action.kind === 'finish') branch.finished = true;
    session!.version++;
    if (options.loseReply && !lost && action.kind === 'say') { lost = true; await route.abort('connectionreset'); return; }
    await route.fulfill({ json: { session } });
  });
  return { read: () => session!, sayings: () => sayings, writes: () => writes, source: () => sourceQuestionId };
}
async function enter(page: Page, title = setup.title) {
  await page.goto('/?mode=custom'); await expect(page.getByRole('heading', { name: '有句话，想先练着说？' })).toBeVisible();
  await page.getByLabel('我想练习……', { exact: true }).fill(topic);
  await page.getByRole('button', { name: '准备我的练习', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
}
async function acceptSetup(page: Page) { await page.getByRole('button', { name: '设定合适，开始对话', exact: true }).click(); await expect(page.getByLabel('如果现在面对对方，你会怎么说？')).toBeVisible(); }

test('[朋友 E mock] 核对同版记录有回执，保留草稿和未确认设定，不产生写入', async ({ page }) => {
  const mock = await mockApi(page); await enter(page);
  const goal = page.getByLabel('这次想谈成什么'); await goal.fill('我正在修改但还没有接受的目标');
  const version = mock.read().version; const writes = mock.writes();
  await page.getByText('记录管理', { exact: true }).click();
  await page.getByRole('button', { name: '核对已保存结果', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '已核对：这里已经是最新记录' })).toBeVisible();
  await expect(goal).toHaveValue('我正在修改但还没有接受的目标');
  expect(mock.writes()).toBe(writes); expect(mock.read().version).toBe(version);
  await acceptSetup(page); const input = page.getByLabel('如果现在面对对方，你会怎么说？'); await input.fill('还没有发出的下一句话');
  await page.getByRole('button', { name: '核对已保存结果', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '已核对：这里已经是最新记录' })).toBeVisible();
  await expect(input).toHaveValue('还没有发出的下一句话'); expect(mock.sayings()).toBe(0);
});

test('[朋友 E mock] 断网后核对找回已保存回应，不重复发言', async ({ page }) => {
  const mock = await mockApi(page, { loseReply: true }); await enter(page); await acceptSetup(page);
  const input = page.getByLabel('如果现在面对对方，你会怎么说？'); await input.fill('我想先发照片给你，可以吗？');
  await page.getByRole('button', { name: '说给对方听', exact: true }).click();
  const region = page.getByRole('region', { name: '我的模拟对话', exact: true });
  await region.getByRole('button', { name: '核对已保存结果', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '已找回这一轮保存的结果' })).toBeVisible();
  await expect(region.locator('[data-speaker="counterpart"]').last()).toContainText('先把漏水的位置发给我');
  await expect(input).toHaveValue(''); expect(mock.sayings()).toBe(1);
});

test('[朋友 E mock] 调整最新回应另存尝试，原文可恢复，草稿和自写标记保留', async ({ page }, testInfo) => {
  const mock = await mockApi(page, { goalOnSay: true }); await enter(page); await acceptSetup(page);
  const input = page.getByLabel('如果现在面对对方，你会怎么说？'); await input.fill('你能先看看漏水照片吗？');
  await page.getByRole('button', { name: '说给对方听', exact: true }).click(); await expect(input).toHaveValue('');
  const original = structuredClone(activeCustomBranch(mock.read())!);
  await input.fill('我还想继续说的草稿'); await page.setViewportSize({ width: 320, height: 760 });
  await page.getByRole('button', { name: '调整对方这句回应', exact: true }).click();
  const edited = page.getByLabel('你觉得对方会怎样说？'); await expect(edited).toBeFocused();
  await edited.fill('我今天看不了，明天再联系你。');
  await page.screenshot({ path: testInfo.outputPath('edit-reply-320-mock.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '保存调整，继续练', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '调整后的回应已另存为一次尝试' })).toBeVisible();
  await expect(input).toHaveValue('我还想继续说的草稿');
  await expect(page.getByText('房东 · 回应由你调整', { exact: true })).toBeVisible();
  await expect(page.getByTestId('goal-review')).toHaveCount(0);
  expect(mock.read().branches[0]).toEqual(original); expect(mock.read().branches).toHaveLength(2); expect(mock.sayings()).toBe(1);
  await page.getByLabel('其他尝试').selectOption(original.id);
  await expect(page.getByText('房东 · 回应由你调整', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: '我的模拟对话', exact: true }).locator('[data-speaker="counterpart"]').last()).toContainText(original.turns[0].reply);
  expect(mock.read().branches[0]).toEqual(original);
});

test('[朋友 E mock] 调整回应提交前断网，刷新恢复编辑稿并复用原动作编号', async ({ page }) => {
  const mock = await mockApi(page); await enter(page); await acceptSetup(page);
  const input = page.getByLabel('如果现在面对对方，你会怎么说？'); await input.fill('我先发一张照片给你看，可以吗？');
  await page.getByRole('button', { name: '说给对方听', exact: true }).click(); await expect(input).toHaveValue('');
  const actionIds: string[] = [];
  await page.route('**/api/custom-practices/*', async route => {
    if (route.request().method() === 'POST' && route.request().postDataJSON()?.kind === 'edit_counterpart_reply') {
      actionIds.push(route.request().postDataJSON().actionId);
      if (actionIds.length === 1) { await route.abort('connectionreset'); return; }
    }
    await route.fallback();
  });
  await page.getByRole('button', { name: '调整对方这句回应', exact: true }).click();
  await page.getByLabel('你觉得对方会怎样说？').fill('我今天没有时间，请明天再联系我。');
  await page.getByRole('button', { name: '保存调整，继续练', exact: true }).click();
  await expect(page.getByRole('region', { name: '练自己的事', exact: true }).getByRole('alert')).toBeVisible(); expect(mock.read().branches).toHaveLength(1);
  await page.reload();
  await page.getByRole('button', { name: '调整对方这句回应', exact: true }).click();
  await expect(page.getByLabel('你觉得对方会怎样说？')).toHaveValue('我今天没有时间，请明天再联系我。');
  await page.getByRole('button', { name: '保存调整，继续练', exact: true }).click();
  await expect(page.getByText('房东 · 回应由你调整', { exact: true })).toBeVisible();
  expect(actionIds).toHaveLength(2); expect(actionIds[1]).toBe(actionIds[0]); expect(mock.read().branches).toHaveLength(2);
});

test('[朋友 E mock] 记录首次读取失败，再次打开仍恢复未发送草稿', async ({ page }) => {
  await mockApi(page); await enter(page); await acceptSetup(page);
  const input = page.getByLabel('如果现在面对对方，你会怎么说？'); await input.fill('我保留在这条练习里的草稿');
  await page.getByRole('button', { name: '我的自由练习', exact: true }).click();
  let first = true;
  await page.route('**/api/custom-practices/*', async route => {
    if (route.request().method() === 'GET' && first) { first = false; await route.abort('connectionreset'); return; }
    await route.fallback();
  });
  const entry = page.getByRole('button', { name: new RegExp(`${setup.title}.*继续`) });
  await entry.click(); await expect(page.getByRole('region', { name: '练自己的事', exact: true }).getByRole('alert')).toBeVisible();
  await entry.click(); await expect(input).toHaveValue('我保留在这条练习里的草稿');
});

test('[句式框架 mock] 本地框架只填草稿，不请求模型、不自动发送，修改后可发言', async ({ page }, testInfo) => {
  const mock = await mockApi(page); let optionRequests = 0;
  await page.route('**/api/custom-practices/*/reply-options?**', route => { optionRequests++; return route.abort(); });
  await enter(page); await acceptSetup(page);
  const original = structuredClone(mock.read());
  await page.getByText('用句式自己填，不用等建议', { exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('reply-frames-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 320, height: 760 });
  const frames = page.getByRole('group', { name: '可填写的说话框架' });
  await expect(frames).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await testInfo.attach('reply-frames-320', { body: await page.screenshot({ path: testInfo.outputPath('reply-frames-320.png'), fullPage: true }), contentType: 'image/png' });
  await page.getByRole('button', { name: /回应眼前的问题/ }).click();
  const composer = page.getByLabel('如果现在面对对方，你会怎么说？');
  await expect(composer).toHaveValue(/【已有事实】/);
  await expect(composer).toBeFocused();
  expect(optionRequests).toBe(0); expect(mock.sayings()).toBe(0); expect(mock.read()).toEqual(original);
  await composer.fill('我能确认水从窗边渗进来，具体原因还需要一起检查。');
  await page.getByRole('button', { name: '说给对方听', exact: true }).click();
  await expect(composer).toHaveValue(''); expect(mock.sayings()).toBe(1);
  expect(activeCustomBranch(mock.read())?.turns[0].userText).not.toContain('【');
});

test('[新手入口 mock] 知识问题先整理方向，建议只填草稿，重新判断才创建', async ({ page }, testInfo) => {
  const mock = await mockApi(page); const inputs: string[] = [];
  await page.route('**/api/practice-intake', async route => {
    const input = route.request().postDataJSON(); inputs.push(input.text);
    const ready = inputs.length > 1;
    await route.fulfill({ json: { intake: { version: 'practice-intake-v1', requestId: input.requestId, originalText: input.text, status: ready ? 'ready' : 'knowledge_request', reason: ready ? '可以开始。' : '你想了解与、或、非的含义。也可以把它变成一次讲解练习。', evidenceQuotes: [input.text], questions: ['你更想向同学请教，还是试着讲给同学听？'], suggestions: ready ? [] : [{ id: 'explain', label: '试着给同学讲清楚与或非', draft: '我想练给同学讲清楚与或非，希望能用例子说明区别。', assumptions: ['对方愿意听你举一个例子。'] }], canStartPractice: ready } } });
  });
  await page.goto('/?mode=custom'); const input = page.getByLabel('我想练习……', { exact: true });
  await input.fill('与或非是什么意思？'); await page.getByRole('button', { name: '准备我的练习', exact: true }).click();
  const help = page.getByRole('region', { name: '帮你找到练习的下一步' }); await expect(help).toContainText('还没有创建练习'); expect(mock.writes()).toBe(0);
  await testInfo.attach('intake-concrete-next-step', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  await help.getByRole('button', { name: /试着给同学讲清楚与或非/ }).click(); await expect(input).toHaveValue(/我想练给同学讲清楚/);
  expect(inputs).toHaveLength(1); expect(mock.writes()).toBe(0);
  await page.getByText('这个建议补充了哪些模拟假设？', { exact: true }).click(); await expect(page.getByText('对方愿意听你举一个例子。', { exact: true })).toBeVisible();
  await input.fill('我想练给同学讲清楚与或非，尤其是用真值的例子说明。');
  await page.getByRole('button', { name: '用修改后的描述准备情境', exact: true }).click(); await expect(page.getByRole('heading', { name: setup.title })).toBeVisible();
  expect(inputs).toHaveLength(2); expect(mock.writes()).toBe(1); expect(mock.read().topic).toBe(inputs[1]);
});

test('[新手入口 mock] 旧输入的整理结果晚到不能创建或覆盖新草稿', async ({ page }) => {
  const mock = await mockApi(page); const waiting = deferred();
  await page.route('**/api/practice-intake', async route => { const input = route.request().postDataJSON(); await waiting.promise; await route.fulfill({ json: { intake: { version: 'practice-intake-v1', requestId: input.requestId, originalText: input.text, status: 'ready', reason: '可以开始。', evidenceQuotes: [input.text], questions: [], suggestions: [], canStartPractice: true } } }); });
  await page.goto('/?mode=custom'); const input = page.getByLabel('我想练习……', { exact: true });
  await input.fill(topic); await page.getByRole('button', { name: '准备我的练习', exact: true }).click();
  await expect(page.getByTestId('waiting-feedback')).toBeVisible();
  await input.fill('我现在想先问清楚与或非是什么。'); waiting.resolve();
  await expect(page.getByTestId('waiting-feedback')).toHaveCount(0); expect(mock.writes()).toBe(0);
  await expect(input).toHaveValue('我现在想先问清楚与或非是什么。');
  await page.reload(); await expect(input).toHaveValue('我现在想先问清楚与或非是什么。');
});

test('[新手入口 mock] 整理结果必须属于本次原话和请求编号', async ({ page }) => {
  const mock = await mockApi(page);
  await page.route('**/api/practice-intake', async route => { const input = route.request().postDataJSON(); await route.fulfill({ json: { intake: { version: 'practice-intake-v1', requestId: randomUUID(), originalText: input.text.trim(), status: 'ready', reason: '可以开始。', evidenceQuotes: [], questions: [], suggestions: [], canStartPractice: true } } }); });
  await page.goto('/?mode=custom'); await page.getByLabel('我想练习……', { exact: true }).fill(` ${topic}\n`);
  await page.getByRole('button', { name: '准备我的练习', exact: true }).click(); await expect(page.getByRole('region', { name: '练自己的事', exact: true }).getByRole('alert')).toContainText('没有对上'); expect(mock.writes()).toBe(0);
  await expect(page.getByLabel('我想练习……', { exact: true })).toHaveValue(` ${topic}\n`);
});

test('[新手入口 mock] 情境生成晚到保留新写的描述，已生成内容可从记录手动打开', async ({ page }) => {
  const waiting = deferred(); const mock = await mockApi(page, { delayCreate: waiting });
  await page.goto('/?mode=custom'); const input = page.getByLabel('我想练习……', { exact: true });
  await input.fill(topic); await page.getByRole('button', { name: '准备我的练习', exact: true }).click();
  await expect.poll(() => mock.writes()).toBe(1); await input.fill('我想先和社团同学商量活动安排。'); waiting.resolve();
  await expect(page.getByText('上一次描述的情境已存到下方记录。你刚写的内容保留在这里。')).toBeVisible();
  await expect(input).toHaveValue('我想先和社团同学商量活动安排。'); await expect(page.getByRole('button', { name: '设定合适，开始对话' })).toHaveCount(0);
  await page.getByRole('button', { name: /和房东谈维修安排.*继续/ }).click(); await expect(page.getByRole('button', { name: '设定合适，开始对话' })).toBeVisible();
});

test('[新手入口 mock] 主页新建不串旧记录，生成后刷新恢复，旧草稿仍保留', async ({ page }) => {
  const mock = await mockApi(page); await enter(page); await acceptSetup(page); const oldId = mock.read().id;
  await page.getByLabel('如果现在面对对方，你会怎么说？').fill('旧练习未发出的私有草稿。');
  await page.getByRole('button', { name: '← 返回练习主页', exact: true }).click(); await page.getByRole('button', { name: '练自己的事', exact: true }).click();
  await expect(page.getByRole('heading', { name: '有句话，想先练着说？' })).toBeVisible(); await expect(page.getByLabel('如果现在面对对方，你会怎么说？')).toHaveCount(0);
  await page.getByLabel('我想练习……', { exact: true }).fill('我想和社团同学商量值班时间。'); await page.getByRole('button', { name: '准备我的练习', exact: true }).click();
  await expect(page.getByRole('heading', { name: setup.title })).toBeVisible(); const newId = mock.read().id; expect(newId).not.toBe(oldId);
  await page.reload(); await expect(page.getByRole('button', { name: '设定合适，开始对话' })).toBeVisible(); expect(mock.read().id).toBe(newId);
  expect(await page.evaluate(id => localStorage.getItem(`practice-custom-draft:${id}`), oldId)).toBe('旧练习未发出的私有草稿。');
});

test('[新手入口 mock] 显式新建链接与尚未生成的主页草稿刷新都不恢复旧练习', async ({ page }) => {
  const mock = await mockApi(page); await enter(page); await acceptSetup(page); const oldId = mock.read().id;
  const originalWrites = mock.writes();
  await page.goto('/?mode=custom&intent=new'); await expect(page.getByRole('heading', { name: '有句话，想先练着说？' })).toBeVisible();
  await expect(page.getByLabel('如果现在面对对方，你会怎么说？')).toHaveCount(0);
  await page.getByLabel('我想练习……', { exact: true }).fill('新建链接里还没有提交的描述。'); await page.reload();
  await expect(page.getByLabel('我想练习……', { exact: true })).toHaveValue('新建链接里还没有提交的描述。');
  await page.getByRole('button', { name: '← 返回练习主页', exact: true }).click(); await page.getByRole('button', { name: '练自己的事', exact: true }).click();
  await page.getByLabel('我想练习……', { exact: true }).fill('主页新建的B草稿，还没有生成。'); await page.reload();
  await expect(page.getByLabel('我想练习……', { exact: true })).toHaveValue('主页新建的B草稿，还没有生成。');
  await expect(page.getByLabel('如果现在面对对方，你会怎么说？')).toHaveCount(0);
  await page.goBack(); await expect(page.getByRole('heading', { name: '今天，想先练哪件事？' })).toBeVisible(); await page.goForward();
  await expect(page.getByLabel('我想练习……', { exact: true })).toHaveValue('主页新建的B草稿，还没有生成。');
  expect(mock.writes()).toBe(originalWrites); expect(mock.read().id).toBe(oldId);
});

test('[新手入口 mock] 题库生成失败后刷新并重试仍发送原问题标识', async ({ page }) => {
  const options = { failCreate: true, sourceContext }; const mock = await mockApi(page, options);
  await page.route('**/api/campus-library?*', route => route.fulfill({ json: { version: 'browser-mock-v1', total: 1, categories: ['宿舍相处'], questions: [campusQuestion], highVoteThreshold: 100 } }));
  await page.goto('/?view=home'); await page.getByRole('button', { name: '从知乎校园问题开始', exact: true }).click();
  await page.getByRole('button', { name: '用这个问题开始练习', exact: true }).click(); await page.getByRole('button', { name: '准备我的练习', exact: true }).click();
  await expect(page.getByText('情境生成暂时中断，可以稍后恢复。', { exact: true })).toBeVisible(); const id = mock.read().id; expect(mock.source()).toBe(campusQuestion.id);
  await page.reload(); await page.getByRole('button', { name: '我已经有件事', exact: true }).click();
  await page.getByRole('button', { name: /和房东谈维修安排.*情境待生成/ }).click();
  options.failCreate = false; await page.getByRole('button', { name: '重试生成情境', exact: true }).click();
  await expect(page.getByRole('button', { name: '设定合适，开始对话' })).toBeVisible(); expect(mock.read().id).toBe(id); expect(mock.source()).toBe(campusQuestion.id); expect(mock.writes()).toBe(2);
});

test('[新手入口 mock] 可选三要素不强迫填满，窄屏长文本与200%文字可操作', async ({ page }, testInfo) => {
  const mock = await mockApi(page); await page.setViewportSize({ width: 320, height: 850 }); await page.goto('/?mode=custom');
  await page.getByLabel('我想练习……', { exact: true }).fill('我想先学着开口。');
  await page.getByText('不知道怎么写？用三个小问题理一理', { exact: true }).click();
  await page.getByLabel('想面对谁？', { exact: true }).fill('第一次见面、刚结束一节很长课程的学姐'); await page.getByRole('button', { name: '补到我的描述中' }).click();
  await expect(page.getByLabel('我想练习……', { exact: true })).toHaveValue(/我想先学着开口。[\s\S]*学姐/); expect(mock.writes()).toBe(0);
  await page.reload(); await page.getByText('不知道怎么写？用三个小问题理一理', { exact: true }).click(); await expect(page.getByLabel('想面对谁？', { exact: true })).toHaveValue(/学姐/);
  await page.evaluate(() => { for (const element of document.querySelectorAll<HTMLElement>('main *')) { if (element.children.length === 0 || element.matches('button,label,summary,input,textarea')) element.style.fontSize = `${parseFloat(getComputedStyle(element).fontSize) * 2}px`; } });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(321);
  await testInfo.attach('new-intake-320-text200', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
});

test('[预设示范] 可点完两种选择，不请求模型或创建练习，不接受提议也可完成目标', async ({ page }, testInfo) => {
  const writes: string[] = []; await page.route('**/api/**', async route => { if (route.request().method() !== 'GET') writes.push(route.request().url()); await route.continue(); });
  await page.goto('/?view=demo'); await expect(page.getByText('90 秒上手 · 预设互动示范')).toBeVisible();
  await page.getByRole('button', { name: /试着这样开口/ }).click(); await expect(page.getByText('她愿意聊聊，模拟沟通目标达成了。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '先在这里请教，不接受新提议', exact: true }).click(); await expect(page.getByText('没有。你选择继续在这里请教。', { exact: true })).toBeVisible();
  await testInfo.attach('demo-goal-without-agreement', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  await page.getByRole('button', { name: '再试一种选择' }).click(); await page.getByRole('button', { name: /试着这样开口/ }).click(); await page.getByRole('button', { name: '明确接受加微信和发框架的提议' }).click();
  await expect(page.getByText('你明确接受了学姐的微信与框架提议。双方原话都留在左侧对话中。')).toBeVisible(); expect(writes).toEqual([]);
  await page.setViewportSize({ width: 320, height: 850 }); expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(321);
});

test('[客户端 mock] 回应晚到不删新写的草稿，新练习不带入上一条草稿', async ({ page }) => {
  const waiting = deferred(); const mock = await mockApi(page, { delaySay: waiting });
  await enter(page); await acceptSetup(page); const oldId = mock.read().id;
  const input = page.getByLabel('如果现在面对对方，你会怎么说？');
  await input.fill('这是我已经发出的第一句。');
  await page.getByRole('button', { name: '说给对方听', exact: true }).click();
  await expect(page.getByTestId('waiting-feedback')).toBeVisible();
  const nextDraft = '这是等待时新写的下一句，还没有发送。';
  await input.fill(nextDraft); waiting.resolve();
  await expect(page.getByTestId('waiting-feedback')).toHaveCount(0);
  await expect(input).toHaveValue(nextDraft);
  await page.reload(); await expect(input).toHaveValue(nextDraft); expect(mock.sayings()).toBe(1);
  await page.getByRole('button', { name: '我的自由练习', exact: true }).click();
  await page.getByLabel('我想练习……', { exact: true }).fill('这次我想和队友商量项目安排。');
  await page.getByRole('button', { name: '准备我的练习', exact: true }).click();
  await acceptSetup(page); await expect(input).toHaveValue('');
  expect(mock.read().id).not.toBe(oldId);
  expect(await page.evaluate(id => localStorage.getItem(`practice-custom-draft:${id}`), oldId)).toBe(nextDraft);
});

test('[客户端 mock] 推进到三点后进入下一幕，草稿、原话、头像和转场可恢复，返回保留旧分支', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 820 });
  const mock = await mockApi(page); await enter(page); await acceptSetup(page);
  const input = page.getByLabel('如果现在面对对方，你会怎么说？');
  await input.fill('那我们今天下午三点看一下漏水位置。');
  await page.getByRole('button', { name: '说给对方听', exact: true }).click();
  await expect(input).toHaveValue('');
  const prior = structuredClone(activeCustomBranch(mock.read())!.turns);
  const avatar = page.locator('[data-speaker="counterpart"] [data-avatar-src]').first();
  const src = await avatar.getAttribute('data-avatar-src');
  await input.fill('进入现场以后，我想先指出墙角的问题。');
  await page.getByRole('button', { name: '跳到之后的时间或场景', exact: true }).click();
  const destination = page.getByRole('textbox', { name: '接下来，想进入哪个时刻？' });
  await expect(destination).toHaveValue(/下午三点/);
  await destination.fill('今天下午三点，开始现场确认');
  await page.getByRole('button', { name: '切换到这个场景', exact: true }).click();
  await expect(page.getByText('当前模拟场景：今天下午三点，开始现场确认', { exact: true })).toBeVisible();
  await expect(input).toHaveValue('进入现场以后，我想先指出墙角的问题。');
  expect(activeCustomBranch(mock.read())!.turns).toEqual(prior);
  expect(activeCustomBranch(mock.read())!.scenes).toHaveLength(1);
  const advanced = structuredClone(activeCustomBranch(mock.read())!);
  await page.reload();
  await expect(page.getByText('现在到了约好的时间。我们先具体看漏水位置，再商量怎么检查维修结果。', { exact: true })).toBeVisible();
  await expect(avatar).toHaveAttribute('data-avatar-src', src!);
  await expect(input).toHaveValue('进入现场以后，我想先指出墙角的问题。');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(321);
  await testInfo.attach('chat-next-scene-320', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  await page.getByRole('button', { name: '← 返回上一步，换个说法', exact: true }).click();
  await expect(page.getByText('当前模拟场景：今天下午三点，开始现场确认', { exact: true })).toHaveCount(0);
  expect(mock.read().branches[0]).toEqual(advanced);
  expect(activeCustomBranch(mock.read())!.turns).toEqual(prior);
  await page.getByRole('combobox', { name: '其他尝试', exact: true }).selectOption(advanced.id);
  await expect(page.getByText('当前模拟场景：今天下午三点，开始现场确认', { exact: true })).toBeVisible();
});

test('自己的事件可编辑并练多轮；返回保留旧尝试，来源和真实记录可回查', async ({ page }, testInfo) => {
  const mock = await mockApi(page); await enter(page);
  await page.getByText('核对具体情况与 1 条模拟假设', { exact: true }).click();
  await expect(page.getByLabel('我提供的情况', { exact: false })).toHaveValue(topic);
  await page.getByLabel('这次想谈成什么', { exact: true }).fill('先说明问题，再约定如何检查维修结果');
  await acceptSetup(page);
  const input = page.getByLabel('如果现在面对对方，你会怎么说？');
  await input.fill('墙角昨晚开始漏水。我可以先发照片，您看接下来怎么安排？');
  await page.getByRole('button', { name: '说给对方听', exact: true }).click();
  await expect(input).toHaveValue('');
  await page.getByRole('button', { name: '← 返回上一步，换个说法', exact: true }).click();
  expect(mock.read().branches).toHaveLength(2); expect(mock.read().branches[0].turns).toHaveLength(1);
  await page.getByRole('combobox', { name: '其他尝试', exact: true }).selectOption(mock.read().branches[0].id);
  await expect(page.getByText('墙角昨晚开始漏水。我可以先发照片，您看接下来怎么安排？', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '查看来源对照', exact: true }).click();
  await expect(page.getByRole('region', { name: '自由练习的知乎经验依据' })).toContainText('不代表作者为这个自定义情境提供了答案');
  await page.getByText('看看仍可借用的两条通用方法', { exact: true }).click();
  await expect(page.getByRole('link', { name: '阅读来源片段' }).first()).toHaveAttribute('href', /^\/sources\//);
  await page.getByRole('button', { name: '先练到这里，保存复盘', exact: true }).click();
  await expect(page.getByRole('heading', { name: '把这次尝试，变成自己的经验', exact: true })).toBeVisible();
  const reflection = '明天先拍清楚漏水的位置，再和房东约一个确认时间。';
  const requestsBeforeReflection = mock.sayings();
  await page.getByLabel('现实里，我准备尝试的一步', { exact: false }).fill(reflection);
  await page.reload();
  await expect(page.getByLabel('现实里，我准备尝试的一步', { exact: false })).toHaveValue(reflection);
  expect(mock.sayings()).toBe(requestsBeforeReflection);
  const takeaway = '我发现先说明具体位置，比只说漏水更清楚。';
  await page.getByLabel('这次，我想记住什么', { exact: false }).fill(takeaway);
  await testInfo.attach('readable-custom-recap', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '下载我的经验记录', exact: true }).click();
  const file = await download; expect(file.suggestedFilename()).toMatch(/我的经验练习-.*\.txt$/);
  const exported = await readFile((await file.path())!, 'utf8');
  expect(exported).toContain(reflection); expect(exported).toContain(takeaway); expect(exported).toContain('墙角昨晚开始漏水'); expect(exported.trimStart()).not.toMatch(/^\{/);
  await page.getByText('记录管理', { exact: true }).click();
  const rawDownload = page.waitForEvent('download'); await page.getByRole('button', { name: '导出原始数据', exact: true }).click();
  const rawFile = await rawDownload; expect(rawFile.suggestedFilename()).toMatch(/\.json$/);
  const raw = JSON.parse(await readFile((await rawFile.path())!, 'utf8')) as { reflections: { nextStep: string }[] };
  expect(raw.reflections[0].nextStep).toBe(reflection);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('p').filter({ hasText: reflection })).toBeVisible();
  await expect(page.locator('#custom-next-step')).not.toBeVisible();
  await page.emulateMedia({ media: 'screen' });
  const id = mock.read().id;
  await page.getByRole('button', { name: '删除这条练习', exact: true }).click();
  await page.getByRole('button', { name: '删除这条练习及所有尝试', exact: true }).click();
  await expect(page.getByRole('heading', { name: '有句话，想先练着说？' })).toBeVisible();
  expect(await page.evaluate(prefix => Object.keys(localStorage).filter(key => key.startsWith(prefix)), `practice-custom-reflection:${id}:`)).toEqual([]);
});

test('[客户端 mock] 自己的事首轮收到回应仍可继续，等待有反馈、失败不丢下一句', async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: 'scope', description: '情境和模型回应由 HTTP mock 提供，只验证客户端连续对话、等待与草稿，不验证真实模型。' });
  const waiting = deferred(); const options = { delaySay: waiting, failSay: false };
  const mock = await mockApi(page, options); await enter(page); await acceptSetup(page);
  const input = page.getByLabel('如果现在面对对方，你会怎么说？');
  await input.fill('我先发照片，再一起商量维修安排，就这样可以吗？');
  await page.getByRole('button', { name: '说给对方听', exact: true }).click();
  try {
    const feedback = page.getByTestId('waiting-feedback');
    await expect(feedback).toBeVisible({ timeout: 2000 });
    expect(await feedback.getByRole('progressbar').getAttribute('aria-valuenow')).toBeNull();
    await expect(feedback.getByText(/已等 [1-9]\d* 秒/)).toBeVisible({ timeout: 4000 });
    waiting.resolve();
    await expect(input).toHaveValue('');
    await expect(page.getByRole('button', { name: '想看看可以怎么说', exact: true })).toBeVisible();
    await expect(input).toBeEnabled();
    await expect(page.getByRole('heading', { name: '把这次尝试，变成自己的经验', exact: true })).toHaveCount(0);
    expect(activeCustomBranch(mock.read())?.finished).toBe(false);
    options.failSay = true;
    const next = '我还想听听您最担心的是什么，怎么约检查时间合适？';
    await input.fill(next); await page.getByRole('button', { name: '说给对方听', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: '客户端模拟' })).toBeVisible();
    await expect(input).toHaveValue(next);
    await expect(page.getByTestId('reply-choices').getByRole('group', { name: '可选回复' })).toHaveCount(0);
    await expect(page.getByText('先核对这一轮，再继续聊', { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: '我的模拟对话', exact: true }).getByRole('button', { name: '核对已保存结果', exact: true })).toBeEnabled();
    expect(activeCustomBranch(mock.read())?.turns).toHaveLength(1);
    expect(activeCustomBranch(mock.read())?.finished).toBe(false);
  } finally { waiting.resolve(); }
});

test('[客户端 mock] 同次练习随机头像稳定、用户有头像，刷新不改写情境且没有大头像舞台', async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: 'scope', description: '服务器情境由 HTTP mock 提供；检查真实客户端稳定头像，不宣称模型结果。' });
  const mock = await mockApi(page); await enter(page); await acceptSetup(page);
  const before = structuredClone(mock.read()); const writes = mock.writes();
  await expect(page.getByRole('region', { name: '面对面练习舞台', exact: true })).toHaveCount(0);
  const avatar = page.locator('[data-speaker="counterpart"] [data-avatar-src]').first();
  const src = await avatar.getAttribute('data-avatar-src'); expect(src).toMatch(/chat-avatar-/);
  expect((await avatar.boundingBox())!.width).toBeLessThanOrEqual(40);
  expect(mock.writes()).toBe(writes); expect(mock.read()).toEqual(before);
  await page.reload();
  await expect(avatar).toHaveAttribute('data-avatar-src', src!);
  expect(mock.writes()).toBe(writes); expect(mock.read()).toEqual(before);
  await expect(page.getByText(setup.openingLine, { exact: true })).toBeVisible();
  await expect(page.getByLabel('如果现在面对对方，你会怎么说？')).toBeEnabled();
  await page.getByLabel('如果现在面对对方，你会怎么说？').fill('我们下午三点看一下漏水位置。');
  await page.getByRole('button', { name: '说给对方听', exact: true }).click();
  await expect(page.locator('[data-speaker="user"] [data-avatar-src]')).toHaveAttribute('data-avatar-src', /chat-avatar-user/);
  await expect(avatar).toHaveAttribute('data-avatar-src', src!);
  await testInfo.attach('persisted-chat-avatars', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
});

test('[选项边界 mock] 自由练习选项随回合与分支更新，编辑后才发送并可继续聊', async ({ page }, testInfo) => {
  const mock = await mockApi(page); const queries: { version: number; branchId: string }[] = [];
  const firstText = '我可以先把漏水位置拍给您，再一起商量下一步吗？';
  const nextText = '照片发给您之后，我们怎么确认维修安排呢？';
  await page.route('**/api/custom-practices/*/reply-options?*', async route => {
    const view = mock.read(); const active = activeCustomBranch(view)!;
    queries.push({ version: view.version, branchId: active.id });
    await route.fulfill({ json: { sessionId: view.id, version: view.version, customBranchId: active.id, status: 'ready', source: 'model', generatedAt: new Date().toISOString(), assistance: 'none', notice: '', options: [{ id: 'r1', text: active.turns.length ? nextText : firstText }, { id: 'r2', text: '您最需要我先提供哪些信息？' }] } });
  });
  await enter(page); await acceptSetup(page); const writes = mock.writes();
  const widget = page.getByTestId('reply-choices'); const input = page.getByLabel('如果现在面对对方，你会怎么说？');
  expect(queries).toHaveLength(0);
  await widget.getByRole('button', { name: '想看看可以怎么说' }).click();
  await widget.getByRole('button', { name: firstText, exact: true }).click();
  await expect(input).toHaveValue(firstText); expect(mock.writes()).toBe(writes);
  const edited = `${firstText}今天我六点以后在家。`;
  await input.fill(edited); await page.getByRole('button', { name: '说给对方听', exact: true }).click();
  await expect(input).toHaveValue(''); await expect(widget.getByRole('button', { name: '想看看可以怎么说' })).toBeVisible();
  expect(queries).toHaveLength(1); await widget.getByRole('button', { name: '想看看可以怎么说' }).click();
  await expect(widget.getByRole('button', { name: nextText, exact: true })).toBeVisible();
  const savedBranch = structuredClone(activeCustomBranch(mock.read())!);
  expect(savedBranch.turns[0].userText).toBe(edited); expect(savedBranch.finished).toBe(false);
  expect(mock.sayings()).toBe(1);
  await page.getByRole('button', { name: '← 返回上一步，换个说法', exact: true }).click();
  await widget.getByRole('button', { name: '想看看可以怎么说' }).click();
  await expect(widget.getByRole('button', { name: firstText, exact: true })).toBeVisible();
  await expect(widget.getByRole('button', { name: nextText, exact: true })).toHaveCount(0);
  expect(mock.read().branches[0]).toEqual(savedBranch);
  expect(new Set(queries.map(query => query.branchId)).size).toBe(2);
  await testInfo.attach('warm-custom-options', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
});

test('[客户端 mock] 320px 与200%文字的聊天、下一幕面板和输入无横向溢出', async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: 'scope', description: '使用客户端 HTTP mock；把各文本元素的实际计算字号放大2倍模拟文字放大，不声称系统级缩放测试。' });
  await page.setViewportSize({ width: 320, height: 800 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockApi(page); await enter(page); await acceptSetup(page);
  await page.getByLabel('如果现在面对对方，你会怎么说？').fill('我们明天下午三点一起确认维修安排，可以吗？');
  await page.getByRole('button', { name: '说给对方听', exact: true }).click();
  await expect(page.getByLabel('如果现在面对对方，你会怎么说？')).toHaveValue('');
  await page.getByRole('button', { name: '跳到之后的时间或场景', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '接下来，想进入哪个时刻？' })).toBeVisible();
  await page.addStyleTag({ content: '* { transition: none !important; animation: none !important; }' });
  const layout = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll<HTMLElement>('p,span,button,label,textarea,input,select,h1,h2,h3,strong,small,summary,a,figcaption,li')];
    const sizes = nodes.map(element => ({ element, size: Number.parseFloat(getComputedStyle(element).fontSize) }));
    for (const { element, size } of sizes) element.style.setProperty('font-size', `${size * 2}px`, 'important');
    const input = document.querySelector<HTMLTextAreaElement>('#custom-say')!;
    return { viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth, fontSize: getComputedStyle(input).fontSize, inlineStyle: input.style.cssText, inputs: document.querySelectorAll('#custom-say').length };
  });
  expect(Number.parseFloat(layout.fontSize), JSON.stringify(layout)).toBeGreaterThanOrEqual(28);
  expect(layout.document, JSON.stringify(layout)).toBeLessThanOrEqual(layout.viewport + 1);
  expect(layout.body, JSON.stringify(layout)).toBeLessThanOrEqual(layout.viewport + 1);
  await page.getByRole('textbox', { name: '接下来，想进入哪个时刻？' }).fill('下午三点，现场确认');
  const input = page.getByLabel('如果现在面对对方，你会怎么说？');
  await input.fill('我想先了解你的顾虑。'); await expect(input).toHaveValue('我想先了解你的顾虑。');
  await page.getByRole('button', { name: '← 返回练习主页', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: '← 返回练习主页', exact: true })).toBeVisible();
  await testInfo.attach('320px-double-text-chat', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
});

test('[朋友A mock] 未改原句不能循环准备，保留原文并把焦点交给方向选择', async ({ page }) => {
  const mock = await mockApi(page); const inputs: string[] = [];
  await page.route('**/api/practice-intake', async route => {
    const input = route.request().postDataJSON(); inputs.push(input.text);
    const ready = inputs.length > 1;
    await route.fulfill({ json: { intake: { version: 'practice-intake-v1', requestId: input.requestId, originalText: input.text, status: ready ? 'ready' : 'needs_context', canStartPractice: ready, reason: ready ? '可以开始。' : '先选这次想练的具体交流。', evidenceQuotes: [input.text], questions: ['想和学姐请教求职经验，还是练一次面试？'], suggestions: [] } } });
  });
  await page.goto('/?mode=custom&intent=new');
  const description = page.getByLabel('我想练习……', { exact: true });
  await description.fill('明年毕业，怕找不到工作');
  await page.getByRole('button', { name: '准备我的练习', exact: true }).click();
  const directions = page.getByRole('region', { name: '帮你找到练习的下一步' });
  await expect(directions).toBeFocused(); await expect(directions).toContainText('还没开始对话');
  await expect(page.getByRole('button', { name: '准备我的练习', exact: true })).toHaveCount(0);
  await expect(description).toHaveValue('明年毕业，怕找不到工作'); expect(inputs).toHaveLength(1); expect(mock.writes()).toBe(0);
  await page.getByRole('button', { name: '我来补充或修改描述', exact: true }).click(); await expect(description).toBeFocused();
  await description.fill('明年毕业，怕找不到工作。我想向学姐请教准备简历的方法，和她约个时间聊一聊。');
  await page.getByRole('button', { name: '用修改后的描述准备情境', exact: true }).click();
  await expect(page.getByRole('button', { name: '设定合适，开始对话', exact: true })).toBeVisible();
  expect(inputs).toHaveLength(2); expect(mock.writes()).toBe(1);
});

test('[朋友A mock] 空幕先回应，转场次于输入，具体切换后需要在新幕发言', async ({ page }) => {
  const mock = await mockApi(page); await enter(page); await acceptSetup(page);
  const say = page.getByLabel('如果现在面对对方，你会怎么说？');
  const advance = page.getByRole('button', { name: '跳到之后的时间或场景', exact: true });
  await expect(say).toBeFocused(); await expect(advance).toHaveCount(0);
  await expect(page.getByText('现在轮到你回应了。', { exact: false })).toBeVisible();
  expect(activeCustomBranch(mock.read())!.scenes ?? []).toHaveLength(0); expect(mock.sayings()).toBe(0);
  await say.fill('我想先了解你什么时候方便。'); await page.getByRole('button', { name: '说给对方听', exact: true }).click();
  await expect(say).toHaveValue(''); await expect(advance).toBeVisible();
  expect(await advance.evaluate(el => Boolean(document.querySelector('#custom-say')!.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await advance.click(); const destination = page.getByLabel('接下来，想进入哪个时刻？', { exact: true });
  await expect(destination).toHaveValue('');
  await expect(page.getByText('它不会替你发言', { exact: false })).toBeVisible();
  const switchScene = page.getByRole('button', { name: '切换到这个场景', exact: true }); await expect(switchScene).toBeDisabled();
  await destination.fill('下一幕'); await expect(switchScene).toBeDisabled();
  await destination.fill('明天下午三点，在房间里查看漏水'); await switchScene.click();
  await expect(page.getByText('当前模拟场景：明天下午三点，在房间里查看漏水', { exact: true })).toBeVisible();
  await expect(advance).toHaveCount(0); await expect(say).toBeFocused(); expect(activeCustomBranch(mock.read())!.scenes).toHaveLength(1);
  await page.reload(); await expect(advance).toHaveCount(0); expect(mock.sayings()).toBe(1);
});

test('[朋友A real GET] 手机准备页首屏可看玩法，返回后原描述仍在', async ({ page }) => {
  let writes = 0; await page.route('**/api/**', async route => { if (route.request().method() !== 'GET') { writes++; await route.abort(); } else await route.continue(); });
  await page.setViewportSize({ width: 320, height: 800 }); await page.goto('/?mode=custom&intent=new');
  const guide = page.getByRole('link', { name: /第一次来？先看怎么玩/ }); await expect(guide).toBeVisible();
  const bounds = await guide.boundingBox(); expect(bounds!.y + bounds!.height).toBeLessThan(800);
  const input = page.getByLabel('我想练习……', { exact: true }); await input.fill('我想和学姐聊一下简历，不知道怎样开口。');
  await guide.click(); await expect(page).toHaveURL(/\/how-it-works$/);
  await page.goBack(); await expect(input).toHaveValue('我想和学姐聊一下简历，不知道怎样开口。'); expect(writes).toBe(0);
});

test('服务已保存但回包中断，刷新恢复 actionId 后不会把草稿重复发送', async ({ page }) => {
  const mock = await mockApi(page, { loseReply: true }); await enter(page); await acceptSetup(page);
  const input = page.getByLabel('如果现在面对对方，你会怎么说？'); await input.fill('我先发照片，我们一起确认要修哪里。');
  await page.getByRole('button', { name: '说给对方听', exact: true }).click();
  await expect(page.getByRole('region', { name: '练自己的事', exact: true }).getByRole('alert')).toBeVisible(); await expect(input).toHaveValue('我先发照片，我们一起确认要修哪里。');
  await page.reload(); await expect(page.getByLabel('如果现在面对对方，你会怎么说？')).toHaveValue('');
  await expect(page.getByText('我先发照片，我们一起确认要修哪里。', { exact: true })).toBeVisible();
  expect(mock.sayings()).toBe(1);
  expect(await page.evaluate(id => localStorage.getItem(`practice-custom-pending:${id}`), mock.read().id)).toBeNull();
});

test('生成期间可以返回练习主页，晚到回应不会把用户拉回练习', async ({ page }) => {
  const waiting = deferred(); await mockApi(page, { delayCreate: waiting });
  await page.goto('/?mode=custom'); await page.getByLabel('我想练习……', { exact: true }).fill(topic);
  await page.getByRole('button', { name: '准备我的练习', exact: true }).click();
  await expect(page.getByRole('button', { name: '正在准备这次练习…', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '← 返回练习主页', exact: true }).click(); waiting.resolve();
  await expect(page.getByRole('heading', { name: '今天，想先练哪件事？' })).toBeVisible();
  await expect(page).not.toHaveURL(/mode=custom/);
});

test('未连接模型明确停止生成；手机自定义界面不横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 }); await mockApi(page, { available: false });
  await page.goto('/?mode=custom'); await page.getByLabel('我想练习……', { exact: true }).fill(topic);
  await expect(page.getByText('自由练习暂未连接模型。可以返回练习主页体验已有示例。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '准备我的练习', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('手机可展开确认过的情况和模拟假设，返回入口始终可用', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 }); await mockApi(page); await enter(page); await acceptSetup(page);
  await page.getByText('已确认的情况与模拟假设', { exact: true }).click();
  await expect(page.getByText('房东还没有亲眼看过漏水的位置', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '← 返回练习主页', exact: true }).click();
  await expect(page.getByRole('heading', { name: '今天，想先练哪件事？' })).toBeVisible();
});

test('生成失败的记录也能恢复和删除，描述与创建草稿一起清除', async ({ page }) => {
  await mockApi(page, { failCreate: true }); await page.goto('/?mode=custom');
  await page.getByLabel('我想练习……', { exact: true }).fill(topic);
  await page.getByRole('button', { name: '准备我的练习', exact: true }).click();
  await expect(page.getByText('情境生成暂时中断，可以稍后恢复。', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /和房东谈维修安排.*情境待生成/ }).click();
  await page.getByRole('button', { name: '删除这条未完成的练习', exact: true }).click();
  await page.getByRole('button', { name: '删除这条练习及所有尝试', exact: true }).click();
  await expect(page.getByRole('heading', { name: '有句话，想先练着说？' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('practice-custom-create-request'))).toBeNull();
});

const campusQuestion: CampusCorpusQuestion = {
  id: 'zhihu-q-123456789', questionId: '123456789', title: '和室友意见不同时，怎样把安排说清楚？', questionUrl: 'https://www.zhihu.com/question/123456789', category: '宿舍相处', tags: ['室友', '沟通'],
  answers: [{ answerId: '987654321', url: 'https://www.zhihu.com/question/123456789/answer/987654321', author: '浏览器测试作者', voteCount: 428, fetchedAt: '2026-09-13T00:00:00.000Z', excerpt: '浏览器测试摘要：先说具体影响，再商量一个可以检查的小安排。', summaryKind: 'search_excerpt', sourceContentId: 'mock-source', searchHashId: 'mock-search', viewpoints: ['先把影响说具体，让对方知道自己需要协商的是什么。', '为小安排留下检查和调整的机会。'] }],
  scenarioSeed: { userRole: '大一学生', counterpartRole: '室友', situation: '你们需要讨论晚上使用公共空间的安排。', goal: '说明各自需要并商量一次能检查的安排。' },
};
const sourceContext: CustomSourceContext = { version: 'browser-mock-v1', match: 'matched', questions: [campusQuestion], note: '浏览器契约测试来源，不表示真实采集或模型效果。' };

test('[认证约定 mock] 两处展示提议与接受原话，打开知乎观点对照且不自动结束', async ({ page }, testInfo) => {
  const mock = await mockApi(page, { goalOnSay: true, sourceContext }); await enter(page); await acceptSetup(page);
  await expect(page.getByRole('region', { name: '这次想谈成', exact: true })).toContainText(setup.goal);
  const input = page.getByLabel('如果现在面对对方，你会怎么说？');
  await input.fill('好，我先发照片，我们再一起确认维修安排。'); await page.getByRole('button', { name: '说给对方听', exact: true }).click();
  const review = page.getByTestId('goal-review'); await expect(review).toContainText('这次，你完成了模拟沟通目标');
  await expect(page.getByRole('region', { name: '这次想谈成', exact: true })).toHaveAttribute('data-goal-status', 'achieved');
  await review.getByText('查看判断依据：对话里的原话', { exact: true }).click();
  await expect(review.locator('details').getByText('好，我先发照片，我们再一起确认维修安排。', { exact: true })).toBeVisible();
  const agreements = review.getByRole('region', { name: '已核对的模拟约定' });
  await expect(agreements).toContainText('提议原话 · 你'); await expect(agreements).toContainText('接受原话 · 模拟中的对方');
  await expect(agreements.locator('blockquote').first()).toContainText(activeCustomBranch(mock.read())!.turns[0].userText);
  await expect(agreements.locator('blockquote').last()).toContainText(activeCustomBranch(mock.read())!.turns[0].reply);
  await expect(review).not.toContainText('不能展示的自由转述');
  expect(activeCustomBranch(mock.read())!.finished).toBe(false); expect(mock.sayings()).toBe(1);
  await input.fill('我还想继续问怎样检查修好没有。');
  await review.getByRole('button', { name: '看看知乎上的相似经验', exact: true }).click();
  const sources = page.getByRole('region', { name: '自由练习的知乎经验依据' });
  await expect(sources.getByRole('region', { name: '已核对的模拟约定' })).toContainText('提议原话 · 你');
  await expect(sources.getByRole('region', { name: '已核对的模拟约定' })).toContainText('接受原话 · 模拟中的对方');
  await expect(sources).not.toContainText('不能展示的自由转述');
  await expect(sources.getByRole('heading', { name: '你刚才的尝试，遇见别人的经验' })).toBeVisible();
  await expect(sources.getByRole('link', { name: campusQuestion.title })).toHaveAttribute('href', campusQuestion.questionUrl);
  await expect(sources.getByRole('link', { name: '去知乎读这条回答' })).toHaveAttribute('href', campusQuestion.answers[0].url);
  await expect(sources).toContainText('428 赞同 · 截至 2026-09-13'); await expect(sources).toContainText('原摘要里的一个片段');
  await sources.getByText('核对已取得的知乎摘要', { exact: true }).click();
  await expect(sources).toContainText('并非完整回答'); await expect(sources).toContainText(campusQuestion.answers[0].excerpt);
  await testInfo.attach('goal-zhihu-comparison-mock', { body: await sources.screenshot(), contentType: 'image/png' });
  await sources.getByRole('button', { name: '收起经验片段', exact: true }).click(); await expect(input).toHaveValue('我还想继续问怎样检查修好没有。');
  await page.reload(); await expect(page.getByTestId('goal-review')).toBeVisible(); expect(mock.sayings()).toBe(1);
  await testInfo.attach('goal-achieved-with-citations-mock', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
});

test('[客户端 mock] 旧对话可主动核对目标，保留原话、草稿和轮数', async ({ page }) => {
  const mock = await mockApi(page); await enter(page); await acceptSetup(page);
  const input = page.getByLabel('如果现在面对对方，你会怎么说？');
  await input.fill('我先发照片，咱们再商量。'); await page.getByRole('button', { name: '说给对方听', exact: true }).click();
  await expect(input).toHaveValue(''); const before = structuredClone(activeCustomBranch(mock.read())!.turns); const version = mock.read().version;
  await input.fill('这句还没有发送。'); await page.getByRole('button', { name: '核对这次目标进展', exact: true }).click();
  await expect(page.getByTestId('goal-review')).toContainText('完成了模拟沟通目标'); expect(activeCustomBranch(mock.read())!.turns).toEqual(before);
  expect(mock.read().version).toBe(version + 1); await expect(input).toHaveValue('这句还没有发送。');
});

test('[客户端 mock] 新一句尚无评估时不沿用旧达成提示，跳转链接仍可键盘使用', async ({ page }) => {
  const options = { goalOnSay: true }; await mockApi(page, options); await enter(page); await acceptSetup(page);
  const input = page.getByLabel('如果现在面对对方，你会怎么说？');
  await input.fill('先发照片，再一起确认安排。'); await page.getByRole('button', { name: '说给对方听', exact: true }).click();
  await expect(page.getByTestId('goal-review')).toBeVisible(); options.goalOnSay = false;
  await input.fill('我改主意了，这个安排还有个地方没说清。'); await page.getByRole('button', { name: '说给对方听', exact: true }).click();
  await expect(input).toHaveValue(''); await expect(page.getByTestId('goal-review')).toHaveCount(0);
  await expect(page.getByRole('region', { name: '这次想谈成', exact: true })).toContainText('进展待核对');
  const skip = page.getByRole('link', { name: '跳到主要内容', exact: true });
  const hidden = await skip.evaluate(element => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height, clip: getComputedStyle(element).clipPath }));
  expect(hidden.width).toBe(1); expect(hidden.height).toBe(1); expect(hidden.clip).toContain('50%');
  await skip.focus(); await expect(skip).toBeFocused();
  expect(await skip.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(1);
});

test('[客户端 mock] 题库从首页进入，分页筛选并携带精确问题标识创建练习', async ({ page }) => {
  const mock = await mockApi(page, { sourceContext }); const requests: URL[] = [];
  await page.route('**/api/campus-library?*', async route => {
    const url = new URL(route.request().url()); requests.push(url);
    await route.fulfill({ json: { version: 'browser-mock-v1', total: 25, categories: ['宿舍相处', '学业选择'], questions: [campusQuestion], highVoteThreshold: 100 } });
  });
  await page.goto('/?view=home'); await page.getByRole('button', { name: '从知乎校园问题开始', exact: true }).click();
  const library = page.getByRole('region', { name: '知乎校园问题库' });
  await expect(library).toContainText('找到 25 个问题');
  await library.getByRole('button', { name: '下一页', exact: true }).click(); await expect(library).toContainText('第 2 / 3 页');
  expect(requests.at(-1)!.searchParams.get('offset')).toBe('12');
  await library.getByRole('combobox', { name: '问题类别' }).selectOption('宿舍相处'); await expect(library).toContainText('第 1 / 3 页');
  await library.getByRole('textbox', { name: '找一件想练的事' }).fill('室友'); await library.getByRole('button', { name: '查找', exact: true }).click();
  await expect.poll(() => requests.at(-1)!.searchParams.get('q')).toBe('室友');
  await library.getByRole('button', { name: '用这个问题开始练习', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '我想练习……', exact: true })).toHaveValue(/大一学生/);
  await page.getByRole('button', { name: '准备我的练习', exact: true }).click(); await expect(page.getByRole('heading', { name: setup.title, exact: true })).toBeVisible();
  expect(mock.source()).toBe(campusQuestion.id);
  const createdId = mock.read().id; await page.reload();
  await expect(page.getByRole('button', { name: '设定合适，开始对话' })).toBeVisible(); expect(mock.read().id).toBe(createdId);
  await expect(page.getByLabel('我想练习……', { exact: true })).toHaveCount(0); await acceptSetup(page);
  await expect(page.getByRole('button', { name: '查看来源对照', exact: true })).toBeVisible();
});

test('[客户端 mock] 300字角色说明、目标和来源在320px及200%文字下不挤框', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 850 });
  const longRole = `你的家长（父亲或母亲），${'对你的升学选择感到不解，想听清具体打算与备用安排。'.repeat(8)}`;
  await mockApi(page, { counterpartRole: longRole, goalOnSay: true, sourceContext }); await enter(page); await acceptSetup(page);
  await expect(page.getByRole('heading', { name: '你的家长（父亲或母亲）', exact: true })).toBeVisible();
  await page.getByText('对方的完整角色说明', { exact: true }).click(); await expect(page.getByText(longRole, { exact: true })).toBeVisible();
  await page.getByLabel('如果现在面对对方，你会怎么说？').fill('我先说明自己的安排。'); await page.getByRole('button', { name: '说给对方听', exact: true }).click();
  await expect(page.getByTestId('goal-review')).toBeVisible();
  const boundaries = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll<HTMLElement>('p,span,button,label,textarea,input,select,h1,h2,h3,strong,summary,a,li')];
    const sizes = nodes.map(element => ({ element, size: Number.parseFloat(getComputedStyle(element).fontSize) }));
    for (const { element, size } of sizes) element.style.setProperty('font-size', `${size * 2}px`, 'important');
    return { width: innerWidth, scroll: document.documentElement.scrollWidth, buttons: [...document.querySelectorAll<HTMLElement>('nav[aria-label="练习导航"] button')].map(button => ({ left: button.getBoundingClientRect().left, right: button.getBoundingClientRect().right, padding: parseFloat(getComputedStyle(button).paddingLeft), content: button.scrollWidth, width: button.clientWidth })) };
  });
  expect(boundaries.scroll, JSON.stringify(boundaries)).toBeLessThanOrEqual(321);
  for (const button of boundaries.buttons) { expect(button.left).toBeGreaterThanOrEqual(0); expect(button.right).toBeLessThanOrEqual(321); expect(button.padding).toBeGreaterThanOrEqual(8); expect(button.content).toBeLessThanOrEqual(button.width + 1); }
  await testInfo.attach('goal-long-role-320-double-text-mock', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
});

test('[认证约定 mock] 旧达成记录保留状态与原话，两处隔离旧归纳且可主动重新核对', async ({ page }) => {
  const mock = await mockApi(page, { goalOnSay: true, goalMode: 'legacy', sourceContext }); await enter(page); await acceptSetup(page);
  const input = page.getByLabel('如果现在面对对方，你会怎么说？');
  await input.fill('请先介绍一下你愿意怎样帮忙。'); await page.getByRole('button', { name: '说给对方听', exact: true }).click();
  const before = structuredClone(mock.read()); const writes = mock.writes();
  const review = page.getByTestId('goal-review');
  await expect(review).toContainText('这次，你完成了模拟沟通目标');
  await expect(page.getByRole('region', { name: '这次想谈成', exact: true })).toHaveAttribute('data-goal-status', 'achieved');
  await expect(review).toContainText('这段历史记录的约定还需要重新核对');
  await expect(review).not.toContainText('不能展示的');
  await expect(review.getByRole('region', { name: '已核对的模拟约定' })).toHaveCount(0);
  await review.getByText('查看判断依据：对话里的原话', { exact: true }).click();
  await expect(review.locator('details')).toContainText(activeCustomBranch(before)!.turns[0].reply);
  await input.fill('这句只是草稿，还没有答应新增的安排。');
  await review.getByRole('button', { name: '看看知乎上的相似经验' }).click();
  const sources = page.getByRole('region', { name: '自由练习的知乎经验依据' });
  await expect(sources).toContainText('这段历史记录的约定还需要重新核对');
  await expect(sources).not.toContainText('不能展示的');
  await expect(sources.getByRole('region', { name: '已核对的模拟约定' })).toHaveCount(0);
  await sources.getByText('查看判断依据：对话里的原话', { exact: true }).click();
  await expect(sources.locator('details').first()).toContainText(activeCustomBranch(before)!.turns[0].userText);
  await sources.getByRole('button', { name: '收起经验片段' }).click();
  expect(mock.read()).toEqual(before); expect(mock.writes()).toBe(writes);
  await review.getByRole('button', { name: '重新核对目标与约定' }).click();
  await expect(review.getByRole('button', { name: '重新核对目标与约定' })).toHaveCount(0);
  expect(mock.writes()).toBe(writes + 1); expect(activeCustomBranch(mock.read())!.turns).toEqual(activeCustomBranch(before)!.turns);
  expect(activeCustomBranch(mock.read())!.goalProgress?.verificationVersion).toBe('goal-progress-v2');
  await expect(input).toHaveValue('这句只是草稿，还没有答应新增的安排。'); expect(activeCustomBranch(mock.read())!.finished).toBe(false);
});

test('[认证约定 mock] 请教学姐已回应目标，尚未接受的微信提议不出现在约定或经验对照中', async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: 'scope', description: '使用冻结的真实知乎问题数据，但对话与评估是UI契约fixture；不代表真实模型判断通过。' });
  const corpus = JSON.parse(await readFile(new URL('../../src/content/campus-corpus-data.json', import.meta.url), 'utf8')) as CampusCorpusQuestion[];
  const question = corpus.find(item => item.id === 'zhihu-q-40645474')!;
  expect(question).toBeDefined();
  const studentSetup: CustomSetup = { userRole: question.scenarioSeed.userRole, counterpartRole: question.scenarioSeed.counterpartRole, goal: question.scenarioSeed.goal, title: '向学姐请教备考思路', userFacts: ['我是来请教备考思路的大一学生。'], assumptions: ['学姐现在有一点空闲。'], openingLine: '你想先聊哪一门课的复习？' };
  const userText = '学姐你好，我想请教一门高学分课的备考思路，你现在方便交流几分钟吗？';
  const reply = '可以，我们先聊这门课怎样抓重点。要是方便的话，我们加个微信，晚上我给你发重点框架。';
  const mock = await mockApi(page, { goalOnSay: true, goalMode: 'no_agreement', customSetup: studentSetup, sayReply: reply, sourceContext: { version: 'frozen-question-ui-fixture', match: 'matched', basis: 'scenario', questions: [question], note: '题目来自冻结题库；此浏览器测试的对话由fixture提供。' } });
  await enter(page, studentSetup.title); await acceptSetup(page);
  const input = page.getByLabel('如果现在面对对方，你会怎么说？');
  await input.fill(userText); await page.getByRole('button', { name: '说给对方听', exact: true }).click();
  const review = page.getByTestId('goal-review');
  await expect(review).toContainText('这次，你完成了模拟沟通目标');
  await expect(review).toContainText('本次没有记录新的双方约定');
  await expect(review.getByRole('region', { name: '已核对的模拟约定' })).toHaveCount(0);
  await expect(review).not.toContainText('双方已约定加微信');
  expect(activeCustomBranch(mock.read())!.goalProgress?.agreements).toHaveLength(0);
  expect(activeCustomBranch(mock.read())!.finished).toBe(false);
  await input.fill('谢谢。我想先在这里聊，不加微信。');
  await review.getByRole('button', { name: '看看知乎上的相似经验' }).click();
  const sources = page.getByRole('region', { name: '自由练习的知乎经验依据' });
  await expect(sources.getByRole('region', { name: '我的尝试对照' })).toContainText('本次没有记录新的双方约定');
  await expect(sources.getByRole('region', { name: '已核对的模拟约定' })).toHaveCount(0);
  await expect(sources).not.toContainText('双方已约定加微信');
  await expect(sources.getByRole('link', { name: question.title, exact: true })).toHaveAttribute('href', question.questionUrl);
  await expect(sources).toContainText(`${question.answers[0].voteCount.toLocaleString('zh-CN')} 赞同`);
  await expect(sources.getByRole('link', { name: '去知乎读这条回答', exact: true })).toHaveAttribute('href', question.answers[0].url);
  await sources.getByText('查看判断依据：对话里的原话', { exact: true }).click();
  await expect(sources.locator('details').first()).toContainText(reply);
  await testInfo.attach('student-goal-without-agreement-ui-fixture', { body: await sources.screenshot(), contentType: 'image/png' });
  await sources.getByRole('button', { name: '收起经验片段' }).click();
  await expect(input).toHaveValue('谢谢。我想先在这里聊，不加微信。'); expect(mock.sayings()).toBe(1);
  await page.reload(); await expect(page.getByTestId('goal-review')).toContainText('本次没有记录新的双方约定');
  await expect(input).toBeEditable(); expect(activeCustomBranch(mock.read())!.finished).toBe(false);
});

test('[场景提示 mock] 新幕无对方头像或代发言，草稿聚焦和刷新恢复后由用户开口', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 850 });
  const availability = { sceneOpeningKind: 'guide' as const, available: true };
  const mock = await mockApi(page, availability);
  await enter(page); await acceptSetup(page);
  const input = page.getByLabel('如果现在面对对方，你会怎么说？');
  await input.fill('今天下午三点方便来看一下漏水位置吗？');
  await page.getByRole('button', { name: '说给对方听', exact: true }).click();
  await expect(input).toHaveValue('');
  const previousTurns = structuredClone(activeCustomBranch(mock.read())!.turns);
  const transcript = page.getByLabel('自由练习对话记录', { exact: true });
  const counterpartMessages = transcript.locator('[data-speaker="counterpart"]');
  await expect(counterpartMessages).toHaveCount(2);
  const draft = '我想先指出墙角渗水的位置。';
  await input.fill(draft);
  availability.available = false;
  await page.reload();
  await expect(input).toHaveValue(draft);
  await expect(page.getByRole('button', { name: '说给对方听', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '跳到之后的时间或场景', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '跳到之后的时间或场景', exact: true }).click();
  const destination = '今天下午三点，在房间里一起查看漏水位置';
  await page.getByLabel('接下来，想进入哪个时刻？', { exact: true }).fill(destination);
  await page.getByRole('button', { name: '切换到这个场景', exact: true }).click();
  const guide = transcript.getByRole('region', { name: '场景提示', exact: true });
  await expect(guide).toBeVisible();
  await expect(guide).toHaveText('场景提示已进入你选择的模拟场景。你准备先对对方说什么？');
  await expect(guide.locator('[data-avatar-src], [data-speaker]')).toHaveCount(0);
  await expect(guide).not.toContainText(destination);
  await expect(page.getByText(`你选定的模拟场景：${destination}`, { exact: true })).toBeVisible();
  await expect(counterpartMessages).toHaveCount(2);
  await expect(input).toHaveValue(draft); await expect(input).toBeFocused();
  await expect(page.getByRole('button', { name: '跳到之后的时间或场景', exact: true })).toHaveCount(0);
  expect(activeCustomBranch(mock.read())!.turns).toEqual(previousTurns); expect(mock.sayings()).toBe(1);
  await page.reload();
  await expect(guide).toBeVisible(); await expect(input).toHaveValue(draft);
  await expect(counterpartMessages).toHaveCount(2);
  expect(mock.sayings()).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await testInfo.attach('scene-guide-restored-320', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  availability.available = true;
  await page.reload();
  await expect(input).toHaveValue(draft);
  await expect(page.getByRole('button', { name: '说给对方听', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '说给对方听', exact: true }).click();
  await expect(input).toHaveValue('');
  await expect(counterpartMessages).toHaveCount(3);
  expect(mock.sayings()).toBe(2);
  expect(activeCustomBranch(mock.read())!.turns[1].userText).toBe(draft);
  await expect(guide).toBeVisible();
  await expect(page.getByRole('button', { name: '跳到之后的时间或场景', exact: true })).toBeVisible();
});
