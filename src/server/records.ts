import type { ActionRequest, ExperienceReport, GameState, Interpretation, SessionView } from '@/domain/types';
import type { ReflectionAttempt } from './reflection';

export interface ActionRecord {
  id: string; hash: string; request: ActionRequest; status: 'interpreting' | 'committed' | 'complete' | 'failed';
  attempt: number; leaseUntil: number; baseVersion: number; errorCode?: string; interpretation?: Interpretation;
}
export interface SessionRecord {
  owner: string; view: Omit<SessionView, 'capabilities' | 'pendingActionId' | 'comparison'>;
  actions: Record<string, ActionRecord>; checkpoints: { sequence: number; state: GameState }[];
  parentState?: GameState;
  expiresAt: string;
  reports?: Record<string, ExperienceReport>;
  reflections?: Record<string, ReflectionAttempt>;
}
export interface ModelSlot { token: string; until: number }
export interface Store {
  mode: 'local' | 'postgres';
  create(record: SessionRecord): Promise<void>;
  read(owner: string, id: string): Promise<SessionRecord>;
  update<T>(owner: string, id: string, mutation: (record: SessionRecord) => T): Promise<T>;
  remove(owner: string, id: string): Promise<string[]>;
  acquireModel(token: string, now: number): Promise<boolean>;
  releaseModel(token: string): Promise<void>;
  cleanup(now: number): Promise<number>;
}
