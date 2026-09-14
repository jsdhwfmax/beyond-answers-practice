import { ACTORS, ORIGINAL_TASKS, SCENARIOS, SCENARIO_VERSION, SOURCE_VERSION, TASKS, TRANSFER_STEPS } from './scenarios';
import type { ActorId, Change, Command, EventDraft, GameState, Proposal, ScenarioId, Slot, TaskId, Transition } from './types';
import { neededAcknowledgements } from './acknowledgements';

const TASK_ORDER = Object.keys(TASKS) as TaskId[];
const BASE: TaskId[] = ['B1', 'B2', 'B3', 'B4'];
const MEMBERS: ActorId[] = ['lin', 'xu', 'zhou'];
const ACKS = new Set(['limited_scope', 'replace_visual', 'defer_new']);
const ACK_LABELS: Record<string, string> = {
  limited_scope: '静态引导只导航到三个入口，不支持自由问答',
  replace_visual: '按本次提议减少原视觉精修范围，保留基础可读性',
  defer_new: '本次暂缓新增需要，后续只评估而不承诺实现',
};
const own = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);
const unique = <T>(values: T[]) => [...new Set(values)];
const time = (minute: number) => `${Math.floor(minute / 60).toString().padStart(2, '0')}:${(minute % 60).toString().padStart(2, '0')}`;
const overlaps = (a: Slot, b: Slot) => a.actor === b.actor && a.start < b.end && b.start < a.end;
const event = (actor: ActorId, kind: string, text: string, changes: Change[] = []): EventDraft => ({ actor, kind, text, changes });
const change = (field: string, before: string, after: string, reason: string): Change => ({ field, before, after, reason });
const titles = (ids: TaskId[]) => ids.map(id => TASKS[id].title);

/** Schedules fixed-duration tasks, reserving explicitly chosen starts before filling gaps. */
export function scheduleTasks(taskIds: TaskId[], assignments: Extract<Command, { type: 'propose' }>['assignments'] = []): { schedule: Slot[]; issues: string[] } {
  const issues: string[] = [];
  if (taskIds.some(id => !own(TASKS, id))) return { schedule: [], issues: ['存在未定义任务，不能凭空增加资源或工作。'] };
  if (new Set(taskIds).size !== taskIds.length) issues.push('同一任务不能重复安排。');
  const selected = TASK_ORDER.filter(id => taskIds.includes(id));
  for (const id of selected) for (const dependency of TASKS[id].dependencies) {
    if (!selected.includes(dependency)) issues.push(`${id} 必须先完成 ${dependency}。`);
  }
  for (const actor of MEMBERS) {
    const needed = selected.filter(id => TASKS[id].actor === actor).reduce((sum, id) => sum + TASKS[id].minutes, 0);
    const capacity = ACTORS[actor].windows.reduce((sum, window) => sum + window.end - window.start, 0);
    if (needed > capacity) issues.push(`${ACTORS[actor].name}需要 ${needed} 分钟，但只有 ${capacity} 分钟；不能增加外援或额外时间。`);
  }
  const fixed = new Map<TaskId, Slot>();
  const assigned = new Set<TaskId>();
  for (const assignment of assignments) {
    if (!selected.includes(assignment.taskId)) { issues.push('不能给方案之外的任务分配负责人。'); continue; }
    if (assigned.has(assignment.taskId)) issues.push(`${assignment.taskId} 重复分配。`);
    assigned.add(assignment.taskId);
    const task = TASKS[assignment.taskId];
    if (assignment.actor !== task.actor) { issues.push(`${task.title}只能由具备对应能力的${ACTORS[task.actor].name}承担。`); continue; }
    if (assignment.start !== undefined) {
      if (!Number.isInteger(assignment.start)) { issues.push(`${task.id} 的开始时间必须是有效的分钟数。`); continue; }
      const slot: Slot = { taskId: task.id, actor: task.actor, start: assignment.start, end: assignment.start + task.minutes };
      if (!ACTORS[task.actor].windows.some(window => slot.start >= window.start && slot.end <= window.end)) issues.push(`${task.id} 超出${ACTORS[task.actor].name}的可用时间，不能占用已有安排。`);
      fixed.set(task.id, slot);
    }
  }
  const reserved = [...fixed.values()];
  for (let i = 0; i < reserved.length; i++) for (let j = i + 1; j < reserved.length; j++) {
    if (overlaps(reserved[i], reserved[j])) issues.push('同一成员的明确排期发生重叠。');
  }
  if (issues.length) return { schedule: [], issues: unique(issues) };
  const scheduled = new Map<TaskId, Slot>();
  for (const id of selected) {
    const task = TASKS[id];
    const earliest = Math.max(1080, ...task.dependencies.map(dependency => scheduled.get(dependency)!.end));
    let slot = fixed.get(id);
    if (slot && slot.start < earliest) return { schedule: [], issues: [`${id} 开始前，其依赖尚未完成。`] };
    if (!slot) {
      const occupied = [...reserved.filter(item => item.taskId !== id), ...scheduled.values()].filter(item => item.actor === task.actor).sort((a, b) => a.start - b.start);
      for (const window of ACTORS[task.actor].windows) {
        let start = Math.max(window.start, earliest);
        for (const block of occupied) if (start < block.end && start + task.minutes > block.start) start = block.end;
        if (start + task.minutes <= window.end) { slot = { taskId: id, actor: task.actor, start, end: start + task.minutes }; break; }
      }
    }
    if (!slot) return { schedule: [], issues: [`${task.title}在依赖完成后没有可用时段；总人时足够也不等于能排期。`] };
    scheduled.set(id, slot);
  }
  return { schedule: [...scheduled.values()].sort((a, b) => a.start - b.start || a.taskId.localeCompare(b.taskId)), issues: [] };
}

