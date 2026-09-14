import { openChapters, expect, test, type Page } from './fixtures';
import type { SessionView } from '../../src/domain/types';

test.use({ baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:3000' });
async function session(page: Page) {
  await expect(page).toHaveURL(/[?&]session=/);
  const id = new URL(page.url()).searchParams.get('session');
  expect(id).toBeTruthy();
  const response = await page.request.get(`/api/sessions/${id}`);
  expect(response.ok()).toBe(true);
  return (await response.json() as { session: SessionView }).session;
}
const home = (page: Page) => page.getByRole('heading', { name: '今天，想先练哪件事？' });
const back = (page: Page) => page.getByRole('button', { name: '返回练习主页', exact: true });

test('新访客知道如何练习，三个示例独立可选；返回首页可恢复每条记录', async ({ page }) => {
  await page.goto('/?view=home');
  await expect(home(page)).toBeVisible();
  await expect(page.getByRole('region', { name: '选择练习入口' }).getByRole('button')).toHaveCount(2);
  await expect(page.getByRole('link', { name: /第一次来？先看怎么玩/ })).toBeVisible();
  await expect(page.getByRole('button', { name: '试试 90 秒示范', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '练自己的事', exact: true })).toBeVisible();
  await openChapters(page);
  await page.getByRole('button', { name: '进入职场协商练习', exact: true }).click();
  await page.getByText('我的角色、这件事的背景', { exact: true }).click();
  await expect(page.getByRole('heading', { name: '你是入职第一周的新同事', exact: true })).toBeVisible();
  const workplace = await session(page);
  await back(page).click();
  await expect(home(page)).toBeVisible();
  await openChapters(page);
  await page.getByRole('button', { name: '进入半小时小任务', exact: true }).click();
  const context = page.locator('.scenario-context');
  if (await context.getAttribute('open') === null) await context.locator(':scope > summary').click();
  await expect(page.getByRole('heading', { name: '你负责一次招新页面预览', exact: true })).toBeVisible();
  const transfer = await session(page);
  expect(transfer.id).not.toBe(workplace.id);
  await back(page).click();
  await expect(page.getByRole('region', { name: '接着上次练', exact: true }).getByRole('listitem')).toHaveCount(2);
  await page.reload();
  await expect(home(page)).toBeVisible();
  await expect(page.getByRole('region', { name: '接着上次练', exact: true }).getByRole('listitem')).toHaveCount(2);
  await page.getByRole('region', { name: '接着上次练', exact: true }).getByRole('listitem').filter({ hasText: '下一站：入职第一周' }).getByRole('button', { name: '继续这次练习', exact: true }).click();
  expect((await session(page)).id).toBe(workplace.id);
});

test('浏览器后退与前进恢复场景；同场景的多次练习不会互相覆盖', async ({ page }) => {
  await page.goto('/?view=home');
  await openChapters(page);
  await page.getByRole('button', { name: '进入校园协作练习', exact: true }).click();
  const first = await session(page);
  await page.goBack();
  await expect(home(page)).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { name: '最后一晚', exact: true })).toBeVisible();
  expect((await session(page)).id).toBe(first.id);
  await back(page).click();
  await openChapters(page);
  await page.getByRole('button', { name: '进入校园协作练习', exact: true }).click();
  const second = await session(page);
  expect(second.id).not.toBe(first.id);
  await back(page).click();
  await expect(page.getByRole('region', { name: '接着上次练', exact: true }).getByRole('listitem')).toHaveCount(2);
});

test('任务窗口可关闭和浏览器后退；未提交的选择与条件草稿保留', async ({ page }) => {
  await page.goto('/?view=home');
  await openChapters(page);
  await page.getByRole('button', { name: '进入校园协作练习', exact: true }).click();
  const original = await session(page);
  const open = page.getByRole('button', { name: '安排任务', exact: true });
  const dialog = page.getByRole('dialog', { name: '把安排摆到桌上', exact: true });
  await open.click();
  await dialog.getByRole('checkbox', { name: /^接入三个静态引导入口/ }).check();
  await dialog.getByRole('textbox', { name: /^还有什么前提/ }).fill('先和队友问清入口范围');
  await page.goBack();
  await expect(dialog).not.toBeVisible();
  expect((await session(page)).version).toBe(original.version);
  await open.click();
  await expect(dialog.getByRole('checkbox', { name: /^接入三个静态引导入口/ })).toBeChecked();
  await expect(dialog.getByRole('textbox', { name: /^还有什么前提/ })).toHaveValue('先和队友问清入口范围');
  await dialog.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(open).toBeFocused();
});

