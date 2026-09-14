import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { CAMPUS_CORPUS, CAMPUS_CORPUS_VERSION, CAMPUS_HIGH_VOTE_THRESHOLD } from './campus-corpus';
import baseline from '../../tests/fixtures/campus-v1-fingerprints.json';

// Fingerprints come from the original 180-question snapshot, not from the
// current corpus. Keep the full immutability check without duplicating its text.
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  const primitive = JSON.stringify(value);
  if (primitive === undefined) throw new Error('A source snapshot must contain JSON values');
  return primitive;
}

describe('published campus experience source integrity', () => {
  it('adds at least 60 questions without rewriting any v1 source snapshot', () => {
    expect(CAMPUS_CORPUS_VERSION).toBe('zhihu-campus-2026-09-14-v2');
    expect(baseline).toHaveLength(180);
    const oldIds = new Set(baseline.map(row => row.id));
    expect(CAMPUS_CORPUS.filter(row => !oldIds.has(row.id)).length).toBeGreaterThanOrEqual(60);
    expect(CAMPUS_CORPUS.length).toBeLessThanOrEqual(280);
    for (const previous of baseline) {
      const current = CAMPUS_CORPUS.find(row => row.id === previous.id);
      expect(current).toBeDefined();
      expect(createHash('sha256').update(canonicalJson(current)).digest('hex')).toBe(previous.sha256);
    }
  });

  it('deduplicates real questions and keeps answer IDs tied to their own question URL', () => {
    expect(CAMPUS_CORPUS.length).toBeGreaterThan(0);
    expect(new Set(CAMPUS_CORPUS.map(question => question.questionId)).size).toBe(CAMPUS_CORPUS.length);
    for (const question of CAMPUS_CORPUS) {
      expect(question.id).toBe(`zhihu-q-${question.questionId}`);
      expect(question.questionUrl).toBe(`https://www.zhihu.com/question/${question.questionId}`);
      expect(question.answers.length).toBeGreaterThan(0);
      for (const answer of question.answers) {
        const url = new URL(answer.url);
        expect(url.origin).toBe('https://www.zhihu.com');
        expect(url.pathname).toBe(`/question/${question.questionId}/answer/${answer.answerId}`);
        expect(Number.isInteger(answer.voteCount)).toBe(true);
        expect(answer.voteCount).toBeGreaterThanOrEqual(CAMPUS_HIGH_VOTE_THRESHOLD);
        expect(Number.isNaN(Date.parse(answer.fetchedAt))).toBe(false);
      }
    }
  });

  it('separates short acquired excerpts, team viewpoints, and original simulation seeds', () => {
    for (const question of CAMPUS_CORPUS) {
      expect(question.tags.length).toBeGreaterThan(0);
      expect(question.scenarioSeed.userRole.trim()).not.toBe('');
      expect(question.scenarioSeed.counterpartRole.trim()).not.toBe('');
      expect(question.scenarioSeed.goal.trim()).not.toBe('');
      for (const answer of question.answers) {
        expect(answer.summaryKind).toBe('search_excerpt');
        expect(answer.excerpt.length).toBeLessThanOrEqual(500);
        expect(answer.excerpt).not.toMatch(/|turn\d+(?:search|view)\d+/);
        expect(answer.viewpoints.length).toBeGreaterThan(0);
        expect(answer.viewpoints.length).toBeLessThanOrEqual(2);
        expect(answer.sourceContentId).not.toBe('');
        expect(answer.searchHashId).not.toBe('');
        if (answer.retrievalMethod === 'public_web_search') expect(answer.evidenceUrl).toBe(answer.url);
      }
    }
  });
});
