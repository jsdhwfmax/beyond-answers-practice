import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import { CAMPUS_CORPUS } from '@/content/campus-corpus';
import { SOURCES } from '@/content/sources';
import { ExperienceBrief } from './experience-brief';

// The SSR fixture uses the module's actual selector names so its CSS can also
// be inspected in an isolated browser without modifying a production page.
vi.mock('./experience-brief.module.css', () => ({ default: new Proxy({}, { get: (_target, key) => String(key) }) }));
const question = () => structuredClone(CAMPUS_CORPUS.find(item => item.id === 'zhihu-q-40645474')!);

test('source dates read naturally and unknown dates do not invent a date', () => {
  const source = question(); source.answers[0].fetchedAt = '2026-09-13T18:30:00Z';
  const html = renderToStaticMarkup(createElement(ExperienceBrief, { questions: [source] }));
  expect(html).toContain('内容截至 2026-09-14'); expect(html).not.toContain('采集于');
  source.answers[0].fetchedAt = 'unknown';
  const withoutDate = renderToStaticMarkup(createElement(ExperienceBrief, { questions: [source] }));
  expect(withoutDate).not.toContain('截至'); expect(withoutDate).not.toContain('Invalid Date');
});

test('a reviewed brief distinguishes team takeaway, practice and original source, without executing callbacks', () => {
  const onUse = vi.fn(); const onOpenSources = vi.fn();
  const html = renderToStaticMarkup(createElement(ExperienceBrief, { questions: [question()], onUse, onOpenSources }));
  expect(html).toContain('先借一条经验'); expect(html).toContain('团队提炼'); expect(html).toContain('这次可以试');
  expect(html).toContain('适用提醒与作者原话'); expect(html).toContain('查看站内完整摘要与出处');
  expect(html).toContain('在知乎读这条回答'); expect(html).not.toContain('更能有效提升成绩');
  expect(html).toContain('type="button"'); expect(onUse).not.toHaveBeenCalled(); expect(onOpenSources).not.toHaveBeenCalled();
});
test('an unreviewed answer is visible as an excerpt and is not relabelled as a takeaway', () => {
  const unreviewed = question(); unreviewed.id = 'unreviewed-test';
  unreviewed.answers[0].viewpoints = ['保证改善现实关系'];
  const html = renderToStaticMarkup(createElement(ExperienceBrief, { questions: [unreviewed] }));
  expect(html).toContain('先看这段原摘要，想想哪里适合你');
  expect(html).toContain('已取得摘要节选'); expect(html).not.toContain('团队提炼');
  expect(html).not.toContain('保证改善现实关系'); expect(html).not.toContain('这次可以试');
});
test('no matched question displays an explicitly general source, not a pretend matching campus story', () => {
  const html = renderToStaticMarkup(createElement(ExperienceBrief, { questions: [], goal: '说明自己的想法' }));
  expect(html).toContain('通用方法，未匹配到相近经历'); expect(html).toContain(SOURCES[0].author);
  expect(html).toContain(SOURCES[0].excerpt); expect(html).toContain(SOURCES[0].conditions);
  expect(html).toContain(`/sources/${SOURCES[0].id}`); expect(html).not.toContain('新生校园指南');
});
test('writes a compact reviewed, excerpt-only and general-source preview for a separate visual check', async () => {
  const original = question(); const other = structuredClone(original); other.id = 'preview-unreviewed';
  const css = await readFile(path.resolve('src/components/experience-brief.module.css'), 'utf8');
  const markup = [createElement(ExperienceBrief, { key: 'reviewed', questions: [original], onUse: () => undefined }), createElement(ExperienceBrief, { key: 'excerpt', questions: [other] }), createElement(ExperienceBrief, { key: 'general', questions: [] })].map(element => renderToStaticMarkup(element)).join('');
  const directory = path.resolve('.local/qa/friend-d-experience'); await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'preview.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>经验卡独立预览</title><style>*{box-sizing:border-box}body{margin:0;background:#fff9ef;color:#442c27;font-family:"Microsoft YaHei UI",sans-serif;font-size:14px}main{max-width:780px;padding:12px;margin:auto}h2,h3,p{margin:0}button{font:inherit;cursor:pointer}a{color:inherit}${css}</style><main>${markup}</main></html>`, 'utf8');
  expect(markup.match(/aria-label="先借一条经验"/g)).toHaveLength(3);
});
