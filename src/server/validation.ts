import { z } from 'zod';
import type { ActionRequest, Command, Interpretation } from '@/domain/types';
import { AppError } from './errors';
import { explicitlyEndsPractice } from './practice-intent';

const actor = z.enum(['lin', 'xu', 'zhou', 'user', 'system', 'manager']);
const task = z.enum(['B1', 'B2', 'B3', 'B4', 'V1', 'V2', 'V3', 'G', 'Q1', 'Q2', 'Q3']);
const shortText = z.string().trim().min(1).max(500);
export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('inspect'), materialId: shortText }).strict(),
  z.object({ type: z.literal('ask'), topic: shortText, actor: actor.optional() }).strict(),
  z.object({ type: z.literal('propose'), taskIds: z.array(task).max(12), conditions: z.array(shortText).max(12).optional(), acknowledgements: z.array(shortText).max(12).optional(), assignments: z.array(z.object({ taskId: task, actor, start: z.number().int().min(0).max(1440).optional() }).strict()).max(12).optional() }).strict(),
  z.object({ type: z.literal('acknowledge'), items: z.array(shortText).min(1).max(12) }).strict(),
  z.object({ type: z.literal('withdraw') }).strict(),
  z.object({ type: z.literal('finish') }).strict(),
  z.object({ type: z.literal('hint') }).strict(),
  z.object({ type: z.literal('reply_options_seen') }).strict(),
  z.object({ type: z.literal('transfer_plan'), steps: z.array(z.enum(['publish', 'verify', 'references'])).max(3) }).strict(),
  z.object({ type: z.literal('transfer_execute'), step: z.enum(['publish', 'verify', 'references']) }).strict(),
  z.object({ type: z.literal('workplace_propose'), order: z.array(z.enum(['summary', 'table'])).min(1).max(2), requestReschedule: z.boolean() }).strict(),
  z.object({ type: z.literal('clarify'), question: shortText }).strict(),
]);

export const actionSchema = z.object({ actionId: z.string().uuid(), expectedVersion: z.number().int().min(0), text: z.string().trim().min(1).max(3000).optional(), command: commandSchema.optional() }).strict().refine(value => Boolean(value.text) !== Boolean(value.command), '只提交一段原话或一个结构化动作。');
export const scenarioSchema = z.object({ scenario: z.enum(['campus', 'transfer', 'workplace']).default('campus') }).strict();
export const forkSchema = z.object({ expectedVersion: z.number().int().min(0), afterSequence: z.number().int().min(0).optional(), reason: z.enum(['retry', 'correction']).default('retry') }).strict();
export const reflectionSchema = z.object({ requestId: z.string().uuid(), expectedVersion: z.number().int().min(0) }).strict();

export function parseAction(value: unknown): ActionRequest {
  const result = actionSchema.safeParse(value);
  if (!result.success) throw new AppError('INVALID_ACTION', '动作格式不完整，请刷新页面后重试。');
  return result.data as ActionRequest;
}

export interface WorkplaceCandidate {
  commandIndex: number;
  requestedDeadlineMinutes: number | null;
  requestedDeadlineQuote: string | null;
  conditions: string[];
}
export interface ModelInterpretation extends Interpretation { workplaceCandidates?: WorkplaceCandidate[] }

