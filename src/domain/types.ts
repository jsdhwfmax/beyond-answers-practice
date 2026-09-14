export type ScenarioId = 'campus' | 'transfer' | 'workplace';
export type ActorId = 'lin' | 'xu' | 'zhou' | 'user' | 'system' | 'manager';
export type TaskId = 'B1' | 'B2' | 'B3' | 'B4' | 'V1' | 'V2' | 'V3' | 'G' | 'Q1' | 'Q2' | 'Q3';
export interface Task { id: TaskId; title: string; actor: ActorId; minutes: number; dependencies: TaskId[]; group: 'base' | 'visual' | 'guide' | 'qa' }
export interface Slot { taskId: string; actor: ActorId; start: number; end: number }
export interface Change { field: string; before: string; after: string; reason: string }
export interface Proposal {
  taskIds: TaskId[]; conditions: string[]; acknowledgements: string[];
  status: 'pending' | 'accepted' | 'rejected'; issues: string[];
  schedule: Slot[]; acceptedBy: ActorId[];
}
export interface TransferState {
  firstPlan: string[] | null; firstAssisted: boolean; plan: string[]; completed: string[];
  elapsed: number; hintUsed: boolean; published: boolean; verified: boolean;
}
export interface WorkplaceState {
  order: ('summary' | 'table')[]; rescheduleRequested: boolean; managerAccepted: boolean;
  tableDeadline: number; schedule: Slot[]; issues: string[];
}
export interface GameState {
  scenario: ScenarioId; scenarioVersion: string; sourceVersion: string;
  phase: 'briefing' | 'negotiating' | 'resolved' | 'ended';
  revealed: string[]; taskIds: TaskId[]; schedule: Slot[]; proposal: Proposal | null;
  agreement: { status: 'original' | 'pending' | 'confirmed' | 'incomplete'; scope: string[]; tradeoffs: string[]; unknowns: string[] };
  transfer: TransferState; workplace: WorkplaceState;
}
export type Command =
  | { type: 'inspect'; materialId: string }
  | { type: 'ask'; topic: string; actor?: ActorId }
  | { type: 'propose'; taskIds: TaskId[]; conditions?: string[]; acknowledgements?: string[]; assignments?: { taskId: TaskId; actor: ActorId; start?: number }[] }
  | { type: 'acknowledge'; items: string[] }
  | { type: 'withdraw' }
  | { type: 'finish' }
  | { type: 'hint' }
  | { type: 'reply_options_seen' }
  | { type: 'transfer_plan'; steps: string[] }
  | { type: 'transfer_execute'; step: string }
  | { type: 'workplace_propose'; order: ('summary' | 'table')[]; requestReschedule: boolean }
  | { type: 'clarify'; question: string };
export interface Interpretation { commands: Command[]; evidence: { commandIndex: number; quote: string }[]; clarification?: string }
export interface EventDraft { actor: ActorId; kind: string; text: string; changes: Change[] }
export interface GameEvent extends EventDraft { id: string; sequence: number; actionId: string; createdAt: string }
export interface Transition { state: GameState; events: EventDraft[] }
export interface ActionRequest { actionId: string; expectedVersion: number; text?: string; command?: Command }
export interface SessionView {
  id: string; version: number; state: GameState; events: GameEvent[];
  parentId: string | null; forkReason: 'retry' | 'correction' | null;
  createdAt: string; updatedAt: string; pendingActionId?: string | null;
  capabilities: { naturalLanguage: boolean; storage: 'postgres' | 'local'; model?: string; provider?: 'bailian' | 'openai' | 'deepseek' };
  comparison?: { parentId: string; state: GameState };
}
export interface SourceCard {
  id: string; author: string; title: string; excerpt: string; interpretation: string;
  conditions: string; application: string; retrievedAt: string; truncated: boolean;
  sourceUrl?: string;
}
export interface ExperienceReport {
  title: string; scenario: ScenarioId; status: string; scope: string[]; tradeoffs: string[];
  unknowns: string[]; changes: Change[]; evidence: { quote: string; result: string }[];
  nextStep: string; generatedAt?: string;
}
