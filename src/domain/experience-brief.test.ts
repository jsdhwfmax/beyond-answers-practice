import { describe, expect, test } from 'vitest';
import { CAMPUS_CORPUS } from '@/content/campus-corpus';
import { buildExperienceBrief, REVIEWED_EXPERIENCE_QUESTION_IDS } from './experience-brief';

function sourceQuestion(id = 'zhihu-q-40645474') {
  return structuredClone(CAMPUS_CORPUS.find(question => question.id === id)!);
}

describe('individually reviewed experience briefs', () => {
  test.each(REVIEWED_EXPERIENCE_QUESTION_IDS)('the fixed source snapshot supports a reviewed brief: %s', id => {
    const question = sourceQuestion(id); const before = structuredClone(question);
    const brief = buildExperienceBrief(question);
    expect(brief.kind).toBe('reviewed');
    const answer = question.answers.find(item => item.answerId === brief.answerId)!;
    expect(brief.sourceId).toBe(answer.sourceContentId);
    expect(answer.excerpt).toContain(brief.quote);
    expect(brief.excerpt).toBe(answer.excerpt);
    if (brief.kind === 'reviewed') {
      expect(brief.summary.trim()).not.toBe(''); expect(brief.conditions.trim()).not.toBe(''); expect(brief.application.trim()).not.toBe('');
    }
    expect(question).toEqual(before);
  });
  test('the first question no longer promotes an unsupported comparative learning effect', () => {
    const brief = buildExperienceBrief(sourceQuestion());
    expect(brief.kind).toBe('reviewed');
    if (brief.kind === 'reviewed') {
      expect(brief.summary).not.toMatch(/更有效|更能有效|提升成绩|提高成绩/);
      expect(brief.conditions).toContain('没有比较');
    }
  });
  test('a source change falls back even if the former quoted sentence is still present', () => {
    const question = sourceQuestion(); question.answers[0].excerpt += '\n以上是在转述另一种观点，不能作为作者本人的建议。';
    const brief = buildExperienceBrief(question);
    expect(brief.kind).toBe('excerpt'); expect(brief).not.toHaveProperty('summary');
    expect(brief.excerpt).toBe(question.answers[0].excerpt);
  });
  test('an explicit answer ID never borrows a different answer’s takeaway or author', () => {
    const question = sourceQuestion(); const first = question.answers[0];
    question.answers.unshift({ ...structuredClone(first), answerId: 'different-answer', sourceContentId: 'different-source', author: '另一个回答者' });
    const specific = buildExperienceBrief(question, 'different-answer');
    expect(specific.kind).toBe('excerpt'); expect(specific.author).toBe('另一个回答者');
    expect(specific.sourceId).toBe('different-source'); expect(specific).not.toHaveProperty('summary');
    expect(buildExperienceBrief(question).answerId).toBe(first.answerId);
    expect(buildExperienceBrief(question, 'not-present').kind).toBe('missing');
    expect(buildExperienceBrief(question, 'not-present').answerId).toBeUndefined();
  });
  test('an unreviewed question shows an exact short excerpt rather than recycling team assertions', () => {
    const question = sourceQuestion(); question.id = 'zhihu-q-unreviewed';
    question.answers[0].excerpt = '这是原摘要中的经验。'.repeat(40) + '🙂';
    question.answers[0].viewpoints = ['这种方法保证任何人拿到第一名。'];
    const brief = buildExperienceBrief(question);
    expect(brief.kind).toBe('excerpt'); expect(brief).not.toHaveProperty('summary');
    expect(question.answers[0].excerpt.startsWith(brief.quote)).toBe(true);
    expect(Array.from(brief.quote).length).toBeLessThanOrEqual(180); expect(brief.quoteTruncated).toBe(true);
    expect(JSON.stringify(brief)).not.toContain('保证任何人');
  });
  test('empty evidence and invalid original links do not produce pretend summaries or unsafe links', () => {
    const question = sourceQuestion(); question.answers[0].excerpt = '  ';
    question.answers[0].url = 'javascript:alert(1)'; question.questionUrl = 'https://zhihu.com.evil.test/question/1';
    const brief = buildExperienceBrief(question, question.answers[0].answerId);
    expect(brief.kind).toBe('missing'); expect(brief).not.toHaveProperty('summary');
    expect(brief.answerUrl).toBeUndefined(); expect(brief.questionUrl).toBeUndefined();
  });
});