const workplaceCandidateSchema = z.object({ commandIndex: z.number().int().min(0).max(3), requestedDeadlineMinutes: z.number().int().min(0).max(1440).nullable(), requestedDeadlineQuote: z.string().min(1).max(3000).nullable(), conditions: z.array(shortText).max(12) }).strict();
const hasConditionalContext = (text: string) => /如果|假如|假设|倘若|(?:只有|只要)[^。；;\n]{0,60}(?:才|就|方可|方能|前提|同意|确认|完成|允许|批准|通过)|除非|前提|一旦|要是|若|否则|取决于|等[^。；;\n]{0,16}(?:后|再)|(?:同意|确认|完成|批准|允许|答应|通过)[^。；;\n]{0,8}(?:后|之后|以后)/.test(text);
const hasDeniedConsent = (text: string) => /(?:不|未|没|没有|不能|无法|不会|还没|尚未)[^。；;，,\n]{0,5}(?:同意|接受|确认|赞成|愿意)|拒绝|不反对|(?:不要|别|不准|不许|不能|并非|不是|并不|没有|不想|不打算|不准备|无意|没打算|不会)[^。；;\n]{0,8}(?:取消|缩减|减少|替换|放弃|确认|同意|接受)|不(?:取消|缩减|减少|替换|放弃)/.test(text);
const withoutPoliteRequest = (text: string) => text.replace(/可不可以|可以不可以|能不能|能否|可否|是否可以/g, '');
const scopeReduction = '(?:取消|缩减|减少|替换|放弃|不做|不再做|舍弃|砍掉|去掉|删掉|移除|删去|减掉|精简|拿掉|撤下)';
const deniedRangeAction = new RegExp(`(?:不要|别|不准|不许|不能|并非|不是|并不|没有|不想|不打算|不准备|无意|没打算|不会|不)[^。；;，,\\n]{0,16}${scopeReduction}`);
const visualReduction = new RegExp(`${scopeReduction}[^。；;，,\\n]{0,16}(?:精修|视觉|V[1-3]|美化|样式|版式)|(?:精修|视觉|V[1-3])[^。；;，,\\n]{0,16}${scopeReduction}`);
const freeInteraction = '(?:自由问答|自由回答|自由提问|聊天|自由输入(?:的)?(?:问题|内容))';
const capabilityLimit = new RegExp(`(?:不支持|不提供|不能|不做|没有|不含|不会)[^。；;，,\\n]{0,12}${freeInteraction}`, 'g');
const deniedCapabilityLimit = new RegExp(`(?:不是|并非|不代表|不等于|不意味着|不要说|不能说|别说|不会说|没有|不会|并不)[^。；;，,\\n]{0,12}(?:不支持|不提供|不能|不做|没有|不含|不会)[^。；;，,\\n]{0,12}${freeInteraction}`);
const claimedFreeInteraction = new RegExp(`(?:可以|能够|能|支持|提供|会)[^。；;，,\\n]{0,8}${freeInteraction}`);
const newNeed = '(?:新增|新需要|新需求|问答|新问题|新功能|新生(?:的)?入口(?:问题|需要|需求))';
const deferredStatus = '(?:暂缓|推迟|暂不|不做|不接|不处理|留待|待评估|暂未|未解决|没解决|没有解决|不解决|尚未解决)';
const deferredNeed = new RegExp(`${deferredStatus}[^。；;，,\\n]{0,16}${newNeed}|${newNeed}[^。；;，,\\n]{0,16}${deferredStatus}`);
const deniedDeferral = /(?:不要|别|不准|不许|不能|并非|不是|并不|没有|不想|不打算|不准备|无意|没打算|不会|不)[^。；;，,\n]{0,18}(?:暂缓|推迟|不处理|留待|待评估|未解决|没解决|没有解决|不解决|尚未解决)/;

