import { readFile, stat } from 'node:fs/promises';
import { openChapters, expect, test, type Page } from './fixtures';
import type { ExperienceReport, SessionView } from '../../src/domain/types';

const ORIGIN = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';
test.use({ baseURL: ORIGIN });

async function startCampus(page: Page) {
  await page.goto('/?view=home');
  await openChapters(page);
  await page.getByRole('button', { name: '进入校园协作练习', exact: true }).click();
  await expect(page.getByRole('heading', { name: '我们的约定', exact: true })).toBeAttached();
}

async function savedSession(page: Page): Promise<SessionView> {
  const id = await page.evaluate(() => JSON.parse(localStorage.getItem('beyond.session.v1') ?? 'null') as string);
  expect(id).toBeTruthy();
  const response = await page.request.get(`/api/sessions/${id}`);
  expect(response.ok()).toBe(true);
  return (await response.json() as { session: SessionView }).session;
}

async function noHorizontalOverflow(page: Page, phase: string) {
  const layout = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    dialogs: [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].map(dialog => ({
      width: dialog.clientWidth, content: dialog.scrollWidth,
      left: dialog.getBoundingClientRect().left, right: dialog.getBoundingClientRect().right,
    })),
  }));
  expect(layout.document, `${phase}: document ${JSON.stringify(layout)}`).toBeLessThanOrEqual(layout.viewport + 1);
  expect(layout.body, `${phase}: body ${JSON.stringify(layout)}`).toBeLessThanOrEqual(layout.viewport + 1);
  for (const dialog of layout.dialogs) {
    expect(dialog.content, `${phase}: dialog ${JSON.stringify(layout)}`).toBeLessThanOrEqual(dialog.width + 1);
    expect(dialog.left).toBeGreaterThanOrEqual(-1);
    expect(dialog.right).toBeLessThanOrEqual(layout.viewport + 1);
  }
}

