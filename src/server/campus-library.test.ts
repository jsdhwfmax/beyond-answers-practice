import { expect, test } from 'vitest';
import type { CampusCorpusQuestion } from '@/content/campus-corpus';
import { matchCampusSources, rankCampusQuestions } from './campus-library';

const corpus: CampusCorpusQuestion[] = [
  { id: 'zhihu-q-1', questionId: '1', title: '大学宿舍室友晚上打游戏声音很大，如何沟通？', questionUrl: 'https://www.zhihu.com/question/1', category: '宿舍关系', tags: ['室友', '噪音', '宿舍'], answers: [], scenarioSeed: { userRole: '室友', counterpartRole: '室友', situation: '噪音', goal: '沟通晚间安排' } },
  { id: 'zhihu-q-2', questionId: '2', title: '怎么和父母商量复读？', questionUrl: 'https://www.zhihu.com/question/2', category: '家庭沟通', tags: ['父母', '复读', '高考'], answers: [], scenarioSeed: { userRole: '孩子', counterpartRole: '家长', situation: '复读', goal: '沟通复读计划' } },
];
test('source matching needs topic evidence, not a generic university word or invented question', () => {
  expect(matchCampusSources('我想和室友商量晚上打游戏的声音', undefined, corpus).questions[0]?.id).toBe('zhihu-q-1');
  expect(matchCampusSources('大学的量子计算选课应该怎么安排', undefined, corpus).match).toBe('none');
  expect(matchCampusSources('修复电脑主板电路', undefined, corpus).questions).toEqual([]);
  expect(rankCampusQuestions('父母复读', corpus)[0].question.id).toBe('zhihu-q-2');
});
test('explicit question choices are versioned independent snapshots, invalid ids fail before generation', () => {
  const context = matchCampusSources('从问题开始练习', 'zhihu-q-2', corpus);
  expect(context.questions).toEqual([corpus[1]]); expect(context.questions[0]).not.toBe(corpus[1]);
  expect(context.note).toContain('原创改编');
  expect(() => matchCampusSources('想练习', 'zhihu-q-999', corpus)).toThrow('这条知乎题目暂不可用');
});
