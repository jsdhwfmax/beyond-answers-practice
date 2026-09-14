import type { SourceCard } from '@/domain/types';

export const SOURCE_VERSION = 'zhihu-excerpts-2026-09-13-v1';
export const SOURCES: SourceCard[] = [
  {
    id: '1393937473601368064', author: '王明伟', title: '明确目标：运用「四大原则」目标更有影响力！',
    excerpt: '原则 1：要聚焦，设定一个共同目标。\n原则 2：要具体，有明确的量化要求。',
    interpretation: '在承诺一个新功能之前，把要解决的问题和这次交付的边界说具体。大家同意的目标，才是接下来取舍的依据。',
    conditions: '这是团队针对已取得片段的归纳。若目的与验收已经明确，就应推进安排，不必机械地重新讨论目标。',
    application: '校园情境中的人物、工时、已有组件和安排均为团队原创模拟设定；引用经验不等于作者认可某个模拟结局。',
    retrievedAt: '2026-09-13', truncated: true,
    sourceUrl: 'https://api.zhihu.com/km-indep-home/hackathon/v2/knowledge/1393937473601368064',
  },
  {
    id: '1523701957479239680', author: '刀熊说说', title: '实现大目标：依靠「小胜」 和「闭合任务回路」',
    excerpt: '所谓闭合任务回路，就是创造一种「完结感」，一种通过自己的某个行动导致某个事物状态达成完结的闭合感。',
    interpretation: '把下一步缩成一个能完成、能检查的行动。写下计划之后，还需要实际执行，并查看结果是否满足完成条件。',
    conditions: '团队仅采用片段中关于具体行动与完成条件的实践启发，不把其中的心理或健康归因当作已验证事实。模拟练习不能代替现实行动。',
    application: '社团招新短练习要求完成模拟发布并核对模拟提交记录；这里只能证明本次模拟发生了什么。',
    retrievedAt: '2026-09-13', truncated: true,
    sourceUrl: 'https://api.zhihu.com/km-indep-home/hackathon/v2/knowledge/1523701957479239680',
  },
];
