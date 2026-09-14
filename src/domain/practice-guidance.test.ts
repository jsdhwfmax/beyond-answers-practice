import { describe, expect, test } from 'vitest';
import { initialState, transition } from './engine';
import { derivePracticeGuidance, neededAcknowledgements } from './practice-guidance';
import { ORIGINAL_TASKS } from './scenarios';
import type { TaskId } from './types';

describe('progress describes the next useful action without ending a conversation', () => {
  test('the campus entry leads with a concrete question, not a review action', () => {
    const result = derivePracticeGuidance(initialState('campus'));
    expect(result.stage).toBe('orient'); expect(result.suggestedPrompts).toEqual(['试用的人具体遇到了什么问题？']);
    expect(result.canReview).toBe(false); expect(result.isEnded).toBe(false);
  });
  test('a reasonable first agreement remains open and can receive another action', () => {
    const accepted = transition(initialState('campus'), { type: 'propose', taskIds: [...ORIGINAL_TASKS, 'G'], acknowledgements: ['limited_scope'] });
    expect(derivePracticeGuidance(accepted.state, accepted.events)).toMatchObject({ stage: 'agreed', canReview: true, isEnded: false });
    const followup = transition(accepted.state, { type: 'ask', topic: 'qa' });
    expect(followup.events[0].kind).toBe('disclosure'); expect(followup.state.phase).toBe('resolved');
    expect(derivePracticeGuidance(transition(followup.state, { type: 'finish' }).state).stage).toBe('ended');
  });
  test('a clarification displays the actual saved next question', () => {
    const question = '新版本要增加什么功能？';
    expect(derivePracticeGuidance(initialState('campus'), [{ kind: 'clarification', text: question }])).toMatchObject({ stage: 'clarify', detail: question, isEnded: false });
  });
  test.each([
    [[...ORIGINAL_TASKS, 'G'], ['limited_scope']],
    [['B1', 'B2', 'B3', 'B4', 'Q1', 'Q2', 'Q3'], ['replace_visual']],
    [[...ORIGINAL_TASKS], ['defer_new']],
  ] as [TaskId[], string[]][])('only applicable acknowledgements are offered', (taskIds, needed) => {
    const state = transition(initialState('campus'), { type: 'propose', taskIds }).state;
    expect(neededAcknowledgements(state)).toEqual(needed);
    const confirmed = transition(state, { type: 'acknowledge', items: needed }).state;
    expect(confirmed.agreement.status).toBe('confirmed'); expect(neededAcknowledgements(confirmed)).toEqual([]);
  });
  test('scope buttons never purport to establish a future completion condition', () => {
    const state = transition(initialState('campus'), { type: 'propose', taskIds: [...ORIGINAL_TASKS], conditions: ['21:30前完成核对'] }).state;
    expect(neededAcknowledgements(state)).toEqual([]);
    expect(derivePracticeGuidance(state)).toMatchObject({ stage: 'negotiate', isEnded: false });
    expect(state.taskIds).toEqual(ORIGINAL_TASKS); expect(state.proposal?.acceptedBy).toEqual([]);
  });
  test('publishing and verification are separate next steps', () => {
    const planned = transition(initialState('transfer'), { type: 'transfer_plan', steps: ['publish', 'verify'] }).state;
    expect(derivePracticeGuidance(planned).stage).toBe('execute');
    const published = transition(planned, { type: 'transfer_execute', step: 'publish' }).state;
    expect(derivePracticeGuidance(published).title).toContain('下一步检查');
    const verified = transition(published, { type: 'transfer_execute', step: 'verify' }).state;
    expect(derivePracticeGuidance(verified)).toMatchObject({ stage: 'complete', isEnded: false });
  });
});
