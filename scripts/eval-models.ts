import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import cases from '../tests/fixtures/language-cases.json';
import { initialState, transition } from '../src/domain/engine';
import { decodeInterpretation, INTERPRETER_INSTRUCTIONS, requestInterpretation } from '../src/server/interpreter';
import { compactInterpretationFormat } from '../src/server/interpreter-format';
import { modelConfiguration } from '../src/server/model-provider';
import type { Command, Interpretation, ScenarioId } from '../src/domain/types';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
type Expectation = {
  types?: string[]; forbidden?: string[]; taskIds?: string[]; acknowledgements?: string[];
  materialId?: string; steps?: string[]; step?: string; order?: string[];
  requestReschedule?: boolean; conditional?: boolean; unchangedAgreement?: boolean;
};
const split = process.argv.find(value => value.startsWith('--split='))?.split('=')[1] ?? 'development';
if (!['development', 'holdout', 'all'].includes(split)) throw new Error('split must be development, holdout or all');
const repeats = Number(process.argv.find(value => value.startsWith('--repeats='))?.split('=')[1] ?? 1);
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 5) throw new Error('repeats must be 1..5');
const concurrency = Number(process.argv.find(value => value.startsWith('--concurrency='))?.split('=')[1] ?? 1);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 3) throw new Error('concurrency must be 1..3');
const reasoningOverride = process.argv.find(value => value.startsWith('--bailian-reasoning='))?.split('=')[1];
if (reasoningOverride && !['none', 'low'].includes(reasoningOverride)) throw new Error('Bailian reasoning override must be none or low');
const onlyIds = process.argv.find(value => value.startsWith('--ids='))?.split('=')[1].split(',') ?? [];
if (onlyIds.length && split !== 'development') throw new Error('Individual selection is permitted only for development, never holdout');
const selected = cases.filter(item => (split === 'all' || item.split === split) && (!onlyIds.length || onlyIds.includes(item.id)));
if (!selected.length || onlyIds.some(id => !selected.some(item => item.id === id))) throw new Error('Unknown development case ID');
const directory = path.resolve('.local/evals');
await mkdir(directory, { recursive: true });
const runId = new Date().toISOString().replaceAll(/[:.]/g, '-');
const runDirectory = path.join(directory, runId);
await mkdir(runDirectory, { recursive: true });
const validationSha256 = createHash('sha256').update(readFileSync('src/server/validation.ts')).digest('hex');
console.log(JSON.stringify({ runId, split, cases: selected.length, concurrency, gracefulStopFile: path.join(runDirectory, 'STOP') }));
const model = modelConfiguration();
if (!model.configured) {
  const result = { status: 'not_run', reason: 'Selected model provider is not configured', model: model.model, provider: model.provider, split, cases: selected.length, liveCalls: 0, matched: null, p95Ms: null };
  await writeFile(path.join(directory, `language-${split}.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  process.exit(2);
}
function sameMembers(actual: string[], expected: string[]) {
  return actual.length === expected.length && actual.every(value => expected.includes(value));
}
function matches(result: Interpretation, expected: Expectation) {
  const commands = result.commands;
  const types = [...commands.map(command => command.type), ...(result.clarification ? ['clarify'] : [])];
  const issues: string[] = [];
  if (expected.types && !expected.types.some(type => types.includes(type))) issues.push('missing expected intent');
  if (expected.forbidden?.some(type => types.includes(type))) issues.push('forbidden intent');
  if (expected.taskIds && !commands.some(command => command.type === 'propose' && sameMembers(command.taskIds, expected.taskIds!))) issues.push('wrong task selection');
  if (expected.acknowledgements && !commands.some(command => command.type === 'propose' && expected.acknowledgements!.every(item => command.acknowledgements?.includes(item)))) issues.push('missing explicit tradeoff');
  if (expected.materialId && !commands.some(command => command.type === 'inspect' && command.materialId === expected.materialId)) issues.push('wrong material');
  if (expected.steps && !commands.some(command => command.type === 'transfer_plan' && JSON.stringify(command.steps) === JSON.stringify(expected.steps))) issues.push('wrong planned sequence');
  if (expected.step && !commands.some(command => command.type === 'transfer_execute' && command.step === expected.step)) issues.push('wrong executed step');
  if (expected.order && !commands.some(command => command.type === 'workplace_propose' && JSON.stringify(command.order) === JSON.stringify(expected.order) && command.requestReschedule === expected.requestReschedule)) issues.push('wrong workplace proposal');
  if (expected.conditional && commands.some(command => command.type === 'propose' && !command.conditions?.length)) issues.push('condition erased');
  return issues;
}
const results: { id: string; repeat: number; matched: boolean; critical: boolean; durationMs: number; issues: string[]; returnedModel?: string; wireOutput?: string; validatedModelInterpretation?: Interpretation; groundingApplied: boolean; ungroundedIssues?: string[]; interpretation?: Interpretation }[] = [];
const recurringFailures: Record<string, number> = {};
let stoppedReason: string | null = null;
const jobs = selected.flatMap(item => Array.from({ length: item.critical ? repeats : 1 }, (_, index) => ({ item, repeat: index + 1 })));
let nextJob = 0;
let saveProgress = Promise.resolve();
async function worker() {
  while (nextJob < jobs.length && !stoppedReason) {
    const { item, repeat } = jobs[nextJob++];
    let state = initialState(item.scenario as ScenarioId);
    for (const command of item.setup) state = transition(state, command as Command).state;
    const before = JSON.stringify(state.agreement);
    const started = performance.now();
    let issues: string[] = [];
    let observed: Interpretation | undefined;
    let returnedModel: string | undefined;
    let wireOutput: string | undefined;
    let validatedModelInterpretation: Interpretation | undefined;
    let ungroundedIssues: string[] | undefined;
    let groundingApplied = false;
    try {
      const response = await requestInterpretation(item.text, state, [], reasoningOverride ? { bailianReasoning: reasoningOverride as 'none' | 'low' } : undefined);
      returnedModel = response.model;
      wireOutput = response.text;
      validatedModelInterpretation = decodeInterpretation(response.text, item.text, { groundLimitedScope: false });
      ungroundedIssues = matches(validatedModelInterpretation, item.expected as Expectation);
      const result = decodeInterpretation(response.text, item.text);
      groundingApplied = JSON.stringify(validatedModelInterpretation) !== JSON.stringify(result);
      observed = result;
      issues = matches(result, item.expected as Expectation);
      // Match the server's all-or-nothing ambiguity guard, not just the parser.
      if (!result.clarification?.trim() && !result.commands.some(command => command.type === 'clarify')) {
        for (const command of result.commands) state = transition(state, command).state;
      }
      if ((item.expected as Expectation).unchangedAgreement && JSON.stringify(state.agreement) !== before) issues.push('unexpected agreement mutation');
    } catch (error) {
      issues = [typeof error === 'object' && error && 'code' in error ? String(error.code) : 'interpretation failed'];
    }
    const row = { id: item.id, repeat, matched: issues.length === 0, critical: item.critical, durationMs: Math.round(performance.now() - started), issues, returnedModel, wireOutput, validatedModelInterpretation, groundingApplied, ungroundedIssues, interpretation: observed };
    results.push(row);
    console.log(JSON.stringify({ ...row, wireOutput: undefined, validatedModelInterpretation: undefined, interpretation: undefined }));
    // Serialize progress writes even when independent synthetic cases overlap.
    const snapshot = JSON.stringify(results, null, 2);
    saveProgress = saveProgress.then(async () => {
      await writeFile(path.join(directory, `language-${split}.progress.json`), snapshot);
      await writeFile(path.join(runDirectory, `language-${split}.progress.json`), snapshot);
    });
    await saveProgress;
    if (existsSync(path.join(runDirectory, 'STOP'))) { stoppedReason = 'Stop requested; no new calls will start, already in-flight calls are retained'; return; }
    for (const code of issues.filter(issue => /^AI_(?:INVALID_OUTPUT|INCOMPLETE|RATE_LIMITED|UNAVAILABLE|TIMEOUT|AUTH_FAILED|MODEL_CONFIGURATION|CONFIGURATION_INVALID|NOT_CONFIGURED)$/.test(issue))) {
      recurringFailures[code] = (recurringFailures[code] ?? 0) + 1;
      if (code === 'AI_AUTH_FAILED' || recurringFailures[code] > 3) { stoppedReason = `${code}: stopped before further live calls; already in-flight calls retained`; return; }
    }
  }
}
const workers = await Promise.allSettled(Array.from({ length: concurrency }, () => worker()));
for (const result of workers) if (result.status === 'rejected') throw result.reason;
results.sort((a, b) => selected.findIndex(item => item.id === a.id) - selected.findIndex(item => item.id === b.id) || a.repeat - b.repeat);
const sorted = results.map(item => item.durationMs).sort((a, b) => a - b);
const matched = results.filter(item => item.matched).length;
const report = {
  status: stoppedReason ? 'stopped' : 'executed', stoppedReason, runId, timestamp: new Date().toISOString(), requestedModel: model.model, returnedModels: [...new Set(results.flatMap(item => item.returnedModel ? [item.returnedModel] : []))], provider: model.provider, split,
  interpreterSha256: createHash('sha256').update(INTERPRETER_INSTRUCTIONS).digest('hex'), schemaSha256: createHash('sha256').update(JSON.stringify(['campus', 'transfer', 'workplace'].map(scenario => compactInterpretationFormat(scenario as ScenarioId)))).digest('hex'), validationSha256, reasoning: model.provider === 'bailian' && /^qwen3\.8(?:-|$)/.test(model.model) ? reasoningOverride || 'low' : model.provider === 'openai' ? 'low' : 'disabled',
  cases: selected.length, selectedIds: selected.map(item => item.id), concurrency, liveCalls: results.length, matched, matchRate: matched / results.length,
  groundingAppliedCases: results.filter(item => item.groundingApplied).map(item => item.id), ungroundedMatched: results.filter(item => item.ungroundedIssues?.length === 0).length,
  criticalFailures: results.filter(item => item.critical && !item.matched).map(item => item.id),
  p50Ms: sorted[Math.ceil(sorted.length * .5) - 1], p95Ms: sorted[Math.ceil(sorted.length * .95) - 1], results,
  limitation: 'Automated intent and state rubric only; needs human review of meaning. Latency measures interpretation, not a full UI turn.',
};
await writeFile(path.join(directory, `language-${split}.json`), JSON.stringify(report, null, 2));
await writeFile(path.join(runDirectory, `language-${split}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, results: undefined }));
process.exitCode = !stoppedReason && report.matchRate >= .95 && report.criticalFailures.length === 0 ? 0 : 1;
