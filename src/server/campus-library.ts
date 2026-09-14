import { CAMPUS_CORPUS, CAMPUS_CORPUS_VERSION, CAMPUS_HIGH_VOTE_THRESHOLD, type CampusCorpusQuestion } from '@/content/campus-corpus';
import type { CustomSourceContext } from '@/domain/custom-practice';
import { AppError } from './errors';
import { getProfileQuestion, PROFILE_SOURCE_VERSION } from './campus-profile-library';

const STOP = new Set(['自己', '怎么', '如何', '什么', '一个', '我们', '可以', '应该', '觉得', '时候', '想要', '希望', '事情', '问题', '大学', '学生', '不是', '但是', '就是', '不想', '现在']);
function terms(text: string): Set<string> {
  const result = new Set<string>();
  for (const segment of text.toLowerCase().match(/[\p{Script=Han}]+|[a-z0-9]+/gu) ?? []) {
    if (/^[a-z0-9]+$/.test(segment)) { if (segment.length > 1) result.add(segment); continue; }
    for (let i = 0; i < segment.length - 1; i++) { const word = segment.slice(i, i + 2); if (!STOP.has(word)) result.add(word); }
  }
  return result;
}
export function rankCampusQuestions(query: string, corpus: CampusCorpusQuestion[] = CAMPUS_CORPUS) {
  const wanted = terms(query);
  return corpus.map(question => {
    const title = terms(question.title); const indexed = terms(`${question.title} ${question.tags.join(' ')}`);
    const titleOverlap = [...wanted].filter(term => title.has(term));
    const matched = [...wanted].filter(term => indexed.has(term));
    // A broad tag such as “校园” or one coincidental two-character word does
    // not establish that an answer concerns the player's actual situation.
    const exactTag = question.tags.filter(tag => tag.length >= 2 && query.includes(tag) && !STOP.has(tag)).length;
    const score = titleOverlap.length * 3 + (matched.length - titleOverlap.length) + Math.min(2, exactTag) * 2;
    const relevant = titleOverlap.length >= 2 && score >= 8 && matched.length / Math.max(1, Math.min(wanted.size, indexed.size)) >= 0.14;
    return { question, score, relevant };
  }).sort((a, b) => b.score - a.score || b.question.answers[0]?.voteCount - a.question.answers[0]?.voteCount || a.question.id.localeCompare(b.question.id));
}
export function matchCampusSources(topic: string, sourceQuestionId?: string, corpus: CampusCorpusQuestion[] = CAMPUS_CORPUS): CustomSourceContext {
  if (sourceQuestionId) {
    const original = corpus.find(question => question.id === sourceQuestionId);
    const selected = original ?? (corpus === CAMPUS_CORPUS ? getProfileQuestion(sourceQuestionId) : undefined);
    if (!selected) throw new AppError('SOURCE_NOT_FOUND', '这条知乎题目暂不可用，请重新选择题目或直接描述你的事情。', 404);
    return { version: original ? CAMPUS_CORPUS_VERSION : PROFILE_SOURCE_VERSION, basis: 'scenario', match: 'matched', questions: [structuredClone(selected)], note: '你选择了这道知乎问题。情境借鉴已取得的回答摘要，由作品原创改编；不复刻作者经历，不代表作者本人回应。' };
  }
  const matches = rankCampusQuestions(topic, corpus).filter(item => item.relevant).slice(0, 2).map(item => structuredClone(item.question));
  return { version: CAMPUS_CORPUS_VERSION, basis: 'scenario', match: matches.length ? 'matched' : 'none', questions: matches,
    note: matches.length ? '按你描述的主题关联到这些知乎问题。仅以已取得的回答摘要形成练习背景，是否适用于你的情况仍需自己判断。' : '当前题库尚未找到足够贴近这件事的知乎问题。本次继续作为原创情境，不把通用方法当作同题答案。' };
}
export function browseCampusLibrary({ query = '', category = '', offset = 0, limit = 12 }: { query?: string; category?: string; offset?: number; limit?: number }) {
  const corpus = category ? CAMPUS_CORPUS.filter(question => question.category === category) : CAMPUS_CORPUS;
  const found = query.trim() ? rankCampusQuestions(query, corpus).filter(item => item.score > 0).map(item => item.question) : corpus;
  const start = Math.max(0, Math.floor(offset)); const count = Math.min(24, Math.max(1, Math.floor(limit)));
  return { version: CAMPUS_CORPUS_VERSION, total: found.length, categories: [...new Set(CAMPUS_CORPUS.map(question => question.category))], questions: found.slice(start, start + count), highVoteThreshold: CAMPUS_HIGH_VOTE_THRESHOLD };
}
