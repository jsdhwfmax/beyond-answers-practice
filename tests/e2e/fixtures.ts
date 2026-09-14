import { test as base, type Page } from '@playwright/test';

export async function openChapters(page: Page) {
  const chapters = page.locator('#example-practices');
  if (await chapters.getAttribute('open') === null) await chapters.locator(':scope > summary').click();
}

// Existing flow checks must not silently become paid model tests just because
// optional reply suggestions are opened. Dedicated cases override this route.
export const test = base.extend({
  context: async ({ context }, provideContext, testInfo) => {
    testInfo.annotations.push({ type: 'options-boundary', description: '回复选项请求默认隔离为客户端 mock；真实模型选项另有明确实测证据。' });
    await context.route('**/reply-options?*', route => route.fulfill({ status: 503, json: { error: { code: 'OPTIONS_TEST_BOUNDARY', message: '回复选项在此客户端验收中被隔离。' } } }));
    await provideContext(context);
  },
});
export { expect } from '@playwright/test';
export type { Page, TestInfo, APIRequestContext } from '@playwright/test';