export function initialState(scenario: ScenarioId): GameState {
  const campus = scenario === 'campus';
  const state: GameState = {
    scenario, scenarioVersion: SCENARIO_VERSION, sourceVersion: SOURCE_VERSION, phase: 'briefing',
    revealed: campus ? ['brief', 'members', 'prototype'] : [scenario === 'transfer' ? 'transfer-brief' : 'workplace-brief'],
    taskIds: campus ? [...ORIGINAL_TASKS] : [], schedule: campus ? scheduleTasks(ORIGINAL_TASKS).schedule : [], proposal: null,
    agreement: { status: 'original', scope: campus ? titles(ORIGINAL_TASKS) : scenario === 'workplace' ? ['竞品表原定 15:00 截止'] : [], tradeoffs: [], unknowns: campus ? ['新增需要尚未形成约定；今晚没有已确认外援。'] : scenario === 'workplace' ? ['新增摘要与旧截止尚待协调。'] : ['模拟发布与验收尚未执行。'] },
    transfer: { firstPlan: null, firstAssisted: false, plan: [], completed: [], elapsed: 0, hintUsed: false, published: false, verified: false },
    workplace: { order: ['table'], rescheduleRequested: false, managerAccepted: false, tableDeadline: 900, schedule: [{ taskId: 'table', actor: 'user', start: 780, end: 840 }], issues: [] },
  };
  if (scenario === 'workplace') state.schedule = structuredClone(state.workplace.schedule);
  return state;
}

