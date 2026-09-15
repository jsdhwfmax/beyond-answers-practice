import { describe, expect, test } from 'vitest';
import type { CampusCorpusQuestion } from '@/content/campus-corpus';
import { captureCustomRetryDraft, matchesCustomDraft, restoreQuestionDraft, restoreStoredQuestionDraft, type CustomDraftIdentity } from './custom-draft';

const questionId = 'zhihu-q-2059626138549350826';
const oldSeed = {
  userRole: '组员',
  counterpartRole: '组长',
  situation: '小组作业初稿完成后，组长想直接提交，你认为方案存在漏洞但怕被觉得拖进度。',
  goal: '向组长提出先用几个问题自查方案漏洞，并请求全组花半小时一起做一次质疑推演后再提交。',
};
const libraryDraft = `我扮演${oldSeed.userRole}，想和${oldSeed.counterpartRole}聊一聊。${oldSeed.situation}\n这次我希望：${oldSeed.goal}`;
const deepLinkDraft = `我是${oldSeed.userRole}，想和${oldSeed.counterpartRole}聊聊。${oldSeed.situation}我希望${oldSeed.goal}`;
const revisedTopic = '我是刚加入科研团队的学生，想和导师聊聊，问清楚课题指导和分工。';

describe('question draft recovery', () => {
  test.each([libraryDraft, deepLinkDraft])('replaces a known obsolete automatic draft with the current question seed', saved => {
    expect(restoreQuestionDraft(questionId, saved, revisedTopic)).toBe(revisedTopic);
  });

  test.each([
    '',
    '我想先问导师每周可以在哪个时间讨论进展。',
    `${libraryDraft}\n但我希望改成向导师请教。`,
    ` ${deepLinkDraft}`,
  ])('preserves the exact user draft, including deliberate deletion or small edits', saved => {
    expect(restoreQuestionDraft(questionId, saved, revisedTopic)).toBe(saved);
  });

  test('does not migrate the same text attached to another question', () => {
    expect(restoreQuestionDraft('zhihu-q-unrelated', libraryDraft, revisedTopic)).toBe(libraryDraft);
  });

  test('uses the current seed only when no saved draft exists', () => {
    expect(restoreQuestionDraft(questionId, null, revisedTopic)).toBe(revisedTopic);
  });

  const storedQuestion: CampusCorpusQuestion = {
    id: questionId, questionId: '2059626138549350826', title: '在一个科研团队中,导师究竟有什么实际作用?',
    questionUrl: 'https://www.zhihu.com/question/2059626138549350826', category: '合作学习', tags: [], answers: [], scenarioSeed: oldSeed,
  };

  test('restoring the library entry revises the stored seed and automatic draft together without mutating the stored object', () => {
    const original = structuredClone(storedQuestion);
    const restored = restoreStoredQuestionDraft(storedQuestion, libraryDraft);
    expect(restored.question.scenarioSeed.counterpartRole).toBe('导师');
    expect(restored.topic).toContain('想和导师聊一聊');
    expect(restored.topic).not.toContain('小组作业');
    expect(storedQuestion).toEqual(original);
    expect(restored.question.questionUrl).toBe(original.questionUrl);
    expect(restored.question.answers).toBe(storedQuestion.answers);
  });

  test.each(['', '我已经改写过：准备先向同门了解组会，再向导师请教。'])('restoring an old question object preserves the user description', saved => {
    const restored = restoreStoredQuestionDraft(storedQuestion, saved);
    expect(restored.question.scenarioSeed.counterpartRole).toBe('导师');
    expect(restored.topic).toBe(saved);
  });
});

describe('asynchronous creation stays with its selected question', () => {
  const submitted: CustomDraftIdentity = { topic: libraryDraft, questionId, selectionRevision: 2 };

  test.each([
    { ...submitted, questionId: 'zhihu-q-another' },
    { ...submitted, questionId: null },
    { ...submitted, topic: revisedTopic },
    // Returning to the same question must not apply work begun before selecting another one.
    { ...submitted, selectionRevision: 4 },
  ])('rejects a stale response even when a different selection uses identical wording', current => {
    expect(matchesCustomDraft(submitted, current)).toBe(false);
  });

  test('allows an unchanged submission and an unchanged source-free submission', () => {
    expect(matchesCustomDraft(submitted, { ...submitted })).toBe(true);
    const free = { ...submitted, questionId: null };
    expect(matchesCustomDraft(free, { ...free })).toBe(true);
  });

  test('retry ownership accepts creation-time trimming but preserves exact text and source for the eventual cleanup', () => {
    const rawDraft = { ...submitted, topic: `  ${revisedTopic}\n` };
    const owned = captureCustomRetryDraft(revisedTopic, questionId, rawDraft);
    expect(owned).toEqual(rawDraft);
    expect(owned).not.toBe(rawDraft);
    expect(matchesCustomDraft(owned!, rawDraft)).toBe(true);
    expect(matchesCustomDraft(owned!, { ...rawDraft, topic: `${rawDraft.topic}\n` })).toBe(false);
    expect(matchesCustomDraft(owned!, { ...rawDraft, selectionRevision: rawDraft.selectionRevision + 1 })).toBe(false);
    expect(captureCustomRetryDraft(revisedTopic, 'zhihu-q-another', rawDraft)).toBeNull();
    expect(captureCustomRetryDraft('另一段已经保存的练习', questionId, rawDraft)).toBeNull();
  });

  test('a delayed response cannot overwrite a newer question selection', async () => {
    let current = { ...submitted };
    let finish: (() => void) | undefined;
    const response = new Promise<void>(resolve => { finish = resolve; });
    const mayApply = response.then(() => matchesCustomDraft(submitted, current));
    current = { ...current, questionId: 'zhihu-q-new', selectionRevision: current.selectionRevision + 1 };
    finish?.();
    await expect(mayApply).resolves.toBe(false);
    expect(current).toEqual({ topic: libraryDraft, questionId: 'zhihu-q-new', selectionRevision: 3 });
  });
});