test('[客户端能力标志 mock] 首轮合理约定形成后仍可继续写话和查阅，只有主动收束才结束', async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: 'scope', description: '真实规则与保存；只 mock 客户端能力标志以验证输入可用，不发送自然语言，不调用模型。' });
  await page.route(/\/api\/sessions(?:\/[^/]+(?:\/actions)?)?$/, async route => {
    const response = await route.fetch(); const body = await response.json();
    if (body.session) body.session.capabilities.naturalLanguage = true;
    await route.fulfill({ response, json: body });
  });
  await startCampus(page);
  await expect(page.getByRole('button', { name: '先练到这里', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '安排任务', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '把安排摆到桌上', exact: true });
  await editor.getByRole('checkbox', { name: /^接入三个静态引导入口/ }).check();
  await editor.getByRole('checkbox', { name: /^明确有限引导的范围/ }).check();
  await editor.getByRole('button', { name: '交给大家确认', exact: true }).click();
  await expect(editor).not.toBeVisible();
  await expect(page.getByRole('heading', { name: '安排谈妥了，可以带走这次经验了', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const accepted = await savedSession(page);
  expect(accepted.state.phase).toBe('resolved'); expect(accepted.state.agreement.status).toBe('confirmed');
  expect(accepted.events.some(event => event.kind === 'finished')).toBe(false);
  const input = page.getByRole('textbox', { name: '写下你的问题、安排或需要澄清的地方', exact: true });
  await expect(input).toBeEnabled(); await input.fill('我还想核对一下要怎么验收。');
  await page.getByRole('button', { name: '项目资料', exact: true }).click();
  await page.getByRole('button', { name: '问答组件与验收', exact: true }).click();
  await expect(page.getByText(/不是从零开发开放域 AI/)).toBeVisible();
  await expect(input).toHaveValue('我还想核对一下要怎么验收。');
  expect((await savedSession(page)).state.phase).toBe('resolved');
  await page.reload(); await expect(input).toBeEnabled();
  await expect(input).toHaveValue('我还想核对一下要怎么验收。');
  await page.getByRole('button', { name: '完成练习，保存复盘', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '把这一次，留给下一次', exact: true })).toBeVisible();
  expect((await savedSession(page)).state.phase).toBe('ended');
});

test('[客户端延迟响应 mock] 等待立刻可见、秒数变化、不报伪百分比；减少动态且失败保留草稿', async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: 'scope', description: '只模拟请求延迟和失败，验证客户端等待反馈，不代表模型延迟实测。' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route(/\/api\/sessions(?:\/[^/]+(?:\/actions)?)?$/, async route => {
    const response = await route.fetch(); const body = await response.json();
    if (body.session) body.session.capabilities.naturalLanguage = true;
    await route.fulfill({ response, json: body });
  });
  let release!: () => void; const delayed = new Promise<void>(resolve => { release = resolve; });
  try {
    await startCampus(page);
    // Establish a completed prior round: a failure must not reuse its success message.
    await page.getByRole('button', { name: '项目资料', exact: true }).click();
    await page.getByRole('button', { name: '模拟试用反馈', exact: true }).click();
    await expect(page.getByText(/当前首要目的，是帮助第一次打开页面的人找到三个主要入口/)).toBeVisible();
    const before = await savedSession(page);
    await page.route('**/api/sessions/*/actions', async route => {
      await delayed;
      await route.fulfill({ status: 503, json: { error: { code: 'MOCK_DELAY_FAILURE', message: '等待验收模拟：这次回应未完成，原话仍然保留。' } } });
    });
    const input = page.getByRole('textbox', { name: '写下你的问题、安排或需要澄清的地方', exact: true });
    const draft = '我们先保留基础版本，具体的新功能还想听听大家意见。';
    await input.fill(draft); await page.getByRole('button', { name: '发送这次表达', exact: true }).click();
    const waiting = page.getByTestId('waiting-feedback');
    await expect(waiting).toBeVisible({ timeout: 2000 });
    const progress = waiting.getByRole('progressbar');
    await expect(progress).toHaveAccessibleName('等待回应：动画不代表实际完成百分比');
    expect(await progress.getAttribute('aria-valuenow')).toBeNull();
    await expect(waiting.getByText(/已等 [1-9]\d* 秒/)).toBeVisible({ timeout: 4000 });
    const earlier = await waiting.textContent();
    await expect.poll(async () => waiting.textContent(), { timeout: 3500 }).not.toBe(earlier);
    const animation = await progress.locator('span').evaluate(element => ({ transition: getComputedStyle(element).transitionDuration, after: getComputedStyle(element, '::after').animationName }));
    expect(animation.transition.split(',').every(value => Number.parseFloat(value) <= 0.001)).toBe(true);
    expect(animation.after).toBe('none');
    await testInfo.attach('waiting-with-reduced-motion', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    release();
    await expect(page.getByRole('alert').filter({ hasText: '等待验收模拟' })).toBeVisible();
    await expect(waiting).not.toBeVisible(); await expect(input).toHaveValue(draft);
    await expect(page.getByText(/这轮回应已经收到/)).toHaveCount(0);
    const nearbyCheck = page.locator('.conversation').getByRole('button', { name: '在这里核对本轮结果', exact: true });
    await expect(nearbyCheck).toBeEnabled();
    await expect(page.locator('.conversation').getByRole('button', { name: '重试这句话', exact: true })).toBeEnabled();
    await nearbyCheck.click();
    await expect(page.getByRole('alert').filter({ hasText: '上次请求尚未登记' })).toBeVisible();
    await expect(input).toHaveValue(draft);
    await expect(page.getByText(/这轮回应已经收到/)).toHaveCount(0);
    const after = await savedSession(page); expect(after.state).toEqual(before.state); expect(after.version).toBe(before.version);
  } finally { release(); }
});

test('[客户端 mock] 已有记录后收到200空正文：中文错误、原话和旧状态保留，不裸露JS异常', async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: 'scope', description: '真实旧会话与材料记录；只把下一次客户端响应模拟为200空正文，不调用模型。' });
  const pageErrors: string[] = []; page.on('pageerror', error => pageErrors.push(error.message));
  await page.route(/\/api\/sessions(?:\/[^/]+(?:\/actions)?)?$/, async route => {
    const response = await route.fetch(); const body = await response.json();
    if (body.session) body.session.capabilities.naturalLanguage = true;
    await route.fulfill({ response, json: body });
  });
  await startCampus(page);
  await page.getByRole('button', { name: '项目资料', exact: true }).click();
  await page.getByRole('button', { name: '模拟试用反馈', exact: true }).click();
  await expect(page.getByText(/当前首要目的，是帮助第一次打开页面的人找到三个主要入口/)).toBeVisible();
  const before = await savedSession(page); expect(before.events.length).toBeGreaterThan(0);
  await page.route('**/api/sessions/*/actions', route => route.fulfill({ status: 200, contentType: 'application/json', body: '' }));
  const draft = '我希望保留基础版，再和大家确认新功能的范围。';
  const input = page.getByRole('textbox', { name: '写下你的问题、安排或需要澄清的地方', exact: true });
  await input.fill(draft); await page.getByRole('button', { name: '发送这次表达', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '没有收到可读取的结果' })).toContainText('原话已保留');
  await expect(input).toHaveValue(draft);
  await expect(page.locator('.conversation').getByRole('button', { name: '在这里核对本轮结果', exact: true })).toBeEnabled();
  await expect(page.getByText(/这轮回应已经收到/)).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(/Cannot destructure|Cannot read properties|TypeError|Unexpected token/);
  expect(pageErrors).toEqual([]);
  const after = await savedSession(page); expect(after.state).toEqual(before.state); expect(after.events).toEqual(before.events); expect(after.version).toBe(before.version);
  expect(await page.evaluate(id => localStorage.getItem(`beyond.draft.v1.${id}`), before.id)).toBe(draft);
  await testInfo.attach('invalid-success-envelope-recovery', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
});

