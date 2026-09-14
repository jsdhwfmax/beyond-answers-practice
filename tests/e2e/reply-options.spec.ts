import { openChapters, expect, test, type Page } from './fixtures';
import type { ActionRequest, SessionView } from '../../src/domain/types';
import type { ReplyOptionsView } from '../../src/domain/reply-options';

// Client contract checks: options/model interpretation are controlled explicitly.
// Session ownership, action storage and transfer assistance use the real service.
test.use({ baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:3000' });
const first = ['我想先了解大家最担心的事。', '我们先把已有承诺摆出来好吗？', '能先说明新增功能要解决什么问题吗？'];
const later = ['我想再核对一下验收标准。', '我们还需要确认谁来检查结果？', '可以保留一点处理意外的时间吗？'];
function reply(id: string, version: number, texts = first): ReplyOptionsView {
  return { sessionId: id, version, status: 'ready', options: texts.map((text, i) => ({ id: `reply-${i}`, text })), source: 'model', generatedAt: new Date().toISOString(), notice: '', assistance: 'none' };
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function snapshot(page: Page): Promise<SessionView> {
  const id = new URL(page.url()).searchParams.get('session');
  expect(id).toBeTruthy(); const response = await page.request.get(`/api/sessions/${id}`);
  expect(response.ok()).toBe(true); return (await response.json()).session as SessionView;
}
async function begin(page: Page, scenario = '进入校园协作练习') {
  // Enable only the client input control; no model is required by these tests.
  await page.route(/\/api\/sessions(?:\/[^/?]+)?$/, async route => {
    const response = await route.fetch(); const body = await response.json();
    if (body.session) body.session.capabilities.naturalLanguage = true;
    await route.fulfill({ response, json: body });
  });
  await page.goto('/?view=home'); await openChapters(page); await page.getByRole('button', { name: scenario, exact: true }).click();
  await expect(page).toHaveURL(/[?&]session=/);
}
const input = (page: Page) => page.getByRole('textbox', { name: '写下你的问题、安排或需要澄清的地方', exact: true });
const choices = (page: Page) => page.getByTestId('reply-choices');

test('[选项边界 mock] 辅助记录失败后，别的行动不会自动展开下一版建议', async ({ page }) => {
  let queries = 0;
  await page.route('**/api/sessions/*/reply-options?*', async route => {
    queries++; const url = new URL(route.request().url());
    await route.fulfill({ json: { ...reply(url.pathname.split('/')[3], Number(url.searchParams.get('expectedVersion')), []), status: 'assistance_required', assistance: 'requires_record' } });
  });
  await page.route('**/api/sessions/*/actions', async route => {
    const input = route.request().postDataJSON() as ActionRequest;
    if (input.command?.type === 'reply_options_seen') return route.fulfill({ status: 503, json: { error: { code: 'MOCK_WRITE_FAILED', message: '客户端模拟：辅助记录未保存。' } } });
    const response = await route.fetch(); await route.fulfill({ response });
  });
  await begin(page, '进入半小时小任务'); const original = await snapshot(page);
  await choices(page).getByRole('button', { name: '想看看可以怎么说' }).click();
  await choices(page).getByRole('button', { name: '看看回答选项' }).click();
  await expect(page.getByText('客户端模拟：辅助记录未保存。', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: '在这里核对本轮结果', exact: true }).click();
  await expect(page.getByText('已核对：上次请求尚未登记，没有改变约定。原话已保留，可以重新提交。', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: '项目资料', exact: true }).click();
  await page.locator('.material-option').first().click();
  await expect(choices(page).getByRole('button', { name: '想看看可以怎么说' })).toBeVisible();
  expect((await snapshot(page)).version).toBe(original.version + 1); expect(queries).toBe(1);
});

test('[选项边界 mock] 等待不阻塞自由输入；选项不自动写入或发送，修改后走原行动接口', async ({ page }, testInfo) => {
  const pending = deferred(); let submitted: ActionRequest | undefined; let writes = 0; let queries = 0;
  await page.route('**/api/sessions/*/reply-options?*', async route => {
    queries++;
    const url = new URL(route.request().url()); const version = Number(url.searchParams.get('expectedVersion'));
    await pending.promise;
    await route.fulfill({ json: reply(url.pathname.split('/')[3], version, version ? later : first) });
  });
  await begin(page); const original = await snapshot(page);
  const typed = '我自己的话先留在这里。'; await input(page).fill(typed);
  expect(queries).toBe(0);
  await choices(page).getByRole('button', { name: '想看看可以怎么说' }).click();
  await expect(choices(page).getByRole('progressbar', { name: '正在准备可选回复，完成时间暂不确定' })).toBeVisible();
  expect(await choices(page).getByRole('progressbar').getAttribute('aria-valuenow')).toBeNull();
  await expect(choices(page).getByText(/已等 [1-9]\d* 秒/)).toBeVisible({ timeout: 4000 });
  pending.resolve();
  await expect(choices(page).getByRole('button', { name: first[0], exact: true })).toBeVisible();
  await expect(input(page)).toHaveValue(typed); expect((await snapshot(page)).version).toBe(original.version);
  await choices(page).getByRole('button', { name: first[1], exact: true }).click();
  await expect(input(page)).toHaveValue(first[1]); expect((await snapshot(page)).version).toBe(original.version);
  const edited = `${first[1]}我想知道三个人今晚各有哪些空档。`;
  await input(page).fill(edited);
  await page.route('**/api/sessions/*/actions', async route => {
    writes++; submitted = route.request().postDataJSON() as ActionRequest;
    // Controlled interpretation only: dispatch a valid read command to the real action service.
    const { text: _text, ...request } = submitted; void _text;
    const response = await route.fetch({ postData: { ...request, command: { type: 'inspect', materialId: 'feedback' } } });
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: '发送这次表达', exact: true }).click();
  await expect(input(page)).toHaveValue('');
  expect(writes).toBe(1); expect(submitted?.text).toBe(edited); expect(submitted?.expectedVersion).toBe(original.version);
  const saved = await snapshot(page); expect(saved.version).toBe(original.version + 1);
  await expect(choices(page).getByRole('button', { name: '想看看可以怎么说' })).toBeVisible();
  expect(queries).toBe(1);
  await choices(page).getByRole('button', { name: '想看看可以怎么说' }).click();
  await expect(choices(page).getByRole('button', { name: later[0], exact: true })).toBeVisible();
  await expect(choices(page).getByRole('button', { name: first[0], exact: true })).toHaveCount(0);
  expect(saved.state.phase).not.toBe('ended');
  await testInfo.attach('selection-edited-input', { body: JSON.stringify({ originalVersion: original.version, submitted, savedVersion: saved.version, modelBoundary: 'mock' }, null, 2), contentType: 'application/json' });
});

test('[选项边界 mock] 版本过期的回复被拒绝，备用选项明确标识且320px键盘可选', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 820 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  let mismatch = true;
  await page.route('**/api/sessions/*/reply-options?*', async route => {
    const url = new URL(route.request().url()); const version = Number(url.searchParams.get('expectedVersion'));
    await route.fulfill({ json: { ...reply(url.pathname.split('/')[3], version + (mismatch ? 1 : 0)), source: 'fallback', notice: '本次使用按场景准备的备用说法，未调用生成模型。' } });
  });
  await begin(page);
  await choices(page).getByRole('button', { name: '想看看可以怎么说' }).click();
  await expect(choices(page).getByText('这组选项与当前对话不匹配。你可以自己写，或重新获取。')).toBeVisible();
  await input(page).fill('我仍可以先自己写。');
  mismatch = false; await choices(page).getByRole('button', { name: '重新获取选项' }).click();
  const option = choices(page).getByRole('button', { name: first[0], exact: true });
  await expect(option).toBeVisible(); await expect(choices(page)).toContainText('未调用生成模型');
  await option.focus(); await page.keyboard.press('Enter');
  await expect(input(page)).toHaveValue(first[0]); await expect(option).toHaveAttribute('aria-pressed', 'true');
  await choices(page).getByRole('button', { name: '收起选项', exact: true }).click(); await expect(input(page)).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(321);
  await testInfo.attach('warm-options-320', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
});

test('[选项边界 mock] 短练习查看选项须主动记录辅助，未查看不写状态', async ({ page }) => {
  await page.route('**/api/sessions/*/reply-options?*', async route => {
    const url = new URL(route.request().url()); const id = url.pathname.split('/')[3]; const version = Number(url.searchParams.get('expectedVersion'));
    const response = await page.request.get(`/api/sessions/${id}`); const saved = (await response.json()).session as SessionView;
    await route.fulfill({ json: saved.state.transfer.hintUsed ? { ...reply(id, version), assistance: 'recorded' } : { ...reply(id, version, []), status: 'assistance_required', assistance: 'requires_record' } });
  });
  await begin(page, '进入半小时小任务'); const original = await snapshot(page);
  await choices(page).getByRole('button', { name: '想看看可以怎么说' }).click();
  await expect(choices(page).getByRole('button', { name: '看看回答选项' })).toBeVisible();
  expect((await snapshot(page)).version).toBe(original.version); expect(original.state.transfer.hintUsed).toBe(false);
  await choices(page).getByRole('button', { name: '看看回答选项' }).click();
  await expect(choices(page).getByRole('button', { name: first[0], exact: true })).toBeVisible();
  const assisted = await snapshot(page); expect(assisted.state.transfer.hintUsed).toBe(true);
  expect(assisted.state.transfer.firstPlan).toBeNull(); expect(assisted.state.transfer.completed).toEqual([]);
  const response = await page.request.post(`/api/sessions/${assisted.id}/actions`, { headers: { Origin: new URL(page.url()).origin }, data: { actionId: crypto.randomUUID(), expectedVersion: assisted.version, command: { type: 'transfer_plan', steps: ['publish', 'verify'] } } });
  expect(response.ok(), await response.text()).toBe(true);
  const firstPlan = (await response.json()).session as SessionView;
  expect(firstPlan.state.transfer.firstAssisted).toBe(true);
  expect(firstPlan.state.transfer.firstPlan).toEqual(['publish', 'verify']);
});
