import { expect, test } from './fixtures';
import type { CampusTopicsFeed } from '../../src/domain/campus-topics';

// UI recovery uses a labelled synthetic feed; actual official CLI/HTTP evidence is stored separately.
const fetchedAt = '2026-09-13T08:00:00Z';
const fixture: CampusTopicsFeed = { fetchedAt, checkedAt: fetchedAt, lastAttemptAt: fetchedAt, nextAutoRefreshAt: '2026-09-13T09:00:00Z', nextManualRefreshAt: '2026-01-01T00:00:00Z', status: 'fresh', refreshResult: 'cached', error: null, hotCount: 1, relatedCount: 5, items: Array.from({ length: 6 }, (_, i) => ({ id: `question:${i + 1}`, title: `大学室友作息不同，怎样沟通第${i + 1}种安排？`, url: `https://www.zhihu.com/question/${i + 1}`, kind: i === 0 ? 'hot' : 'related', contentType: 'question', fetchedAt, editedAt: null })) };

test('校园讨论保留来源并进入可编辑草稿，不自动请求模型', async ({ page }) => {
  let modelPosts = 0;
  await page.route('**/api/campus-topics', route => route.fulfill({ json: fixture }));
  await page.route('**/api/custom-practices', async route => {
    if (route.request().method() === 'POST') modelPosts++;
    await route.fulfill({ json: { sessions: [], available: true } });
  });
  await page.goto('/?view=home');
  await page.getByRole('button', { name: '看看校园里正在聊什么', exact: true }).click();
  const section = page.getByRole('region', { name: '从知乎讨论里，找一件想练的事' });
  await expect(section.getByRole('listitem')).toHaveCount(6);
  await expect(section).toContainText('相关讨论来自搜索');
  await expect(section.getByRole('link', { name: '看原讨论' }).first()).toHaveAttribute('href', fixture.items[0].url);
  await section.getByRole('button', { name: '把它带进练习' }).first().click();
  const draft = page.getByLabel('我想练习……', { exact: true });
  await expect(draft).toHaveValue(new RegExp(fixture.items[0].title.replace(/[？?]/g, '.')));
  await expect(page.getByText('借一个话题开始', { exact: true })).toBeVisible();
  await draft.fill('我想和自己的室友商量今晚安静的时间。');
  expect(modelPosts).toBe(0);
});

test('旧缓存失败提示、手动限频和320px键盘焦点保持清楚', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await page.route('**/api/campus-topics', route => route.fulfill({ json: route.request().method() === 'POST' ? { ...fixture, status: 'stale', refreshResult: 'failed', error: { code: 'UNAVAILABLE', message: '这次没有连上知乎话题服务。' }, nextManualRefreshAt: '2099-01-01T00:00:00Z' } : fixture }));
  await page.goto('/?view=home');
  await page.getByRole('button', { name: '看看校园里正在聊什么', exact: true }).click();
  const section = page.getByRole('region', { name: '从知乎讨论里，找一件想练的事' });
  await expect(section.getByRole('listitem')).toHaveCount(6);
  const refresh = section.getByRole('button', { name: '刷新话题', exact: true });
  await refresh.click();
  await expect(section).toContainText('先保留上次内容，获取时间没有更新');
  await expect(section.getByRole('listitem')).toHaveCount(6); await expect(refresh).toBeDisabled();
  const enter = section.getByRole('button', { name: '把它带进练习' }).first(); await enter.focus(); await expect(enter).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
