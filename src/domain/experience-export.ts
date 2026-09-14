import { ACTORS, SCENARIOS } from './scenarios';
import type { ExperienceReport, SessionView } from './types';

export function formatExperienceText(session: SessionView, report: ExperienceReport, reflection = ''): string {
  const section = (title: string, values: string[]) => [title, ...(values.length ? values.map(value => `• ${value}`) : ['尚未记录。'])].join('\n');
  return ['答案之外｜我的经验练习记录', SCENARIOS[session.state.scenario].title, report.title, `当前状态：${report.status}`,
    section('留下的安排', report.scope), section('这次接受的取舍', report.tradeoffs), section('仍需确认的事', report.unknowns),
    section('原话与变化依据', report.evidence.map(value => `“${value.quote}”\n${value.result}`)),
    '实际行动与模拟回应', ...session.events.map(event => `${event.actor === 'user' ? '我' : event.actor === 'system' ? '练习记录' : ACTORS[event.actor]?.name ?? event.actor}：${event.text}`),
    `可以带走的下一步\n${report.nextStep}`, `现实中准备尝试的一步（本人自述）\n${reflection.trim() || '尚未填写。'}`,
    `场景版本：${session.state.scenarioVersion}\n来源版本：${session.state.sourceVersion}`,
    '这是模拟记录，不表示现实工作已经完成，也不证明现实协作能力已经提升。'].join('\n\n');
}
