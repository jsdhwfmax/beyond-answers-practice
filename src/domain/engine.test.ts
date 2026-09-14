import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { initialState, scheduleTasks, transition } from './engine';
import { ACTORS, ORIGINAL_TASKS, TASKS } from './scenarios';
import type { Command, GameState, TaskId } from './types';

const BASE: TaskId[] = ['B1', 'B2', 'B3', 'B4'];
const A: TaskId[] = [...ORIGINAL_TASKS, 'G'];
const B: TaskId[] = [...BASE, 'Q1', 'Q2', 'Q3'];
const ALL = Object.keys(TASKS) as TaskId[];
const ACKS = ['limited_scope', 'replace_visual', 'defer_new'];
const apply = (state: GameState, command: Command) => transition(state, command).state;
const propose = (ids: TaskId[], acknowledgements: string[] = ACKS, conditions: string[] = []): Command => ({ type: 'propose', taskIds: ids, acknowledgements, conditions });
function validCampusSchedule(state: GameState) {
  expect(state.schedule.map(slot => slot.taskId).sort()).toEqual([...state.taskIds].sort());
  for (const slot of state.schedule) {
    const task = TASKS[slot.taskId as TaskId];
    expect(slot.actor).toBe(task.actor);
    expect(slot.end - slot.start).toBe(task.minutes);
    expect(ACTORS[slot.actor].windows.some(window => slot.start >= window.start && slot.end <= window.end)).toBe(true);
    for (const id of task.dependencies) {
      const prerequisite = state.schedule.find(other => other.taskId === id);
      expect(prerequisite).toBeDefined();
      expect(prerequisite!.end).toBeLessThanOrEqual(slot.start);
    }
    for (const other of state.schedule) if (other !== slot && other.actor === slot.actor) {
      expect(slot.end <= other.start || other.end <= slot.start).toBe(true);
    }
  }
}

