import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { modelConfiguration, requestModelJson } from './model-provider';
import { configuration } from './config';

const input = { system: 'Return JSON with ok.', user: 'This is synthetic test input.', schemaName: 'test_result', jsonSchema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' } }, required: ['ok'] } };
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubEnv('MODEL_PROVIDER', 'bailian'); vi.stubEnv('DASHSCOPE_API_KEY', 'test-placeholder-key'); vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('CUSTOM_MODEL_PROVIDER', '');
  vi.stubEnv('BAILIAN_MODEL', 'qwen3.8-max-0902'); vi.stubEnv('BAILIAN_BASE_URL', 'https://dashscope.aliyuncs.com/compatible-mode/v1');
  vi.stubEnv('DEEPSEEK_API_KEY', ''); vi.stubEnv('DEEPSEEK_MODEL', ''); vi.stubEnv('DEEPSEEK_BASE_URL', '');
  fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
});

describe('optional DeepSeek Responses provider', () => {
  const select = () => { vi.stubEnv('MODEL_PROVIDER', 'deepseek'); vi.stubEnv('DEEPSEEK_API_KEY', 'synthetic-deepseek-key'); };
  function response(overrides: Record<string, unknown> = {}) {
    return new Response(JSON.stringify({ id: 'synthetic-response', object: 'response', model: 'deepseek-flash-served', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"ok":true}', annotations: [] }] }], ...overrides }), { headers: { 'content-type': 'application/json' } });
  }
  test('the default provider remains Bailian even when a DeepSeek key is present', () => {
    vi.stubEnv('MODEL_PROVIDER', ''); vi.stubEnv('DEEPSEEK_API_KEY', 'synthetic-deepseek-key');
    expect(modelConfiguration()).toMatchObject({ provider: 'bailian', model: 'qwen3.8-max-0902', configured: true });
  });
  test('explicit selection requires its own key and does not bill another configured provider', async () => {
    vi.stubEnv('MODEL_PROVIDER', 'deepseek');
    expect(modelConfiguration()).toMatchObject({ provider: 'deepseek', model: 'deepseek-flash', configured: false });
    await expect(requestModelJson(input)).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  test('uses the official Responses endpoint, full schema and explicit non-thinking mode', async () => {
    select(); fetchMock.mockResolvedValue(response());
    expect(await requestModelJson({ ...input, purpose: 'reflection' })).toEqual({ text: '{"ok":true}', model: 'deepseek-flash-served', provider: 'deepseek' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.deepseek.com/responses');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer synthetic-deepseek-key');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ model: 'deepseek-flash', input: input.user, instructions: input.system, reasoning: { effort: 'none' }, max_output_tokens: 5000, stream: false, text: { format: { type: 'json_schema', name: input.schemaName, strict: true, schema: input.jsonSchema } } });
    for (const field of ['response_format', 'reasoning_effort', 'enable_thinking', 'store', 'previous_response_id', 'metadata', 'tools']) expect(body).not.toHaveProperty(field);
    expect(JSON.stringify(configuration())).not.toContain('synthetic-deepseek-key');
    expect(configuration().configured.deepseek).toBe(true);
  });
  test('an explicit supported endpoint path and model keep their own served attribution', async () => {
    select(); vi.stubEnv('DEEPSEEK_BASE_URL', 'https://api.deepseek.com/v1'); vi.stubEnv('DEEPSEEK_MODEL', 'deepseek-v4-pro');
    fetchMock.mockResolvedValue(response({ model: 'deepseek-v4-pro-served' }));
    expect((await requestModelJson({ ...input, maxOutputTokens: 1300 })).model).toBe('deepseek-v4-pro-served');
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.deepseek.com/v1/responses');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ model: 'deepseek-v4-pro', max_output_tokens: 1300, reasoning: { effort: 'none' } });
  });
  test.each(['http://api.deepseek.com', 'https://user:secret@api.deepseek.com', 'https://api.deepseek.com?key=value', 'https://another-service.example/v1', 'https://api.deepseek.com/beta', 'https://api.deepseek.com:8443'])('rejects unapproved endpoint %s before any key is sent', async endpoint => {
    select(); vi.stubEnv('DEEPSEEK_BASE_URL', endpoint);
    await expect(requestModelJson(input)).rejects.toMatchObject({ code: 'AI_CONFIGURATION_INVALID' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  test.each([
    [{ model: '' }, 'AI_INCOMPLETE'],
    [{ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }, 'AI_INCOMPLETE'],
    [{ status: 'failed', error: { message: 'private-provider-detail' } }, 'AI_INCOMPLETE'],
    [{ output: [] }, 'AI_INCOMPLETE'],
    [{ status: 'incomplete', incomplete_details: { reason: 'content_filter' } }, 'AI_REFUSED'],
    [{ output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'private-refusal' }] }] }, 'AI_REFUSED'],
  ])('does not accept incomplete or refused structured output %#', async (overrides, code) => {
    select(); fetchMock.mockResolvedValue(response(overrides));
    await expect(requestModelJson(input)).rejects.toMatchObject({ code });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  test.each([[402, 'AI_BALANCE_INSUFFICIENT'], [429, 'AI_RATE_LIMITED'], [401, 'AI_AUTH_FAILED'], [400, 'AI_MODEL_CONFIGURATION'], [500, 'AI_UNAVAILABLE']])('fails once on HTTP %i without a hidden provider fallback', async (status, code) => {
    select(); fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: 'private-provider-detail', type: 'diagnostic' } }), { status: Number(status), headers: { 'content-type': 'application/json' } }));
    await expect(requestModelJson(input)).rejects.toMatchObject({ code });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  test('propagates caller cancellation through the SDK instead of holding a request after its deadline', async () => {
    select(); const controller = new AbortController();
    fetchMock.mockImplementation((_url, init) => new Promise((_resolve, reject) => { init.signal.addEventListener('abort', () => reject(new DOMException('Synthetic abort', 'AbortError')), { once: true }); }));
    const running = requestModelJson({ ...input, timeoutMs: 2500, signal: controller.signal });
    const rejected = expect(running).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    controller.abort(); await rejected;
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function completion(overrides: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ id: 'synthetic', object: 'chat.completion', model: 'qwen3.8-max-0902-served', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{"ok":true}' } }], ...overrides }), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('model provider boundary', () => {
  test('selected Bailian key enables capability without requiring an OpenAI key', () => {
    vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('DATABASE_URL', '');
    expect(configuration()).toMatchObject({ naturalLanguage: true, model: { provider: 'bailian', name: 'qwen3.8-max-0902' }, configured: { openai: false, bailian: true, model: true } });
    expect(JSON.stringify(modelConfiguration())).not.toContain('test-placeholder-key');
  });
  test('unknown provider fails closed even when a key exists', async () => {
    vi.stubEnv('MODEL_PROVIDER', 'typo');
    expect(modelConfiguration().configured).toBe(false);
    await expect(requestModelJson(input)).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  test('Bailian sends strict Chat schema and its documented thinking parameter, returning served model identity', async () => {
    fetchMock.mockResolvedValue(completion());
    expect(await requestModelJson(input)).toEqual({ text: '{"ok":true}', model: 'qwen3.8-max-0902-served', provider: 'bailian' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ model: 'qwen3.8-max-0902', reasoning_effort: 'none', stream: false, response_format: { type: 'json_schema', json_schema: { strict: true, schema: input.jsonSchema } } });
    expect(body).not.toHaveProperty('reasoning'); expect(body).not.toHaveProperty('store'); expect(body).not.toHaveProperty('enable_thinking');
  });
  test('Qwen 3.7 uses the top-level extension, not an extra_body envelope', async () => {
    vi.stubEnv('BAILIAN_MODEL', 'qwen3.7-plus-2026-05-26'); fetchMock.mockResolvedValue(completion());
    await requestModelJson(input); const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.enable_thinking).toBe(false); expect(body).not.toHaveProperty('extra_body'); expect(body).not.toHaveProperty('reasoning_effort');
  });
  test('Qwen 3.8 action interpretation defaults low and accepts a server-only none experiment', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(completion()));
    await requestModelJson({ ...input, purpose: 'interpretation' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).reasoning_effort).toBe('low');
    await requestModelJson({ ...input, purpose: 'interpretation', bailianReasoning: 'none' });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).reasoning_effort).toBe('none');
  });
  test('missing served identity cannot be relabeled as the requested snapshot', async () => {
    fetchMock.mockResolvedValue(completion({ model: '' }));
    await expect(requestModelJson(input)).rejects.toMatchObject({ code: 'AI_INCOMPLETE' });
  });
  test.each(['length', 'content_filter', 'tool_calls'])('does not consume partial, refused or tool output (%s)', async reason => {
    fetchMock.mockResolvedValue(completion({ choices: [{ finish_reason: reason, message: { content: '{"ok":true}' } }] }));
    await expect(requestModelJson(input)).rejects.toMatchObject({ code: reason === 'content_filter' ? 'AI_REFUSED' : 'AI_INCOMPLETE' });
  });
  test('refusal is rejected even when the completion ends normally', async () => {
    fetchMock.mockResolvedValue(completion({ choices: [{ finish_reason: 'stop', message: { content: '', refusal: 'cannot comply' } }] }));
    await expect(requestModelJson(input)).rejects.toMatchObject({ code: 'AI_REFUSED' });
  });
  test.each([[429, 'AI_RATE_LIMITED'], [401, 'AI_AUTH_FAILED'], [403, 'AI_AUTH_FAILED'], [400, 'AI_MODEL_CONFIGURATION'], [404, 'AI_MODEL_CONFIGURATION'], [500, 'AI_UNAVAILABLE']])('maps HTTP %i without returning provider error detail or retrying billing', async (status, code) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: 'provider-specific sensitive diagnostic', type: 'invalid_request_error' } }), { status: Number(status), headers: { 'content-type': 'application/json' } }));
    await expect(requestModelJson(input)).rejects.toMatchObject({ code }); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  test('provider switching is explicit and retains Responses semantics for OpenAI', async () => {
    vi.stubEnv('MODEL_PROVIDER', 'openai'); vi.stubEnv('OPENAI_API_KEY', 'test-openai-key'); vi.stubEnv('OPENAI_MODEL', 'gpt-6-astra');
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'synthetic-response', model: 'gpt-6-astra-snapshot', status: 'completed', output_text: '{"ok":true}', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"ok":true}', annotations: [] }] }] }), { headers: { 'content-type': 'application/json' } }));
    const result = await requestModelJson({ ...input, purpose: 'reflection' });
    expect(result.provider).toBe('openai'); expect(result.model).toBe('gpt-6-astra-snapshot');
    const [url, init] = fetchMock.mock.calls[0]; expect(String(url)).toBe('https://api.openai.com/v1/responses');
    expect(JSON.parse(init.body)).toMatchObject({ reasoning: { effort: 'medium' }, store: false });
  });
  test.each(['http://example.test/v1', 'https://user:password@example.test/v1', 'https://example.test/v1?key=wrong'])('invalid endpoint cannot receive a key (%s)', async endpoint => {
    vi.stubEnv('BAILIAN_BASE_URL', endpoint); await expect(requestModelJson(input)).rejects.toMatchObject({ code: 'AI_CONFIGURATION_INVALID' }); expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('server-owned custom model routing', () => {
  function deepseekResponse() {
    return new Response(JSON.stringify({ id: 'synthetic-custom', object: 'response', model: 'deepseek-flash-served', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"ok":true}', annotations: [] }] }] }), { headers: { 'content-type': 'application/json' } });
  }
  test('custom overrides use their provider model while default and fixed requests retain Bailian', async () => {
    vi.stubEnv('CUSTOM_MODEL_PROVIDER', ' deepseek '); vi.stubEnv('DEEPSEEK_API_KEY', 'synthetic-custom-key'); vi.stubEnv('DEEPSEEK_MODEL', 'deepseek-flash');
    expect(modelConfiguration()).toEqual({ provider: 'bailian', model: 'qwen3.8-max-0902', configured: true });
    expect(modelConfiguration('custom')).toEqual({ provider: 'deepseek', model: 'deepseek-flash', configured: true });
    fetchMock.mockImplementation((url: string) => Promise.resolve(String(url).includes('api.deepseek.com') ? deepseekResponse() : completion()));
    const [fixed, custom] = await Promise.all([
      requestModelJson({ ...input, purpose: 'interpretation' }),
      requestModelJson({ ...input, scope: 'custom', purpose: 'interpretation' }),
    ]);
    expect(fixed.provider).toBe('bailian'); expect(custom.provider).toBe('deepseek');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const calls = fetchMock.mock.calls.map(([url, init]) => ({ url: String(url), auth: new Headers(init.headers).get('authorization'), body: JSON.parse(init.body) }));
    expect(calls.find(call => call.url.includes('dashscope.aliyuncs.com'))).toMatchObject({ auth: 'Bearer test-placeholder-key', body: { model: 'qwen3.8-max-0902', reasoning_effort: 'low' } });
    expect(calls.find(call => call.url === 'https://api.deepseek.com/responses')).toMatchObject({ auth: 'Bearer synthetic-custom-key', body: { model: 'deepseek-flash', reasoning: { effort: 'none' }, text: { format: { strict: true, schema: input.jsonSchema } } } });
    expect(calls.every(call => !Object.hasOwn(call.body, 'scope'))).toBe(true);
    expect(process.env.MODEL_PROVIDER).toBe('bailian'); expect(process.env.CUSTOM_MODEL_PROVIDER).toBe(' deepseek ');
  });
  test.each([undefined, '', '   '])('an absent or empty custom override inherits the configured provider (%s)', async customProvider => {
    vi.stubEnv('CUSTOM_MODEL_PROVIDER', customProvider); vi.stubEnv('MODEL_PROVIDER', 'deepseek'); vi.stubEnv('DEEPSEEK_API_KEY', 'synthetic-custom-key');
    expect(modelConfiguration('custom')).toEqual(modelConfiguration());
    fetchMock.mockResolvedValue(deepseekResponse());
    await expect(requestModelJson({ ...input, scope: 'custom' })).resolves.toMatchObject({ provider: 'deepseek' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.deepseek.com/responses');
  });
  test('an unconfigured default retains the legacy Bailian selection for both scopes', () => {
    vi.stubEnv('MODEL_PROVIDER', undefined); vi.stubEnv('CUSTOM_MODEL_PROVIDER', undefined); vi.stubEnv('DASHSCOPE_API_KEY', undefined);
    expect(modelConfiguration()).toEqual({ provider: 'bailian', model: 'qwen3.8-max-0902', configured: false });
    expect(modelConfiguration('custom')).toEqual(modelConfiguration());
  });
  test('a configured default key cannot substitute for the selected custom provider key', async () => {
    vi.stubEnv('CUSTOM_MODEL_PROVIDER', 'deepseek');
    expect(modelConfiguration().configured).toBe(true); expect(modelConfiguration('custom').configured).toBe(false);
    await expect(requestModelJson({ ...input, scope: 'custom' })).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  test('an independent custom key does not enable a missing default key', async () => {
    vi.stubEnv('CUSTOM_MODEL_PROVIDER', 'deepseek'); vi.stubEnv('DEEPSEEK_API_KEY', 'synthetic-custom-key'); vi.stubEnv('DASHSCOPE_API_KEY', '');
    expect(modelConfiguration('custom').configured).toBe(true); expect(modelConfiguration().configured).toBe(false);
    await expect(requestModelJson(input)).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  test('an invalid nonempty custom provider fails closed without disabling the valid default', async () => {
    vi.stubEnv('CUSTOM_MODEL_PROVIDER', 'deepsseek'); vi.stubEnv('DEEPSEEK_API_KEY', 'synthetic-custom-key');
    expect(modelConfiguration('custom')).toMatchObject({ provider: null, configured: false });
    expect(modelConfiguration().configured).toBe(true);
    await expect(requestModelJson({ ...input, scope: 'custom' })).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  test('a valid custom override works independently of an invalid default provider', async () => {
    vi.stubEnv('MODEL_PROVIDER', 'unconfigured-typo'); vi.stubEnv('CUSTOM_MODEL_PROVIDER', 'deepseek'); vi.stubEnv('DEEPSEEK_API_KEY', 'synthetic-custom-key');
    expect(modelConfiguration().configured).toBe(false); expect(modelConfiguration('custom').configured).toBe(true);
    fetchMock.mockResolvedValue(deepseekResponse());
    await expect(requestModelJson({ ...input, scope: 'custom' })).resolves.toMatchObject({ provider: 'deepseek' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  test('an invalid runtime scope cannot silently select the default provider', async () => {
    const invalidScope = 'player-selected-route' as 'custom';
    expect(modelConfiguration(invalidScope)).toMatchObject({ provider: null, configured: false });
    await expect(requestModelJson({ ...input, scope: invalidScope })).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  test('a custom provider failure does not send a second request to the configured default', async () => {
    vi.stubEnv('CUSTOM_MODEL_PROVIDER', 'deepseek'); vi.stubEnv('DEEPSEEK_API_KEY', 'synthetic-custom-key');
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: 'synthetic provider failure' } }), { status: 500, headers: { 'content-type': 'application/json' } }));
    await expect(requestModelJson({ ...input, scope: 'custom' })).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.deepseek.com/responses');
    expect(process.env.MODEL_PROVIDER).toBe('bailian');
  });
});
