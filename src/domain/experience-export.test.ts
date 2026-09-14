import { describe, expect, test } from 'vitest';
import { formatCustomPracticeText } from './custom-export';
import { type CustomBranch, type CustomPracticeView, CUSTOM_SCENE_GUIDE, customCreateSchema } from './custom-practice';
import { SOURCES } from '@/content/sources';
import { sourceReadingHref } from './source-reading';
import { initialState, transition } from './engine';
import { CAMPUS_CORPUS } from '@/content/campus-corpus';
import { buildExperienceBrief } from './experience-brief';

const branch = (): CustomBranch => ({ id: 'branch-1', label: '第一次', parentId: null, accepted: true, finished: false, createdAt: '2026-09-14', setup: { title: '课后请教', userRole: '新生', counterpartRole: '学姐', goal: '听听选课经验', userFacts: ['我想请教选课。'], assumptions: ['学姐愿意聊一会儿。'], openingLine: '想问哪方面？' }, turns: [{ id: 'turn-1', userText: '怎样看课表？', reply: '先核对必修，再留一点空余。', reflection: '可以把课程表放到一起核对。', supportedQuote: '怎样看课表？', sourceId: null, createdAt: '2026-09-14' }] });
const view = (branches: CustomBranch[]): CustomPracticeView => ({ id: 'practice', version: 3, topic: '我想问问选课经验', createdAt: '2026-09-14', updatedAt: '2026-09-14', expiresAt: '2026-10-14', activeBranchId: branches.at(-1)?.id ?? null, branches, generating: false, sourceVersion: 'test', pendingAction: null });

