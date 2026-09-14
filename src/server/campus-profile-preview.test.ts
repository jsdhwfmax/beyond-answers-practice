import { expect, test } from 'vitest';
import { CAMPUS_PROFILE_OPTIONS, isCampusProfileCombinationValid, type CampusProfileFilters } from '@/domain/campus-profile-options';
import { discoverCampusQuestions, getProfileQuestions, previewCampusQuestions, PROFILE_SOURCE_VERSION } from './campus-profile-library';
import { GET } from '@/app/api/discover/route';

test('count previews expose no corpus content, match full discovery and do not change sources or selections', () => {
  const filters: CampusProfileFilters = { education: 'doctor', schoolTier: '985', stage: 'entering' };
  const original = JSON.stringify({ filters, questions: getProfileQuestions() });
  const preview = previewCampusQuestions(filters);
  expect(preview).toMatchObject({ kind: 'count_preview', version: PROFILE_SOURCE_VERSION, filters });
  expect(Object.keys(preview).sort()).toEqual(['filters', 'kind', 'relaxations', 'total', 'version']);
  expect(preview.total).toBe(discoverCampusQuestions(filters).total);
  expect(JSON.stringify({ filters, questions: getProfileQuestions() })).toBe(original);
  expect(preview.total).toBe(0); expect(preview.relaxations.length).toBeGreaterThan(0);
  expect(JSON.stringify(preview)).not.toMatch(/questionUrl|answerId|excerpt|quote|author|matches/);
});

test('every legal combination uses the original AND count; zero suggestions remove the fewest explicit fields and have real results', () => {
  for (const education of [undefined, ...CAMPUS_PROFILE_OPTIONS.education.map(option => option.value)]) {
    for (const schoolTier of [undefined, ...CAMPUS_PROFILE_OPTIONS.schoolTier.map(option => option.value)]) {
      for (const stage of [undefined, ...CAMPUS_PROFILE_OPTIONS.stage.map(option => option.value)]) {
        const filters: CampusProfileFilters = { ...(education ? { education } : {}), ...(schoolTier ? { schoolTier } : {}), ...(stage ? { stage } : {}) };
        if (!isCampusProfileCombinationValid(filters)) continue;
        const preview = previewCampusQuestions(filters);
        expect(preview.total).toBe(discoverCampusQuestions(filters).total);
        if (preview.total) { expect(preview.relaxations).toEqual([]); continue; }
        expect(preview.relaxations.length).toBeGreaterThan(0); expect(preview.relaxations.length).toBeLessThanOrEqual(3);
        for (const suggestion of preview.relaxations) {
          const expected = { ...filters }; for (const field of suggestion.removedFields) delete expected[field];
          expect(suggestion.filters).toEqual(expected);
          expect(suggestion.total).toBeGreaterThan(0);
          expect(suggestion.total).toBe(discoverCampusQuestions(suggestion.filters).total);
          // Re-adding any removed condition must return to zero, else this was not minimal.
          for (const field of suggestion.removedFields) expect(discoverCampusQuestions({ ...suggestion.filters, [field]: filters[field] }).total).toBe(0);
        }
      }
    }
  }
});

test('public count mode is no-store, cookie-free and contains only versioned count data', async () => {
  const result = await GET(new Request('https://practice.test/api/discover?preview=1&education=doctor&schoolTier=985&stage=entering'));
  expect(result.status).toBe(200); expect(result.headers.get('set-cookie')).toBeNull(); expect(result.headers.get('cache-control')).toContain('no-store');
  const body = await result.json(); expect(body).toEqual(previewCampusQuestions({ education: 'doctor', schoolTier: '985', stage: 'entering' }));
  expect(JSON.stringify(body).length).toBeLessThan(1600);
});

test('a count source version must still match before full discovery; mismatch returns conflict with no results', async () => {
  const stale = await GET(new Request('https://practice.test/api/discover?education=bachelor&expectedSourceVersion=old-version'));
  expect(stale.status).toBe(409); expect(await stale.json()).toMatchObject({ error: { code: 'SOURCE_VERSION_CHANGED' } });
  const current = await GET(new Request(`https://practice.test/api/discover?education=bachelor&expectedSourceVersion=${PROFILE_SOURCE_VERSION}`));
  expect(current.status).toBe(200); expect(await current.json()).toMatchObject({ version: PROFILE_SOURCE_VERSION, filters: { education: 'bachelor' } });
});

test.each(['preview=2', 'preview=1&preview=1', 'preview=1&limit=24', 'preview=1&offset=0', 'preview=1&education=junior_college&schoolTier=985', 'preview=1&education=unverified', 'expectedSourceVersion='])('invalid count mode does not broaden or return data: %s', async query => {
  const result = await GET(new Request(`https://practice.test/api/discover?${query}`));
  expect(result.status).toBe(400); expect(await result.json()).toHaveProperty('error');
});
