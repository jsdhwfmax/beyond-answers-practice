import OpenAI from 'openai';
import { AppError } from './errors';

export type ModelProvider = 'bailian' | 'openai' | 'deepseek';
export const DEFAULT_BAILIAN_MODEL = 'qwen3.8-max-0902';
export const DEFAULT_BAILIAN_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-flash';
export const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

/** Safe for health responses: credentials and host configuration never leave the server. */
export function modelConfiguration(scope?: 'custom') {
  const requested = (scope === 'custom' ? process.env.CUSTOM_MODEL_PROVIDER?.trim() : undefined) || process.env.MODEL_PROVIDER?.trim() || 'bailian';
  const validScope = scope === undefined || scope === 'custom';
  const provider: ModelProvider | null = validScope && (requested === 'bailian' || requested === 'openai' || requested === 'deepseek') ? requested : null;
  const model = provider === 'openai' ? process.env.OPENAI_MODEL?.trim() || 'gpt-6-astra' : provider === 'deepseek' ? process.env.DEEPSEEK_MODEL?.trim() || DEFAULT_DEEPSEEK_MODEL : process.env.BAILIAN_MODEL?.trim() || DEFAULT_BAILIAN_MODEL;
  const keyPresent = provider === 'bailian' ? Boolean(process.env.DASHSCOPE_API_KEY?.trim()) : provider === 'openai' ? Boolean(process.env.OPENAI_API_KEY?.trim()) : provider === 'deepseek' ? Boolean(process.env.DEEPSEEK_API_KEY?.trim()) : false;
  return { provider, model, configured: Boolean(provider && keyPresent) };
}

export interface ModelJsonRequest {
  /** Server-owned routing choice. Never copied from a player action or model output. */
  scope?: 'custom';
  system: string;
  user: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  maxOutputTokens?: number;
  purpose?: 'interpretation' | 'reflection' | 'reply_options';
  /** Server-owned request budget; never copied from user input. */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Explicit, server-only experiment override. Never accepted from a player action. */
  bailianReasoning?: 'none' | 'low';
}
export interface ModelJsonResponse { text: string; model: string; provider: ModelProvider }

