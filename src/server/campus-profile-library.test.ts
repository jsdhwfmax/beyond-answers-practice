import { expect, test } from 'vitest';
import { CAMPUS_CORPUS, type CampusCorpusQuestion } from '@/content/campus-corpus';
import extras from '@/content/campus-profile-extra-data.json';
import annotations from '@/content/campus-profile-tags.json';
import type { CampusProfileMetadata } from '@/domain/campus-profile';
import { CAMPUS_PROFILE_OPTIONS } from '@/domain/campus-profile-options';
import { discoverCampusQuestions, getProfileQuestion, getProfileQuestions, PROFILE_SOURCE_VERSION } from './campus-profile-library';
import { GET } from '@/app/api/discover/route';

test('the supplementary accessor preserves every original object and resolves only exact question IDs', () => {
  const before = JSON.stringify(CAMPUS_CORPUS); const questions = getProfileQuestions();
  expect(new Set(questions.map(question => question.id)).size).toBe(questions.length);
  for (const original of CAMPUS_CORPUS) expect(getProfileQuestion(original.id)).toBe(original);
  for (const extra of extras.questions as CampusCorpusQuestion[]) expect(getProfileQuestion(extra.id)).toMatchObject(extra);
  expect(getProfileQuestion('not-an-id')).toBeUndefined();
  expect(getProfileQuestion(CAMPUS_CORPUS[0].title)).toBeUndefined();
  discoverCampusQuestions({}, 0, 8);
  expect(JSON.stringify(CAMPUS_CORPUS)).toBe(before);
});

test('published profile metadata uses valid options and exact acquired source quotations', () => {
  const metadata = annotations as CampusProfileMetadata;
  expect(metadata.version).toBe(PROFILE_SOURCE_VERSION);
  expect(extras.version).toBe(PROFILE_SOURCE_VERSION);
  for (const [id, entry] of Object.entries(metadata.entries)) {
    const question = getProfileQuestion(id);
    expect(question, `annotated question ${id} must exist`).toBeDefined();
    expect(new Set(entry.contexts.map(context => context.id)).size).toBe(entry.contexts.length);
    for (const context of entry.contexts) {
      expect(context.label.trim()).not.toBe('');
      for (const dimension of ['education', 'schoolTier', 'stage'] as const) {
        for (const tag of context[dimension]) {
          expect(CAMPUS_PROFILE_OPTIONS[dimension].some(option => option.value === tag.value), `${id}: ${dimension} ${tag.value}`).toBe(true);
          const source = tag.sourceScope === 'question' ? question!.title : question!.answers.find(answer => answer.answerId === tag.answerId)?.excerpt;
          expect(tag.quote.trim(), `${id}: empty quote`).not.toBe('');
          expect(source, `${id}: ${dimension} source`).toBeDefined();
          expect(source, `${id}: ${dimension} exact quote`).toContain(tag.quote);
          expect(tag.matchLabel.trim()).not.toBe('');
        }
      }
    }
  }
});

test('actual public discovery paginates the union without a guest cookie or silent filter removal', async () => {
  const first = await GET(new Request('https://practice.test/api/discover?limit=8'));
  expect(first.status).toBe(200); expect(first.headers.get('set-cookie')).toBeNull();
  const page = await first.json();
  expect(page).toMatchObject({ version: PROFILE_SOURCE_VERSION, filters: {}, total: getProfileQuestions().length, offset: 0, limit: 8 });
  expect(page.matches).toHaveLength(Math.min(8, getProfileQuestions().length));
  const next = discoverCampusQuestions({}, 8, 8);
  expect(next.matches.some(match => page.matches.some((prior: { question: { id: string } }) => prior.question.id === match.question.id))).toBe(false);
  const filtered = await GET(new Request('https://practice.test/api/discover?education=doctor&schoolTier=985&stage=entering&limit=8'));
  expect(filtered.status).toBe(200);
  const exact = await filtered.json();
  expect(exact.filters).toEqual({ education: 'doctor', schoolTier: '985', stage: 'entering' });
  for (const match of exact.matches) expect(match.evidence.map((item: { dimension: string }) => item.dimension)).toEqual(['education', 'schoolTier', 'stage']);
});

test('frozen real comparison and exclusion cases keep their distinct stages and school evidence', () => {
  const comparison = 'zhihu-q-357810399';
  const excluded985 = 'zhihu-q-58570383';
  const master985 = discoverCampusQuestions({ education: 'master', schoolTier: '985' }, 0, 24);
  expect(master985.matches.some(match => match.question.id === comparison)).toBe(false);
  const bachelor985Studying = discoverCampusQuestions({ education: 'bachelor', schoolTier: '985', stage: 'studying' }, 0, 24);
  expect(bachelor985Studying.matches.some(match => match.question.id === comparison)).toBe(false);
  const masterOrdinary = discoverCampusQuestions({ education: 'master', schoolTier: 'ordinary_undergraduate', stage: 'studying' }, 0, 24);
  expect(masterOrdinary.matches.find(match => match.question.id === comparison)?.contextLabel).toContain('硕士');
  expect(discoverCampusQuestions({ schoolTier: '985' }, 0, 24).matches.some(match => match.question.id === excluded985)).toBe(false);
});