function evaluateProposal(state: GameState, proposal: Proposal, events: EventDraft[]) {
  const ids = proposal.taskIds;
  const outcomeConditions = proposal.conditions.filter(condition => !/^task_accepted:(B[1-4]|V[1-3]|G|Q[1-3])$/.test(condition));
  if (outcomeConditions.length) {
    proposal.status = 'pending'; proposal.acceptedBy = [];
    proposal.issues = outcomeConditions.map(condition => `条件尚未成立：${condition}`);
    state.proposal = proposal;
    const completionPoint = outcomeConditions.flatMap(condition => [...condition.matchAll(/([01]?\d|2[0-3])\s*[:：]\s*([0-5]\d)\s*前[^。；;\n]{0,12}(?:完成|做完|核对|验收)/g)]).map(match => Number(match[1]) * 60 + Number(match[2]));
    const plannedEnd = Math.max(1080, ...proposal.schedule.map(slot => slot.end));
    const tooEarly = completionPoint.find(point => point < plannedEnd);
    const next = tooEarly === undefined ? '你可以继续说清要核对什么、条件不成立时采用什么范围。' : `按这份安排，任务排到了 ${time(plannedEnd)}，不能同时声称在 ${time(tooEarly)} 前全部完成核对。你想调整检查点，还是减少这次范围？`;
    events.push(event('system', 'proposal_pending', `你提出了有前提的安排：“${outcomeConditions.join('；')}”。先保留这个检查点和原有约定；现在是在协商排期，还没有执行或验收。${next}`));
    return;
  }
  const priorAccepted = new Set(proposal.acceptedBy);
  proposal.acceptedBy = [];
  const missing: string[] = [];
  const missingAcknowledgements = neededAcknowledgements({ ...state, proposal });
  for (const actor of MEMBERS) {
    let reason = '';
    if (actor === 'lin' && missingAcknowledgements.includes('limited_scope')) reason = '我想核对一下：这次只把新生带到三个入口，还不能自由提问，对吗？说清这个边界，我就能按它检查内容。';
    if (actor === 'lin' && missingAcknowledgements.includes('defer_new')) reason = '按这个安排，新生不知道从哪进入的问题今晚还没处理。你的意思是这次先保住原交付，新增需要之后再评估，对吗？';
    if (actor === 'xu' && missingAcknowledgements.includes('replace_visual')) reason = '这会改变我们原来答应的精修。我可以调整，只要基础界面仍然清楚可读；你希望这次具体拿掉哪些精修？';
    if (reason) {
      missing.push(reason);
      events.push(event(actor, 'acceptance_pending', reason));
    } else {
      proposal.acceptedBy.push(actor);
      if (!priorAccepted.has(actor)) events.push(event(actor, 'actor_acceptance', actor === 'lin' ? '内容这边可以，我接受由我负责的安排。' : actor === 'xu' ? `界面这边可以${!ids.includes('V3') ? '，基础可读性保留，精修按这次说好的范围调整' : '，按这份范围做精修'}。` : '我核对了可用时间和先后依赖，开发与验收这边接受这个排期。'));
    }
  }
  for (const condition of proposal.conditions) {
    const match = /^task_accepted:(B[1-4]|V[1-3]|G|Q[1-3])$/.exec(condition);
    const id = match?.[1] as TaskId | undefined;
    if (!id || !ids.includes(id) || !proposal.acceptedBy.includes(TASKS[id].actor)) missing.push(`条件尚未成立：${condition}`);
  }
  proposal.issues = unique(missing);
  if (missing.length) { proposal.status = 'pending'; state.proposal = proposal; events.push(event('system', 'proposal_pending', '提议已保留，原有约定仍然有效；未确认条件不会自动变成资源。')); return; }
  const previous = state.taskIds.join(',');
  proposal.status = 'accepted';
  state.proposal = proposal;
  state.taskIds = [...ids];
  state.schedule = structuredClone(proposal.schedule);
  const tradeoffs: string[] = [];
  if (ids.includes('G')) tradeoffs.push('静态引导只导航到三个入口，不支持自由问答。');
  if (!ids.includes('V3')) tradeoffs.push('本次未交付完整视觉精修，基础可读性仍保留。');
  if (ids.includes('Q3')) tradeoffs.push('问答仅覆盖已有 12 条指南；范围外提示不知道。');
  const deferred = !ids.includes('G') && !ids.includes('Q3');
  if (deferred) tradeoffs.push('新增需要本次暂缓，后续只评估，不承诺功能已经安排。');
  if (!ids.includes('Q3') && ids.some(id => id === 'Q1' || id === 'Q2')) tradeoffs.push('已列出的问答准备不等于问答已可交付。');
  const total = state.schedule.reduce((sum, slot) => sum + slot.end - slot.start, 0);
  if (total === 480) tradeoffs.push('今晚生产容量已用满，没有额外缓冲。');
  else tradeoffs.push(`保留 ${480 - total} 分钟未分配容量；它不是已承诺的新工作。`);
  state.agreement = { status: 'confirmed', scope: titles(ids), tradeoffs, unknowns: deferred ? ['后续新功能的工作量、负责人和期限仍待评估。'] : [] };
  state.phase = 'resolved';
  events.push(event('system', 'agreement_confirmed', '相关成员已明确接受，新的交付约定生效。这是排期成立，工作尚未执行。你可以接着核对验收和代价，或选择何时回看这段练习。', [change('taskIds', previous, ids.join(','), '成员接受且能力、个人时间和任务依赖核验通过。')]));
}

