import { describe, expect, test } from 'vitest';
import { CUSTOM_SCENE_GUIDE, type CustomBranch } from '@/domain/custom-practice';
import { fallbackReplyTexts, replyModelContext, validateReplyOptions } from './reply-options-model';

function branch(title: string, counterpartRole = '已经工作的学姐'): CustomBranch {
  return { id: 'frame-branch', label: '第一次', parentId: null, accepted: true, finished: false,
    createdAt: '2026-09-14T03:00:00Z', turns: [], setup: { title, counterpartRole,
      userRole: '想请教的同学', goal: '我想说清自己的疑问，再商量下一步。',
      userFacts: [title], assumptions: [], openingLine: '你具体想问哪一部分？' } };
}

describe('备用话术不凭主题词切换用户身份', () => {
  test.each(['和朋友聊学历焦虑', '和父母商量毕业之后的选择'])('%s 不凭标题猜对方身份', title => {
    const current = branch(title); const before = structuredClone(current);
    const texts = fallbackReplyTexts({ kind: 'custom', branch: current });
    expect(texts).toHaveLength(3);
    expect(texts.join('')).not.toMatch(/筛选|职位说明|第一学历|招聘门槛|我接受/);
    expect(texts.join('')).not.toMatch(/【|】|先表达自己的|填写/);
    expect(validateReplyOptions({ text: JSON.stringify({ options: texts }), provider: 'deepseek', model: 'test' }, { kind: 'custom', branch: current }).texts).toEqual(texts);
    expect(current).toEqual(before);
  });

  test.each(['向学姐请教简历里的项目经历', '请导师看看求职简历'])('%s 给出简历请教的下一句，未知经历仍不代填', title => {
    const current = branch(title); const before = structuredClone(current);
    const texts = fallbackReplyTexts({ kind: 'custom', branch: current });
    expect(texts.some(text => /简历|经历/u.test(text))).toBe(true);
    expect(texts.join('')).not.toMatch(/筛选|职位说明|第一学历|招聘门槛|我接受|我已经|我的项目是/);
    expect(current).toEqual(before);
  });

  test('确实面对招聘负责人时仍保留已验证的招聘问题', () => {
    const texts = fallbackReplyTexts({ kind: 'custom', branch: branch('了解这次学历筛选', '公司招聘负责人（HR）') });
    expect(texts[0]).toContain('筛选');
    expect(texts[2]).toContain('职位说明');
  });

  test('在新场景先开口时，固定提示不是对方问过的问题', () => {
    const current = branch('向学姐请教简历');
    current.scenes = [{ id: 'scene', turnIndex: 0, label: '一起讨论项目经历', openingKind: 'guide', openingLine: CUSTOM_SCENE_GUIDE, createdAt: current.createdAt }];
    expect(replyModelContext({ kind: 'custom', branch: current })).toMatchObject({ currentQuestion: null, latestDialogue: [] });
    current.turns.push({ id: 'say', userText: '我该先核对什么？', supportedQuote: '我该先核对什么？', reply: '你在项目里实际做了什么？', reflection: '试着说具体。', sourceId: null, createdAt: current.createdAt });
    expect(replyModelContext({ kind: 'custom', branch: current })).toMatchObject({ currentQuestion: '你在项目里实际做了什么？' });
  });
});