test('320px：首页、校园对话、约定和任务弹窗均无横向溢出', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/?view=home');
  await expect(page.getByRole('button', { name: '练自己的事', exact: true })).toBeEnabled();
  await noHorizontalOverflow(page, '首页');
  await openChapters(page);
  await page.getByRole('button', { name: '进入校园协作练习', exact: true }).click();
  await expect(page.getByRole('heading', { name: '先听听大家怎么说', exact: true })).toBeVisible();
  await noHorizontalOverflow(page, '校园对话');
  await page.getByRole('navigation', { name: '练习分区', exact: true }).getByRole('button', { name: '约定', exact: true }).click();
  const board = page.getByRole('region', { name: '我们的约定', exact: true });
  await expect(board).toBeVisible();
  await noHorizontalOverflow(page, '校园约定');
  await board.getByRole('button', { name: /^提出一份安排/ }).click();
  await expect(page.getByRole('dialog', { name: '把安排摆到桌上', exact: true })).toBeVisible();
  await noHorizontalOverflow(page, '任务弹窗');
  await testInfo.attach('320px-task-dialog', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
});

test('键盘：来源弹窗约束 Tab 焦点，Escape 关闭后回到触发入口', async ({ page }) => {
  await page.goto('/?view=home');
  const trigger = page.getByRole('navigation', { name: '主要导航', exact: true }).getByRole('button', { name: '练习方法来源', exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: '练习方法来源', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('刀熊说说', { exact: true })).toBeVisible();
  const focusWithin = () => dialog.evaluate(element => element.contains(document.activeElement));
  expect(await focusWithin()).toBe(true);
  for (let index = 0; index < 12; index++) {
    await page.keyboard.press(index % 3 === 0 ? 'Shift+Tab' : 'Tab');
    const active = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 250));
    expect(await focusWithin(), `Tab step ${index + 1} must remain in the modal; active=${active}`).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '关闭窗口', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test('减少动态：浏览器偏好生效，滚动和按钮转场不保留长动画', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?view=home');
  await openChapters(page);
  const start = page.getByRole('button', { name: '进入校园协作练习', exact: true });
  await expect(start).toBeEnabled();
  const computed = await start.evaluate(element => ({
    matches: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    scroll: getComputedStyle(document.documentElement).scrollBehavior,
    transitions: getComputedStyle(element).transitionDuration.split(',').map(value => Number.parseFloat(value)),
    animations: getComputedStyle(element).animationDuration.split(',').map(value => Number.parseFloat(value)),
  }));
  expect(computed.matches).toBe(true);
  expect(computed.scroll).toBe('auto');
  expect(computed.transitions.every(seconds => seconds <= 0.001)).toBe(true);
  expect(computed.animations.every(seconds => seconds <= 0.001)).toBe(true);
  await start.click();
  await expect(page.getByRole('heading', { name: '我们的约定', exact: true })).toBeVisible();
});

test('[客户端 mock] 中文组合输入期间 Ctrl+Enter 不发送；服务失败保留完整草稿与旧约定', async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: 'scope', description: '仅 mock 能力标志与失败响应以检查客户端，不调用模型，不验证真实中文输入法或模型质量。' });
  // Preserve the real session/cookie, only allow the composer to be exercised.
  await page.route('**/api/sessions', async route => {
    const response = await route.fetch();
    const body = await response.json() as { session?: SessionView };
    if (body.session) body.session.capabilities.naturalLanguage = true;
    await route.fulfill({ response, json: body });
  });
  let interceptedActions = 0;
  await page.route('**/api/sessions/*/actions', async route => {
    interceptedActions++;
    await route.fulfill({ status: 503, contentType: 'application/json', json: { error: { code: 'AI_UNAVAILABLE', message: '客户端验收模拟：服务暂时不可用，尚未确认任何安排。' } } });
  });
  await startCampus(page);
  const before = await savedSession(page);
  const composer = page.getByRole('textbox', { name: '写下你的问题、安排或需要澄清的地方', exact: true });
  await expect(composer).toBeEnabled();
  const draft = '我还没同意加问答，先确认大家分别有多少时间。';
  await composer.focus();
  await composer.dispatchEvent('compositionstart', { data: '我' });
  await composer.fill(draft);
  await page.keyboard.press('Control+Enter');
  await expect(composer).toHaveValue(draft);
  expect(interceptedActions).toBe(0);
  await composer.dispatchEvent('compositionend', { data: draft });
  await page.keyboard.press('Control+Enter');
  await expect(page.getByRole('alert').filter({ hasText: '客户端验收模拟' })).toContainText('客户端验收模拟：服务暂时不可用');
  expect(interceptedActions).toBe(1);
  await expect(composer).toHaveValue(draft);
  const after = await savedSession(page);
  expect(after.version).toBe(before.version);
  expect(after.state).toEqual(before.state);
  expect(after.events).toEqual(before.events);
  const storedDraft = await page.evaluate(id => localStorage.getItem(`beyond.draft.v1.${id}`), before.id);
  expect(storedDraft).toBe(draft);
});

