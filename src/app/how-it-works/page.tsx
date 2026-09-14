import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight, BookOpen, Clock3, MoveLeft } from 'lucide-react';
import styles from './page.module.css';

export const metadata = { title: '怎样练一次｜答案之外' };

export default function HowItWorks() {
  return <div className={styles.page}>
    <a href="#main-content" className={styles.skipLink}>跳到玩法说明</a>
    <header className={styles.header}>
      <Link href="/" className={styles.brand}><BookOpen size={22} aria-hidden="true" />答案之外</Link>
      <Link href="/?view=home"><MoveLeft size={16} aria-hidden="true" />进入练习主页</Link>
    </header>
    <main id="main-content" tabIndex={-1}>
      <section className={styles.intro}>
        <div>
          <p className={styles.caption}>第一次来，先看怎么玩。</p>
          <h1>生活不会给彩排。<br />这里可以。</h1>
          <p className={styles.lead}>借有出处的经验，练自己的表达。<br />你说自己的话，AI 扮演这次面对的人。</p>
          <p>比如，毕业前想请学姐看看简历，却怕打扰她。你可以先在这里练习怎样开口，怎样约好时间。</p>
          <div className={styles.introActions}><Link className={styles.primary} href="#steps-title">看看具体怎么操作<ArrowRight size={17} aria-hidden="true" /></Link><Link className={styles.textLink} href="/?view=demo">点开一个小示范</Link></div>
          <small>示范是预设互动，不需要填写资料，也不计入你的练习记录。</small>
        </div>
        <Image src="/art/how-conversation-v5.png" alt="两位校园同伴面对面坐下，一人试着开口，另一人认真倾听。" width={1536} height={1024} sizes="(max-width: 760px) calc(100vw - 44px), 48vw" loading="eager" />
      </section>

      <section className={styles.steps} aria-labelledby="steps-title">
        <div className={styles.stepsIntro}>
        <h2 id="steps-title">用一件事，走过这五步</h2>
        <p className={styles.sectionLead}>下面是操作示例。你可以换成自己的事情，不需要照抄这些话。</p>
        </div>
        <ol>
          <li><span>1</span><div><h3>描述事情：我想练什么？</h3><p>说说想面对谁、卡在哪里、希望谈成什么。还没想具体也可以先写下来。</p><blockquote>“明年毕业，怕找不到工作。我想请已经工作的学姐看看简历，但怕打扰她。”</blockquote></div></li>
          <li><span>2</span><div><h3>整理方向：还没有开始聊天</h3><p>如果页面给出追问或建议，是在帮你把练习方向说具体。补充到原来的描述里，或点一个方向后再编辑，再点“用修改后的描述准备情境”。</p><blockquote>把描述补成：“我想和学姐约一次 15 分钟的简历交流。”</blockquote><p className={styles.stepNote}>重复提交同一段描述不会变成新对话。建议只填入草稿；由你决定采用什么。</p></div></li>
          <li><span>3</span><div><h3>确认设定：这才是我想练的事</h3><p>核对“我扮演谁”“对方是谁”和“这次想谈成什么”。不贴切的角色、情况与模拟假设，都可以改。</p><p className={styles.stepNote}>看过对方的开场白，点“设定合适，开始对话”，再进入练习。</p></div></li>
          <li><span>4</span><div><h3>自己发言：说给对方听</h3><p>对方开口后，在输入框写下你想说的话，再发送。想听下一句，就接着向对方提问或回应。</p><blockquote>“学姐，你这周方便抽 15 分钟，帮我看看简历里的项目经历吗？”</blockquote><p>练习旁的经验片段可以借来想思路。先看看适用条件，再决定如何用在自己的情况里；团队归纳与原摘要都有标注，不必跳去原文才能了解要点。</p><p className={styles.stepNote}>不会说时可以看看回复建议，点选后仍由你检查、修改和发送。系统不会默认替你发言。</p></div></li>
          <li><span>5</span><div><h3>有约定后，再跳到约定的时刻</h3><p>比如学姐提议“明晚 8 点线上聊”，你回答“好，明晚 8 点见”。双方说好后，才适合把模拟时间跳到这次交流。</p><p className={styles.stepNote}>下一幕是可选的。也可以留在当前场景继续说，或保存这次练习。</p></div></li>
        </ol>
      </section>

      <section className={styles.sceneGuide} aria-labelledby="scene-title">
        <div className={styles.sceneTitle}><Clock3 size={25} aria-hidden="true" /><h2 id="scene-title">“跳到之后的时间或场景”，什么时候用？</h2></div>
        <p>它会把场景切到你指定的时间或地点，比如双方约好的下一次交流。切换后先显示场景提示，由你开口后，对方才会回应。没有谈妥的事仍然待定。<strong>它不是“让 AI 继续说”的按钮，也不会替你同意、回应或完成任务。</strong></p>
        <div className={styles.sceneExample}>
          <div><h3>这一幕：先约好</h3><p><strong>学姐：</strong>“明晚 8 点，我们线上聊 15 分钟？”</p><p><strong>你：</strong>“好，明晚 8 点见。我带上简历。”</p></div>
          <div><h3>下一幕：来到约定时刻</h3><p>模拟时间到了明晚 8 点。你继续练习怎样说明简历中最想请教的部分。</p><p>跳转只改变模拟场景，不代表现实中已经见面，也不代表简历已经改好。</p></div>
        </div>
        <p className={styles.sceneTip}>还没有谈妥，就先留在这一幕说一句。只想知道对方怎么回应，直接在对话输入框发言即可。跳转选项在对话输入区下方，先在这一幕开口后再按需使用。</p>
      </section>

      <section className={styles.reflection}>
        <Image src="/art/how-reflection-v5.png" alt="把书中的启发和自己的下一步记在一本笔记里。" width={1536} height={1024} sizes="(max-width: 760px) calc(100vw - 44px), 45vw" />
        <div><h2>聊到这里，<br />回看自己留下了什么。</h2><ul><li>自己尝试过的表达与对方的模拟回应</li><li>已经谈清的事，以及还需确认的地方</li><li>对应的知乎问题、回答摘要与团队归纳</li><li>一份可读、可导出的经验记录</li></ul><p>目标谈通后会有提示，你决定继续还是保存。看看前人的经验，再写下现实中准备尝试的一小步。</p><p>模拟中的同意只属于模拟；现实中的行动仍需要你亲自尝试。</p></div>
      </section>
      <section className={styles.ready}><h2>从自己想说的第一句话开始。</h2><Link className={styles.primary} href="/?view=home">选一件事，先练一次<ArrowRight size={18} aria-hidden="true" /></Link><p>正在练习中来看说明？可以用浏览器返回，接着原来的页面继续。</p></section>
    </main>
    <footer className={styles.footer}>知乎内容有出处，场景与人物由我们原创。<Link href="/?view=home">返回练习主页</Link></footer>
  </div>;
}
