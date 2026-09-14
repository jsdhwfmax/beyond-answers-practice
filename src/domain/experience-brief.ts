import type { CampusCorpusAnswer, CampusCorpusQuestion } from '@/content/campus-corpus';

export const EXPERIENCE_BRIEF_VERSION = 'experience-brief-2026-09-14-v1';
interface ReviewedExcerpt {
  questionId: string; answerId: string; expectedExcerpt: string; quote: string;
  summary: string; conditions: string; application: string;
}
// These ten excerpts were individually read for this display adapter. This is
// deliberately not a new interpretation of every answer in the source corpus.
const reviews: readonly ReviewedExcerpt[] = [
  {
    questionId: 'zhihu-q-40645474', answerId: '2285426526',
    expectedExcerpt: '要知道的是，学分越高，代表这门课程越重要！\n…\n后来，我与一位已经成功保研的直系学姐促膝长谈，学姐将她三年保持绩点专业第一的秘诀，毫无保留的全盘传授给我。',
    quote: '后来，我与一位已经成功保研的直系学姐促膝长谈，学姐将她三年保持绩点专业第一的秘诀，毫无保留的全盘传授给我。',
    summary: '遇到学习困惑时，可以主动向有相关经历的人请教具体方法。',
    conditions: '片段记录了一次请教经历，没有证明请教一定提分，也没有比较它与延长学习时间的效果。',
    application: '先说明想请教哪门课，再问对方是否方便分享一个方法；让对方有选择交流时间的空间。',
  },
  {
    questionId: 'zhihu-q-462787789', answerId: '1911703815163475843',
    expectedExcerpt: '后来我渐渐明白了，老师只在乎解决问题以推进工作，你干了多少活累不累着，nobody care。\n…\n研三的时候，我已经基本可以掌握组会的节奏了，就是给出方案让老师点评，给他做选择题，让他有种指导学生的快乐，大概就是“老师，这个玩意坏了，跑不了，我测了一些大概是a原因，也可能是b原因，接下来我打算试一下A方法和B办法，A方法需要钱，B方法需要人，课题组这边能否帮忙解决一下？',
    quote: '接下来我打算试一下A方法和B办法，A方法需要钱，B方法需要人，课题组这边能否帮忙解决一下？',
    summary: '汇报卡点时，把可尝试的方案和需要的支持一起说出来，给讨论一个具体着手点。',
    conditions: '适用于已有初步排查或可讨论方案的情况；没有做过的检查、没有把握的原因要如实说明。',
    application: '说清现在卡在哪里、准备先试什么，再请导师确认方向或需要协调的资源。',
  },
  {
    questionId: 'zhihu-q-526149248', answerId: '2457063695',
    expectedExcerpt: '因为实际上找资料的人大部分都是随便在网上百度，看都不看完整，最后我制作PPT的时候想要和找资料的同学讨论时，他们一问三不知。\n…\n把“找资料”换成了“写策划”，写策划可以让他们把自己找到的资料整理集合，并且清楚的展示出PPT结构，减轻了负责PPT的人的需要工作量',
    quote: '把“找资料”换成了“写策划”，写策划可以让他们把自己找到的资料整理集合，并且清楚的展示出PPT结构',
    summary: '分工可以约定一个别人能接着用的成果，而不只分配“找资料”这样的活动。',
    conditions: '先核对组员的能力和时间；这段经历不能证明增加交付要求后，原来的排期仍然可行。',
    application: '请队友一起说清资料要整理成什么样、谁接着使用，再核对这项分工是否做得到。',
  },
  {
    questionId: 'zhihu-q-269026894', answerId: '927330572',
    expectedExcerpt: '不要说“小声点”，因为小声点是没有概念的，他会降低声音但是三分钟后和以前没有区别\n…\n建议提前拉个警钟，先单独和他说一下，“你睡觉时间打游戏说话很影响我休息，希望你以后睡觉时间别说话了”，心平气和说',
    quote: '你睡觉时间打游戏说话很影响我休息，希望你以后睡觉时间别说话了',
    summary: '把“声音小一点”说成具体的行为和受影响的时段，让对方知道你希望调整什么。',
    conditions: '适用于还能直接协商的日常作息分歧；具体时段和安排仍需双方讨论，不能假定对方已经同意。',
    application: '用一件实际发生的事说明影响，再提出一个具体、可讨论的调整请求。',
  },
  {
    questionId: 'zhihu-q-2005279929667956946', answerId: '2076561771511420793',
    expectedExcerpt: '面试时提的问题直接针对具体工作，尤其要考核应聘人员对设计工作的熟悉程度，以及对国家标准和行业规范的理解程度。\n…\n有次参与招聘工程部设计师的面试时，一位参加面试的年轻人文凭很不错，但当我问他技术问题时，他回答不出来。',
    quote: '面试时提的问题直接针对具体工作，尤其要考核应聘人员对设计工作的熟悉程度，以及对国家标准和行业规范的理解程度。',
    summary: '谈岗位能力时，可以把讨论落到具体工作和能够说明的技能上。',
    conditions: '片段讲的是工程设计岗位的面试经历，不代表所有公司的筛选标准，也不能证明学历要求一定可调整。',
    application: '先问 HR 这个岗位具体关注哪些能力，再用自己真实做过的一件事回应。',
  },
  {
    questionId: 'zhihu-q-19603341', answerId: '36472333360',
    expectedExcerpt: '真正好的面试者，自己会操控节奏和导向。\n\n而这操控，当然不是说直接取代HR开始自问自答，而是通过自己的陈述铺垫，从一开始就把局面往自己占优势的方向代。\n…\n讲故事嘛，总要有足够的噱头让别人愿意集中注意力听下去。\n\n这时候我们让豆包再把竞赛成长那一段单独拎出来，增加一个引子。\n\n豆包给出的引子是：商业模拟竞赛就是商业竞争的缩影。\n\n那这话放在前面，面试官心里肯定就会有OS出现，他可能已经认同这个观点，可能暂时还不认同，但无所谓，兴趣已经被调动起来了。',
    quote: '而这操控，当然不是说直接取代HR开始自问自答，而是通过自己的陈述铺垫，从一开始就把局面往自己占优势的方向代。',
    summary: '可以借用“陈述铺垫”这一步，在自我介绍中点出一段准备展开的经历。',
    conditions: '只使用自己能够如实解释的经历；这个片段没有提供简历改写结论，也不保证能吸引每位面试官。',
    application: '挑一段与岗位有关的真实经历，用一句话说明你做过什么，再留出让对方追问的空间。',
  },
  {
    questionId: 'zhihu-q-28434997', answerId: '1808265608',
    expectedExcerpt: '要尽力动用各种关系去找在公司里工作的师哥、师姐、亲友，甚至是私信咨询网上的陌生网友，了解一下基层员工真实的状态\n…\n选择那些重视人的成长和培养、而不是过度消耗人才的公司，愿意给员工耐心和机会、和员工一起成长的公司',
    quote: '要尽力动用各种关系去找在公司里工作的师哥、师姐、亲友，甚至是私信咨询网上的陌生网友，了解一下基层员工真实的状态',
    summary: '了解实习岗位时，可以向有相关工作经历的人询问日常工作与培养情况。',
    conditions: '个人经历只是一条线索，可能与当前岗位不同；还需要向实际招聘方核对具体安排。',
    application: '选一个最关心的问题，例如日常任务或怎样获得指导，请对方用一个具体经历说明。',
  },
  {
    questionId: 'zhihu-q-2019165528103600779', answerId: '2019376762702804886',
    expectedExcerpt: '至于各种不需要经常加班的场景，一般老板或领导也是通过各种带有商议谈判性质的过程来完全加班工作的安排的。\n…\n而且大部分人都能理解，什么活儿是必须得现在做，拖到明天就可以永远不用做了，以及什么活儿是明天上班再做也一样的。',
    quote: '什么活儿是必须得现在做，拖到明天就可以永远不用做了，以及什么活儿是明天上班再做也一样的。',
    summary: '谈工作安排时，先区分哪些必须当下完成、哪些可以延后，再讨论具体取舍。',
    conditions: '是否能延期仍需有决定权的人确认；这段经验不是工时、加班报酬或法律规则的说明。',
    application: '先问清截止时间和紧急原因，再把任务放回现有安排中，请对方确认优先顺序。',
  },
  {
    questionId: 'zhihu-q-27962530', answerId: '1958663543965618854',
    expectedExcerpt: '当你开始用这个视角，你就会明白父母的很多观念——打压式教育、情感表达困难等等——是他们那个时代的产物，不是绝对的真理，更不是你的错。\n…\n所以当你把自己的认知强加给父母，指望他们立即理解并接受，结局注定是失败。',
    quote: '所以当你把自己的认知强加给父母，指望他们立即理解并接受，结局注定是失败。',
    summary: '可以先放下“对方必须马上认同”的期待，让彼此的想法有机会说清。',
    conditions: '这是沟通视角的提醒，不要求你服从，也不代表所有亲子分歧都有相同原因。',
    application: '先问对方最担心什么，再说明自己怎样看待这件事；把还没谈拢的部分留下来。',
  },
  {
    questionId: 'zhihu-q-27183576', answerId: '46571662',
    expectedExcerpt: '拒绝的话你说轻了，有人情商不够，觉得他们还有机会；\n…\n所以最终发现，有男生喜欢你，你拒绝了他，这就是一种伤害，其大小并不是你怎么样把拒绝说出来所决定的，而是对方的性格和期待所决定。',
    quote: '拒绝的话你说轻了，有人情商不够，觉得他们还有机会；',
    summary: '表达拒绝时需要把立场说清；温和的说法也不能保证对方完全不难过。',
    conditions: '适用于你已经确定不接受的情况；这条经验不替你决定关系，也不判断对方一定会怎样反应。',
    application: '清楚说出自己的决定，避免留下并不存在的承诺，再听听是否还有需要说清的地方。',
  },
];
export const REVIEWED_EXPERIENCE_QUESTION_IDS: readonly string[] = reviews.map(review => review.questionId);

