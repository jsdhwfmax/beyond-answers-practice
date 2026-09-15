import { describe, expect, it } from 'vitest';
import archived from './campus-corpus-data.json';
import { CAMPUS_CORPUS, CAMPUS_CORPUS_VERSION, type CampusCorpusQuestion } from './campus-corpus';
import { isPreviousAutomaticScenarioDraft, reviseCampusScenarioSeed } from './campus-scenario-seeds';
import { matchCampusSources } from '@/server/campus-library';
import { getProfileQuestion } from '@/server/campus-profile-library';

const corrected = ['2059626138549350826', '28180008', '535483677', '371545287', '519087887'];

describe('research and postgraduate question scenario alignment', () => {
  it('keeps research-adviser relationships and exam contact contexts with their selected questions', () => {
    const seeds = corrected.map(id => CAMPUS_CORPUS.find(q => q.questionId === id)!.scenarioSeed);
    expect(seeds[0].userRole).toContain('研究生');
    expect(seeds[0].counterpartRole).toBe('导师');
    expect(seeds[0].situation).toContain('研究方案');
    expect(seeds[1].counterpartRole).toBe('导师');
    expect(seeds[1].situation).toContain('研究');
    expect(seeds[2].situation).toContain('导师权力');
    for (const seed of seeds.slice(3)) {
      expect(seed.userRole).toContain('复试');
      expect(seed.counterpartRole).toBe('意向导师');
      expect(seed.situation).toContain('邮件');
    }
    for (const seed of seeds) expect(JSON.stringify(seed)).not.toMatch(/小组作业|组长|课程项目|课后当面/);
  });

  it('changes only the five reviewed simulations, preserving all acquired sources and the raw archive', () => {
    const before = JSON.stringify(archived);
    const revised = (archived as CampusCorpusQuestion[]).map(reviseCampusScenarioSeed);
    expect(revised.filter((q, i) => q !== archived[i]).map(q => q.questionId)).toEqual(corrected);
    expect(JSON.stringify(archived)).toBe(before);
    for (let i = 0; i < revised.length; i++) {
      expect({ ...revised[i], scenarioSeed: archived[i].scenarioSeed }).toEqual(archived[i]);
    }
  });

  it.each(corrected)('recognizes both historical automatic templates only for their own question: %s', id => {
    const old = archived.find(q => q.questionId === id)!;
    const s = old.scenarioSeed;
    const formats = [
      `我扮演${s.userRole}，想和${s.counterpartRole}聊一聊。${s.situation}\n这次我希望：${s.goal}`,
      `我是${s.userRole}，想和${s.counterpartRole}聊聊。${s.situation}我希望${s.goal}`,
    ];
    for (const draft of formats) {
      expect(isPreviousAutomaticScenarioDraft(old.id, draft)).toBe(true);
      expect(isPreviousAutomaticScenarioDraft(old.id, `${draft}我想自己修改。`)).toBe(false);
      expect(isPreviousAutomaticScenarioDraft('unrelated-question', draft)).toBe(false);
    }
  });

  it('creates current independent snapshots in both entry paths without rewriting an existing snapshot', () => {
    const old = structuredClone(archived.find(q => q.questionId === corrected[0])!);
    const oldSnapshot = { version: 'zhihu-campus-2026-09-14-v2', questions: [old] };
    const before = JSON.stringify(oldSnapshot);
    const current = matchCampusSources('想了解导师怎样指导科研', old.id);
    expect(current.version).toBe(CAMPUS_CORPUS_VERSION);
    expect(current.questions[0].scenarioSeed.counterpartRole).toBe('导师');
    expect(getProfileQuestion(old.id)).toEqual(current.questions[0]);
    current.questions[0].scenarioSeed.goal = '用户自己的新目标';
    expect(getProfileQuestion(old.id)!.scenarioSeed.goal).not.toBe('用户自己的新目标');
    expect(JSON.stringify(oldSnapshot)).toBe(before);
    expect(oldSnapshot.questions[0].scenarioSeed.counterpartRole).toBe('组长');
  });
});
