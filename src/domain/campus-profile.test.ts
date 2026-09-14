import { describe, expect, test } from 'vitest';
import type { CampusCorpusQuestion } from '@/content/campus-corpus';
import { matchCampusProfiles, type CampusProfileContext, type CampusProfileMetadata, type CampusProfileTag } from './campus-profile';
import type { CampusProfileFilters } from './campus-profile-options';

function question(id: string, title: string, votes = 100): CampusCorpusQuestion {
  return { id, questionId: id.slice(8), title, questionUrl: `https://www.zhihu.com/question/${id.slice(8)}`, category: '学习与成长', tags: [], answers: [{ answerId: 'answer-1', url: 'https://www.zhihu.com/question/1/answer/1', author: '未用于判断身份', voteCount: votes, fetchedAt: '2026-09-14T00:00:00Z', excerpt: '我讨论的是普通本科在读的学习安排。', summaryKind: 'search_excerpt', sourceContentId: 'test', searchHashId: 'test', viewpoints: ['团队讨论博士规划，不是原文'] }], scenarioSeed: { userRole: '硕士', counterpartRole: '博士导师', situation: '原创985情境', goal: '练习求助' } };
}
function tag<T extends string>(value: T, quote: string, extra: Partial<CampusProfileTag<T>> = {}): CampusProfileTag<T> {
  return { value, quote, sourceScope: 'question', matchLabel: '题目讨论的情境，不代表作者身份', ...extra };
}
function context(overrides: Partial<CampusProfileContext> = {}): CampusProfileContext {
  return { id: 'current', label: '原题所述情境', education: [], schoolTier: [], stage: [], ...overrides };
}
const metadata = (id: string, contexts: CampusProfileContext[]): CampusProfileMetadata => ({ version: 'test-v1', entries: { [id]: { contexts } } });
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) freeze(child); }
  return value;
}