/** Strict wire format is a transport aid; callers still validate the parsed data and its meaning. */
export async function requestModelJson(input: ModelJsonRequest): Promise<ModelJsonResponse> {
  const config = modelConfiguration(input.scope);
  if (!config.configured || !config.provider) throw new AppError('AI_NOT_CONFIGURED', '自然语言服务尚未配置。可以继续使用页面中的练习操作。', 503);
  const provider = config.provider;
  const baseURL = provider === 'bailian' ? process.env.BAILIAN_BASE_URL?.trim() || DEFAULT_BAILIAN_BASE_URL : provider === 'deepseek' ? process.env.DEEPSEEK_BASE_URL?.trim() || DEFAULT_DEEPSEEK_BASE_URL : undefined;
  if (baseURL) {
    let url: URL;
    try { url = new URL(baseURL); } catch { throw new AppError('AI_CONFIGURATION_INVALID', '模型接口地址配置无效。', 503); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new AppError('AI_CONFIGURATION_INVALID', '模型接口地址必须是无凭据、无查询参数的 HTTPS 地址。', 503);
    if (provider === 'deepseek' && (url.hostname !== 'api.deepseek.com' || url.port || !['/', '/v1', '/v1/'].includes(url.pathname))) throw new AppError('AI_CONFIGURATION_INVALID', 'DeepSeek 接口地址必须使用已配置的官方服务。', 503);
  }
  const apiKey = provider === 'bailian' ? process.env.DASHSCOPE_API_KEY!.trim() : provider === 'deepseek' ? process.env.DEEPSEEK_API_KEY!.trim() : process.env.OPENAI_API_KEY!.trim();
  const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}), timeout: Math.min(35_000, Math.max(1000, input.timeoutMs ?? 35_000)), maxRetries: 0 });
  try {
    if (provider === 'bailian') {
      // Aliyun's Chat Completions schema API supports these model families. There is
      // deliberately no silent JSON-object fallback if a configured model rejects it.
      const request = {
        model: config.model,
        messages: [{ role: 'system' as const, content: input.system }, { role: 'user' as const, content: input.user }],
        response_format: { type: 'json_schema' as const, json_schema: { name: input.schemaName, strict: true, schema: input.jsonSchema } },
        max_tokens: input.maxOutputTokens ?? 5000,
        stream: false as const,
        // Qwen 3.8 uses reasoning_effort; 3.7 uses the top-level DashScope extension.
        ...(/^qwen3\.8(?:-|$)/.test(config.model) ? { reasoning_effort: input.bailianReasoning ?? (input.purpose === 'interpretation' ? 'low' as const : 'none' as const) } : { enable_thinking: false }),
      };
      const response = await client.chat.completions.create(request, { signal: input.signal });
      const choice = response.choices[0];
      if (choice?.message.refusal || choice?.finish_reason === 'content_filter') throw new AppError('AI_REFUSED', '模型无法解释这段内容，本轮没有改变约定。请换一种具体说法。', 422);
      if (choice?.finish_reason !== 'stop' || !choice.message.content?.trim() || !response.model?.trim()) throw new AppError('AI_INCOMPLETE', '语言解释未完成，本轮没有改变约定。请稍后重试。', 502);
      return { text: choice.message.content, model: response.model, provider };
    }
    if (provider === 'deepseek') {
      // DeepSeek Chat only documents json_object. Its Responses endpoint
      // accepts JSON Schema; keep all existing application validators as well.
      const response = await client.responses.create({
        model: config.model, reasoning: { effort: 'none' }, stream: false,
        max_output_tokens: input.maxOutputTokens ?? 5000, instructions: input.system, input: input.user,
        text: { format: { type: 'json_schema', name: input.schemaName, strict: true, schema: input.jsonSchema } },
      }, { signal: input.signal });
      if (response.incomplete_details?.reason === 'content_filter' || response.output?.some(item => item.type === 'message' && item.content?.some(part => part.type === 'refusal'))) throw new AppError('AI_REFUSED', '模型无法解释这段内容，本轮没有改变约定。请换一种具体说法。', 422);
      if (response.status !== 'completed' || !response.output_text?.trim() || !response.model?.trim()) throw new AppError('AI_INCOMPLETE', '语言解释未完成，本轮没有改变约定。请稍后重试。', 502);
      return { text: response.output_text, model: response.model, provider };
    }
    const response = await client.responses.create({
      model: config.model, reasoning: { effort: input.purpose === 'reflection' ? 'medium' : 'low' }, store: false,
      max_output_tokens: input.maxOutputTokens ?? 5000, instructions: input.system, input: input.user,
      text: { format: { type: 'json_schema', name: input.schemaName, strict: true, schema: input.jsonSchema } },
    }, { signal: input.signal });
    if (response.output.some(item => item.type === 'message' && item.content.some(part => part.type === 'refusal'))) throw new AppError('AI_REFUSED', '模型无法解释这段内容，本轮没有改变约定。请换一种具体说法。', 422);
    if (response.status !== 'completed' || !response.output_text?.trim() || !response.model?.trim()) throw new AppError('AI_INCOMPLETE', '语言解释未完成，本轮没有改变约定。请稍后重试。', 502);
    return { text: response.output_text, model: response.model, provider };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof OpenAI.APIConnectionTimeoutError) throw new AppError('AI_TIMEOUT', '模型响应超时，本轮没有改变约定。请稍后重试。', 503);
    if (provider === 'deepseek' && error instanceof OpenAI.APIError && error.status === 402) throw new AppError('AI_BALANCE_INSUFFICIENT', '模型服务可用余额不足，原话已保留。', 503);
    if (error instanceof OpenAI.APIError && error.status === 429) throw new AppError('AI_RATE_LIMITED', '模型服务当前繁忙，本轮没有改变约定。请稍后重试。', 429);
    if (error instanceof OpenAI.APIError && (error.status === 401 || error.status === 403)) throw new AppError('AI_AUTH_FAILED', '模型服务鉴权未通过，请检查服务端的密钥、地域与模型权限。', 503);
    if (error instanceof OpenAI.APIError && (error.status === 400 || error.status === 404)) throw new AppError('AI_MODEL_CONFIGURATION', '当前模型或结构化输出配置未被服务接受。请检查所选模型及接口地域。', 503);
    throw new AppError('AI_UNAVAILABLE', '模型服务暂未返回可用结果，本轮没有改变约定。请稍后重试。', 503);
  }
}