describe('校园任务、能力与真实排期', () => {
  it('初始七人时原约定有效，不预设玩家失败', () => {
    const state = initialState('campus');
    expect(state.agreement.status).toBe('original');
    expect(state.proposal).toBeNull();
    expect(state.schedule.reduce((sum, slot) => sum + slot.end - slot.start, 0)).toBe(420);
    validCampusSchedule(state);
  });
  it.each([['静态引导', A], ['限定问答', B]] as const)('%s可以直接首次提出并成立', (_name, ids) => {
    const result = transition(initialState('campus'), propose([...ids]));
    expect(result.state.proposal?.status).toBe('accepted');
    expect(result.state.proposal?.acceptedBy).toEqual(['lin', 'xu', 'zhou']);
    expect(result.state.schedule.reduce((sum, slot) => sum + slot.end - slot.start, 0)).toBe(480);
    expect(result.state.schedule.at(-1)?.end).toBe(1320);
    expect(result.events.filter(item => item.kind === 'actor_acceptance')).toHaveLength(3);
    validCampusSchedule(result.state);
  });
  it('两条路线对个人时段的分配可检查', () => {
    const a = apply(initialState('campus'), propose(A));
    const b = apply(initialState('campus'), propose(B));
    expect(a.schedule.find(slot => slot.taskId === 'V3')).toMatchObject({ actor: 'xu', start: 1200, end: 1260 });
    expect(a.schedule.find(slot => slot.taskId === 'G')).toMatchObject({ actor: 'zhou', start: 1260, end: 1320 });
    expect(b.schedule.find(slot => slot.taskId === 'Q2')).toMatchObject({ actor: 'xu', start: 1140, end: 1260 });
    expect(b.schedule.find(slot => slot.taskId === 'Q3')).toMatchObject({ actor: 'zhou', start: 1260, end: 1320 });
  });
  it('保留原范围与一小时缓冲，不把后续评估伪装成开发承诺', () => {
    const state = apply(initialState('campus'), propose(ORIGINAL_TASKS));
    expect(state.agreement.status).toBe('confirmed');
    expect(state.agreement.tradeoffs.join('')).toContain('60 分钟');
    expect(state.agreement.unknowns.join('')).toContain('仍待评估');
  });
  it('支持任务级部分精修替代解，不按固定A/B标签判定', () => {
    const ids: TaskId[] = [...BASE, 'V1', 'V2', 'G'];
    const state = apply(initialState('campus'), propose(ids));
    expect(state.proposal?.status).toBe('accepted');
    expect(state.taskIds).toEqual(ids);
    expect(state.agreement.tradeoffs.join('')).toContain('未交付完整视觉精修');
    validCampusSchedule(state);
  });
  it('问答准备与问答交付分开，部分准备需要明确暂缓', () => {
    let state = apply(initialState('campus'), propose([...BASE, 'Q1', 'Q2'], ['replace_visual']));
    expect(state.proposal?.status).toBe('pending');
    state = apply(state, { type: 'acknowledge', items: ['defer_new'] });
    expect(state.proposal?.status).toBe('accepted');
    expect(state.taskIds).not.toContain('Q3');
    expect(state.agreement.tradeoffs.join('')).toContain('准备不等于问答已可交付');
    validCampusSchedule(state);
  });
  it('静态引导可以搭配独立准备任务，但不能同时承诺完整问答', () => {
    const partial = apply(initialState('campus'), propose([...BASE, 'Q1', 'G']));
    expect(partial.proposal?.status).toBe('accepted');
    const conflict = apply(initialState('campus'), propose([...B, 'G']));
    expect(conflict.proposal?.status).toBe('rejected');
    expect(conflict.proposal?.issues.join('')).toContain('互斥');
  });
  it.each(['B1', 'B2', 'B3', 'B4'] as TaskId[])('不能丢掉基础任务%s', id => {
    const state = apply(initialState('campus'), propose(BASE.filter(item => item !== id)));
    expect(state.proposal?.status).toBe('rejected');
    expect(state.taskIds).toEqual(ORIGINAL_TASKS);
  });
  it.each([
    [...BASE, 'V3'], [...BASE, 'Q3'], [...BASE, 'Q1', 'Q3'], ['G'],
  ].map(ids => [ids as TaskId[]]))('不完整依赖不会被模型自动补齐: %j', ids => {
    const state = apply(initialState('campus'), propose(ids));
    expect(state.proposal?.status).toBe('rejected');
    expect(state.proposal?.issues.join('')).toContain('必须先完成');
  });
  it('即使总人时不超8，也检查个人容量', () => {
    const state = apply(initialState('campus'), propose([...BASE, 'V1', 'Q1']));
    expect(state.proposal?.issues.join('')).toContain('林澄需要 180 分钟');
    expect(state.proposal?.status).toBe('rejected');
  });
  it('允许合法显式排期，并在预留时段之外自动安排其它任务', () => {
    const scheduled = scheduleTasks(BASE, [{ taskId: 'B4', actor: 'zhou', start: 1260 }]);
    expect(scheduled.issues).toEqual([]);
    expect(scheduled.schedule.find(slot => slot.taskId === 'B3')?.start).toBe(1080);
    expect(scheduled.schedule.find(slot => slot.taskId === 'B4')?.start).toBe(1260);
  });
  it('拒绝用户替代专业成员、非法时间、重叠和依赖倒置', () => {
    const bad: Extract<Command, { type: 'propose' }>['assignments'][] = [
      [{ taskId: 'B3', actor: 'user' }],
      [{ taskId: 'B3', actor: 'zhou', start: 1200 }],
      [{ taskId: 'B1', actor: 'lin', start: -1 }],
      [{ taskId: 'B1', actor: 'lin', start: 1080.5 }],
      [{ taskId: 'B3', actor: 'zhou', start: 1080 }, { taskId: 'B4', actor: 'zhou', start: 1080 }],
      [{ taskId: 'B4', actor: 'zhou', start: 1080 }],
    ];
    for (const assignments of bad) expect(apply(initialState('campus'), { ...propose(BASE), type: 'propose', taskIds: BASE, assignments }).proposal?.status).toBe('rejected');
  });
  it('拒绝任务重复、未知任务与方案外负责人分配', () => {
    expect(scheduleTasks([...BASE, 'B1']).issues.length).toBeGreaterThan(0);
    expect(scheduleTasks([...BASE, 'SECRET' as TaskId]).issues.length).toBeGreaterThan(0);
    expect(scheduleTasks(BASE, [{ taskId: 'Q1', actor: 'lin' }]).issues.length).toBeGreaterThan(0);
  });
  it('总量可容纳但关键依赖错过个人窗口时，不宣布可排期', () => {
    const state = apply(initialState('campus'), { type: 'propose', taskIds: A, acknowledgements: ACKS, assignments: [{ taskId: 'B3', actor: 'zhou', start: 1140 }] });
    expect(state.proposal?.status).toBe('rejected');
    expect(state.proposal?.issues.join('')).toContain('没有可用时段');
  });
});