test('真实记录导出：JSON 与服务器状态一致，打印为实际 PDF 且保留本机反思', async ({ page }, testInfo) => {
  await startCampus(page);
  await page.getByRole('button', { name: '安排任务', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '把安排摆到桌上', exact: true });
  await editor.getByRole('checkbox', { name: /^新增需要留待后续评估/ }).check();
  await editor.getByRole('button', { name: '交给大家确认', exact: true }).click();
  await expect(editor).not.toBeVisible();
  await page.getByRole('button', { name: '完成练习，保存复盘', exact: true }).click();
  const reportDialog = page.getByRole('dialog', { name: '把这一次，留给下一次', exact: true });
  await expect(reportDialog.getByText('已形成模拟中的确认约定', { exact: true })).toBeVisible();
  const reflection = '验收样例：下次先说明旧承诺受影响；这不是已经发生的现实结果。';
  await reportDialog.getByRole('textbox', { name: /^写给下一次的自己/ }).fill(reflection);
  await reportDialog.getByRole('button', { name: '保存这段反思', exact: true }).click();
  await expect(reportDialog.getByRole('button', { name: '已保存到本机', exact: true })).toBeVisible();
  const server = await savedSession(page);
  const reportResponse = await page.request.get(`/api/sessions/${server.id}/report`);
  expect(reportResponse.ok()).toBe(true);
  const serverReport = (await reportResponse.json() as { report: ExperienceReport }).report;

  const downloadPromise = page.waitForEvent('download');
  await reportDialog.getByRole('button', { name: '导出原始数据 JSON', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^经验练习场-最后一晚-.*\.json$/);
  const downloaded = JSON.parse(await readFile((await download.path())!, 'utf8')) as { session: SessionView; report: ExperienceReport; personalReflection: string; reflectionKind: string };
  expect(downloaded.session.id).toBe(server.id);
  expect(downloaded.session.version).toBe(server.version);
  expect(downloaded.session.state).toEqual(server.state);
  expect(downloaded.session.events).toEqual(server.events);
  expect(downloaded.report).toEqual(serverReport);
  expect(downloaded.personalReflection).toBe(reflection);
  expect(downloaded.reflectionKind).toBe('用户自述，未验证现实效果');
  expect(JSON.stringify(server)).not.toContain(reflection);
  await testInfo.attach('downloaded-record', { body: JSON.stringify(downloaded, null, 2), contentType: 'application/json' });

  // Exercise the print media rules in headless Chromium; this is an actual PDF,
  // not a screenshot renamed as a document or an assertion about print-dialog UI.
  await page.emulateMedia({ media: 'print' });
  await expect(reportDialog.getByRole('heading', { name: '留下的交付范围', exact: true })).toBeVisible();
  await expect(reportDialog.locator('.print-reflection')).toBeVisible();
  await expect(reportDialog.getByRole('button', { name: '导出原始数据 JSON', exact: true })).not.toBeVisible();
  const output = testInfo.outputPath('report-sample.pdf');
  await page.pdf({ path: output, format: 'A4', printBackground: true, preferCSSPageSize: true, tagged: true });
  expect((await stat(output)).size).toBeGreaterThan(5000);
  expect((await readFile(output)).subarray(0, 5).toString()).toBe('%PDF-');
  await testInfo.attach('report-sample', { path: output, contentType: 'application/pdf' });
});

