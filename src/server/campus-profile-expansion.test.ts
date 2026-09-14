import { expect, test } from 'vitest';
import { discoverCampusQuestions, getProfileQuestion } from './campus-profile-library';

test('a specialist-college graduate matches its own background without borrowing a colleague’s 211 identity', () => {
  const id = 'zhihu-q-401648188';
  const own = discoverCampusQuestions({ education: 'junior_college', schoolTier: 'vocational_college', stage: 'internship_job_search' }, 0, 24);
  expect(own.matches.some(match => match.question.id === id)).toBe(true);
  expect(getProfileQuestion(id)?.answers[0].excerpt).toContain('就我一个专科，其中还有不少211');
  expect(discoverCampusQuestions({ schoolTier: '211' }, 0, 24).matches.some(match => match.question.id === id)).toBe(false);
});

test('a specialist college’s studying account does not establish an unstated personal education', () => {
  const id = 'zhihu-q-401637837';
  expect(discoverCampusQuestions({ schoolTier: 'vocational_college', stage: 'studying' }, 0, 24).matches.some(match => match.question.id === id)).toBe(true);
  expect(discoverCampusQuestions({ education: 'junior_college', schoolTier: 'vocational_college', stage: 'studying' }, 0, 24).matches.some(match => match.question.id === id)).toBe(false);
});

test('an explicit undergraduate 211 research account supports the complete same-situation combination', () => {
  const match = discoverCampusQuestions({ education: 'bachelor', schoolTier: '211', stage: 'studying' }, 0, 24).matches.find(match => match.question.id === 'zhihu-q-629263572');
  expect(match).toBeDefined();
  expect(match!.evidence.every(item => item.source === 'answer_excerpt')).toBe(true);
  expect(new Set(match!.evidence.map(item => item.answerId)).size).toBe(1);
});

test('a planned target university is not presented as an already-held school background', () => {
  const id = 'zhihu-q-383630190';
  expect(getProfileQuestion(id)?.title).toContain('双一流');
  expect(discoverCampusQuestions({ schoolTier: 'ordinary_undergraduate', stage: 'graduation_further_study' }, 0, 24).matches.some(match => match.question.id === id)).toBe(true);
  expect(discoverCampusQuestions({ schoolTier: 'double_first_class' }, 0, 24).matches.some(match => match.question.id === id)).toBe(false);
});

test('the master’s question and another author’s graduate history remain separately evidenced', () => {
  const id = 'zhihu-q-482483423';
  const question = discoverCampusQuestions({ education: 'master', schoolTier: 'double_first_class', stage: 'internship_job_search' }, 0, 24).matches.find(match => match.question.id === id);
  const author = discoverCampusQuestions({ education: 'master', schoolTier: '211', stage: 'graduation_further_study' }, 0, 24).matches.find(match => match.question.id === id);
  expect(question?.evidence.every(item => item.source === 'question')).toBe(true);
  expect(author?.evidence.every(item => item.source === 'answer_excerpt')).toBe(true);
  expect(discoverCampusQuestions({ education: 'master', schoolTier: '211', stage: 'studying' }, 0, 24).matches.some(match => match.question.id === id)).toBe(false);
});

test('an acquired master’s degree recalled after graduation does not establish a current transition stage', () => {
  for (const id of ['zhihu-q-351675467', 'zhihu-q-431748898']) {
    expect(discoverCampusQuestions({ education: 'master' }, 0, 24).matches.some(match => match.question.id === id)).toBe(true);
    expect(discoverCampusQuestions({ education: 'master', stage: 'graduation_further_study' }, 0, 24).matches.some(match => match.question.id === id)).toBe(false);
  }
});
