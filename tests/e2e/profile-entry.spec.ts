import { test, expect } from './fixtures';
import { readFileSync } from 'node:fs';
import type { CampusCorpusQuestion } from '../../src/content/campus-corpus';
const corpus: CampusCorpusQuestion[] = JSON.parse(readFileSync('src/content/campus-corpus-data.json', 'utf8'));

// Real public library read; model/create boundaries are explicitly mocked.
test('selected question deep link survives reload and submits that exact source id', async ({ page }) => {
  const question = corpus[0];
  let submitted: { sourceQuestionId?: string; topic: string } | undefined;
  await page.route('**/api/custom-practices', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { sessions: [], available: true } });
    submitted = route.request().postDataJSON();
    await route.fulfill({ status: 503, json: { error: { message: '模拟创建边界，仅核对题目编号与原话。' } } });
  });
  await page.route('**/api/practice-intake', async route => {
    const input = route.request().postDataJSON();
    await route.fulfill({ json: { intake: { version: 'practice-intake-v1', requestId: input.requestId, originalText: input.text, status: 'ready', reason: '测试边界', evidenceQuotes: [input.text], questions: [], suggestions: [], canStartPractice: true } } });
  });
  await page.goto(`/?mode=custom&intent=new&sourceQuestionId=${question.id}`);
  await expect(page.getByRole('link', { name: question.title, exact: true })).toBeVisible();
  await page.reload();
  const input = page.getByLabel('我想练习……', { exact: true });
  expect(await input.inputValue()).toContain(question.scenarioSeed.goal);
  await input.fill('我想先向学姐问清楚一门课的复习方法，今晚只请教一个问题。');
  await page.getByRole('button', { name: '准备我的练习', exact: true }).click();
  await expect.poll(() => submitted?.sourceQuestionId).toBe(question.id);
  expect(submitted?.topic).toBe('我想先向学姐问清楚一门课的复习方法，今晚只请教一个问题。');
});

test('an unknown source id fails visibly instead of using a previous saved topic', async ({ page }) => {
  await page.goto('/?mode=custom&intent=new&sourceQuestionId=zhihu-q-000000000');
  await expect(page.getByRole('alert').filter({ hasText: '这条题目暂时无法读取' })).toBeVisible();
  await expect(page.getByRole('link', { name: '返回按情况选题' })).toHaveAttribute('href', '/discover');
  await expect(page.getByRole('button', { name: '准备我的练习', exact: true })).toHaveCount(0);
});

test('cancelling a selected source keeps the editable topic but does not restore its association on reload', async ({ page }) => {
  const question = corpus[0];
  await page.route('**/api/custom-practices', route => route.fulfill({ json: { sessions: [], available: true } }));
  await page.goto(`/?mode=custom&intent=new&sourceQuestionId=${question.id}`);
  await expect(page.getByRole('link', { name: question.title, exact: true })).toBeVisible();
  await page.getByLabel('我想练习……', { exact: true }).fill('换成我自己的情况，先练一次请教。');
  await page.getByRole('button', { name: '取消这个问题关联', exact: true }).click();
  await page.getByLabel('我想练习……', { exact: true }).fill('取消来源后，我继续改写：先练一次向老师请教。');
  await page.reload();
  await expect(page.getByLabel('我想练习……', { exact: true })).toHaveValue('取消来源后，我继续改写：先练一次向老师请教。');
  await expect(page.getByRole('button', { name: '取消这个问题关联', exact: true })).toHaveCount(0);
  await expect(page).not.toHaveURL(/sourceQuestionId/);
});