interface BriefSource {
  questionId: string; answerId?: string; sourceId?: string; author?: string;
  answerUrl?: string; questionUrl?: string; fetchedAt?: string;
  excerpt: string; quote: string; quoteTruncated: boolean;
}
export type ExperienceBriefData = BriefSource & (
  | { kind: 'reviewed'; summary: string; conditions: string; application: string; reviewVersion: string }
  | { kind: 'excerpt'; summary?: never; conditions?: never; application?: never; reviewVersion?: never }
  | { kind: 'missing'; summary?: never; conditions?: never; application?: never; reviewVersion?: never }
);

function zhihuUrl(value: string | undefined): string | undefined {
  try {
    const url = new URL(value ?? '');
    if (url.protocol === 'https:' && !url.username && !url.password && ['www.zhihu.com', 'zhihu.com', 'zhuanlan.zhihu.com'].includes(url.hostname)) return url.href;
  } catch { /* Do not manufacture an original URL when it has not been checked. */ }
}
function preview(excerpt: string) {
  const text = excerpt.trim(); const points = Array.from(text);
  if (points.length <= 180) return { quote: text, quoteTruncated: false };
  const prefix = points.slice(0, 180).join('');
  const punctuation = Math.max(prefix.lastIndexOf('。'), prefix.lastIndexOf('！'), prefix.lastIndexOf('？'));
  return { quote: punctuation >= 50 ? prefix.slice(0, punctuation + 1) : prefix, quoteTruncated: true };
}
function matchingReview(questionId: string, answer: CampusCorpusAnswer) {
  return reviews.find(review => review.questionId === questionId && review.answerId === answer.answerId
    && review.expectedExcerpt === answer.excerpt && answer.excerpt.includes(review.quote));
}

