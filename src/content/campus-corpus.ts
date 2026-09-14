import corpus from './campus-corpus-data.json';

/** Public Zhihu API excerpts, never full-answer claims. Votes are observation-time facts. */
export interface CampusCorpusAnswer {
  answerId: string;
  url: string;
  author: string;
  voteCount: number;
  fetchedAt: string;
  excerpt: string;
  summaryKind: 'search_excerpt';
  sourceContentId: string;
  searchHashId: string;
  retrievalMethod?: 'official_api' | 'public_web_search';
  evidenceUrl?: string;
  /** Team paraphrases grounded in the acquired excerpt, not author quotations. */
  viewpoints: string[];
}

export interface CampusCorpusQuestion {
  id: string;
  questionId: string;
  title: string;
  questionUrl: string;
  category: string;
  tags: string[];
  answers: CampusCorpusAnswer[];
  /** Original simulation seed. It is not a reconstruction of the author's life. */
  scenarioSeed: { userRole: string; counterpartRole: string; situation: string; goal: string };
}

export const CAMPUS_CORPUS_VERSION = 'zhihu-campus-2026-09-14-v2';
export const CAMPUS_HIGH_VOTE_THRESHOLD = 100;
export const CAMPUS_CORPUS: CampusCorpusQuestion[] = corpus as CampusCorpusQuestion[];
