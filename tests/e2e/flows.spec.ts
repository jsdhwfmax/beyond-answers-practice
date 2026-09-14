import { openChapters, expect, test, type Page, type TestInfo } from './fixtures';
import type { ScenarioId, SessionView } from '../../src/domain/types';

// These tests exercise real action APIs and persistence; the separate reply-options request is isolated by fixtures.
// API requests only establish isolated non-campus sessions and inspect saved facts.
const ORIGIN = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';
test.use({ baseURL: ORIGIN });

const board = (page: Page) => page.getByRole('region', { name: '我们的约定', exact: true });

async function currentId(page: Page): Promise<string> {
  const id = await page.evaluate(() => JSON.parse(localStorage.getItem('beyond.session.v1') ?? 'null') as string | null);
  expect(id).toBeTruthy();
  return id!;
}

async function savedSession(page: Page, id?: string): Promise<SessionView> {
  const response = await page.request.get(`/api/sessions/${id ?? await currentId(page)}`);
  expect(response.ok()).toBe(true);
  return (await response.json() as { session: SessionView }).session;
}

async function attachState(page: Page, testInfo: TestInfo, label: string) {
  await testInfo.attach(label, { body: JSON.stringify(await savedSession(page), null, 2), contentType: 'application/json' });
}

async function startCampus(page: Page) {
  await page.goto('/?view=home');
  await openChapters(page);
  await page.getByRole('button', { name: '进入校园协作练习', exact: true }).click();
  await expect(board(page)).toBeVisible();
  await expect(board(page).getByText('原有安排', { exact: true })).toBeVisible();
}

async function startIsolated(page: Page, scenario: Exclude<ScenarioId, 'campus'>) {
  await page.goto('/?view=home');
  await openChapters(page);
  await page.getByRole('button', { name: scenario === 'transfer' ? '进入半小时小任务' : '进入职场协商练习', exact: true }).click();
  await expect(board(page)).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(scenario === 'transfer' ? '今晚先完成什么' : '下一站：入职第一周');
  const helpers = page.locator('.optional-actions');
  if (!await helpers.getAttribute('open').then(value => value !== null)) await helpers.locator('summary').click();
}

async function proposeGuide(page: Page, acknowledgeInEditor = false) {
  await page.getByRole('button', { name: '安排任务', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '把安排摆到桌上', exact: true });
  await editor.getByRole('checkbox', { name: /^接入三个静态引导入口/ }).check();
  if (acknowledgeInEditor) await editor.getByRole('checkbox', { name: /^明确有限引导的范围/ }).check();
  await editor.getByRole('button', { name: '交给大家确认', exact: true }).click();
  await expect(editor).not.toBeVisible();
}

test('校园 A：先待确认再明确范围，完成回看且刷新恢复相同记录', async ({ page }, testInfo) => {
  await startCampus(page);
  const original = await savedSession(page);
  if (!original.capabilities.naturalLanguage) await expect(page.getByRole('textbox', { name: '写下你的问题、安排或需要澄清的地方' })).toBeDisabled();
  await page.getByRole('button', { name: '项目资料', exact: true }).click();
  await page.getByRole('button', { name: '模拟试用反馈', exact: true }).click();
  await expect(page.getByText(/当前首要目的，是帮助第一次打开页面的人找到三个主要入口/)).toBeVisible();

  await proposeGuide(page);
  await expect(board(page).getByRole('heading', { name: '这份提议尚未生效', exact: true })).toBeVisible();
  await expect(board(page).locator('.task-list > li')).toHaveCount(7);
  const pending = await savedSession(page);
  expect(pending.state.taskIds).toEqual(original.state.taskIds);
  expect(pending.state.schedule).toEqual(original.state.schedule);
  expect(pending.state.proposal?.status).toBe('pending');

  await board(page).getByRole('button', { name: /^明确有限引导的范围/ }).click();
  await expect(board(page).getByText('已确认', { exact: true })).toBeVisible();
  await expect(board(page).locator('.task-list > li')).toHaveCount(8);
  await expect(board(page).getByText('周衡 · 21:00–22:00', { exact: true })).toBeVisible();
  await expect(board(page).getByText('静态引导只导航到三个入口，不支持自由问答。', { exact: true })).toBeVisible();
  const accepted = await savedSession(page);
  expect(accepted.state.proposal?.acceptedBy).toEqual(['lin', 'xu', 'zhou']);
  expect(accepted.state.taskIds).toContain('G');
  expect(accepted.events.some(event => event.kind === 'actor_acceptance' && event.actor === 'lin')).toBe(true);

  await page.getByRole('button', { name: '完成练习，保存复盘', exact: true }).click();
  const report = page.getByRole('dialog', { name: '把这一次，留给下一次', exact: true });
  await expect(report.getByText('已形成模拟中的确认约定', { exact: true })).toBeVisible();
  await expect(report.getByRole('heading', { name: '变化，有迹可循', exact: true })).toBeVisible();
  const finished = await savedSession(page);
  expect(finished.state.phase).toBe('ended');
  await attachState(page, testInfo, 'campus-confirmed-before-refresh');
  await page.reload();
  await expect(board(page).getByText('已确认', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '回看已保存的记录', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '写下你的问题、安排或需要澄清的地方', exact: true })).toBeDisabled();
  const restored = await savedSession(page);
  expect(restored.id).toBe(finished.id);
  expect(restored.version).toBe(finished.version);
  expect(restored.state).toEqual(finished.state);
  expect(restored.events).toEqual(finished.events);
  await board(page).getByRole('button', { name: '查看本次记录', exact: true }).click();
  await expect(report.getByText('已形成模拟中的确认约定', { exact: true })).toBeVisible();
});

