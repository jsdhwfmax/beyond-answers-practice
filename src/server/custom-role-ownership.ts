import type { CustomBranch } from '@/domain/custom-practice';

type Speaker = 'user' | 'counterpart';
const roleGroups = [
  /学生|在校生|本科生|研究生|硕士生|博士生|实习生|应届生|毕业生/u,
  /求职者|候选人|应聘者|面试者/u,
  /面试官|招聘负责人|招聘人员|HR/iu,
  /老师|教师|导师/u,
  /带教(?:前辈|老师)?|主管|经理|老板|上司|负责人/u,
  /爸爸|妈妈|父亲|母亲|家长|你妈|你爸/u,
  /孩子|儿子|女儿/u,
];
const withoutQuotes = (text: string) => text.replace(/“[^”]*”|‘[^’]*’|「[^」]*」|『[^』]*』|"[^"\n]*"|'[^'\n]*'/gu, '');
const normalizeClaim = (text: string) => text.replace(/确实|其实|目前|现在|这边|自己|也|还|都/gu, '').replace(/弄不完|做不完|完不成|赶不完/gu, '完成不了').replace(/[\s\p{P}\p{S}]/gu, '');
const historical = /^(?:以前|当年|曾经|过去|上学时|读书时|小时候|当时)/u;
function roleHead(text: string): number[] {
  // Use the last role noun: "实习生的带教老师" is a teacher, not an intern.
  const affirmed = text.split(/而不是|而非|并非|不是/u)[0];
  const hits = roleGroups.flatMap((group, groupIndex) => [...affirmed.matchAll(new RegExp(group.source, `${group.flags}g`))].map(match => ({ groupIndex, at: match.index })));
  const last = Math.max(-1, ...hits.map(hit => hit.at));
  return hits.filter(hit => hit.at === last).map(hit => hit.groupIndex);
}

/** Extract assertions made in the speaker's own voice; quotations, questions,
 * proposed next steps and explanations of what "you said" are not self facts. */
function selfAssertions(text: string): string[] {
  let self = false;
  const result: string[] = [];
  for (const raw of withoutQuotes(text).match(/[^。！？!?；;，,\n]+[。！？!?；;，,\n]?/gu) ?? []) {
    const clause = raw.replace(/[。！？!?；;，,\n]$/u, '').trim();
    const own = /^(?:(?:但是|不过|可是|所以|其实|今天|今晚|明天|最近|目前|现在|这次|早上|上午|下午|晚上)\s*)*(?:我(?!们)(?:自己|这边)?|本人)(.*)$/u.exec(clause);
    if (own) self = true;
    // Only a narrow continuation can keep an omitted "I". A following noun
    // ("学生明天要上课") or advice ("论文要写清楚") owns its own subject.
    else if (!/^(?:学校那边|家里|手头|这边|还有|也有|还要|也要|只能|不能|需要|要交|得交)/u.test(clause)) self = false;
    const assertion = own?.[1].trim() ?? clause;
    const meta = /^(?:是说|说的是|指的是|问的是|想问|想确认|听到|理解|听懂|听说|在复述)/u.test(assertion);
    const hypothetical = /^(?:如果|假如|要是|想|希望|准备|打算|计划|建议|提议|愿意|可以先|会先|先|再|担心|考虑)/u.test(assertion);
    if (self && assertion && !/[？?]$/u.test(raw.trim()) && !meta && !hypothetical) result.push(assertion);
    if (meta || hypothetical || /[。！？!?；;\n]$/u.test(raw)) self = false;
  }
  return result;
}

export function roleOwnershipContext(branch: CustomBranch) {
  return {
    speaker: { id: 'counterpart', role: branch.setup.counterpartRole, firstPerson: '生成回应中的“我”只能指这位模拟对方' },
    listener: { id: 'user', role: branch.setup.userRole, secondPerson: '回应中的“你/您”指玩家' },
    userOwnedBackground: branch.setup.userFacts,
    counterpartOpening: { speaker: 'counterpart', text: branch.setup.openingLine },
    rule: '玩家的身份、上课/作业、求职经历、家庭关系、做不完的工作和可用时间，不会因为出现在上下文就变成对方的事实。双方已明确共有的背景可分别保留；引用或向玩家询问不等于角色自述。',
  };
}

/** A bounded ownership check, not a complete semantic judge. Explicit role
 * inversions and copied personal constraints cannot become a saved response. */
