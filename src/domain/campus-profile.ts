import type { CampusCorpusQuestion } from '@/content/campus-corpus';
import {
  CAMPUS_PROFILE_OPTIONS, isCampusProfileCombinationValid, type CampusDiscoveryEvidence, type CampusDiscoveryMatch,
  type CampusEducation, type CampusProfileDimension, type CampusProfileFilters,
  type CampusSchoolTier, type CampusStage,
} from './campus-profile-options';

export interface CampusProfileTag<T extends string = string> {
  value: T; quote: string; sourceScope: 'question' | 'answer'; answerId?: string; matchLabel: string;
}
export interface CampusProfileContext {
  id: string; label: string;
  education: CampusProfileTag<CampusEducation>[];
  schoolTier: CampusProfileTag<CampusSchoolTier>[];
  stage: CampusProfileTag<CampusStage>[];
}
export interface CampusProfileMetadata {
  version: string;
  entries: Record<string, { contexts: CampusProfileContext[] }>;
}
const dimensions = ['education', 'schoolTier', 'stage'] as const;
const compareText = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

function checkedEvidence(question: CampusCorpusQuestion, dimension: CampusProfileDimension, tag: CampusProfileTag): CampusDiscoveryEvidence | undefined {
  const option = CAMPUS_PROFILE_OPTIONS[dimension].find(item => item.value === tag.value);
  if (!option || !tag.quote?.trim() || !tag.matchLabel?.trim()) return;
  // Only acquired source text can support tags. Author fields, team paraphrases
  // and original simulation seeds do not establish education or school identity.
  const source = tag.sourceScope === 'question' ? question.title
    : tag.sourceScope === 'answer' && tag.answerId ? question.answers.find(answer => answer.answerId === tag.answerId)?.excerpt : undefined;
  if (!source?.includes(tag.quote)) return;
  return {
    dimension, label: option.label, source: tag.sourceScope === 'question' ? 'question' : 'answer_excerpt',
    quote: tag.quote, matchLabel: tag.matchLabel,
    ...(tag.sourceScope === 'answer' ? { answerId: tag.answerId } : {}),
  };
}

/** Strict AND within one explicitly annotated situation, never across people or stages. */
export function matchCampusProfiles(
  corpus: readonly CampusCorpusQuestion[], metadata: CampusProfileMetadata, filters: CampusProfileFilters,
): CampusDiscoveryMatch[] {
  const selected = dimensions.filter(dimension => filters[dimension] !== undefined);
  if (selected.some(dimension => !CAMPUS_PROFILE_OPTIONS[dimension].some(option => option.value === filters[dimension]))) return [];
  if (!isCampusProfileCombinationValid(filters)) return [];
  const matches: CampusDiscoveryMatch[] = []; const seen = new Set<string>();
  for (const question of corpus) {
    if (seen.has(question.id)) continue;
    seen.add(question.id);
    const contexts = [...(metadata.entries[question.id]?.contexts ?? [])].sort((left, right) => compareText(left.id, right.id));
    let match: CampusDiscoveryMatch | undefined;
    for (const context of contexts) {
      const evidence: CampusDiscoveryEvidence[] = [];
      for (const dimension of selected.length ? selected : dimensions) {
        const eligible = context[dimension].filter(tag => !selected.length || tag.value === filters[dimension]);
        const verified = eligible.map(tag => checkedEvidence(question, dimension, tag)).filter((item): item is CampusDiscoveryEvidence => Boolean(item));
        // One valid quote per selected dimension is enough; missing dimensions
        // are never silently removed from a user's requested intersection.
        if (selected.length && !verified.length) break;
        evidence.push(...verified);
      }
      if (selected.every(dimension => evidence.some(item => item.dimension === dimension))) {
        match = { question, evidence, ...(evidence.length ? { contextLabel: context.label } : {}) }; break;
      }
    }
    if (match) matches.push(match);
    else if (!selected.length) matches.push({ question, evidence: [] });
  }
  // Votes are fixed observation-time corpus facts. A lexical ID tie-break avoids
  // locale-dependent order; neither the corpus nor its answer arrays are sorted.
  const votes = (question: CampusCorpusQuestion) => Math.max(0, ...question.answers.map(answer => Number.isFinite(answer.voteCount) ? answer.voteCount : 0));
  return matches.sort((left, right) => votes(right.question) - votes(left.question) || compareText(left.question.id, right.question.id));
}
