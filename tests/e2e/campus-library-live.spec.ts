import { test, expect } from './fixtures';
import type { CampusCorpusQuestion } from '../../src/content/campus-corpus';

test('[只读真实题库] 实际整理的题目、赞同数和回答链接可在界面核对', async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: 'scope', description: '不mock题库接口；只读当前项目实际题库和渲染页面，不发送模型对话，不声明题库总量或全部来源已独立审核。' });
  const response = await page.request.get('/api/campus-library?limit=1');
  expect(response.ok()).toBe(true);
  const actual = await response.json() as { total: number; questions: CampusCorpusQuestion[]; version: string };
  expect(actual.total).toBeGreaterThan(0);
  const question = actual.questions[0]; expect(question.answers[0].voteCount).toBeGreaterThanOrEqual(100);
  await page.goto('/?view=home');
  await page.getByRole('button', { name: '从知乎校园问题开始', exact: true }).click();
  const library = page.getByRole('region', { name: '知乎校园问题库' });
  await library.getByRole('textbox', { name: '找一件想练的事' }).fill(question.title);
  await library.getByRole('button', { name: '查找', exact: true }).click();
  const card = library.locator(`[data-question-id="${question.id}"]`);
  await expect(card.getByRole('link', { name: question.title, exact: true })).toHaveAttribute('href', question.questionUrl);
  await expect(card).toContainText(`${question.answers[0].voteCount.toLocaleString('zh-CN')} 赞同`);
  await card.getByText('看看经验与出处', { exact: true }).click();
  await expect(card.getByRole('link', { name: '去知乎读这条回答', exact: true }).first()).toHaveAttribute('href', question.answers[0].url);
  await card.getByText('核对已取得的知乎摘要', { exact: true }).first().click();
  await expect(card).toContainText(question.answers[0].excerpt);
  await testInfo.attach('actual-question-desktop', { body: await card.screenshot(), contentType: 'image/png' });
  await page.setViewportSize({ width: 320, height: 850 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(321);
  await testInfo.attach('actual-question-320', { body: await card.screenshot(), contentType: 'image/png' });
  await testInfo.attach('actual-library-read', { body: JSON.stringify({ version: actual.version, totalAtObservation: actual.total, questionId: question.id, answerId: question.answers[0].answerId, voteCount: question.answers[0].voteCount, modelCalls: 0, libraryMocked: false }, null, 2), contentType: 'application/json' });
});