describe('角色接受、条件、否定与已有承诺', () => {
  it('先保留提议，补有限范围后由NPC明确接受，才生效', () => {
    const original = initialState('campus');
    const pending = apply(original, propose(A, []));
    expect(pending.proposal?.status).toBe('pending');
    expect(pending.taskIds).toEqual(original.taskIds);
    expect(pending.schedule).toEqual(original.schedule);
    const accepted = transition(pending, { type: 'acknowledge', items: ['limited_scope'] });
    expect(accepted.state.proposal?.status).toBe('accepted');
    expect(accepted.events.some(item => item.actor === 'lin' && item.kind === 'actor_acceptance')).toBe(true);
    expect(accepted.events.find(item => item.kind === 'acknowledgement')?.text).toContain('不支持自由问答');
    expect([...pending.proposal!.issues, ...accepted.events.map(item => item.text)].join('')).not.toMatch(/limited_scope|replace_visual|defer_new/);
  });
  it('取消部分既有精修也要许念接受范围调整', () => {
    const pending = apply(initialState('campus'), propose([...BASE, 'V1', 'V2', 'G'], ['limited_scope']));
    expect(pending.proposal?.status).toBe('pending');
    expect(pending.proposal?.acceptedBy).not.toContain('xu');
    expect(apply(pending, { type: 'acknowledge', items: ['replace_visual'] }).proposal?.status).toBe('accepted');
  });
  it('未知外援与额外时间不会被acknowledge变成事实', () => {
    const pending = apply(initialState('campus'), propose(A, ACKS, ['unconfirmed:extra_help', 'unconfirmed:more_time']));
    const next = apply(pending, { type: 'acknowledge', items: ['unconfirmed:extra_help', 'unconfirmed:more_time', ...ACKS] });
    expect(next.proposal?.status).toBe('pending');
    expect(next.proposal?.conditions).toHaveLength(2);
    expect(next.taskIds).toEqual(ORIGINAL_TASKS);
  });
  it('task_accepted条件需要方案中真实存在且相关NPC已接受的任务', () => {
    expect(apply(initialState('campus'), propose(A, ACKS, ['task_accepted:V1'])).proposal?.status).toBe('accepted');
    const missing = apply(initialState('campus'), propose(B, ACKS, ['task_accepted:V1']));
    expect(missing.proposal?.status).toBe('pending');
    const xuPending = apply(initialState('campus'), propose(B, [], ['task_accepted:Q2']));
    expect(xuPending.proposal?.issues.join('')).toContain('task_accepted:Q2');
  });
  it('重写提议不继承上一份方案的范围确认', () => {
    const state = apply(initialState('campus'), propose(A));
    const pending = apply(state, propose(B, []));
    expect(pending.proposal?.status).toBe('pending');
    expect(pending.taskIds).toEqual(A);
    expect(pending.agreement).toEqual(state.agreement);
  });
  it('无动作/否定由上游给空commands，澄清不会改动约定', () => {
    const original = initialState('campus');
    const noCommands = ([] as Command[]).reduce(apply, original);
    expect(noCommands).toEqual(original);
    const clarified = transition(original, { type: 'clarify', question: '你说不加问答，是保留原安排吗？' });
    expect(clarified.state).toEqual(original);
    expect(clarified.events.every(item => item.changes.length === 0)).toBe(true);
  });
  it('撤回仅影响未生效提议，不撤销已经确认的约定', () => {
    const accepted = apply(initialState('campus'), propose(A));
    const pending = apply(accepted, propose(B, []));
    const withdrawn = apply(pending, { type: 'withdraw' });
    expect(withdrawn.proposal).toBeNull();
    expect(withdrawn.taskIds).toEqual(accepted.taskIds);
    expect(withdrawn.schedule).toEqual(accepted.schedule);
    expect(withdrawn.agreement).toEqual(accepted.agreement);
    expect(apply(withdrawn, { type: 'finish' }).agreement).toEqual(accepted.agreement);
    expect(apply(accepted, { type: 'withdraw' }).taskIds).toEqual(A);
  });
  it('新提议失败或带未知结束，旧的确认安排仍生效', () => {
    const accepted = apply(initialState('campus'), propose(B));
    const rejected = apply(accepted, propose([...B, 'G']));
    expect(rejected.agreement).toEqual(accepted.agreement);
    const ended = apply(rejected, { type: 'finish' });
    expect(ended.agreement.status).toBe('confirmed');
    expect(ended.taskIds).toEqual(B);
    expect(ended.agreement.unknowns.length).toBeGreaterThan(0);
  });
  it('允许带未定事项结束；结束后不能偷偷修改方案', () => {
    const ended = apply(initialState('campus'), { type: 'finish' });
    expect(ended.agreement.status).toBe('incomplete');
    expect(ended.phase).toBe('ended');
    expect(apply(ended, propose(A))).toEqual(ended);
  });
  it('询问按职责披露，材料查看也能获得目的', () => {
    const state = initialState('campus');
    expect(state.revealed).not.toContain('feedback');
    expect(apply(state, { type: 'ask', topic: 'goal', actor: 'zhou' }).revealed).not.toContain('feedback');
    expect(apply(state, { type: 'ask', topic: 'goal', actor: 'lin' }).revealed).toContain('feedback');
    expect(apply(state, { type: 'inspect', materialId: 'feedback' }).revealed).toContain('feedback');
    expect(apply(state, { type: 'inspect', materialId: 'invented-data' }).revealed).toEqual(state.revealed);
  });
});

