import { describe, expect, test } from 'vitest';
import { CAMPUS_EDUCATION_OPTIONS, CAMPUS_SCHOOL_TIER_OPTIONS, campusSchoolOptions, isCampusProfileCombinationValid, sanitizeCampusProfileFilters, type CampusProfileFilters } from './campus-profile-options';

describe('one study context controls the available school types', () => {
  test('education remains optional and permits browsing each independent school tag', () => {
    expect(campusSchoolOptions()).toEqual(CAMPUS_SCHOOL_TIER_OPTIONS);
    for (const option of CAMPUS_SCHOOL_TIER_OPTIONS) expect(isCampusProfileCombinationValid({ schoolTier: option.value })).toBe(true);
  });
  test('junior college offers only vocational/junior college, while other degrees exclude it', () => {
    expect(campusSchoolOptions('junior_college').map(option => option.value)).toEqual(['vocational_college']);
    for (const education of ['bachelor', 'master', 'doctor'] as const) {
      expect(campusSchoolOptions(education).map(option => option.value)).toEqual(['985', '211', 'double_first_class', 'ordinary_undergraduate']);
    }
  });
  test.each(CAMPUS_EDUCATION_OPTIONS.flatMap(education => CAMPUS_SCHOOL_TIER_OPTIONS.map(school => ({ education: education.value, schoolTier: school.value }))))('all degree/type intersections are consistent: $education / $schoolTier', filters => {
    const expected = filters.education === 'junior_college' ? filters.schoolTier === 'vocational_college' : filters.schoolTier !== 'vocational_college';
    expect(isCampusProfileCombinationValid(filters)).toBe(expected);
  });
  test('a conflicting saved school choice is removed without changing education, stage or source object', () => {
    const prior = Object.freeze({ education: 'junior_college', schoolTier: '985', stage: 'internship_job_search' } as const);
    expect(sanitizeCampusProfileFilters(prior)).toEqual({ filters: { education: 'junior_college', stage: 'internship_job_search' }, clearedSchoolTier: '985' });
    expect(prior.schoolTier).toBe('985');
    expect(sanitizeCampusProfileFilters({ education: 'master', schoolTier: 'vocational_college', stage: 'studying' })).toEqual({ filters: { education: 'master', stage: 'studying' }, clearedSchoolTier: 'vocational_college' });
  });
  test('valid local choices are preserved without inventing additional overlapping school tags', () => {
    const filters: CampusProfileFilters = { education: 'bachelor', schoolTier: '985', stage: 'entering' };
    expect(sanitizeCampusProfileFilters(filters)).toEqual({ filters });
    expect(sanitizeCampusProfileFilters({ schoolTier: 'vocational_college' })).toEqual({ filters: { schoolTier: 'vocational_college' } });
  });
  test('malformed saved values and unrelated keys cannot create supported filters', () => {
    for (const input of [null, 42, 'master', ['bachelor']]) expect(sanitizeCampusProfileFilters(input)).toEqual({ filters: {} });
    expect(sanitizeCampusProfileFilters({ education: ['bachelor'], schoolTier: '211_non985', stage: 'entering', authorIdentity: '985' })).toEqual({ filters: { stage: 'entering' } });
  });
});
