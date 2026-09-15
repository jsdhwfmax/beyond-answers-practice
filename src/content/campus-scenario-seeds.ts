import type { CampusCorpusQuestion } from './campus-corpus';

type ScenarioSeed = CampusCorpusQuestion['scenarioSeed'];

/** Reviewed original simulations, not claims about the answer authors' lives.
 * The previous seed is kept only to recognize exact automatic browser drafts.
 */
const revisions: Record<string, { previous: ScenarioSeed; current: ScenarioSeed }> = {
  "zhihu-q-2059626138549350826": {
    "previous": {
      "userRole": "组员",
      "counterpartRole": "组长",
      "situation": "小组作业初稿完成后，组长想直接提交，你认为方案存在漏洞但怕被觉得拖进度。",
      "goal": "向组长提出先用几个问题自查方案漏洞，并请求全组花半小时一起做一次质疑推演后再提交。"
    },
    "current": {
      "userRole": "刚加入科研团队的研究生",
      "counterpartRole": "导师",
      "situation": "你已有一份研究方案初稿，但不清楚哪些问题应先独立验证、哪些需要请导师指导，准备带着自己的推理和疑问讨论。",
      "goal": "说明研究思路与尚未验证的假设，请导师指出需要检验的薄弱处，并商量下一步由自己尝试什么、怎样再获得反馈。"
    }
  },
  "zhihu-q-28180008": {
    "previous": {
      "userRole": "本科生",
      "counterpartRole": "同组同学",
      "situation": "你和同学组队做课程项目，对方同时接了社团部长工作，最近几次讨论都迟到且没完成分工部分。",
      "goal": "向同学明确表达你对项目进度的担忧，请他说明接下来一周能具体完成哪部分任务，并约定下次碰面的交付节点。"
    },
    "current": {
      "userRole": "研究生",
      "counterpartRole": "导师",
      "situation": "你正在了解知名导师如何指导学生。带着自己已有的阶段性研究成果，你准备与导师讨论下一步值得推进的方向，以及如何分配研究精力。",
      "goal": "说明已有工作及其局限，询问导师如何判断下一步研究的价值，并讨论自己接下来需要验证的问题。"
    }
  },
  "zhihu-q-535483677": {
    "previous": {
      "userRole": "本科生",
      "counterpartRole": "同组同学",
      "situation": "小组作业中一位同学持续拖延，你担心他不在乎最终成绩会影响全组分数，需要和他沟通分工调整。",
      "goal": "向对方明确提出将核心部分拆分并由你接手其中一块的请求，获得对方同意重新分配任务的口头确认。"
    },
    "current": {
      "userRole": "考虑加入课题组的学生",
      "counterpartRole": "课题组的在读师姐",
      "situation": "你读到关于导师权力与培养投入的不同看法，想在加入课题组前了解实际指导、反馈方式和遇到分歧时的沟通渠道。",
      "goal": "请师姐结合具体经历介绍导学沟通，区分个人感受与已知情况，整理仍需向导师或学校核实的问题。"
    }
  },
  "zhihu-q-371545287": {
    "previous": {
      "userRole": "本科生",
      "counterpartRole": "专业课教师",
      "situation": "你希望加入该老师的课题组做科研训练，发了一封附简历的邮件后十天未收到回复，现在想在课后当面询问。",
      "goal": "礼貌说明此前已发邮件并表达对该课题的具体兴趣，询问老师是否方便查看或是否有名额，获得明确答复或下一步建议。"
    },
    "current": {
      "userRole": "准备考研复试的考生",
      "counterpartRole": "意向导师",
      "situation": "你准备通过邮件联系意向导师，已开始查阅对方的研究介绍，希望把自己的学习背景、研究兴趣和想了解的事项写清楚。",
      "goal": "练习一封简短的联系邮件，如实说明自己了解的研究方向与学习背景，提出具体问题，并准备未收到回复时的适度后续联系。"
    }
  },
  "zhihu-q-519087887": {
    "previous": {
      "userRole": "本科生",
      "counterpartRole": "专业课教师",
      "situation": "你希望加入老师的课题组做本科科研，但只在课后见过老师几面，没有正式交流过。你想发邮件自我介绍并询问是否有名额，不确定该写什么内容、用什么语气。",
      "goal": "向老师当面确认是否方便通过邮件发送简历和科研意向，并请老师提示邮件中需要包含哪些信息以便评估。"
    },
    "current": {
      "userRole": "准备复试、科研经历较少的考生",
      "counterpartRole": "意向导师",
      "situation": "你的考研初试成绩一般，本科期间也缺少竞赛和科研经历，想通过邮件联系意向导师，但担心自己没有突出的经历可写。",
      "goal": "如实说明已有学习基础和感兴趣的研究方向，不夸大经历，询问还需提供哪些材料、有哪些信息应先核实。"
    }
  }
};

export function reviseCampusScenarioSeed(question: CampusCorpusQuestion): CampusCorpusQuestion {
  const revision = revisions[question.id];
  return revision ? { ...question, scenarioSeed: { ...revision.current } } : question;
}

export function isPreviousAutomaticScenarioDraft(questionId: string, text: string): boolean {
  const seed = revisions[questionId]?.previous;
  if (!seed) return false;
  return text === `我扮演${seed.userRole}，想和${seed.counterpartRole}聊一聊。${seed.situation}\n这次我希望：${seed.goal}`
    || text === `我是${seed.userRole}，想和${seed.counterpartRole}聊聊。${seed.situation}我希望${seed.goal}`;
}