describe('独立迁移：计划、模拟发布与验收', () => {
  it('重复询问已知目标时给出材料，不虚构新的信息缺口', () => {
    const result = transition(initialState('transfer'), { type: 'ask', topic: 'goal' });
    expect(result.events[0]).toMatchObject({ actor: 'system', kind: 'disclosure' });
    expect(result.events[0].text).toContain('核对模拟提交');
    expect(result.state.transfer).toEqual(initialState('transfer').transfer);
  });
  it('首次计划先留证；仅列计划不算发布和验证', () => {
    const state = apply(initialState('transfer'), { type: 'transfer_plan', steps: ['publish', 'verify'] });
    expect(state.transfer.firstPlan).toEqual(['publish', 'verify']);
    expect(state.transfer.firstAssisted).toBe(false);
    expect(state.transfer.published).toBe(false);
    expect(apply(state, { type: 'finish' }).agreement.status).toBe('incomplete');
  });
  it('发布后核对才闭环，重复执行不会重复扣时', () => {
    let state = apply(initialState('transfer'), { type: 'transfer_plan', steps: ['publish', 'verify'] });
    expect(apply(state, { type: 'transfer_execute', step: 'verify' }).transfer.elapsed).toBe(0);
    state = apply(state, { type: 'transfer_execute', step: 'publish' });
    state = apply(state, { type: 'transfer_execute', step: 'publish' });
    expect(state.transfer.elapsed).toBe(15);
    expect(state.transfer.verified).toBe(false);
    state = apply(state, { type: 'transfer_execute', step: 'verify' });
    expect(state.transfer).toMatchObject({ elapsed: 25, published: true, verified: true });
    expect(apply(state, { type: 'finish' }).agreement.status).toBe('confirmed');
  });
  it('参考工作不能冒充成果，剩余时间不足不自动延长', () => {
    let state = apply(initialState('transfer'), { type: 'transfer_plan', steps: ['references', 'publish', 'verify'] });
    state = apply(state, { type: 'transfer_execute', step: 'references' });
    const blocked = apply(state, { type: 'transfer_execute', step: 'publish' });
    expect(blocked.transfer.elapsed).toBe(20);
    expect(blocked.transfer.published).toBe(false);
    expect(blocked.transfer.verified).toBe(false);
  });
  it('首次辅助标志不能由之后的修改洗掉或倒填', () => {
    const assisted = apply(apply(initialState('transfer'), { type: 'hint' }), { type: 'transfer_plan', steps: ['verify'] });
    const fixed = apply(assisted, { type: 'transfer_plan', steps: ['publish', 'verify'] });
    expect(fixed.transfer.firstPlan).toEqual(['verify']);
    expect(fixed.transfer.firstAssisted).toBe(true);
    const independent = apply(initialState('transfer'), { type: 'transfer_plan', steps: ['publish'] });
    expect(apply(independent, { type: 'hint' }).transfer.firstAssisted).toBe(false);
  });
  it('未知任务或未列入计划的执行没有任何效果', () => {
    const state = initialState('transfer');
    expect(apply(state, { type: 'transfer_execute', step: 'publish' })).toEqual(state);
    expect(apply(state, { type: 'transfer_execute', step: '__proto__' })).toEqual(state);
  });
});