test('误操作回到最近一轮之前，原分支和未撤回的行动均可核查', async ({ page }) => {
  await page.goto('/?view=home');
  await openChapters(page);
  await page.getByRole('button', { name: '进入校园协作练习', exact: true }).click();
  await page.getByRole('button', { name: '项目资料', exact: true }).click();
  await page.getByRole('button', { name: '模拟试用反馈', exact: true }).click();
  await expect(page.getByText(/当前首要目的，是帮助第一次打开页面的人找到三个主要入口/)).toBeVisible();
  const first = await session(page);
  await page.getByRole('button', { name: '项目资料', exact: true }).click();
  await page.getByRole('button', { name: '问答组件与验收', exact: true }).click();
  await expect(page.getByText(/不是从零开发开放域 AI/)).toBeVisible();
  const parent = await session(page);
  await page.getByRole('button', { name: '刚才点错了', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '回到刚才那一步？', exact: true });
  await dialog.getByRole('button', { name: '回到上一步', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const child = await session(page);
  expect(child.id).not.toBe(parent.id);
  expect(child.parentId).toBe(parent.id);
  expect(child.forkReason).toBe('correction');
  expect(child.events).toEqual(first.events);
  expect(child.state).toEqual(first.state);
  const preserved = await page.request.get(`/api/sessions/${parent.id}`);
  expect((await preserved.json() as { session: SessionView }).session.events).toEqual(parent.events);
  await page.goBack();
  await expect(page.getByRole('heading', { name: '最后一晚', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await session(page)).id).toBe(parent.id);
  await page.goForward();
  await expect(page.getByRole('heading', { name: '最后一晚', exact: true })).toBeVisible();
  expect((await session(page)).id).toBe(child.id);
  await back(page).click();
  await expect(page.getByRole('region', { name: '接着上次练', exact: true }).getByRole('listitem')).toHaveCount(2);
  await expect(page.getByRole('region', { name: '接着上次练', exact: true }).getByRole('listitem').filter({ hasText: '纠正后的分支' })).toBeVisible();
});

test('[客户端能力标志 mock] 返回场景选择、恢复及刷新均保留未发送的自然表达', async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: 'scope', description: '只为输入框启用能力标志；不发送文本，不调用模型。' });
  await page.route(/\/api\/sessions(?:\/[^/]+)?$/, async route => {
    const response = await route.fetch();
    const body = await response.json();
    if (body.session) body.session.capabilities.naturalLanguage = true;
    await route.fulfill({ response, json: body });
  });
  await page.goto('/?view=home');
  await openChapters(page);
  await page.getByRole('button', { name: '进入校园协作练习', exact: true }).click();
  const draft = '我想先听听每个人最担心的是什么。';
  const input = page.getByRole('textbox', { name: '写下你的问题、安排或需要澄清的地方', exact: true });
  await input.fill(draft);
  await back(page).click();
  await page.getByRole('button', { name: '继续这次练习', exact: true }).click();
  await expect(input).toHaveValue(draft);
  await page.reload();
  await expect(input).toHaveValue(draft);
});

test('行动处理中返回首页，迟到的真实结果只保存记录，不把人拉回原场景', async ({ page }) => {
  await page.goto('/?view=home');
  await openChapters(page);
  await page.getByRole('button', { name: '进入校园协作练习', exact: true }).click();
  const original = await session(page);
  let release!: () => void;
  const paused = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/sessions/*/actions', async route => {
    await paused;
    const response = await route.fetch();
    await route.fulfill({ response });
  });
  try {
    await page.getByRole('button', { name: '项目资料', exact: true }).click();
    const requested = page.waitForRequest(request => request.url().endsWith('/actions'));
    await page.getByRole('button', { name: '模拟试用反馈', exact: true }).click();
    await requested;
    await back(page).click();
    await expect(home(page)).toBeVisible();
    release();
    await expect.poll(async () => {
      const response = await page.request.get(`/api/sessions/${original.id}`);
      return (await response.json() as { session: SessionView }).session.version;
    }).toBeGreaterThan(original.version);
    await expect(home(page)).toBeVisible();
    await expect(page).toHaveURL(/\?view=home$/);
    await expect(page.getByRole('button', { name: '继续这次练习', exact: true })).toBeEnabled();
    await page.goBack();
    await expect(page.getByRole('heading', { name: '最后一晚', exact: true })).toBeVisible();
    expect((await session(page)).id).toBe(original.id);
    await expect(page.getByText(/当前首要目的，是帮助第一次打开页面的人找到三个主要入口/)).toBeVisible();
    await page.goForward();
    await expect(home(page)).toBeVisible();
  } finally { release(); }
});