export function roleOwnershipIssues(branch: CustomBranch, text: string, speaker: Speaker = 'counterpart', currentUserText = ''): string[] {
  const ownRole = speaker === 'counterpart' ? branch.setup.counterpartRole : branch.setup.userRole;
  const otherRole = speaker === 'counterpart' ? branch.setup.userRole : branch.setup.counterpartRole;
  const sharedFacts = branch.setup.assumptions.filter(fact => /^(?:双方|两人|你们|我们).{0,8}(?:都|均|共同)/u.test(fact)).map(fact => fact.replace(/^(?:双方|两人|你们|我们)/u, '我'));
  const ownAccepted = speaker === 'counterpart'
    ? [branch.setup.counterpartRole, branch.setup.openingLine, ...sharedFacts, ...branch.turns.map(turn => turn.reply)]
    : [branch.setup.userRole, ...branch.setup.userFacts, ...branch.turns.map(turn => turn.userText), currentUserText];
  const foreignTexts = speaker === 'counterpart'
    ? [...branch.setup.userFacts, branch.setup.goal, ...branch.turns.map(turn => turn.userText), currentUserText]
    : [branch.setup.openingLine, ...branch.turns.map(turn => turn.reply)];
  const ownClaims = ownAccepted.flatMap(selfAssertions).map(normalizeClaim);
  // Saved NPC history may ground a peer's shared facts; it cannot by itself
  // license a teacher acquiring a student's responsibilities after an old bug.
  const ownStudyClaims = [branch.setup.openingLine, ...sharedFacts].flatMap(selfAssertions).map(normalizeClaim);
  const foreignClaims = foreignTexts.flatMap(selfAssertions).map(normalizeClaim)
    .filter(claim => claim.length >= 4 && /毕业|作业|论文|考试|学校|上课|工资|父母|爸妈|简历|应聘|面试|负责|只能|不能|完成不了|交不了/u.test(claim));
  const issues: string[] = [];
  const unquoted = withoutQuotes(text);
  const userSpeech = /(?:^|[。！？!\n])\s*(?:你回答|用户回答|玩家回答|实习生回答)\s*[：:]\s*(?:[“‘「『"']([^”’」』"'\n]+)[”’」』"']|([^。！？\n]+))/gu;
  if (speaker === 'counterpart') for (const match of text.matchAll(userSpeech)) {
    const quoted = match[1];
    const known = [...branch.turns.map(turn => turn.userText), currentUserText];
    if (!quoted || !known.some(line => normalizeClaim(line).includes(normalizeClaim(quoted)))) issues.push('对方不能擅自补写玩家下一句');
  }
  if (speaker === 'counterpart' && /父亲|母亲|爸爸|妈妈|家长/u.test(ownRole) && /孩子|儿子|女儿/u.test(otherRole) && /(?:^|[。！？!\n])\s*(?:爸|妈|爸爸|妈妈)[，,！!]/u.test(unquoted)) issues.push('把孩子称呼成自己的父母');
  for (const assertion of selfAssertions(text)) {
    const claim = normalizeClaim(assertion);
    if (historical.test(claim)) continue;
    const identity = /^(?:是|还是|只是|就是|作为|身为)(?:一名|一个|个)?(.+)$/u.exec(claim)?.[1];
    const isOtherRole = identity && (roleHead(identity).some(group => roleHead(otherRole).includes(group) && !roleHead(ownRole).includes(group)) || (otherRole.length >= 4 && identity.includes(otherRole) && !identity.includes(ownRole)));
    if (isOtherRole) {
      issues.push(`角色身份倒置：${assertion}`); continue;
    }
    if (/面试官|招聘|HR/iu.test(ownRole) && /候选人|应聘|求职|面试者/u.test(otherRole) && /^(?:来应聘|来面试|来向你求职|向你求职)/u.test(claim)) { issues.push(`把应聘者的行为转给面试方：${assertion}`); continue; }
    const inherited = foreignClaims.find(fact => claim.includes(fact) && !ownClaims.some(known => known.includes(fact)));
    if (inherited) { issues.push(`把另一方的已知个人事实转成自己的自述：${assertion}`); continue; }
    const learner = /学生|在校|本科生|研究生|实习生|孩子|儿子|女儿/u.test(otherRole);
    const authority = /带教|前辈|主管|老板|上司|面试官|招聘|老师|教师|导师|父亲|母亲|爸爸|妈妈|家长/u.test(ownRole);
    const ownsStudy = /学生|在读|读研|进修|兼职学习/u.test(ownRole) || ownStudyClaims.some(known => /作业|论文|考试|上课/u.test(known));
    const studyDuty = /(?:交|写|做|赶|补).{0,5}(?:作业|论文)|(?:作业|论文).{0,10}(?:要交|没写|没做|要写|要赶)|(?:要|得|需要).{0,5}(?:上课|考试|答辩)/u.test(assertion);
    const deniesStudy = /(?:不用|不必|不需要|没有|并非|不是).{0,8}(?:作业|论文|上课|考试|答辩)/u.test(assertion);
    if (speaker === 'counterpart' && learner && authority && !ownsStudy && studyDuty && !deniesStudy) issues.push(`把学习者的职责转给了对方：${assertion}`);
  }
  return [...new Set(issues)];
}