describe('职场截止与明确接受', () => {
  it('摘要优先且明确请求16:00截止，排期15:30完成但不悄悄改写请求', () => {
    const result = transition(initialState('workplace'), { type: 'workplace_propose', order: ['summary', 'table'], requestReschedule: true });
    expect(result.state.workplace).toMatchObject({ managerAccepted: true, tableDeadline: 960, issues: [] });
    expect(result.state.schedule).toEqual([
      { taskId: 'summary', actor: 'user', start: 780, end: 870 },
      { taskId: 'table', actor: 'user', start: 870, end: 930 },
    ]);
    expect(result.events.some(item => item.actor === 'manager' && item.kind === 'manager_acceptance')).toBe(true);
    expect(result.events.find(item => item.kind === 'manager_acceptance')?.text).toContain('16:00');
    expect(result.events.find(item => item.kind === 'workplace_proposal')?.text).toContain('16:00');
  });
  it('负责人权限与截止问题由负责人披露已有材料，不自动算作同意改期', () => {
    const original = initialState('workplace');
    for (const topic of ['authority', 'acceptance', 'deadline', 'goal']) {
      const result = transition(original, { type: 'ask', topic, actor: 'manager' });
      expect(result.events[0]).toMatchObject({ actor: 'manager', kind: 'disclosure' });
      expect(result.events[0].text).toContain(topic === 'acceptance' ? '目标、现状和待决策' : '15:00');
      if (topic === 'authority' || topic === 'deadline') expect(result.events[0].text).toContain('16:00');
      expect(result.state.workplace.managerAccepted).toBe(false);
      expect(result.state.workplace.tableDeadline).toBe(900);
    }
  });
  it('没有协调旧截止不能被默认批准', () => {
    const state = apply(initialState('workplace'), { type: 'workplace_propose', order: ['summary', 'table'], requestReschedule: false });
    expect(state.workplace.managerAccepted).toBe(false);
    expect(state.workplace.tableDeadline).toBe(900);
    expect(state.workplace.issues.join('')).toContain('需明确请求');
  });
  it('先做旧表会错过摘要硬截止，即便同意顺延旧表也无效', () => {
    const state = apply(initialState('workplace'), { type: 'workplace_propose', order: ['table', 'summary'], requestReschedule: true });
    expect(state.workplace.managerAccepted).toBe(false);
    expect(state.workplace.issues.join('')).toContain('摘要必须在 15:00');
  });
  it('不能漏掉或重复工作', () => {
    for (const order of [[], ['summary'], ['summary', 'summary']] as ('summary' | 'table')[][]) {
      expect(apply(initialState('workplace'), { type: 'workplace_propose', order, requestReschedule: true }).workplace.managerAccepted).toBe(false);
    }
  });
  it('已接受安排不会被后续错误提议覆写', () => {
    const state = apply(initialState('workplace'), { type: 'workplace_propose', order: ['summary', 'table'], requestReschedule: true });
    const invalid = apply(state, { type: 'workplace_propose', order: ['table', 'summary'], requestReschedule: true });
    expect(invalid.schedule).toEqual(state.schedule);
    expect(invalid.workplace.order).toEqual(state.workplace.order);
    expect(invalid.workplace.tableDeadline).toBe(960);
    expect(apply(invalid, { type: 'finish' }).agreement.status).toBe('confirmed');
  });
  it('情境之间不能互相注入执行动作', () => {
    const state = initialState('campus');
    expect(apply(state, { type: 'workplace_propose', order: ['summary', 'table'], requestReschedule: true })).toEqual(state);
    expect(apply(state, { type: 'transfer_plan', steps: ['publish'] })).toEqual(state);
  });
});

