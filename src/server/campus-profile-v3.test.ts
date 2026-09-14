import { expect, test } from 'vitest';
import { discoverCampusQuestions, getProfileQuestion, previewCampusQuestions, PROFILE_SOURCE_VERSION } from './campus-profile-library';
import { matchCampusSources } from './campus-library';
import { GET as discover } from '@/app/api/discover/route';
import { GET as readQuestion } from '@/app/api/campus-library/[id]/route';

test('博士211 has several sourced choices and an in-study subset without removing selected filters', async () => {
  const filters = { education: 'doctor', schoolTier: '211' } as const;
  const all = discoverCampusQuestions(filters, 0, 24);
  expect(all.total).toBeGreaterThanOrEqual(6);
  expect(previewCampusQuestions(filters)).toMatchObject({ filters, total: all.total, relaxations: [] });
  const inStudy = discoverCampusQuestions({ ...filters, stage: 'studying' }, 0, 24);
  expect(inStudy.total).toBeGreaterThanOrEqual(5);
  for (const match of inStudy.matches) {
    expect(match.evidence.map(item => item.dimension)).toEqual(['education', 'schoolTier', 'stage']);
  }
  const response = await discover(new Request('https://practice.test/api/discover?education=doctor&schoolTier=211&stage=studying&limit=2'));
  const page = await response.json();
  expect(page).toMatchObject({ filters: { ...filters, stage: 'studying' }, total: inStudy.total, limit: 2 });
  expect(page.matches).toHaveLength(2);
  const next = discoverCampusQuestions({ ...filters, stage: 'studying' }, 2, 2);
  expect(next.matches.some(item => page.matches.some((prior: { question: { id: string } }) => prior.question.id === item.question.id))).toBe(false);
});

test('a 211 doctoral student considering 985 stays associated with the current school', () => {
  const id = 'zhihu-q-530201491';
  expect(getProfileQuestion(id)?.title).toContain('想去一所985');
  expect(discoverCampusQuestions({ education: 'doctor', schoolTier: '211', stage: 'studying' }, 0, 24).matches.some(item => item.question.id === id)).toBe(true);
  expect(discoverCampusQuestions({ education: 'doctor', schoolTier: '985' }, 0, 24).matches.some(item => item.question.id === id)).toBe(false);
});

test('the doctoral stage never borrows an undergraduate school or the questioner’s degree from another author', () => {
  const doctoral = 'zhihu-q-2012555174539961491';
  expect(getProfileQuestion(doctoral)?.title).toContain('本科双非,硕博211');
  expect(discoverCampusQuestions({ education: 'doctor', schoolTier: '211' }, 0, 24).matches.some(item => item.question.id === doctoral)).toBe(true);
  expect(discoverCampusQuestions({ education: 'doctor', schoolTier: 'ordinary_undergraduate' }, 0, 24).matches.some(item => item.question.id === doctoral)).toBe(false);
  for (const id of ['zhihu-q-308523686', 'zhihu-q-559157484']) {
    expect(discoverCampusQuestions({ education: 'doctor', schoolTier: '211' }, 0, 24).matches.some(item => item.question.id === id)).toBe(false);
  }
});

test('a newly discovered question opens the exact source and original practice seed', async () => {
  const id = 'zhihu-q-2012555174539961491';
  const selected = discoverCampusQuestions({ education: 'doctor', schoolTier: '211', stage: 'internship_job_search' }, 0, 24).matches.find(item => item.question.id === id);
  expect(selected).toBeDefined();
  const response = await readQuestion(new Request(`https://practice.test/api/campus-library/${id}`), { params: Promise.resolve({ id }) });
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.question).toEqual(selected!.question);
  const sourceUrl = new URL(data.question.answers[0].url);
  expect(sourceUrl.origin).toBe('https://www.zhihu.com');
  expect(sourceUrl.pathname).toMatch(/^\/question\/2012555174539961491\/answer\/\d+$/);
  expect(data.question.scenarioSeed.goal.trim()).not.toBe('');
  const context = matchCampusSources('准备向导师询问留校条件', id);
  expect(context.version).toBe(PROFILE_SOURCE_VERSION);
  expect(context.questions).toEqual([selected!.question]);
  expect(context.questions[0]).not.toBe(selected!.question);
  const original = selected!.question.title;
  context.questions[0].title = 'independent saved copy';
  expect(getProfileQuestion(id)?.title).toBe(original);
});