export function transition(input: GameState, command: Command): Transition {
  const state = structuredClone(input);
  const events: EventDraft[] = [];
  const result = () => ({ state, events });
  if (command.type === 'clarify') { events.push(event('system', 'clarification', command.question)); return result(); }
  if (command.type === 'inspect') {
    const material = SCENARIOS[state.scenario].materials.find(item => item.id === command.materialId);
    if (!material) events.push(event('system', 'unavailable', '当前情境没有这份已确认材料。'));
    else { state.revealed = unique([...state.revealed, material.id]); events.push(event('system', 'disclosure', material.text)); }
    return result();
  }
  if (command.type === 'ask') {
    const campusTopics: Record<string, { actor: ActorId; material: string; text?: string }> = {
      goal: { actor: 'lin', material: 'feedback' }, capacity: { actor: 'system', material: 'members' },
      qa: { actor: 'zhou', material: 'qa-component' }, visual: { actor: 'xu', material: 'brief', text: '我可以协商减少精修，但基础可读界面必须保留；请明确变更的范围，再由我接受。' },
      acceptance: { actor: 'zhou', material: 'qa-component' },
    };
    const knownTopics = state.scenario === 'workplace' ? ['goal', 'capacity', 'acceptance', 'authority', 'deadline'] : ['goal', 'capacity', 'acceptance'];
    const target = state.scenario === 'campus' ? campusTopics[command.topic] : knownTopics.includes(command.topic) ? {
      actor: state.scenario === 'workplace' ? 'manager' as const : 'system' as const,
      material: state.scenario === 'workplace' ? 'workplace-brief' : 'transfer-brief',
    } : undefined;
    if (!target) events.push(event(command.actor ?? 'system', 'clarification', '请指出要确认的具体条件；没有确认的事实会继续留白。'));
    else if (command.actor && command.actor !== 'system' && target.actor !== 'system' && command.actor !== target.actor) events.push(event(command.actor, 'referral', `这部分应由${ACTORS[target.actor].name}确认，或查看对应材料；我不替对方补充事实。`));
    else {
      state.revealed = unique([...state.revealed, target.material]);
      const workplaceReplies: Record<string, string> = {
        deadline: `摘要要在 15:00 前交；竞品表目前约定 ${time(state.workplace.tableDeadline)} 交。摘要的时间不能延后，竞品表我可以同意调整到最迟 16:00。你想怎么排？`,
        authority: `竞品表的截止由我确认，最迟可以调到 16:00；摘要 15:00 要用，这个不能动。目前竞品表的约定还是 ${time(state.workplace.tableDeadline)}。`,
        capacity: '你今天能工作的时段是 13:00–16:00。摘要需要 1.5 小时，竞品表还要 1 小时，两件事不能同时做。先做哪件，我们可以一起商量。',
        acceptance: '摘要把目标、现状和待决策的事写清楚就可以，材料已经齐了。竞品表按原来定好的范围交；题目没有给出更多具体字段，我们先不额外加要求。',
        goal: '15:00 的演示要用到摘要，竞品表也还有原来的承诺。你把先后安排和对旧截止的影响说清楚，我来确认能不能调整。',
      };
      events.push(event(target.actor, 'disclosure', (state.scenario === 'workplace' ? workplaceReplies[command.topic] : undefined) ?? ('text' in target ? target.text : undefined) ?? SCENARIOS[state.scenario].materials.find(item => item.id === target.material)!.text));
    }
    return result();
  }
  if (state.phase === 'ended') { events.push(event('system', 'closed', '本次记录已结束；如需改变做法，请从关键节点另开重试。')); return result(); }
  if (command.type === 'reply_options_seen') {
    if (state.scenario === 'transfer') {
      state.transfer.hintUsed = true;
      events.push(event('system', 'reply_options_assistance', '已选择查看回答选项。本次会记录选项辅助；选项可以改写，不代表唯一正确做法，也没有执行任何模拟任务。'));
    } else events.push(event('system', 'unchanged', '回答选项仅供改写，没有改变当前约定。'));
    return result();
  }
  if (command.type === 'hint') {
    if (state.scenario === 'transfer') {
      state.transfer.hintUsed = true;
      events.push(event('system', 'hint', '目标和验收已明确。找到能先产出可用预览的行动，再检查模拟提交是否成立；额外参考不能代替验证。'));
    } else events.push(event('system', 'hint', '先看当前缺什么：是目的、验收、时间，还是某个人尚未接受的承诺。经验是线索，不是必须照说的台词。'));
    return result();
  }
  if (command.type === 'finish') {
    if (state.scenario === 'campus' && (state.agreement.status !== 'confirmed' || (state.proposal !== null && state.proposal.status !== 'accepted'))) {
      if (state.agreement.status !== 'confirmed') state.agreement.status = 'incomplete';
      state.agreement.unknowns = unique([...state.agreement.unknowns, ...(state.proposal?.issues ?? ['新增需要或交付取舍尚未确认。'])]);
    }
    if (state.scenario === 'transfer') {
      state.agreement.status = state.transfer.verified ? 'confirmed' : 'incomplete';
      state.agreement.unknowns = state.transfer.verified ? [] : ['尚未完成发布后的模拟提交核对；写出计划不等于完成。'];
    }
    if (state.scenario === 'workplace' && (!state.workplace.managerAccepted || state.workplace.issues.length)) {
      if (!state.workplace.managerAccepted) state.agreement.status = 'incomplete';
      state.agreement.unknowns = unique([...state.agreement.unknowns, ...state.workplace.issues, '尚有调整未获负责人接受；既有生效安排没有自动撤销。']);
    }
    state.phase = 'ended';
    events.push(event('system', 'finished', state.agreement.status === 'confirmed' ? '本次结果已保存。模拟中的确认与真实执行分别记录。' : '已保存当前进度与未定事项，未将它标记为完整交付。'));
    return result();
  }
  if (command.type === 'withdraw') {
    if (state.proposal && state.proposal.status !== 'accepted') {
      state.proposal = null;
      events.push(event('system', 'proposal_withdrawn', '未生效提议已撤回，原有约定、负责人和时间保持有效。'));
    } else events.push(event('system', 'unchanged', '没有未生效的校园提议可撤回；已确认约定需要通过新的可行安排协商替换。'));
    return result();
  }
  if (command.type === 'propose') {
    if (state.scenario !== 'campus') { events.push(event('system', 'unavailable', '当前情境不接受校园任务排期。')); return result(); }
    const scheduled = scheduleTasks(command.taskIds, command.assignments);
    const issues = [...scheduled.issues];
    if (BASE.some(id => !command.taskIds.includes(id))) issues.push('基础可用性和集成验收 B1–B4 必须保留。');
    if (command.taskIds.includes('G') && command.taskIds.includes('Q3')) issues.push('静态引导 G 与完整问答交付 Q3 是互斥方案，不能同时计作本次交付。');
    const proposal: Proposal = {
      taskIds: TASK_ORDER.filter(id => command.taskIds.includes(id)), conditions: unique((command.conditions ?? []).map(item => item.trim()).filter(Boolean)),
      acknowledgements: unique((command.acknowledgements ?? []).filter(item => ACKS.has(item))),
      status: issues.length ? 'rejected' : 'pending', issues: unique(issues), schedule: scheduled.schedule, acceptedBy: [],
    };
    state.proposal = proposal;
    state.phase = 'negotiating';
    events.push(event('user', 'proposal', `提出任务安排：${titles(proposal.taskIds).join('、') || '空方案'}${proposal.conditions.length ? `；附条件：${proposal.conditions.join('；')}` : ''}。`));
    if (issues.length) events.push(event('system', 'proposal_rejected', `${unique(issues).join(' ')} 原有生效约定没有改变。`));
    else evaluateProposal(state, proposal, events);
    return result();
  }
  if (command.type === 'acknowledge') {
    if (state.scenario !== 'campus' || !state.proposal || state.proposal.status !== 'pending') { events.push(event('system', 'unchanged', '当前没有可以补充确认的待定提议。')); return result(); }
    state.proposal.acknowledgements = unique([...state.proposal.acknowledgements, ...command.items.filter(item => ACKS.has(item))]);
    events.push(event('user', 'acknowledgement', `补充范围确认：${command.items.filter(item => ACKS.has(item)).map(item => ACK_LABELS[item]).join('；') || '没有新增已定义范围确认'}。`));
    evaluateProposal(state, state.proposal, events);
    return result();
  }
  if (command.type === 'transfer_plan') {
    if (state.scenario !== 'transfer') { events.push(event('system', 'unavailable', '当前情境不是独立短练习。')); return result(); }
    if (state.transfer.firstPlan === null) {
      state.transfer.firstPlan = [...command.steps];
      state.transfer.firstAssisted = state.transfer.hintUsed;
    }
    state.transfer.plan = [...command.steps];
    state.phase = 'negotiating';
    const valid = command.steps.every(step => own(TRANSFER_STEPS, step));
    events.push(event('user', 'transfer_plan', `计划顺序：${command.steps.map(step => TRANSFER_STEPS[step]?.title ?? step).join(' → ') || '尚未列出行动'}。`));
    if (!valid || new Set(command.steps).size !== command.steps.length || !command.steps.length) events.push(event('system', 'plan_issue', '计划包含未知、重复步骤或尚未包含行动；尚未执行任何模拟任务。'));
    else {
      const minutes = command.steps.reduce((sum, step) => sum + TRANSFER_STEPS[step].minutes, 0);
      events.push(event('system', 'plan_recorded', minutes > 30 ? `这些步骤需 ${minutes} 分钟，超过 30 分钟。可以调整顺序与范围；计划尚未执行。` : '计划已记录。请执行模拟操作，并实际查看核对结果。'));
    }
    return result();
  }
  if (command.type === 'transfer_execute') {
    if (state.scenario !== 'transfer') { events.push(event('system', 'unavailable', '当前情境不是独立短练习。')); return result(); }
    const transfer = state.transfer;
    if (!own(TRANSFER_STEPS, command.step) || !transfer.plan.includes(command.step)) { events.push(event('system', 'execution_blocked', '请先把一个已定义行动列入自己的计划。')); return result(); }
    if (transfer.completed.includes(command.step)) { events.push(event('system', 'unchanged', '这项模拟行动已经完成，不重复耗时。')); return result(); }
    const step = TRANSFER_STEPS[command.step];
    if (step.dependencies.some(dependency => !transfer.completed.includes(dependency))) { events.push(event('system', 'execution_blocked', '还没有可用预览，不能先核对提交记录。')); return result(); }
    if (transfer.elapsed + step.minutes > 30) { events.push(event('system', 'execution_blocked', '剩余模拟时间不足。已有记录保留，可结束或另开重试，不自动延长时间。')); return result(); }
    const before = transfer.elapsed;
    transfer.completed.push(command.step);
    transfer.elapsed += step.minutes;
    if (command.step === 'publish') transfer.published = true;
    if (command.step === 'verify') transfer.verified = true;
    state.agreement.scope = transfer.completed.map(id => TRANSFER_STEPS[id].title);
    state.agreement.status = transfer.verified ? 'confirmed' : 'pending';
    state.agreement.unknowns = transfer.verified ? [] : ['模拟提交记录尚未核对。'];
    if (transfer.verified) state.phase = 'resolved';
    events.push(event('system', 'simulation_completed', command.step === 'verify' ? '模拟提交记录已核对：一条预设测试记录可见。这是模拟验收，没有创建真实报名。' : `${step.title}已在模拟中完成。`, [change('transfer.elapsed', String(before), String(transfer.elapsed), `${step.title}耗时 ${step.minutes} 分钟。`)]));
    return result();
  }
  if (command.type === 'workplace_propose') {
    if (state.scenario !== 'workplace') { events.push(event('system', 'unavailable', '当前情境不是职场预告。')); return result(); }
    const issues: string[] = [];
    if (command.order.length !== 2 || new Set(command.order).size !== 2 || !command.order.includes('summary') || !command.order.includes('table')) issues.push('必须处理摘要和原竞品表，不能遗漏或重复任务。');
    let cursor = 780;
    const schedule: Slot[] = command.order.filter(id => id === 'summary' || id === 'table').map(id => {
      const start = cursor; cursor += id === 'summary' ? 90 : 60;
      return { taskId: id, actor: 'user', start, end: cursor };
    });
    const summary = schedule.find(slot => slot.taskId === 'summary');
    const table = schedule.find(slot => slot.taskId === 'table');
    const deadline = command.requestReschedule ? 960 : 900;
    if (summary && summary.end > 900) issues.push('摘要必须在 15:00 前完成，这个截止不能顺延。');
    if (table && table.end > deadline) issues.push('竞品表会超过原承诺 15:00，需明确请求调整旧截止。');
    if (cursor > 960 || deadline > 960) issues.push('不能超过 16:00 或凭空增加外援。');
    events.push(event('user', 'workplace_proposal', `提出顺序：${command.order.map(id => id === 'summary' ? '演示摘要' : '竞品表').join(' → ')}；${command.requestReschedule ? '请求将旧竞品表截止调整到 16:00' : '尚未请求调整旧截止'}。`));
    if (issues.length) {
      state.workplace.issues = unique(issues);
      if (!state.workplace.managerAccepted) {
        state.workplace.order = [...command.order]; state.workplace.rescheduleRequested = command.requestReschedule;
        state.workplace.schedule = schedule; state.phase = 'negotiating';
      }
      events.push(event('manager', 'proposal_rejected', `${unique(issues).join(' ')} 我没有接受这次调整，既有生效安排保留。`));
      return result();
    }
    const priorDeadline = state.workplace.tableDeadline;
    state.workplace = { order: [...command.order], rescheduleRequested: command.requestReschedule, managerAccepted: true, tableDeadline: deadline, schedule, issues: [] };
    state.schedule = structuredClone(schedule);
    state.agreement = { status: 'confirmed', scope: schedule.map(slot => `${slot.taskId === 'summary' ? '演示摘要' : '竞品表'} ${time(slot.start)}–${time(slot.end)}`), tradeoffs: [`竞品表旧截止由 15:00 调整为 ${time(deadline)}；摘要仍须 15:00 前完成。`], unknowns: [] };
    state.phase = 'resolved';
    events.push(event('manager', 'manager_acceptance', `我明确接受这个安排：先完成摘要，竞品表截止调整到 ${time(deadline)}。`, [change('workplace.tableDeadline', time(priorDeadline), time(deadline), '负责人有权协调两项工作，并明确接受这次调整。')]));
    return result();
  }
  events.push(event('system', 'unavailable', '未识别的结构化动作，没有改变任何约定。'));
  return result();
}
