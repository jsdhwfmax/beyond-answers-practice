import { TASKS } from './scenarios';
import type { GameState } from './types';

export type ScopeAcknowledgement = 'limited_scope' | 'replace_visual' | 'defer_new';

/** Only offer confirmations that can actually resolve the saved pending proposal. */
export function neededAcknowledgements(state: GameState): ScopeAcknowledgement[] {
  const proposal = state.proposal;
  if (state.scenario !== 'campus' || !proposal || proposal.status !== 'pending') return [];
  // A future outcome cannot be verified by pressing a scope-confirmation button.
  if (proposal.conditions.some(condition => !/^task_accepted:(B[1-4]|V[1-3]|G|Q[1-3])$/.test(condition))) return [];
  const needed: ScopeAcknowledgement[] = [];
  if (proposal.taskIds.includes('G')) needed.push('limited_scope');
  else if (!proposal.taskIds.includes('Q3')) needed.push('defer_new');
  if (state.taskIds.some(id => TASKS[id].group === 'visual' && !proposal.taskIds.includes(id))) needed.push('replace_visual');
  return needed.filter(item => !proposal.acknowledgements.includes(item));
}
