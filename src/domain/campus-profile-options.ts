import type { CampusCorpusQuestion } from '@/content/campus-corpus';

/** Client-safe options: this module must not import the corpus or profile JSON at runtime. */
export const CAMPUS_EDUCATION_OPTIONS = [
  { value: 'junior_college', label: '专科' },
  { value: 'bachelor', label: '本科' },
  { value: 'master', label: '硕士' },
  { value: 'doctor', label: '博士' },
] as const;
export const CAMPUS_SCHOOL_TIER_OPTIONS = [
  { value: '985', label: '985' },
  { value: '211', label: '211' },
  { value: 'double_first_class', label: '双一流' },
  { value: 'ordinary_undergraduate', label: '普通院校 / 双非' },
  { value: 'vocational_college', label: '高职 / 专科院校' },
] as const;
export const CAMPUS_STAGE_OPTIONS = [
  { value: 'entering', label: '入学适应' },
  { value: 'studying', label: '在读学习' },
  { value: 'graduation_further_study', label: '毕业升学' },
  { value: 'internship_job_search', label: '实习求职' },
] as const;
export type CampusEducation = typeof CAMPUS_EDUCATION_OPTIONS[number]['value'];
export type CampusSchoolTier = typeof CAMPUS_SCHOOL_TIER_OPTIONS[number]['value'];
export type CampusStage = typeof CAMPUS_STAGE_OPTIONS[number]['value'];
export interface CampusProfileFilters {
  education?: CampusEducation; schoolTier?: CampusSchoolTier; stage?: CampusStage;
}
export type CampusProfileDimension = keyof CampusProfileFilters;
export interface CampusDiscoveryEvidence {
  dimension: CampusProfileDimension; label: string;
  source: 'question' | 'answer_excerpt'; quote: string; answerId?: string;
  /** Editorial description of the topic's context, not the author's identity. */
  matchLabel: string;
}
export interface CampusDiscoveryMatch {
  question: CampusCorpusQuestion; evidence: CampusDiscoveryEvidence[]; contextLabel?: string;
}
export interface CampusDiscoveryResult {
  version: string; filters: CampusProfileFilters; total: number;
  offset: number; limit: number; matches: CampusDiscoveryMatch[];
}
export interface CampusProfileRelaxation {
  removedFields: CampusProfileDimension[];
  filters: CampusProfileFilters;
  total: number;
}
/** Counts only; no question, answer, author or quotation payload crosses this boundary. */
export interface CampusDiscoveryPreview {
  kind: 'count_preview';
  version: string;
  filters: CampusProfileFilters;
  total: number;
  relaxations: CampusProfileRelaxation[];
}
export const CAMPUS_PROFILE_OPTIONS = {
  education: CAMPUS_EDUCATION_OPTIONS, schoolTier: CAMPUS_SCHOOL_TIER_OPTIONS, stage: CAMPUS_STAGE_OPTIONS,
} as const;

/** Options describe one chosen study context, not every program an institution may host. */
export function campusSchoolOptions(education?: CampusEducation) {
  if (!education) return CAMPUS_SCHOOL_TIER_OPTIONS;
  return CAMPUS_SCHOOL_TIER_OPTIONS.filter(option => education === 'junior_college'
    ? option.value === 'vocational_college'
    : option.value !== 'vocational_college');
}

export function isCampusProfileCombinationValid(filters: CampusProfileFilters): boolean {
  return !filters.schoolTier || campusSchoolOptions(filters.education).some(option => option.value === filters.schoolTier);
}

/** Recover supported local preferences, preserving education and stage if a school choice conflicts. */
export function sanitizeCampusProfileFilters(input: unknown): { filters: CampusProfileFilters; clearedSchoolTier?: CampusSchoolTier } {
  const filters: CampusProfileFilters = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { filters };
  for (const dimension of ['education', 'schoolTier', 'stage'] as const) {
    const value = (input as Record<string, unknown>)[dimension];
    if (CAMPUS_PROFILE_OPTIONS[dimension].some(option => option.value === value)) Object.assign(filters, { [dimension]: value });
  }
  if (isCampusProfileCombinationValid(filters)) return { filters };
  const clearedSchoolTier = filters.schoolTier;
  delete filters.schoolTier;
  return { filters, clearedSchoolTier };
}