/** Passing an answer ID never borrows a different answer's author, quote or takeaway. */
export function buildExperienceBrief(question: CampusCorpusQuestion, answerId?: string): ExperienceBriefData {
  const answer = answerId !== undefined ? question.answers.find(item => item.answerId === answerId)
    : question.answers.find(item => matchingReview(question.id, item)) ?? question.answers.find(item => item.excerpt.trim());
  const base: BriefSource = {
    questionId: question.id, questionUrl: zhihuUrl(question.questionUrl),
    excerpt: answer?.excerpt ?? '', ...preview(answer?.excerpt ?? ''),
    ...(answer ? { answerId: answer.answerId, sourceId: answer.sourceContentId, author: answer.author.trim() || '作者昵称未显示', answerUrl: zhihuUrl(answer.url), fetchedAt: answer.fetchedAt } : {}),
  };
  if (!answer?.excerpt.trim()) return { ...base, kind: 'missing' };
  const reviewed = matchingReview(question.id, answer);
  if (!reviewed) return { ...base, kind: 'excerpt' };
  return { ...base, kind: 'reviewed', quote: reviewed.quote, quoteTruncated: false,
    summary: reviewed.summary, conditions: reviewed.conditions, application: reviewed.application, reviewVersion: EXPERIENCE_BRIEF_VERSION };
}
