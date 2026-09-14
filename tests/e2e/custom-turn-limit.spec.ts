import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from './fixtures';
import { activeCustomBranch, type CustomAction, type CustomPracticeView } from '../../src/domain/custom-practice';

async function twentyTurnPractice(page: Page) {
  const now = new Date().toISOString(); const branchId = randomUUID();
  const session: CustomPracticeView = {
    id: randomUUID(), version: 21, topic: '和房东商量漏水维修的安排。', createdAt: now, updatedAt: now,
    expiresAt: new Date(Date.now() + 86400000).toISOString(), sourceVersion: 'browser-turn-limit-fixture',
    generating: false, pendingAction: null, activeBranchId: branchId,
    branches: [{ id: branchId, parentId: null, label: '第一次尝试', accepted: true, finished: false, createdAt: now,
      setup: { title: '核对维修安排', userRole: '租住这间房的人', counterpartRole: '房东', goal: '问清怎样检查漏水和安排维修',
        userFacts: ['房间有漏水情况'], assumptions: ['房东还没有亲眼看过'], openingLine: '方便说说漏水的位置吗？' },
      turns: Array.from({ length: 20 }, (_, index) => ({ id: randomUUID(), userText: `第${index + 1}次表达：我想核对维修安排。`, reply: '先把位置说清楚，再商量安排。', reflection: '', supportedQuote: '', sourceId: null, createdAt: now })),
    }],
  };
  const original = structuredClone(session.branches[0]); const actions: CustomAction[] = []; const unexpected: string[] = [];
  const draft = '这句草稿尚未发送，退回后继续修改。';
  await page.addInitScript(({ id, draft }) => { localStorage.setItem('practice-custom-selected', id); localStorage.setItem(`practice-custom-draft:${id}`, draft); }, { id: session.id, draft });
  await page.route('**/api/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path === '/api/custom-practices') {
      await route.fulfill({ json: { available: true, sessions: [{ id: session.id, title: '核对维修安排', updatedAt: now, turns: 20, ready: true }] } }); return;
    }
    if (request.method() === 'GET' && path === `/api/custom-practices/${session.id}`) { await route.fulfill({ json: { session } }); return; }
    if (request.method() === 'POST' && path === `/api/custom-practices/${session.id}`) {
      const action = request.postDataJSON() as CustomAction; actions.push(action);
      if (action.expectedVersion !== session.version) { await route.fulfill({ status: 409, json: { error: { message: '测试记录版本已更新。' } } }); return; }
      const active = activeCustomBranch(session)!;
      if (action.kind === 'finish') active.finished = true;
      else if (action.kind === 'rewind' || action.kind === 'edit_counterpart_reply') {
        const next = structuredClone(active); next.id = randomUUID(); next.parentId = active.id; next.finished = false; delete next.goalProgress;
        if (action.kind === 'rewind') { next.label = '退回上一步'; next.turns.pop(); }
        else {
          next.label = '调整对方回应'; const last = next.turns.at(-1)!;
          last.replyOrigin = { kind: 'user_edit', branchId: active.id, turnId: last.id }; last.id = action.actionId; last.reply = action.reply; delete last.goalProgress;
        }
        session.branches.push(next); session.activeBranchId = next.id;
      } else {
        unexpected.push(action.kind); await route.fulfill({ status: 503, json: { error: { message: '本次边界检查不调用模型或发送新一轮。' } } }); return;
      }
      session.version++; await route.fulfill({ json: { session } }); return;
    }
    if (request.method() !== 'GET') unexpected.push(`${request.method()} ${path}`);
    await route.fulfill({ status: 503, json: { error: { message: '浏览器上限检查的隔离接口。' } } });
  });
  await page.goto('/?mode=custom');
  await expect(page.getByRole('region', { name: '本次尝试已到轮数上限', exact: true })).toBeVisible();
  return { session, original, actions, unexpected, draft };
}

async function expectNoNextTurn(page: Page) {
  await expect(page.getByLabel('如果现在面对对方，你会怎么说？')).toHaveCount(0);
  await expect(page.getByTestId('reply-choices')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '跳到之后的时间或场景', exact: true })).toHaveCount(0);
}

test('[20轮客户端 mock] 回应可调整但新尝试仍到上限，可以保存复盘', async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: 'scope', description: '20轮状态和保存由客户端API mock提供；仅核对上限UI，不证明服务端或模型上限。' });
  await page.setViewportSize({ width: 320, height: 850 });
  const mock = await twentyTurnPractice(page); await expectNoNextTurn(page);
  await page.getByRole('button', { name: '调整对方这句回应', exact: true }).click();
  await page.getByLabel('你觉得对方会怎样说？').fill('我需要先问维修师傅，暂时还不能确定时间。');
  await expect(page.getByRole('button', { name: '保存调整，继续练', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '保存调整', exact: true }).click();
  await expect(page.getByText('房东 · 回应由你调整', { exact: true })).toBeVisible();
  await expectNoNextTurn(page);
  await expect(page.getByRole('region', { name: '本次尝试已到轮数上限', exact: true })).toContainText('这次已练到 20 轮');
  expect(activeCustomBranch(mock.session)?.turns).toHaveLength(20);
  expect(mock.session.branches[0]).toEqual(mock.original);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(321);
  await testInfo.attach('twenty-turn-edit-320', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  await page.getByRole('button', { name: '先练到这里，保存复盘', exact: true }).click();
  await expect(page.getByRole('heading', { name: '把这次尝试，变成自己的经验', exact: true })).toBeVisible();
  expect(activeCustomBranch(mock.session)?.finished).toBe(true);
  expect(mock.actions.map(action => action.kind)).toEqual(['edit_counterpart_reply', 'finish']); expect(mock.unexpected).toEqual([]);
});

test('[20轮客户端 mock] 退回十九轮恢复草稿、输入和可选建议，原二十轮不改写', async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: 'scope', description: '模拟20轮存档与退回响应，核对客户端恢复；不发送新对话或调用模型。' });
  const mock = await twentyTurnPractice(page); await expectNoNextTurn(page);
  await page.getByRole('button', { name: '← 返回上一步，换个说法', exact: true }).click();
  await expect(page.getByRole('region', { name: '本次尝试已到轮数上限', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('如果现在面对对方，你会怎么说？')).toHaveValue(mock.draft);
  await expect(page.getByRole('button', { name: '说给对方听', exact: true })).toBeEnabled();
  await expect(page.getByTestId('reply-choices')).toBeVisible();
  await expect(page.getByRole('button', { name: '跳到之后的时间或场景', exact: true })).toBeVisible();
  expect(activeCustomBranch(mock.session)?.turns).toHaveLength(19); expect(mock.session.branches[0]).toEqual(mock.original);
  expect(mock.actions.map(action => action.kind)).toEqual(['rewind']); expect(mock.unexpected).toEqual([]);
  await testInfo.attach('nineteen-turn-restored-draft', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
});