function acknowledgementIssue(items: string[], text: string, proposal: boolean): string | undefined {
  if (!items.length) return;
  const context = proposal ? withoutPoliteRequest(text) : text;
  const asksForInformation = proposal ? /如何|怎么|怎样|为什么|意味着什么|什么意思|有什么|要不要|是否需要|想(?:了解|知道)|请解释/.test(context) : /吗|么|如何|怎么|是否|什么|能否|可否|能不能|要不要|可不可以|[?？]/.test(context);
  if (hasConditionalContext(text) || hasDeniedConsent(context) || asksForInformation) return '这段范围确认仍包含否定、条件或询问。请直接说明本次确定接受的取舍；本轮尚未改变约定。';
  // These checks ground a model-proposed acknowledgement in the full utterance.
  // New synonyms keep their corresponding negation checks; an isolated pronoun
  // or an unqualified "unresolved problem" does not identify the new need.
  const limits = [...text.matchAll(capabilityLimit)];
  const hasNarrowRoute = /(?:只|仅|三个|3个)[^。；;\n]{0,20}(?:入口|导航|引导)|静态(?:入口|导航|引导)/.test(text);
  const deniesNarrowRoute = /(?:不只|不仅|不止|不限于|并非只|不是只)[^。；;，,\n]{0,16}(?:入口|导航|引导)/.test(text);
  const changesRouteCount = [...text.matchAll(/([零〇一二两三四五六七八九十百千\d]+)\s*个(?:导航|引导)?入口/g)].some(match => match[1] !== '3' && match[1] !== '三');
  const limited = hasNarrowRoute && !deniesNarrowRoute && !changesRouteCount && limits.length > 0 && !deniedCapabilityLimit.test(text) && !claimedFreeInteraction.test(text.replace(capabilityLimit, ''));
  if (items.some(item => item === 'replace_visual' ? !visualReduction.test(text) || deniedRangeAction.test(context) : item === 'limited_scope' ? !limited : item === 'defer_new' ? !deferredNeed.test(text) || deniedDeferral.test(context) : true)) return '尚不能从完整原话确认这项具体取舍。请明确本次减少的范围、有限引导边界或未解决的新需要。';
}

// These are the three fixed short-practice actions, not a general plan parser.
// A model may recognize a synonym, but may not complete the lesson for the user.
const transferActionEnd = '(?=$|[。；;，,、\\n]|(?:再|然后|随后|接着|并|后|之后|以后))';
const transferStepEvidence: Record<string, RegExp> = {
  publish: new RegExp(`(?:发布(?:可用)?(?:的)?(?:页面|预览|网页)?|(?:发出|上线)(?:可用)?(?:的)?(?:页面|预览|网页)|(?:页面|预览|网页)(?:发出(?:去)?|上线))${transferActionEnd}`),
  verify: new RegExp(`(?:核对|核验|检查|验证|验收)(?:一下|一遍|一次)?(?:(?:(?:模拟|测试)?提交|表单提交|报名提交)(?:的)?(?:记录|结果|数据)|(?:记录|结果|数据))?${transferActionEnd}`),
  references: new RegExp(`(?:(?:收集|搜集|寻找|查找|搜索|搜|找|补充|整理|浏览|查看)[^。；;，,、\\n]{0,16}(?:参考|视觉素材|设计案例|版式案例)|(?:参考|视觉素材|设计案例|版式案例)[^。；;，,、\\n]{0,10}(?:收集|搜集|补充|整理))${transferActionEnd}`),
};

function transferPlanIssue(steps: string[], text: string): string | undefined {
  if (hasConditionalContext(text) || /[?？]|吗|是否|能否|可否|要不要|可不可以|能不能|如何|怎么|怎样|为什么|想(?:了解|知道)|请解释/.test(text)) return '这份短练习计划仍包含条件或询问。请说明本次确定要做的步骤；本轮尚未记录计划。';
  if (/(?:材料|题目|说明|老师|队友|他|她|你)(?:里|中)?(?:说|写|建议|要求|提到)|(?:我)?(?:听说|知道要)|(?:引用|转述|举例)|例如|比如/.test(text)) return '这段话仍可能是在引用要求或举例。请用自己的话说明本次确定要做的步骤；本轮尚未记录计划。';
  const clauses = text.split(/[。；;，,、\n]/).map(clause => clause.trim()).filter(Boolean);
  for (const step of steps) {
    const matches = clauses.filter(clause => transferStepEvidence[step]?.test(clause));
    // Denying an already-completed action does not deny the separate future
    // plan ("我只是想发布，没有说已经发布完成"). It is not positive evidence either.
    const planning = matches.filter(clause => !/(?:没有|没|未)(?:说|表示|声称)(?:已经|已)/.test(clause));
    if (!planning.length || planning.some(clause => /不|没|未|别|拒绝/.test(clause))) return '尚不能从完整原话确认计划中的每个步骤。请说明本次是否安排发布、核对或收集参考；本轮没有补充或删改你的计划。';
  }
}

