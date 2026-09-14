import type { ActorId, ScenarioId, Task, TaskId } from './types';

export const SCENARIO_VERSION = 'campus-2026-09-13-v1';
export { SOURCE_VERSION } from '../content/sources';
export const TASKS: Record<TaskId, Task> = {
  B1: { id: 'B1', title: '核对 12 条指南内容', actor: 'lin', minutes: 60, dependencies: [], group: 'base' },
  B2: { id: 'B2', title: '完成基础可读界面', actor: 'xu', minutes: 60, dependencies: [], group: 'base' },
  B3: { id: 'B3', title: '修复现有路由', actor: 'zhou', minutes: 60, dependencies: [], group: 'base' },
  B4: { id: 'B4', title: '基础版集成与验收', actor: 'zhou', minutes: 60, dependencies: ['B1', 'B2', 'B3'], group: 'base' },
  V1: { id: 'V1', title: '整理精修文案', actor: 'lin', minutes: 60, dependencies: ['B1'], group: 'visual' },
  V2: { id: 'V2', title: '完成精细版式', actor: 'xu', minutes: 60, dependencies: ['B2'], group: 'visual' },
  V3: { id: 'V3', title: '合并视觉精修', actor: 'xu', minutes: 60, dependencies: ['V1', 'V2'], group: 'visual' },
  G: { id: 'G', title: '接入三个静态引导入口', actor: 'zhou', minutes: 60, dependencies: ['B4'], group: 'guide' },
  Q1: { id: 'Q1', title: '准备问答内容与测试集', actor: 'lin', minutes: 60, dependencies: ['B1'], group: 'qa' },
  Q2: { id: 'Q2', title: '配置问答界面与状态', actor: 'xu', minutes: 120, dependencies: ['B2'], group: 'qa' },
  Q3: { id: 'Q3', title: '接入并验收限定范围问答', actor: 'zhou', minutes: 60, dependencies: ['B4', 'Q1', 'Q2'], group: 'qa' },
};

export interface ActorProfile {
  id: ActorId; name: string; role: string; description: string;
  windows: { start: number; end: number }[]; color: string;
}
export const ACTORS: Record<ActorId, ActorProfile> = {
  lin: { id: 'lin', name: '林澄', role: '内容与使用体验', description: '核对内容、整理文案和测试问题，不负责代码。', windows: [{ start: 1080, end: 1200 }], color: '#688b79' },
  xu: { id: 'xu', name: '许念', role: '视觉与界面', description: '配置样式和现成组件界面，不开发服务端。', windows: [{ start: 1080, end: 1260 }], color: '#aa7b6b' },
  zhou: { id: 'zhou', name: '周衡', role: '开发与集成', description: '修复、接入、验收与发布；20:00–21:00 有不可挪动的安排。', windows: [{ start: 1080, end: 1200 }, { start: 1260, end: 1320 }], color: '#697b99' },
  user: { id: 'user', name: '你', role: '协调者', description: '负责询问、协商与确认，不额外增加今晚的生产人时。', windows: [], color: '#c55f43' },
  manager: { id: 'manager', name: '项目负责人', role: '本次两项工作的负责人', description: '演示摘要 15:00 必须完成；有权将竞品表截止调整到最迟 16:00。', windows: [], color: '#758083' },
  system: { id: 'system', name: '练习记录', role: '记录与核验', description: '只记录这组原创模拟中的事实和行动。', windows: [], color: '#777777' },
};

export interface ScenarioMaterial { id: string; title: string; text: string }
export interface ScenarioDescription {
  id: ScenarioId; title: string; subtitle: string; brief: string; objective: string; materials: ScenarioMaterial[];
}
export const SCENARIOS: Record<ScenarioId, ScenarioDescription> = {
  campus: {
    id: 'campus', title: '最后一晚', subtitle: '校园主篇 · 原创模拟',
    brief: '现在是 18:00。新生校园指南明天展示，今晚 22:00 前要完成版本。原型已能打开，团队已答应基础版和视觉精修。林澄提出再加问答。三人共有 8 人时，交流与读资料不会消耗生产时间。',
    objective: '形成大家实际接受、能排期的交付约定；也可以明确留下尚未解决的问题。',
    materials: [
      { id: 'brief', title: '今晚的任务单', text: '基础 B1–B4 共 4 人时必须保留；视觉精修 V1–V3 共 3 人时已约定但可协商。22:00 为固定截止。所有人物、耗时与结果都是原创模拟设定。' },
      { id: 'members', title: '成员时间与能力', text: '林澄 18–20 共 2 小时；许念 18–21 共 3 小时；周衡 18–20、21–22 共 3 小时。用户负责协调。没有已确认的外援或额外时间。' },
      { id: 'prototype', title: '当前指南原型', text: '页面已经能打开，已有 12 条待最终核对的指南稿。基础版处理内容、可读性、路由和验收；三个静态入口只导航到报到、报修、校园卡正文。' },
      { id: 'feedback', title: '模拟试用反馈', text: '新生说页面看起来不错，但不知道应该先点哪里，有人首先要找报到地点。当前首要目的，是帮助第一次打开页面的人找到三个主要入口；并没有预先规定必须用自由问答。' },
      { id: 'qa-component', title: '问答组件与验收', text: '已有可运行组件。Q1 内容与测试 1 小时、Q2 界面状态 2 小时、Q3 接入验收 1 小时，共 4 人时。范围仅为现有 12 条指南，回答显示出处，范围外提示不知道；不是从零开发开放域 AI。' },
    ],
  },
  transfer: {
    id: 'transfer', title: '今晚先完成什么', subtitle: '校园独立短练习 · 原创模拟',
    brief: '20:00，你有 30 分钟。招新页面的模板、文案和模拟测试数据齐备。目标与验收已明确：发布可用预览，并运行一次模拟提交、核对记录。',
    objective: '把一个小结果推进到可验证完成。先写自己的计划，再执行模拟操作。',
    materials: [{ id: 'transfer-brief', title: '目标与验收', text: '发布预览 publish 需 15 分钟；核对模拟提交 verify 需 10 分钟，必须在发布后；补充视觉参考 references 需 20 分钟，不能替代发布和核对。全程模拟，不创建真实报名或收集个人信息。' }],
  },
  workplace: {
    id: 'workplace', title: '下一站：入职第一周', subtitle: '职场篇 · 互动预告',
    brief: '13:00，你可以工作到 16:00。已答应 15:00 交竞品表，还需 1 小时；新增的一页演示摘要需 1.5 小时，15:00 必须完成。两项任务不可同时进行。',
    objective: '说明旧承诺受到的影响，提出可排期的取舍，并取得负责人明确接受。',
    materials: [{ id: 'workplace-brief', title: '两项已明确的任务', text: '摘要包含目标、现状、待决策三项，材料齐备；竞品表的范围也已确定。负责人可将竞品表顺延至最迟 16:00，但无权延后 15:00 的摘要。没有已确认外援。' }],
  },
};

export const ORIGINAL_TASKS: TaskId[] = ['B1', 'B2', 'B3', 'B4', 'V1', 'V2', 'V3'];
export const TRANSFER_STEPS: Record<string, { title: string; minutes: number; dependencies: string[] }> = {
  publish: { title: '发布模拟预览', minutes: 15, dependencies: [] },
  verify: { title: '运行模拟提交并核对记录', minutes: 10, dependencies: ['publish'] },
  references: { title: '补充视觉参考', minutes: 20, dependencies: [] },
};
