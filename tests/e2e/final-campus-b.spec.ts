import { openChapters, expect, test } from './fixtures';
import type { SessionView } from '../../src/domain/types';

test('校园 B：替换精修需确认，限定问答排期成立且刷新保留', async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: 'scope', description: '真实本地规则与持久化；只发送明确结构化操作，自然语言请求被阻止，回复建议保持默认 mock。' });
  const unexpectedText: string[] = [];
  await page.route('**/api/sessions/*/actions', async route => {
    const input = route.request().postDataJSON();
    if (input.text) {
      unexpectedText.push(input.text);
      await route.fulfill({ status: 503, json: { error: { message: '此结构化场景验收不调用模型。' } } });
      return;
    }
    await route.continue();
  });
  await page.goto('/?view=home'); await openChapters(page);
  await page.getByRole('button', { name: '进入校园协作练习', exact: true }).click();
  const board = page.getByRole('region', { name: '我们的约定', exact: true });
  await expect(board).toBeVisible();
  const id = new URL(page.url()).searchParams.get('session'); expect(id).toBeTruthy();
  const snapshot = async (): Promise<SessionView> => {
    const response = await page.request.get(`/api/sessions/${id}`); expect(response.ok()).toBe(true);
    return (await response.json()).session;
  };
  const original = await snapshot();
  await page.getByRole('button', { name: '安排任务', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '把安排摆到桌上', exact: true });
  for (const title of ['整理精修文案', '完成精细版式', '合并视觉精修']) await editor.getByRole('checkbox', { name: new RegExp(`^${title}`) }).uncheck();
  for (const title of ['准备问答内容与测试集', '配置问答界面与状态', '接入并验收限定范围问答']) await editor.getByRole('checkbox', { name: new RegExp(`^${title}`) }).check();
  await editor.getByRole('button', { name: '交给大家确认', exact: true }).click();
  await expect(editor).not.toBeVisible();
  await expect(board.getByRole('heading', { name: '这份提议尚未生效', exact: true })).toBeVisible();
  const pending = await snapshot();
  expect(pending.state.taskIds).toEqual(original.state.taskIds);
  expect(pending.state.schedule).toEqual(original.state.schedule);
  expect(pending.state.proposal?.status).toBe('pending');
  await board.getByRole('button', { name: /^协商替换原视觉交付/ }).click();
  await expect(board.getByText('已确认', { exact: true })).toBeVisible();
  const confirmed = await snapshot();
  expect([...confirmed.state.taskIds].sort()).toEqual(['B1', 'B2', 'B3', 'B4', 'Q1', 'Q2', 'Q3']);
  expect(confirmed.state.proposal?.acceptedBy).toEqual(['lin', 'xu', 'zhou']);
  expect(confirmed.state.schedule).toContainEqual({ taskId: 'Q3', actor: 'zhou', start: 1260, end: 1320 });
  expect(confirmed.state.schedule.reduce((minutes, slot) => minutes + slot.end - slot.start, 0)).toBe(480);
  await expect(board.getByText('接入并验收限定范围问答', { exact: true })).toBeVisible();
  await expect(board.getByText('合并视觉精修', { exact: true })).toHaveCount(0);
  await page.reload(); await expect(board.getByText('已确认', { exact: true })).toBeVisible();
  const restored = await snapshot();
  expect(restored.version).toBe(confirmed.version); expect(restored.state).toEqual(confirmed.state); expect(restored.events).toEqual(confirmed.events);
  expect(unexpectedText).toEqual([]);
  await testInfo.attach('campus-b-confirmed-record', { body: JSON.stringify(restored, null, 2), contentType: 'application/json' });
  await testInfo.attach('campus-b-confirmed-board', { body: await board.screenshot(), contentType: 'image/png' });
});
