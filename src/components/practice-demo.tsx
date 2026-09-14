'use client';

import { useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Check, RotateCcw } from 'lucide-react';
import { CHAT_AVATARS, USER_CHAT_AVATAR } from '@/content/chat-avatars';
import { ChatMessage } from './chat-message';
import styles from './practice-demo.module.css';

const opening = '学姐，我刚上大学，想请教一下怎么复习高数。你现在方便聊几分钟吗？';
const reply = '可以呀，我们先聊聊思路。要是方便的话，我们加个微信，晚上我给你发重点框架。';
const responses = {
  here: '谢谢学姐！我们先在这里聊聊复习思路吧，我主要不知道怎么抓重点。',
  accept: '谢谢学姐，我愿意加微信，晚上接收你发来的重点框架。',
} as const;

/** A fixed, interactive explanation: no model request, session, score or learning claim. */
export function PracticeDemo({ onStart, onLibrary, onBack }: { onStart: () => void; onLibrary: () => void; onBack: () => void }) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [choice, setChoice] = useState<keyof typeof responses | null>(null);
  return <section className={styles.page} aria-label="90 秒互动示范">
    <nav className={styles.nav} aria-label="示范导航"><button onClick={onBack}><ArrowLeft size={16} aria-hidden="true" />返回练习主页</button><span>90 秒上手 · 预设互动示范</span></nav>
    <header className={styles.heading}><span>从一句“想请教一下”开始</span><h1>练一次，然后看见自己做了什么。</h1><p>点击走完三个小步骤。这里的对话是预先编写的，不计入你的练习记录。</p></header>
    <ol className={styles.steps} aria-label="示范步骤">{['说出目的', '看看回应', '带走经验'].map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined}><span>{index + 1}</span>{label}</li>)}</ol>
    <div className={styles.layout}>
      <section className={styles.chat} aria-label="请教学姐示范对话">
        <div className={styles.goal}><span>这次想谈成</span><strong>向学姐请教复习方法，获得愿意聊几分钟的回应。</strong></div>
        <ChatMessage src={CHAT_AVATARS[1].src} name="学姐 · 原创模拟角色" text="你好呀，有什么想聊的吗？" />
        {step === 0 ? <div className={styles.prompt}><p>先让对方知道：你想请教什么，也在意她是否方便。</p><button className={styles.messageChoice} onClick={() => setStep(1)}><span>{opening}</span><span>试着这样开口<ArrowRight size={16} aria-hidden="true" /></span></button></div> : <>
          <ChatMessage src={USER_CHAT_AVATAR.src} name="我 · 示范原话" text={opening} own />
          <ChatMessage src={CHAT_AVATARS[1].src} name="学姐 · 原创模拟角色" text={reply} />
          <div className={styles.feedback} role="status"><Check size={19} aria-hidden="true" /><div><strong>她愿意聊聊，模拟沟通目标达成了。</strong><p>{choice === 'accept' ? '你随后明确接受了“加微信、晚上发框架”的提议，这才留下新的双方约定。' : '“加微信、晚上发框架”还是她的提议，你还没有接受。'}</p></div></div>
          {choice && <ChatMessage src={USER_CHAT_AVATAR.src} name="我 · 示范原话" text={responses[choice]} own />}
          {step === 1 && <div className={styles.prompt}><h2>你仍然可以决定，接下来怎么聊。</h2><div className={styles.choices}><button onClick={() => { setChoice('here'); setStep(2); }}>先在这里请教，不接受新提议</button><button onClick={() => { setChoice('accept'); setStep(2); }}>明确接受加微信和发框架的提议</button></div></div>}
        </>}
      </section>
      <aside className={styles.note} aria-live="polite">
        {step < 2 ? <><span>这一步在练什么</span><h2>{step === 0 ? '把想要的帮助，说具体一点。' : '分清“聊通了”和“又答应了一件事”。'}</h2><p>{step === 0 ? '不必一次说得漂亮。先说清目的，给对方留下回应的空间。' : '目标已经达成，不代表每个新提议都成了双方约定。你可以继续，也可以收束。'}</p></> : <><span>这次示范留下的经验</span><h2>一句表达，一次选择。</h2><dl><dt>我尝试了</dt><dd>说清想请教高数复习，并询问对方是否方便。</dd><dt>我得到的回应</dt><dd>对方明确愿意聊聊。</dd><dt>新的双方约定</dt><dd>{choice === 'accept' ? '你明确接受了学姐的微信与框架提议。双方原话都留在左侧对话中。' : '没有。你选择继续在这里请教。'}</dd></dl><details><summary>这怎样连接知乎经验？</summary><p>知乎上的真实问题提供了练习主题。这段对话是团队原创示范，不是回答作者的原话。</p><a href="https://www.zhihu.com/question/40645474" target="_blank" rel="noopener noreferrer">大学中如何拿到高绩点？<ArrowRight size={13} aria-hidden="true" /></a><p>进入自己的练习后，可以把实际尝试与回答的摘要和团队归纳对照。</p></details><p className={styles.boundary}>这里只发生了模拟对话；现实中能否谈成，还需要真正去尝试。</p></>}
      </aside>
    </div>
    {step === 2 && <section className={styles.next} aria-label="开始自己的练习"><div><span>接下来，换你自己的事情。</span><h2>不必照抄这句话。</h2></div><div><button className={styles.primary} onClick={onStart}>练自己的事<ArrowRight size={16} aria-hidden="true" /></button><button onClick={onLibrary}><BookOpen size={16} aria-hidden="true" />从知乎校园问题开始</button><button className={styles.restart} onClick={() => { setStep(0); setChoice(null); }}><RotateCcw size={15} aria-hidden="true" />再试一种选择</button></div></section>}
  </section>;
}
