import type { CampusCorpusQuestion } from '@/content/campus-corpus';
import { isPreviousAutomaticScenarioDraft, reviseCampusScenarioSeed } from '@/content/campus-scenario-seeds';

export interface CustomDraftIdentity {
  topic: string;
  questionId: string | null;
  selectionRevision: number;
}

/** Even identical text may belong to a different question or a later selection. */
export function matchesCustomDraft(submitted: CustomDraftIdentity, current: CustomDraftIdentity): boolean {
  return submitted.topic === current.topic
    && submitted.questionId === current.questionId
    && submitted.selectionRevision === current.selectionRevision;
}

/** Creation trims only when sending; recovery must still preserve the exact editable draft. */
export function captureCustomRetryDraft(sessionTopic: string, sessionQuestionId: string | null, current: CustomDraftIdentity): CustomDraftIdentity | null {
  if (current.topic.trim() !== sessionTopic || current.questionId !== sessionQuestionId) return null;
  return { ...current };
}

/** Only exact obsolete automatic seeds migrate; an empty or edited draft is user work. */
export function restoreQuestionDraft(questionId: string, saved: string | null, initialTopic: string): string {
  if (saved === null || isPreviousAutomaticScenarioDraft(questionId, saved)) return initialTopic;
  return saved;
}

/** Browser-only selection metadata can be revised without touching saved practice branches. */
export function restoreStoredQuestionDraft(question: CampusCorpusQuestion, saved: string | null): { question: CampusCorpusQuestion; topic: string } {
  const currentQuestion = reviseCampusScenarioSeed(question);
  const seed = currentQuestion.scenarioSeed;
  const currentTopic = `我扮演${seed.userRole}，想和${seed.counterpartRole}聊一聊。${seed.situation}\n这次我希望：${seed.goal}`;
  return { question: currentQuestion, topic: restoreQuestionDraft(question.id, saved, currentTopic) };
}
