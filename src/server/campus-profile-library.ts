import { CAMPUS_CORPUS, type CampusCorpusQuestion } from '@/content/campus-corpus';
import extras from '@/content/campus-profile-extra-data.json';
import annotations from '@/content/campus-profile-tags.json';
import { matchCampusProfiles, type CampusProfileMetadata } from '@/domain/campus-profile';
import type { CampusDiscoveryPreview, CampusDiscoveryResult, CampusProfileFilters, CampusProfileRelaxation } from '@/domain/campus-profile-options';

export const PROFILE_SOURCE_VERSION = 'campus-profile-2026-09-14-v3';
const metadata = annotations as CampusProfileMetadata;
// Preserve all original objects and their v2 identity. Supplementary questions
// are only an additional source for discovery and exact-ID selection.
const questions = [...new Map([
  ...(extras.questions as CampusCorpusQuestion[]).map(question => [question.id, question] as const),
  ...CAMPUS_CORPUS.map(question => [question.id, question] as const),
]).values()];
export function getProfileQuestions(): readonly CampusCorpusQuestion[] { return questions; }
export function getProfileQuestion(id: string): CampusCorpusQuestion | undefined { return questions.find(question => question.id === id); }
export function discoverCampusQuestions(filters: CampusProfileFilters, offset = 0, limit = 8): CampusDiscoveryResult {
  const matches = matchCampusProfiles(questions, metadata, filters);
  return { version: PROFILE_SOURCE_VERSION, filters: { ...filters }, total: matches.length, offset, limit, matches: matches.slice(offset, offset + limit) };
}

/** At most eight local matches; reuse the exact same-context AND rule as full browsing. */
export function previewCampusQuestions(filters: CampusProfileFilters): CampusDiscoveryPreview {
  const total = matchCampusProfiles(questions, metadata, filters).length;
  const relaxations: CampusProfileRelaxation[] = [];
  if (!total) {
    const selected = (['education', 'schoolTier', 'stage'] as const).filter(field => filters[field]);
    // Offer the smallest explicit change that has evidence, never silently broaden.
    for (let removeCount = 1; removeCount <= selected.length; removeCount++) {
      for (let mask = 1; mask < 1 << selected.length; mask++) {
        const removedFields = selected.filter((_, index) => mask & (1 << index));
        if (removedFields.length !== removeCount) continue;
        const relaxed = { ...filters };
        for (const field of removedFields) delete relaxed[field];
        const count = matchCampusProfiles(questions, metadata, relaxed).length;
        if (count) relaxations.push({ removedFields, filters: relaxed, total: count });
      }
      if (relaxations.length) break;
    }
  }
  return { kind: 'count_preview', version: PROFILE_SOURCE_VERSION, filters: { ...filters }, total, relaxations: relaxations.slice(0, 3) };
}
