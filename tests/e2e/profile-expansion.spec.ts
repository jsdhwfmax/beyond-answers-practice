import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test.use({ baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:3000' });

test('真实新增专科问题通过三个标签找到，保留原回答与精确练习草稿', async ({ page }, testInfo) => {
  const writes: string[] = [];
  // This verifies real library GETs and navigation. Do not send model/session writes.
  await page.route('**/api/**', async route => {
    if (route.request().method() !== 'GET') { writes.push(route.request().url()); await route.abort(); }
    else await route.continue();
  });
  await page.goto('/discover');
  await page.getByRole('combobox', { name: '学历', exact: true }).selectOption('junior_college');
  await page.getByRole('combobox', { name: '院校类型', exact: true }).selectOption('vocational_college');
  await page.getByRole('combobox', { name: '当前阶段', exact: true }).selectOption('internship_job_search');
  await page.getByRole('button', { name: '查找相近的问题', exact: true }).click();
  const card = page.locator('[data-discovery-question="zhihu-q-401648188"]');
  await expect(card).toBeVisible();
  await expect(card).toContainText('专科');
  await expect(card).toContainText('高职 / 专科院校');
  await expect(card).toContainText('实习求职');
  await expect(card.getByRole('link', { name: '读知乎原回答' })).toHaveAttribute('href', /\/question\/401648188\/answer\/3083948243/);
  await card.getByText('在这里核对摘要与出处', { exact: true }).click();
  await expect(card.locator('details blockquote').last()).toContainText('就我一个专科');
  const evidenceDir = process.env.E2E_EVIDENCE_DIR || (process.env.E2E_BASE_URL?.startsWith('https:') ? '.local/qa/profile-v5/production' : '.local/qa/profile-v5/local');
  await mkdir(evidenceDir, { recursive: true });
  await page.screenshot({ path: `${evidenceDir}/new-junior-college-results.png`, fullPage: true });
  await card.getByRole('link', { name: '从这题开始练习' }).click();
  await expect(page).toHaveURL(/sourceQuestionId=zhihu-q-401648188/);
  await expect(page.getByRole('link', { name: '在西安电力高等专科学校就读是什么体验?', exact: true })).toBeVisible();
  const topic = page.getByLabel('我想练习……', { exact: true });
  await expect(topic).not.toHaveValue('');
  const draft = await topic.inputValue();
  await page.reload();
  await expect(topic).toHaveValue(draft);
  await expect(page.getByRole('link', { name: '在西安电力高等专科学校就读是什么体验?', exact: true })).toBeVisible();
  expect(writes).toEqual([]);
  await testInfo.attach('new-source-draft', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
});
