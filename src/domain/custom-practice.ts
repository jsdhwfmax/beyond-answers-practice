import { z } from 'zod';
import type { CampusCorpusQuestion } from '@/content/campus-corpus';

const short = z.string().trim().min(1).max(300);
export const customSetupSchema = z.object({
  title: z.string().trim().min(1).max(60), userRole: short, counterpartRole: short,
  goal: short, userFacts: z.array(short).max(10), assumptions: z.array(short).max(8),
  openingLine: z.string().trim().min(1).max(500),
}).strict();
export type CustomSetup = z.infer<typeof customSetupSchema>;
export interface CustomModelInfo { provider: 'bailian' | 'openai' | 'deepseek'; model: string }
export interface CustomGoalEvidence { turnId: string; speaker: 'user' | 'counterpart'; quote: string }
export interface CustomGoalAgreement {
  /** New certified entries use the proposal's exact words, never a generated paraphrase. */
  text: string; evidence: CustomGoalEvidence[];
  /** Absent on legacy records; those paraphrases are not certified agreements. */
  certification?: {
    version: 'proposal-acceptance-v1';
    proposal: CustomGoalEvidence; acceptance: CustomGoalEvidence;
  };
}
export interface CustomGoalProgress {
  status: 'in_progress' | 'partial' | 'achieved'; summary: string;
  evidence: CustomGoalEvidence[];
  agreements: CustomGoalAgreement[];
  /** Legacy records remain unchanged and can be explicitly reviewed again. */
  verificationVersion?: 'goal-progress-v2';
  openQuestions: string[]; evaluatedThroughTurnId: string; evaluatedAt: string;
  generatedBy?: CustomModelInfo;
}
export interface CustomSourceContext {
  version: string; match: 'matched' | 'none'; questions: CampusCorpusQuestion[]; note: string;
  basis?: 'scenario' | 'retrospective';
}
export interface CustomTurn {
  id: string; userText: string; reply: string; reflection: string;
  supportedQuote: string; sourceId: string | null; createdAt: string;
  generatedBy?: CustomModelInfo;
  sceneId?: string;
  goalProgress?: CustomGoalProgress;
  /** User-authored hypothetical counterpart speech; never independent goal evidence. */
  replyOrigin?: { kind: 'user_edit'; branchId: string; turnId: string };
}
export interface CustomScene {
  id: string; label: string; openingLine: string; turnIndex: number; createdAt: string;
  /** Missing on legacy scenes, whose openings remain counterpart dialogue. */
  openingKind?: 'guide' | 'counterpart';
  generatedBy?: CustomModelInfo;
}
export const CUSTOM_SCENE_GUIDE = '已进入你选择的模拟场景。你准备先对对方说什么？';
/** No user text or model output is interpolated into this code-owned prompt. */
export function customSceneGuide(): { openingKind: 'guide'; openingLine: typeof CUSTOM_SCENE_GUIDE } {
  return { openingKind: 'guide', openingLine: CUSTOM_SCENE_GUIDE };
}
export interface CustomBranch {
  id: string; label: string; parentId: string | null; setup: CustomSetup;
  accepted: boolean; finished: boolean; turns: CustomTurn[]; createdAt: string;
  generatedBy?: CustomModelInfo;
  /** Absent on records written before explicit simulated scene transitions. */
  scenes?: CustomScene[];
  goalProgress?: CustomGoalProgress;
  sourceContext?: CustomSourceContext;
}
export interface CustomPracticeView {
  id: string; version: number; topic: string; createdAt: string; updatedAt: string;
  /** The explicitly selected question at creation, retained even if setup generation fails. */
  sourceQuestionId?: string;
  expiresAt: string; activeBranchId: string | null; branches: CustomBranch[];
  generating: boolean; sourceVersion: string;
  pendingAction: { actionId: string; until: number } | null;
}
export interface CustomPracticeSummary {
  id: string; title: string; updatedAt: string; turns: number; ready: boolean;
}
export const customCreateSchema = z.object({
  id: z.uuid(), actionId: z.uuid(), topic: z.string().trim().min(1).max(2000),
  sourceQuestionId: z.string().regex(/^zhihu-q-\d+$/).optional(),
}).strict();
const actionFields = { actionId: z.uuid(), expectedVersion: z.number().int().nonnegative() };
export const customActionSchema = z.discriminatedUnion('kind', [
  z.object({ ...actionFields, kind: z.literal('accept_setup'), setup: customSetupSchema }).strict(),
  z.object({ ...actionFields, kind: z.literal('say'), text: z.string().trim().min(1).max(2000) }).strict(),
  z.object({ ...actionFields, kind: z.literal('advance_scene'), label: z.string().trim().min(1).max(120) }).strict(),
  z.object({ ...actionFields, kind: z.literal('edit_counterpart_reply'), turnId: z.uuid(), reply: z.string().trim().min(1).max(1200) }).strict(),
  z.object({ ...actionFields, kind: z.literal('rewind') }).strict(),
  z.object({ ...actionFields, kind: z.literal('switch_branch'), branchId: z.uuid() }).strict(),
  z.object({ ...actionFields, kind: z.literal('finish') }).strict(),
  z.object({ ...actionFields, kind: z.literal('review_goal') }).strict(),
]);
export type CustomAction = z.infer<typeof customActionSchema>;
export function activeCustomBranch(view: CustomPracticeView): CustomBranch | undefined {
  return view.branches.find(branch => branch.id === view.activeBranchId);
}
export function activeCustomScene(branch: CustomBranch | undefined): CustomScene | undefined {
  return branch?.scenes?.at(-1);
}
/** Readiness is local to this scene; older dialogue cannot unlock empty later scenes. */
export function customSceneReadiness(branch: CustomBranch | undefined): { ready: boolean; reason: string | null; turnsInScene: number } {
  const sceneStart = Math.max(0, activeCustomScene(branch)?.turnIndex ?? 0);
  const turnsInScene = branch?.turns.slice(sceneStart).filter(turn => turn.userText.trim() && turn.reply.trim()).length ?? 0;
  if (!branch?.accepted) return { ready: false, reason: '先确认情境，再开始对话。', turnsInScene };
  if (branch.finished) return { ready: false, reason: '这次练习已保存，回到上一步后可以继续。', turnsInScene };
  if (!turnsInScene) return { ready: false, reason: '先在这一幕里说出自己的话；聊过之后，才能跳到之后的时间或场景。', turnsInScene };
  return { ready: true, reason: null, turnsInScene };
}
/** Reject only known navigation placeholders, not arbitrary natural-language destinations. */
export function isGenericCustomSceneLabel(label: string): boolean {
  const normalized = label.normalize('NFKC').replace(/[\p{P}\p{Z}\s]/gu, '');
  return ['进入约定的下一幕', '进入这次谈话之后的下一幕', '进入下一幕', '下一幕', '推进时间', '推进时间进入下一幕', '进入下一段谈话', '进入下一场景', '下一步', '继续对话', '继续回答'].includes(normalized);
}
/** A draft destination, never evidence that either person accepted an appointment. */
export function suggestedCustomSceneLabel(branch: CustomBranch): string {
  const current = activeCustomScene(branch);
  const recent = branch.turns.slice(current?.turnIndex ?? 0).flatMap(turn => [turn.userText, turn.reply]).reverse();
  for (const text of recent) {
    const times = [...text.matchAll(/(?:今天|明天|后天|周[一二三四五六日天])?(?:的)?(?:上午|中午|下午|晚上|晚间|早上)?\s*(?:[零〇一二两三四五六七八九十\d]{1,3}点(?:半|[零〇一二两三四五六七八九十\d]{1,3}分)?|(?:[01]?\d|2[0-3]):[0-5]\d)/g)]
      .filter(match => !/^(建议|想法|要求|顾虑|意见|内容)/.test(text.slice(match.index! + match[0].length)));
    const time = times.at(-1)?.[0].trim();
    if (time && !current?.label.includes(time)) return `${time}，进入下一段谈话`;
  }
  return '';
}
export const CUSTOM_BOUNDARY = '这是原创角色扮演。对方的回应与同意只发生在模拟中，不能证明现实中的人会接受，也不表示现实行动已经完成。';
export const CUSTOM_SOURCE_BOUNDARY = '本练习借用“说清目标与边界”“把下一步做具体并检查”的通用方法。仅核读过以下知乎知识片段，不代表作者为这个自定义情境提供了答案。';
