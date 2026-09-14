import { z } from 'zod';
import type { CustomModelInfo } from './custom-practice';

export const practiceIntakeRequestSchema = z.object({
  requestId: z.uuid(),
  // Keep the player's exact draft so a delayed response cannot match edited text.
  text: z.string().min(1).max(2000).refine(value => value.trim().length > 0),
}).strict();
export type PracticeIntakeRequest = z.infer<typeof practiceIntakeRequestSchema>;
export type PracticeIntakeStatus = 'ready' | 'needs_context' | 'knowledge_request' | 'topic_only';
export interface PracticeIntakeSuggestion {
  id: string; label: string; draft: string; assumptions: string[];
}
export interface PracticeIntakeView {
  version: 'practice-intake-v1'; requestId: string; originalText: string;
  status: PracticeIntakeStatus; reason: string; evidenceQuotes: string[];
  questions: string[]; suggestions: PracticeIntakeSuggestion[];
  /** Advice only; no session, simulated response or goal achievement is created. */
  canStartPractice: boolean; generatedBy?: CustomModelInfo;
}
