import { describe, expect, it } from 'vitest';
import type { CustomBranch } from '@/domain/custom-practice';
import { roleOwnershipIssues } from './custom-role-ownership';

interface OwnershipCase {
  id: string;
  expected: 'block' | 'allow';
  user: string;
  npc: string;
  reply: string;
  facts?: string[];
  assumptions?: string[];
  priorNpc?: string;
  priorUser?: string;
  opening?: string;
  currentUserText?: string;
}

function branchFor(example: OwnershipCase): CustomBranch {
  const createdAt = '2026-09-14T00:00:00.000Z';
  return {
    id: 'role-ownership-branch', label: '角色归属练习', parentId: null,
    accepted: true, finished: false, createdAt,
    setup: {
      title: '角色归属练习', userRole: example.user, counterpartRole: example.npc,
      goal: '沟通当前事项', userFacts: example.facts ?? [], assumptions: example.assumptions ?? [],
      openingLine: example.opening ?? '请把你的想法说说。',
    },
    turns: example.priorNpc || example.priorUser ? [{
      id: 'prior-saved-turn', userText: example.priorUser ?? '你明天有安排吗？',
      reply: example.priorNpc ?? '我听到了。', reflection: '继续沟通当前事项。',
      supportedQuote: example.priorUser ?? '你明天有安排吗？', sourceId: null, createdAt,
    }] : [],
  };
}