// A narrow grounding check for this fixed scene, not a general time parser or
// language interpreter. Unknown formulations ask for clarification rather than
// inventing a deadline. Other task times elsewhere in the message are allowed.
function requestedDeadlineIsSixteen(text: string, quote: string) {
  const target = /(?:调整|顺延|延后|推迟|更改|修改|挪|改|延)[^。；;，,!?？\n]{0,16}?(?:到|至|为|成)\s*((?:(?:下午|晚上|上午)\s*)?(?:\d{1,2}|[一二三四五六七八九十]{1,3})(?:\s*[:：]\s*\d{2}(?:[:：]\d{2})?|\s*(?:点|时)(?:半|整|(?:\d{1,2}|[零〇一二三四五六七八九十两]{1,3})(?:分钟?|刻)?)?)(?:左右|前后)?)/g;
  const targets = [...text.matchAll(target)].map(match => match[1]);
  const isSixteen = (time: string) => /^(?:(?:16|十六)(?:[:：]00|点(?:整)?|时(?:整)?)|下午(?:4|四)(?:[:：]00|点(?:整)?|时(?:整)?))$/.test(time.replace(/\s/g, ''));
  return targets.length > 0 && targets.every(isSixteen) && text.includes(quote) && (quote.trim() === text.trim() || targets.some(time => quote.trim().replace(/(?:之前|以前|前)$/, '') === time.trim()));
}

export function validateInterpretation(value: ModelInterpretation, text: string): ModelInterpretation {
  if (!value || !Array.isArray(value.commands) || value.commands.length > 4 || !Array.isArray(value.evidence)) throw new AppError('AI_INVALID_OUTPUT', '语言解释未通过校验，本轮没有改变约定。请换一种表述重试。', 502);
  if (value.evidence.some(item => !item || typeof item.quote !== 'string' || !Number.isInteger(item.commandIndex))) throw new AppError('AI_EVIDENCE_MISMATCH', '语言解释的原话证据格式无效，本轮没有改变约定。', 502);
  const commands: Command[] = value.commands.map(command => {
    const parsed = commandSchema.safeParse(command);
    if (!parsed.success) throw new AppError('AI_INVALID_OUTPUT', '语言解释包含无法执行的动作，本轮没有改变约定。', 502);
    if (parsed.data.type === 'reply_options_seen') throw new AppError('AI_INVALID_OUTPUT', '查看选项只能由页面上的明确操作记录，语言解释不能代替你的选择。', 502);
    return parsed.data as Command;
  });
  for (let index = 0; index < commands.length; index++) {
    const evidence = value.evidence.filter(item => item.commandIndex === index);
    if (evidence.length !== 1 || !evidence[0].quote.trim() || !text.includes(evidence[0].quote)) throw new AppError('AI_EVIDENCE_MISMATCH', '语言解释无法对应你的原话，本轮没有改变约定。请重新表述。', 502);
  }
  if (value.evidence.some(item => !Number.isInteger(item.commandIndex) || item.commandIndex < 0 || item.commandIndex >= commands.length)) throw new AppError('AI_EVIDENCE_MISMATCH', '语言解释的原话索引无效，本轮没有改变约定。', 502);
  const candidates = value.workplaceCandidates === undefined ? [] : z.array(workplaceCandidateSchema).max(4).safeParse(value.workplaceCandidates);
  if (!Array.isArray(candidates) && !candidates.success) throw new AppError('AI_INVALID_OUTPUT', '职场候选条件格式无效，本轮没有改变约定。', 502);
  const workplaceCandidates = Array.isArray(candidates) ? candidates : candidates.data;
  const clarify = (clarification: string): ModelInterpretation => ({ commands: [], evidence: [], clarification, ...(workplaceCandidates.length ? { workplaceCandidates } : {}) });
  for (let index = 0; index < commands.length; index++) {
    const command = commands[index];
    if (!['ask', 'inspect', 'hint', 'clarify'].includes(command.type) && value.evidence.find(item => item.commandIndex === index)!.quote.trim() !== text.trim()) return clarify('动作证据没有包含本轮完整原话，可能遗漏否定或条件。请完整确认要执行的安排；本轮尚未改变约定。');
    if (command.type === 'finish' && !explicitlyEndsPractice(text)) return clarify('你是在说项目做到这里就可以，还是想结束这段练习、回看记录？练习仍然保留，你可以接着说。');
    const acknowledgements = command.type === 'acknowledge' ? command.items : command.type === 'propose' ? command.acknowledgements ?? [] : [];
    const issue = acknowledgementIssue(acknowledgements, text, command.type === 'propose');
    if (issue) return clarify(issue);
    if (command.type === 'transfer_plan') {
      const issue = transferPlanIssue(command.steps, text);
      if (issue) return clarify(issue);
    }
    if (command.type === 'workplace_propose') {
      const matches = workplaceCandidates.filter(item => item.commandIndex === index);
      if (matches.length !== 1) return clarify('职场安排缺少可核验的截止与条件记录。请明确是否请求把旧表截止调整到 16:00。');
      const candidate = matches[0];
      if (candidate.conditions.length || hasConditionalContext(text)) {
        const originalConditions = text.split(/[。；;，,\n]/).filter(hasConditionalContext).join('；');
        return clarify(originalConditions
          ? `这份安排还有附加前提：“${originalConditions.slice(0, 240)}”。这项目前没有确认。你是要保留这个前提，还是现在直接提出两项任务的安排与截止调整？原约定保持有效。`
          : '这轮解释把安排中的一部分读成了附加前提，但尚不能从原话核实。请直接说明现在要提出的任务顺序和截止调整；本轮保留原约定。');
      }
      if (command.requestReschedule) {
        const requestContext = withoutPoliteRequest(text); // Polite requests are still requests; retain any separate negation.
        if (hasDeniedConsent(requestContext) || /(?:不要|不必|别|不能|不想|不打算|不是要|不再|不)[^。；;\n]{0,12}(?:请求|申请|调整|顺延|更改|延后|延|改|挪)/.test(requestContext) || candidate.requestedDeadlineMinutes !== 960 || !candidate.requestedDeadlineQuote || !requestedDeadlineIsSixteen(text, candidate.requestedDeadlineQuote)) return clarify('当前职场模拟只支持明确请求把旧表截止调整到 16:00。你的候选截止或请求含义尚不匹配，请确认具体时间；本轮没有提交新承诺。');
      } else if (candidate.requestedDeadlineMinutes !== null || candidate.requestedDeadlineQuote !== null) return clarify('解释中同时出现了“不调整截止”和新的候选截止。请明确本次是否请求顺延。');
    }
  }
  return { commands, evidence: value.evidence, ...(value.clarification ? { clarification: value.clarification.slice(0, 500) } : {}), ...(workplaceCandidates.length ? { workplaceCandidates } : {}) };
}

