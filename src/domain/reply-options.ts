export interface ReplyOption { id: string; text: string }
export interface ReplyOptionsView {
  sessionId: string;
  version: number;
  customBranchId?: string;
  status: 'ready' | 'ended' | 'not_ready' | 'assistance_required';
  options: ReplyOption[];
  source: 'model' | 'fallback';
  generatedAt: string | null;
  model?: string;
  provider?: 'bailian' | 'openai' | 'deepseek';
  notice: string;
  assistance: 'none' | 'recorded' | 'requires_record';
}