// These fixtures distinguish the subject of an assertion; they are not a
// general claim that every NPC statement or every role-play response is valid.
const cases: OwnershipCase[] = [
  { id: '01 带教不能自称刚报到的实习生', expected: 'block', user: '刚报到实习生', npc: '带教老师', reply: '师兄，我是本周刚报到的实习生，麻烦你带我熟悉项目。' },
  { id: '02 面试官不能认领本次求职行为', expected: 'block', user: '应聘者', npc: '本场面试官', reply: '您好，我来应聘贵公司的产品实习生，下面介绍一下我的经历。' },
  { id: '03 导师不能接管学生论文并反向请求宽限', expected: 'block', user: '论文学生', npc: '指导老师', reply: '老师，我的论文还没写完，能再给我一次修改机会吗？' },
  { id: '04 母亲不能把女儿称作妈妈', expected: 'block', user: '女儿', npc: '母亲', reply: '妈，我想休学，你能不能先听完我的理由？' },
  { id: '05 孩子不能自称用户的母亲', expected: 'block', user: '母亲', npc: '孩子', reply: '我是你妈，这次必须听我的。' },
  { id: '06 同辈不能接管已明确的另一方姓名与分工', expected: 'block', user: '负责海报的小林', npc: '负责报名的小周', facts: ['我负责海报'], reply: '我是负责海报的小林，你把报名名单发我。' },
  { id: '07 NPC 不能补写用户未说的接受台词', expected: 'block', user: '尚未同意加班的实习生', npc: '带教', reply: '你回答：好的，我愿意无偿加班。那就这样定了。' },
  { id: '08 老师不能以学生身份向用户保证补作业', expected: 'block', user: '学生', npc: '老师', reply: '我作为学生向您保证会补齐作业，请老师原谅。' },
  { id: '09 引号内的第一人称仍属于被引用者', expected: 'allow', user: '实习生', npc: '带教', reply: '你刚才说“我是本周刚报到的实习生”，那我先带你看项目结构。' },
  { id: '10 否定求职身份不等于自认求职者', expected: 'allow', user: '候选人', npc: '面试官', reply: '我不是来应聘的，我负责这轮面试；请先介绍你最熟悉的项目。' },
  { id: '11 反问中的求职身份不作为肯定自述', expected: 'allow', user: '候选人', npc: '面试官', reply: '难道我是来向你求职的吗？我想了解的是你对岗位的理解。' },
  { id: '12 明确假设自己是实习生不改变当前身份', expected: 'allow', user: '实习生', npc: '带教', reply: '如果我是实习生，我也会先问验收要求。你现在最不清楚哪一步？' },
  { id: '13 以前实习过不等于当前实习生', expected: 'allow', user: '实习生', npc: '带教', reply: '我以前也做过实习生，刚来的时候同样不熟悉流程。' },
  { id: '14 同辈共同准备考研不属于用户专属经历', expected: 'allow', user: '室友', npc: '室友', facts: ['我在准备考研'], assumptions: ['双方都在准备考研'], reply: '我也在准备考研，我们可以一起商量安静时段。' },
  { id: '15 师生共有的组会安排不属于学生专属', expected: 'allow', user: '学生', npc: '老师', assumptions: ['双方明天都参加组会'], reply: '我们明天都要参加组会，我先听你说卡在哪儿。' },
  { id: '16 无引号的间接引述保留原说话人', expected: 'allow', user: '实习生', npc: '带教', reply: '你说你是新来的实习生，我是负责带你的同事。先把卡住的步骤说给我听。' },
  { id: '17 实习生的带教老师的角色中心是老师', expected: 'allow', user: '实习生', npc: '带教老师', reply: '我是实习生的带教老师，这个流程由我负责介绍。' },
  { id: '18 老师的历史论文经历不是当前学生任务', expected: 'allow', user: '学生', npc: '老师', reply: '我当年写论文也很慢，先把你卡住的地方说说。' },
  { id: '19 已接受的双方考试背景允许分别自述', expected: 'allow', user: '室友', npc: '室友', facts: ['我明天要考试'], assumptions: ['双方明天都要考试'], reply: '我明天也要考试，我们早点休息。' },
  { id: '20 已保存的 NPC 同辈事实可作为己方依据', expected: 'allow', user: '室友', npc: '室友', facts: ['我明天要考试'], priorNpc: '我明天也要考试，可以商量一下熄灯时间。', reply: '我明天也要考试，我们早点休息。' },
  { id: '21 前句是否定不能豁免后句身份倒置', expected: 'block', user: '学生', npc: '老师', reply: '我不是来责备你的。我是学生，我需要你给我批作业。' },
  { id: '22 后面的请求问号不能豁免前面的身份肯定', expected: 'block', user: '实习生', npc: '带教', reply: '我是刚来的实习生，你能带我熟悉项目吗？' },
  { id: '23 建议后的论文主语不能继承第一人称', expected: 'allow', user: '学生', npc: '老师', reply: '我建议先列提纲，论文要写清研究问题。' },
  { id: '24 逗号后的学生主语不继承老师第一人称', expected: 'allow', user: '学生', npc: '老师', reply: '我负责这节课，学生明天要上课。' },
  { id: '25 真实反馈原句不能将实习生的工作和学校作业转给带教', expected: 'block', user: '正在上学的实习生', npc: '负责带教的前辈', facts: ['我今晚弄不完，学校那边有作业要交。'], reply: '今晚我确实弄不完，学校那边有作业要交。我明天上班可以先帮你做其中一部分' },
  { id: '26 同辈不能复制另一方独有的到场限制', expected: 'block', user: '社团成员', npc: '社团成员', facts: ['我只能周末到场'], reply: '我只能周末到场，平日先线上沟通。' },
  { id: '27 当前用户原话中的个人限制也有明确归属', expected: 'block', user: '社团成员', npc: '社团成员', currentUserText: '我只能周末到场', reply: '我只能周末到场。' },
  { id: '28 合法引用不能豁免下一句的角色串位', expected: 'block', user: '实习生', npc: '带教老师', reply: '你刚才说“我是实习生”。我是刚入职的实习生，需要你带我熟悉流程。' },
  { id: '29 老师明确自身在读可拥有自己的论文任务', expected: 'allow', user: '本科学生', npc: '仍在读博士的指导老师', reply: '我明天要交论文，今天先听你说卡住的步骤。' },
  { id: '30 已接受开场明确老师的自身学习任务时保留', expected: 'allow', user: '本科学生', npc: '指导老师', opening: '我明天要交论文，今天可以先听你说卡住的步骤。', reply: '我明天要交论文，今天先把你的研究问题讨论清楚。' },
  { id: '31 否定范围里的带教称呼不能覆盖肯定实习生身份', expected: 'block', user: '实习生', npc: '带教', reply: '我只是实习生而不是带教，需要你告诉我怎么做。' },
  { id: '32 引述已保存的用户回答不等于补写用户新台词', expected: 'allow', user: '实习生', npc: '带教', priorUser: '好的，我愿意加班。', reply: '你回答：“好的，我愿意加班。”我听到了。' },
];

describe('自由练习说话人的事实与角色归属', () => {
  it.each(cases)('$id', example => {
    const issues = roleOwnershipIssues(branchFor(example), example.reply, 'counterpart', example.currentUserText ?? '');
    if (example.expected === 'block') expect(issues.length).toBeGreaterThan(0);
    else expect(issues).toEqual([]);
  });

  it('检查不修改设定、用户原话或已保存的双方记录', () => {
    const example = cases.find(item => item.id.startsWith('28 '))!;
    const branch = branchFor(example);
    const before = structuredClone(branch);
    roleOwnershipIssues(branch, example.reply, 'counterpart', '我想问清任务范围。');
    expect(branch).toEqual(before);
  });
});