describe('readable experience records preserve evidence and history', () => {
  test('answer statistics use saved observation dates and omit unknown dates', () => {
    const question = structuredClone(CAMPUS_CORPUS.find(item => item.id === 'zhihu-q-40645474')!);
    question.answers[0].voteCount = 428; question.answers[0].fetchedAt = '2026-09-13T18:30:00Z';
    const current = branch(); current.sourceContext = { match: 'matched', version: 'test', questions: [question], note: '测试来源' };
    const record = view([current]); const before = structuredClone(record);
    expect(formatCustomPracticeText(record)).toContain('428 赞同 · 截至 2026-09-14');
    expect(formatCustomPracticeText(record)).not.toContain('采集时'); expect(record).toEqual(before);
    question.answers[0].fetchedAt = '';
    const text = formatCustomPracticeText(record); expect(text).toContain('428 赞同'); expect(text).not.toContain('截至');
  });
  test('exports only evidence-bound team briefs and keeps other answers as verbatim excerpts', () => {
    const question = structuredClone(CAMPUS_CORPUS.find(item => item.id === 'zhihu-q-40645474')!);
    const reviewed = buildExperienceBrief(question);
    expect(reviewed.kind).toBe('reviewed');
    const extra = { ...question.answers[0], answerId: 'unreviewed-answer', author: '另一位作者', excerpt: '先向对方说明自己遇到的具体问题。', viewpoints: ['保证任何人拿第一名。'] };
    question.answers.push(extra);
    const current = branch();
    current.sourceContext = { match: 'matched', basis: 'scenario', version: 'test', questions: [question], note: '测试来源' };
    const record = view([current]); const before = structuredClone(record);
    const text = formatCustomPracticeText(record);
    if (reviewed.kind === 'reviewed') {
      expect(text).toContain(reviewed.summary); expect(text).toContain(reviewed.conditions); expect(text).toContain(reviewed.application);
    }
    expect(text).toContain(extra.excerpt); expect(text).not.toContain(extra.viewpoints[0]);
    expect(text.split('团队提炼：')).toHaveLength(2);
    expect(record).toEqual(before);
  });
  test('exports independent branches, scene order and private reflection without mutating saved data', () => {
    const first = branch(); const second = { ...branch(), id: 'branch-2', parentId: first.id, label: '再试一次', scenes: [{ id: 'scene', label: '带着课表再聊', openingLine: '这次有哪些备选？', turnIndex: 1, createdAt: '2026-09-14' }] };
    const record = view([first, second]); const before = structuredClone(record);
    const text = formatCustomPracticeText(record, { 'branch-2': '明天先核对必修学分。' });
    expect(text).toContain('第一次'); expect(text).toContain('再试一次（当前尝试）');
    expect(text).toContain('进入下一幕：带着课表再聊'); expect(text).toContain('明天先核对必修学分。');
    expect(text.indexOf('这次有哪些备选')).toBeGreaterThan(text.lastIndexOf('先核对必修，再留一点空余。'));
    expect(record).toEqual(before);
  });
  test('legacy achievement and unpaired summary are never exported as verified results', () => {
    const old = branch(); old.goalProgress = { status: 'achieved', summary: '都完成了', evidence: [], agreements: [{ text: '已经约好晚上发微信', evidence: [] }], openQuestions: [], evaluatedThroughTurnId: 'turn-1', evaluatedAt: '2026-09-14' };
    const text = formatCustomPracticeText(view([old]));
    expect(text).toContain('历史目标与约定尚待重新核对'); expect(text).not.toContain('模拟沟通目标已达成'); expect(text).not.toContain('已经约好晚上发微信');
  });
  test('exports a guide as a scene prompt and preserves old counterpart openings verbatim', () => {
    const current = branch();
    current.scenes = [
      { id: 'old-scene', label: '旧场景', openingLine: '此前保存的对方开场。', turnIndex: 0, createdAt: '2026-09-14' },
      { id: 'guide-scene', label: '明天继续聊选课', openingLine: CUSTOM_SCENE_GUIDE, openingKind: 'guide', turnIndex: 1, createdAt: '2026-09-14' },
    ];
    const record = view([current]); const before = structuredClone(record);
    const text = formatCustomPracticeText(record);
    expect(text).toContain('进入下一幕：旧场景\n学姐（模拟）：\n此前保存的对方开场。');
    expect(text).toContain(`用户选定情境：明天继续聊选课\n场景提示：\n${CUSTOM_SCENE_GUIDE}`);
    expect(text).not.toContain(`学姐（模拟）：\n${CUSTOM_SCENE_GUIDE}`);
    expect(record).toEqual(before);
  });
  test('stale goal assessment is not presented as the latest result', () => {
    const old = branch(); old.goalProgress = { status: 'achieved', summary: '完成', evidence: [], agreements: [], verificationVersion: 'goal-progress-v2', openQuestions: [], evaluatedThroughTurnId: 'earlier-turn', evaluatedAt: '2026-09-14' };
    expect(formatCustomPracticeText(view([old]))).toContain('尚未完成最新目标核对');
  });
  test('official API content ids resolve to a reading page while verified article links remain usable', () => {
    expect(sourceReadingHref(SOURCES[0])).toBe(`/sources/${SOURCES[0].id}`);
    expect(sourceReadingHref({ ...SOURCES[0], sourceUrl: 'https://www.zhihu.com/question/123/answer/456' })).toBe('https://www.zhihu.com/question/123/answer/456');
  });
  test('a short concrete Chinese intention is accepted by the create contract', () => {
    expect(customCreateSchema.safeParse({ id: '11111111-1111-4111-8111-111111111111', actionId: '22222222-2222-4222-8222-222222222222', topic: '想请假' }).success).toBe(true);
  });
  test('a deadline question after reading materials gets a concrete manager response and retains the agreement', () => {
    const read = transition(initialState('workplace'), { type: 'inspect', materialId: 'workplace-brief' }).state;
    const first = transition(read, { type: 'ask', topic: 'deadline', actor: 'manager' });
    expect(first.events[0]).toMatchObject({ actor: 'manager', kind: 'disclosure' }); expect(first.events[0].text).toContain('15:00');
    const agreed = transition(first.state, { type: 'workplace_propose', order: ['summary', 'table'], requestReschedule: true }).state;
    const followup = transition(agreed, { type: 'ask', topic: 'deadline', actor: 'manager' });
    expect(followup.events[0].text).toContain('竞品表目前约定 16:00'); expect(followup.state).toEqual(agreed);
  });
});