test('同条件重试建立独立分支：新尝试选择暂缓，不改写原已接受方案', async ({ page }, testInfo) => {
  await startCampus(page);
  await page.getByRole('button', { name: '项目资料', exact: true }).click();
  await page.getByRole('button', { name: '模拟试用反馈', exact: true }).click();
  await expect(page.getByText(/当前首要目的，是帮助第一次打开页面的人找到三个主要入口/)).toBeVisible();
  const beforeProposal = await savedSession(page);
  await proposeGuide(page, true);
  await expect(board(page).getByText('已确认', { exact: true })).toBeVisible();
  const parent = await savedSession(page);
  await board(page).getByRole('button', { name: '回到一个时刻', exact: true }).click();
  const retry = page.getByRole('dialog', { name: '回到同一个时刻', exact: true });
  await expect(retry.getByText('首次范围提议之前', { exact: true })).toBeVisible();
  await expect(retry.getByRole('combobox')).toHaveCount(0);
  await retry.getByRole('button', { name: '从这里重新尝试', exact: true }).click();
  await expect(retry).not.toBeVisible();
  await expect(board(page).getByText('原有安排', { exact: true })).toBeVisible();
  const fork = await savedSession(page);
  expect(fork.id).not.toBe(parent.id);
  expect(fork.parentId).toBe(parent.id);
  expect(fork.state.taskIds).not.toContain('G');
  expect(fork.events).toEqual(beforeProposal.events);
  expect(fork.state.revealed).toEqual(beforeProposal.state.revealed);

  await proposeGuide(page);
  await expect(board(page).getByRole('heading', { name: '这份提议尚未生效', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '对照两次尝试', exact: true }).click();
  const comparison = page.getByRole('dialog', { name: '两次尝试，放在一起看', exact: true });
  const scheduleComparison = comparison.locator('.comparison-row').filter({ has: page.getByRole('heading', { name: '负责人和排期', exact: true }) }).locator('.comparison-values > div');
  await expect(scheduleComparison.nth(0).getByText('周衡 · 接入三个静态引导入口 · 21:00–22:00', { exact: true })).toBeVisible();
  await expect(scheduleComparison.nth(1).getByText(/接入三个静态引导入口/)).toHaveCount(0);
  await expect(scheduleComparison.nth(1).getByRole('listitem')).toHaveCount(fork.state.schedule.length);
  await expect(scheduleComparison.nth(1).getByText('许念 · 合并视觉精修 · 20:00–21:00', { exact: true })).toBeVisible();
  const pendingComparison = comparison.locator('.comparison-row').filter({ has: page.getByRole('heading', { name: '待确认的条件', exact: true }) }).locator('.comparison-values > div').nth(1);
  await expect(pendingComparison.getByText('当前提议尚未确认。', { exact: true })).toBeVisible();
  await expect(pendingComparison.getByText(/这次只把新生带到三个入口，还不能自由提问/)).toBeVisible();
  await expect(pendingComparison.getByText('尚未记录', { exact: true })).toHaveCount(0);
  await comparison.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await page.getByRole('button', { name: '安排任务', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '把安排摆到桌上', exact: true });
  await editor.getByRole('checkbox', { name: /^接入三个静态引导入口/ }).uncheck();
  await editor.getByRole('checkbox', { name: /^新增需要留待后续评估/ }).check();
  await editor.getByRole('button', { name: '交给大家确认', exact: true }).click();
  await expect(editor).not.toBeVisible();
  await expect(board(page).getByText('已确认', { exact: true })).toBeVisible();
  await expect(board(page).getByText(/保留 60 分钟未分配容量/)).toBeVisible();
  await expect(board(page).getByText('后续新功能的工作量、负责人和期限仍待评估。', { exact: true })).toBeVisible();
  const child = await savedSession(page);
  const unchangedParent = await savedSession(page, parent.id);
  expect(unchangedParent.version).toBe(parent.version);
  expect(unchangedParent.state).toEqual(parent.state);
  expect(unchangedParent.events).toEqual(parent.events);
  expect(child.state.taskIds).not.toContain('G');
  await page.getByRole('button', { name: '对照两次尝试', exact: true }).click();
  await expect(comparison.getByText('原来的尝试', { exact: true })).toBeVisible();
  await expect(comparison.getByText('接入三个静态引导入口', { exact: true })).toHaveCount(1);
  await expect(scheduleComparison.nth(0).getByText('周衡 · 接入三个静态引导入口 · 21:00–22:00', { exact: true })).toBeVisible();
  await expect(scheduleComparison.nth(1).getByText(/接入三个静态引导入口/)).toHaveCount(0);
  await expect(scheduleComparison.nth(1).getByRole('listitem')).toHaveCount(child.state.schedule.length);
  await expect(comparison.getByText(/后续新功能的工作量、负责人和期限仍待评估/)).toBeVisible();
  await attachState(page, testInfo, 'campus-independent-retry');
});

test('纠正分支可从已接受安排后的完整节点继续，切回教学重试仍固定提议前', async ({ page }) => {
  await startCampus(page);
  await proposeGuide(page, true);
  await expect(board(page).getByText('已确认', { exact: true })).toBeVisible();
  const parent = await savedSession(page);
  await board(page).getByRole('button', { name: '回到一个时刻', exact: true }).click();
  const retry = page.getByRole('dialog', { name: '回到同一个时刻', exact: true });
  await retry.getByRole('radio', { name: '纠正被误解的表达', exact: true }).check();
  const selector = retry.getByRole('combobox', { name: '从哪个节点继续', exact: true });
  const boundaries = parent.events.filter((event, index, events) => index === events.length - 1 || event.actionId !== events[index + 1]?.actionId);
  await expect(selector.getByRole('option')).toHaveCount(boundaries.length + 1);
  await selector.selectOption(String(parent.events.at(-1)!.sequence));
  await retry.getByRole('radio', { name: '再试一种做法', exact: true }).check();
  await expect(retry.getByRole('combobox')).toHaveCount(0);
  await expect(retry.getByText('首次范围提议之前', { exact: true })).toBeVisible();
  await retry.getByRole('radio', { name: '纠正被误解的表达', exact: true }).check();
  await expect(selector).toHaveValue(String(parent.events.at(-1)!.sequence));
  await retry.getByRole('button', { name: '从这里重新尝试', exact: true }).click();
  await expect(retry).not.toBeVisible();
  const fork = await savedSession(page);
  expect(fork.parentId).toBe(parent.id);
  expect(fork.forkReason).toBe('correction');
  expect(fork.events).toEqual(parent.events);
  expect(fork.state.taskIds).toEqual(parent.state.taskIds);
  expect(fork.state.agreement.status).toBe('confirmed');
});

test('校园短练习：计划不是完成，发布之前不能验收，发布后核对共 25 分钟', async ({ page }, testInfo) => {
  await startIsolated(page, 'transfer');
  await page.getByRole('button', { name: '加入发布可试用版本', exact: true }).click();
  await page.getByRole('button', { name: '加入按验收条件检查', exact: true }).click();
  await page.getByRole('button', { name: '保存计划，开始执行', exact: true }).click();
  const execute = page.getByRole('region', { name: '今晚，先完成什么？', exact: true });
  await expect(execute.getByRole('button', { name: /^发布可试用版本 执行会推进/ })).toBeVisible();
  await expect(board(page).getByText('已用 0 分钟', { exact: true })).toBeVisible();
  let saved = await savedSession(page);
  expect(saved.state.transfer).toMatchObject({ firstPlan: ['publish', 'verify'], firstAssisted: false, published: false, verified: false, elapsed: 0 });

  await execute.getByRole('button', { name: /^按验收条件检查 执行会推进/ }).click();
  await expect(page.getByText('还没有可用预览，不能先核对提交记录。', { exact: true })).toBeVisible();
  expect((await savedSession(page)).state.transfer.elapsed).toBe(0);
  await execute.getByRole('button', { name: /^发布可试用版本 执行会推进/ }).click();
  await expect(board(page).getByText('已用 15 分钟', { exact: true })).toBeVisible();
  await expect(execute.getByRole('button', { name: /^发布可试用版本 已执行/ })).toBeDisabled();
  saved = await savedSession(page);
  expect(saved.state.transfer).toMatchObject({ published: true, verified: false });
  await execute.getByRole('button', { name: /^按验收条件检查 执行会推进/ }).click();
  await expect(board(page).getByText('已用 25 分钟', { exact: true })).toBeVisible();
  await expect(board(page).getByText('已确认', { exact: true })).toBeVisible();
  saved = await savedSession(page);
  expect(saved.state.transfer).toMatchObject({ published: true, verified: true, completed: ['publish', 'verify'], firstAssisted: false });
  await page.getByRole('button', { name: '完成练习，保存复盘', exact: true }).click();
  const report = page.getByRole('dialog', { name: '把这一次，留给下一次', exact: true });
  await expect(report.getByText('模拟发布与验收已完成', { exact: true })).toBeVisible();
  await expect(report.getByText('这次模拟不能证明现实任务已经完成。', { exact: false })).toBeVisible();
  await attachState(page, testInfo, 'transfer-published-and-verified');
  await report.getByRole('button', { name: '继续试试', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('下一站：入职第一周');
});

test('职场预告：拒绝不会改写旧约定；明确申请 16:00 后才接受，排期 15:30 完成', async ({ page }, testInfo) => {
  await startIsolated(page, 'workplace');
  const initial = await savedSession(page);
  await page.getByRole('button', { name: '提出这份安排', exact: true }).click();
  await expect(board(page).getByText('竞品表截止 15:00', { exact: true })).toBeVisible();
  await expect(board(page).getByText(/需明确请求调整旧截止/)).toBeVisible();
  expect((await savedSession(page)).state.schedule).toEqual(initial.state.schedule);
  // The active agreement must not display an unaccepted candidate as live work.
  await expect(board(page).locator('.task-list > li')).toHaveCount(1);
  await expect(board(page).getByText('13:00–14:00', { exact: true })).toBeVisible();
  const rejected = await savedSession(page);
  await board(page).getByRole('button', { name: '回到一个时刻', exact: true }).click();
  const retry = page.getByRole('dialog', { name: '回到同一个时刻', exact: true });
  await retry.getByRole('radio', { name: '纠正被误解的表达', exact: true }).check();
  await retry.getByRole('combobox', { name: '从哪个节点继续', exact: true }).selectOption(String(rejected.events.at(-1)!.sequence));
  await retry.getByRole('button', { name: '从这里重新尝试', exact: true }).click();
  await expect(retry).not.toBeVisible();
  await page.getByRole('button', { name: '对照两次尝试', exact: true }).click();
  const comparison = page.getByRole('dialog', { name: '两次尝试，放在一起看', exact: true });
  const scheduleComparison = comparison.locator('.comparison-row').filter({ has: page.getByRole('heading', { name: '负责人和排期', exact: true }) });
  await expect(scheduleComparison.getByText('你 · 竞品表 · 13:00–14:00', { exact: true })).toHaveCount(2);
  await expect(scheduleComparison.getByText(/演示摘要/)).toHaveCount(0);
  const pendingComparison = comparison.locator('.comparison-row').filter({ has: page.getByRole('heading', { name: '待确认的条件', exact: true }) });
  await expect(pendingComparison.getByText('竞品表会超过原承诺 15:00，需明确请求调整旧截止。', { exact: true })).toHaveCount(2);
  await comparison.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await page.getByRole('checkbox', { name: /^说明旧承诺受到影响，并请求把竞品表调整到 16:00/ }).check();
  await page.getByRole('button', { name: '提出这份安排', exact: true }).click();
  await expect(board(page).getByText('竞品表截止 16:00', { exact: true })).toBeVisible();
  await expect(board(page).getByText('负责人已确认本次调整', { exact: true })).toBeVisible();
  await expect(board(page).getByText('13:00–14:30', { exact: true })).toBeVisible();
  await expect(board(page).getByText('14:30–15:30', { exact: true })).toBeVisible();
  const accepted = await savedSession(page);
  expect(accepted.state.workplace).toMatchObject({ managerAccepted: true, tableDeadline: 960, issues: [] });
  expect(accepted.events.some(event => event.kind === 'manager_acceptance' && event.text.includes('16:00'))).toBe(true);
  await page.getByRole('button', { name: '完成练习，保存复盘', exact: true }).click();
  await expect(page.getByRole('dialog').getByText('负责人已接受当前生效安排', { exact: true })).toBeVisible();
  await attachState(page, testInfo, 'workplace-explicitly-accepted-deadline');
});

test('短练习首次计划前查看经验书架，辅助记录不能遗漏或在重试时洗掉', async ({ page }) => {
  await startIsolated(page, 'transfer');
  await page.getByRole('button', { name: '借一条经验', exact: true }).click();
  const sources = page.getByRole('dialog', { name: '练习方法来源', exact: true });
  await expect(sources.getByText('刀熊说说', { exact: true })).toBeVisible();
  await sources.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await page.getByRole('button', { name: '加入发布可试用版本', exact: true }).click();
  await page.getByRole('button', { name: '加入按验收条件检查', exact: true }).click();
  await page.getByRole('button', { name: '保存计划，开始执行', exact: true }).click();
  await expect(page.getByRole('button', { name: /^发布可试用版本 执行会推进/ })).toBeVisible();
  const parent = await savedSession(page);
  expect(parent.state.transfer.firstAssisted).toBe(true);
  expect(parent.state.transfer.firstPlan).toEqual(['publish', 'verify']);
  await board(page).getByRole('button', { name: '回到一个时刻', exact: true }).click();
  const retry = page.getByRole('dialog', { name: '回到同一个时刻', exact: true });
  await expect(retry.getByText('首次范围提议之前', { exact: true })).toBeVisible();
  await expect(retry.getByRole('combobox')).toHaveCount(0);
  await retry.getByRole('button', { name: '从这里重新尝试', exact: true }).click();
  await expect(retry).not.toBeVisible();
  const fork = await savedSession(page);
  expect(fork.state.transfer.firstAssisted).toBe(true);
  expect(fork.state.transfer.firstPlan).toEqual(parent.state.transfer.firstPlan);
  await board(page).getByRole('button', { name: '查看本次记录', exact: true }).click();
  await expect(page.getByRole('dialog').getByText(/不能作为无提示表现/)).toBeVisible();
});

test('只撤下精修合并仍可保留文案和版式，保存原话不得夸大为放弃全部精修', async ({ page }) => {
  await startCampus(page);
  await page.getByRole('button', { name: '安排任务', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '把安排摆到桌上', exact: true });
  await editor.getByRole('checkbox', { name: /^合并视觉精修/ }).uncheck();
  await editor.getByRole('checkbox', { name: /^接入三个静态引导入口/ }).check();
  await editor.getByRole('checkbox', { name: /^明确有限引导的范围/ }).check();
  await editor.getByRole('checkbox', { name: /^协商替换原视觉交付/ }).check();
  await editor.getByRole('button', { name: '交给大家确认', exact: true }).click();
  await expect(editor).not.toBeVisible();
  await expect(board(page).getByText('已确认', { exact: true })).toBeVisible();
  await expect(board(page).getByText('整理精修文案', { exact: true })).toBeVisible();
  await expect(board(page).getByText('完成精细版式', { exact: true })).toBeVisible();
  await expect(board(page).getByText('合并视觉精修', { exact: true })).toHaveCount(0);
  const saved = await savedSession(page);
  expect(saved.state.taskIds).toEqual(expect.arrayContaining(['V1', 'V2', 'G']));
  expect(saved.state.taskIds).not.toContain('V3');
  const input = saved.events.find(event => event.actor === 'user' && event.kind === 'input');
  expect(input?.text).not.toContain('放弃视觉精修');
  expect(input?.text).toContain('精修');
});