/**
 * Call only after validateInterpretation. Recover an explicit scope statement
 * omitted from a single static-guide proposal; never infer it from G alone.
 * The command remains a proposal for the unchanged domain rules to evaluate.
 */
export function groundExplicitLimitedScope(value: ModelInterpretation, text: string): ModelInterpretation {
  if (value.clarification || value.commands.length !== 1) return value;
  const command = value.commands[0];
  if (command.type !== 'propose' || command.conditions?.length || !command.taskIds.includes('G') || command.taskIds.some(id => id === 'Q1' || id === 'Q2' || id === 'Q3') || command.acknowledgements?.includes('limited_scope')) return value;
  // Do not repair incomplete evidence, additional intents, undecided language,
  // or a report of another person's words. The original model result is kept.
  if (value.evidence.length !== 1 || value.evidence[0].commandIndex !== 0 || value.evidence[0].quote.trim() !== text.trim()) return value;
  if (/(?:还没|还没有|尚未|没有|未)(?:决定|提议|提出|确认)|只是在?(?:引用|转述)|(?:林澄|许念|周衡|他|她)(?:曾经|刚才)?说/.test(text)) return value;
  if (acknowledgementIssue(['limited_scope'], text, false)) return value;
  return { ...value, commands: [{ ...command, acknowledgements: [...(command.acknowledgements ?? []), 'limited_scope'] }] };
}
