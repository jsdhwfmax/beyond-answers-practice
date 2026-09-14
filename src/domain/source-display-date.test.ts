import { expect, test } from 'vitest';
import { sourceAsOf, sourceVotesLabel } from './source-display-date';

test('saved observation instants use the same Beijing date in browser and export', () => {
  expect(sourceAsOf('2026-09-13T18:30:00.000Z')).toBe('截至 2026-09-14');
  expect(sourceAsOf('2026-09-14T02:30:00+08:00')).toBe('截至 2026-09-14');
  expect(sourceAsOf('2026-09-13')).toBe('截至 2026-09-13');
  expect(sourceAsOf('2024-02-29T08:00:00Z')).toBe('截至 2024-02-29');
});

test('unknown, impossible and unzoned dates are omitted rather than made current', () => {
  for (const input of [undefined, null, '', 'unknown', '2026-02-30', '2026-02-30T08:00:00Z', '2026-09-14T09:30:00', '2026-09-14T99:30:00Z']) {
    expect(sourceAsOf(input)).toBe('');
  }
  expect(sourceVotesLabel({ voteCount: 428, fetchedAt: 'unknown' })).toBe('428 赞同');
  expect(sourceVotesLabel(undefined)).toBe('— 赞同');
});

test('votes keep the saved value and date without mutating the source', () => {
  const source = { voteCount: 1234, fetchedAt: '2026-09-13T18:30:00Z' }; const before = { ...source };
  expect(sourceVotesLabel(source)).toBe('1,234 赞同 · 截至 2026-09-14');
  expect(source).toEqual(before);
});