describe('状态与排期不变量', () => {
  it('任意候选任务集合都不能破坏当前生效排期', () => {
    fc.assert(fc.property(fc.subarray(ALL), ids => {
      const initial = initialState('campus');
      const snapshot = structuredClone(initial);
      const state = apply(initial, propose(ids));
      expect(initial).toEqual(snapshot);
      validCampusSchedule(state);
      if (state.proposal?.status === 'accepted') {
        expect(BASE.every(id => state.taskIds.includes(id))).toBe(true);
        expect(state.taskIds.includes('G') && state.taskIds.includes('Q3')).toBe(false);
        expect(state.proposal.acceptedBy).toEqual(['lin', 'xu', 'zhou']);
      } else expect(state.taskIds).toEqual(initial.taskIds);
    }), { numRuns: 500 });
  });
  it('输入任务顺序不能改变依赖排期的结论', () => {
    fc.assert(fc.property(fc.subarray(ALL), ids => {
      expect(scheduleTasks([...ids].reverse())).toEqual(scheduleTasks(ids));
    }), { numRuns: 250 });
  });
  it('任意未知条件不能用范围ack消失，任意自然文字澄清不产生动作', () => {
    fc.assert(fc.property(fc.string({ maxLength: 80 }), text => {
      const initial = initialState('campus');
      const state = apply(initial, propose(A, ACKS, [`unconfirmed:${text}`]));
      const acknowledged = apply(state, { type: 'acknowledge', items: [`unconfirmed:${text}`, ...ACKS] });
      expect(acknowledged.proposal?.status).toBe('pending');
      expect(acknowledged.taskIds).toEqual(ORIGINAL_TASKS);
      expect(apply(initial, { type: 'clarify', question: text })).toEqual(initial);
    }), { numRuns: 150 });
  });
  it('任意执行顺序不会在未发布时验证，也不会超时或重复扣时', () => {
    const action = fc.constantFrom<Command>(
      { type: 'transfer_plan', steps: ['publish', 'verify', 'references'] },
      { type: 'transfer_execute', step: 'publish' }, { type: 'transfer_execute', step: 'verify' },
      { type: 'transfer_execute', step: 'references' }, { type: 'hint' }, { type: 'finish' },
    );
    fc.assert(fc.property(fc.array(action, { maxLength: 30 }), commands => {
      let state = initialState('transfer');
      for (const command of commands) {
        const before = structuredClone(state);
        state = apply(state, command);
        expect(state.transfer.elapsed).toBeGreaterThanOrEqual(before.transfer.elapsed);
        expect(state.transfer.elapsed).toBeLessThanOrEqual(30);
        expect(new Set(state.transfer.completed).size).toBe(state.transfer.completed.length);
        if (state.transfer.verified) expect(state.transfer.published).toBe(true);
        if (before.transfer.firstPlan !== null) {
          expect(state.transfer.firstPlan).toEqual(before.transfer.firstPlan);
          expect(state.transfer.firstAssisted).toEqual(before.transfer.firstAssisted);
        }
      }
    }), { numRuns: 250 });
  });
});
