import { describe, expect, it } from 'vitest';
import { initialState, transition } from './engine';
import { buildReport } from './report';
import { ORIGINAL_TASKS } from './scenarios';
import type { GameEvent } from './types';

describe('经验记录只对应实际事件', () => {
  it('没有行为时不生成虚假的前后进步或引用', () => {
    const report = buildReport(initialState('campus'), []);
    expect(report.evidence).toEqual([]);
    expect(report.changes).toEqual([]);
    expect(report.status).not.toContain('掌握');
    expect(report.generatedAt).toBeUndefined();
  });
  it('只有同一次行动后实际出现的事件成为结果证据', () => {
    const result = transition(initialState('campus'), { type: 'propose', taskIds: [...ORIGINAL_TASKS, 'G'], acknowledgements: ['limited_scope'] });
    const input: GameEvent = { id: 'input', sequence: 0, actionId: 'one-action', createdAt: '2026-09-13T00:00:00Z', actor: 'user', kind: 'input', text: '原计划再加三个入口，只做导航，不做自由问答。', changes: [] };
    const events: GameEvent[] = [input, ...result.events.map((event, index): GameEvent => ({ ...event, actor: event.actor === 'user' ? 'system' : event.actor, kind: event.actor === 'user' ? `interpretation:${event.kind}` : event.kind, id: String(index), sequence: index + 1, actionId: 'one-action', createdAt: '2026-09-13T00:00:00Z' }))];
    events.push({ ...input, id: 'unrelated', sequence: 100, actionId: 'another-action', actor: 'system', kind: 'disclosure', text: '另一次行动的事实，不应拼成这句原话的结果。' });
    const report = buildReport(result.state, events);
    expect(report.evidence).toHaveLength(1);
    expect(report.evidence[0].quote).toBe(input.text);
    expect(report.evidence[0].result).toContain('新的交付约定生效');
    expect(report.evidence[0].result).not.toContain('另一次行动的事实');
    expect(report.changes).toHaveLength(1);
    expect(report.tradeoffs.join('')).toContain('不支持自由问答');
  });
  it('待定新方案与已有安排分开显示', () => {
    const first = transition(initialState('campus'), { type: 'propose', taskIds: [...ORIGINAL_TASKS, 'G'], acknowledgements: ['limited_scope'] }).state;
    const pending = transition(first, { type: 'propose', taskIds: ORIGINAL_TASKS, conditions: ['unconfirmed:extra_help'] }).state;
    const report = buildReport(pending, []);
    expect(report.scope).toEqual(first.agreement.scope);
    expect(report.status).toContain('既有安排保留');
    expect(report.unknowns.join('')).toContain('extra_help');
  });
  it('区分提示后的首次计划与无提示记录，不能把计划说成模拟完成', () => {
    const hinted = transition(initialState('transfer'), { type: 'hint' }).state;
    const planned = transition(hinted, { type: 'transfer_plan', steps: ['publish', 'verify'] }).state;
    const report = buildReport(planned, []);
    expect(report.status).toBe('尚未闭合模拟任务');
    expect(report.tradeoffs.join('')).toContain('不能作为无提示表现');
  });
  it('报告返回副本，不允许改写保存状态', () => {
    const state = initialState('campus');
    const before = structuredClone(state);
    const report = buildReport(state, []);
    report.scope.push('invented');
    report.unknowns.length = 0;
    expect(state).toEqual(before);
  });
});