describe('profile discovery source evidence and strict intersections', () => {
  test('three selected dimensions require exact source evidence in one context', () => {
    const item = question('zhihu-q-1', '普通本科的本科生在读期间怎样安排学习？');
    const data = metadata(item.id, [context({ education: [tag('bachelor', '本科生')], schoolTier: [tag('ordinary_undergraduate', '普通本科')], stage: [tag('studying', '在读期间')] })]);
    const result = matchCampusProfiles([item], data, { education: 'bachelor', schoolTier: 'ordinary_undergraduate', stage: 'studying' });
    expect(result).toHaveLength(1);
    expect(result[0].evidence.map(entry => entry.dimension)).toEqual(['education', 'schoolTier', 'stage']);
    expect(result[0].evidence.every(entry => item.title.includes(entry.quote))).toBe(true);
    expect(result[0].contextLabel).toBe('原题所述情境');
  });
  test('missing a selected dimension returns zero instead of silently diluting the filter', () => {
    const item = question('zhihu-q-1', '本科生怎样安排学习？');
    const data = metadata(item.id, [context({ education: [tag('bachelor', '本科生')] })]);
    expect(matchCampusProfiles([item], data, { education: 'bachelor' })).toHaveLength(1);
    expect(matchCampusProfiles([item], data, { education: 'bachelor', schoolTier: '985' })).toEqual([]);
  });
  test('a comparison never joins a current bachelor context to the future 985 master context', () => {
    const item = question('zhihu-q-1', '普通本科在读，毕业后想考985硕士，该怎样准备？');
    const data = metadata(item.id, [
      context({ id: 'current', label: '普通本科在读现状', education: [tag('bachelor', '本科')], schoolTier: [tag('ordinary_undergraduate', '普通本科')], stage: [tag('studying', '在读')] }),
      context({ id: 'future', label: '题目讨论的985硕士升学目标，尚非已取得背景', education: [tag('master', '硕士')], schoolTier: [tag('985', '985')], stage: [tag('graduation_further_study', '毕业后')] }),
    ]);
    expect(matchCampusProfiles([item], data, { education: 'bachelor', schoolTier: '985' })).toEqual([]);
    expect(matchCampusProfiles([item], data, { education: 'master', stage: 'studying' })).toEqual([]);
    const future = matchCampusProfiles([item], data, { education: 'master', schoolTier: '985', stage: 'graduation_further_study' });
    expect(future).toHaveLength(1); expect(future[0].contextLabel).toContain('尚非已取得背景');
  });
  test('generic university or graduate topics and original simulation roles infer no education or tier', () => {
    const generic = question('zhihu-q-1', '大学生与研究生怎样安排学习？');
    const empty: CampusProfileMetadata = { version: 'test-v1', entries: {} };
    expect(matchCampusProfiles([generic], empty, { education: 'bachelor' })).toEqual([]);
    expect(matchCampusProfiles([generic], empty, { education: 'master' })).toEqual([]);
    expect(matchCampusProfiles([generic], empty, { schoolTier: '985' })).toEqual([]);
    expect(matchCampusProfiles([generic], empty, {})).toEqual([{ question: generic, evidence: [] }]);
  });
  test('changed quotes, the wrong answer ID and team or simulation text are not source evidence', () => {
    const item = question('zhihu-q-1', '怎样安排校园学习？');
    const attempts = [
      tag('bachelor', '普通本科正在读', { sourceScope: 'answer', answerId: 'answer-1' }),
      tag('bachelor', '普通本科在读', { sourceScope: 'answer', answerId: 'another-answer' }),
      tag('doctor', '团队讨论博士规划，不是原文', { sourceScope: 'answer', answerId: 'answer-1' }),
      tag('master', '硕士'),
      tag('bachelor', '  '),
    ];
    for (const attempt of attempts) {
      const data = metadata(item.id, [context({ education: [attempt] })]);
      expect(matchCampusProfiles([item], data, { education: attempt.value })).toEqual([]);
    }
  });
  test('an acquired answer excerpt keeps the exact answer and quote provenance', () => {
    const item = question('zhihu-q-1', '怎样安排校园学习？');
    const data = metadata(item.id, [context({ education: [tag('bachelor', '普通本科在读', { sourceScope: 'answer', answerId: 'answer-1' })] })]);
    expect(matchCampusProfiles([item], data, { education: 'bachelor' })[0].evidence).toEqual([
      { dimension: 'education', label: '本科', source: 'answer_excerpt', quote: '普通本科在读', answerId: 'answer-1', matchLabel: '题目讨论的情境，不代表作者身份' },
    ]);
  });
  test('211 and double-first-class match explicit topic labels without inferring 985', () => {
    const item = question('zhihu-q-1', '211或双一流大学的学习讨论');
    const data = metadata(item.id, [context({ schoolTier: [tag('211', '211'), tag('double_first_class', '双一流')] })]);
    expect(matchCampusProfiles([item], data, { schoolTier: '211' })).toHaveLength(1);
    expect(matchCampusProfiles([item], data, { schoolTier: 'double_first_class' })).toHaveLength(1);
    expect(matchCampusProfiles([item], data, { schoolTier: '985' })).toEqual([]);
  });
  test('browsing and ranking are deterministic, de-duplicate IDs and never mutate source objects', () => {
    const low = question('zhihu-q-3', '普通题目', 100); const highB = question('zhihu-q-2', '另一题', 500); const highA = question('zhihu-q-1', '普通题目', 500);
    const corpus = freeze([low, highB, highA, low]); const data = freeze(metadata(low.id, []));
    const before = JSON.stringify({ corpus, data });
    const result = matchCampusProfiles(corpus, data, {});
    expect(result.map(entry => entry.question.id)).toEqual(['zhihu-q-1', 'zhihu-q-2', 'zhihu-q-3']);
    expect(matchCampusProfiles([...corpus].reverse(), data, {}).map(entry => entry.question.id)).toEqual(result.map(entry => entry.question.id));
    expect(JSON.stringify({ corpus, data })).toBe(before);
    expect(result[2].question).toBe(low);
  });
  test('an unknown filter value cannot turn into unfiltered browsing', () => {
    const item = question('zhihu-q-1', '普通题目');
    expect(matchCampusProfiles([item], metadata(item.id, []), { education: 'all' } as unknown as CampusProfileFilters)).toEqual([]);
  });
  test('incompatible direct queries cannot match even when a source mentions both kinds of background', () => {
    const item = question('zhihu-q-1', '专科生、985本科生和高职专科的学习讨论');
    const data = metadata(item.id, [context({ education: [tag('junior_college', '专科生'), tag('bachelor', '本科生')], schoolTier: [tag('985', '985'), tag('vocational_college', '高职专科')] })]);
    expect(matchCampusProfiles([item], data, { education: 'junior_college', schoolTier: '985' })).toEqual([]);
    expect(matchCampusProfiles([item], data, { education: 'bachelor', schoolTier: 'vocational_college' })).toEqual([]);
    expect(matchCampusProfiles([item], data, { education: 'junior_college', schoolTier: 'vocational_college' })).toHaveLength(1);
    expect(matchCampusProfiles([item], data, { schoolTier: '985' })).toHaveLength(1);
  });
});
