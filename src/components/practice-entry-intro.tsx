import Image from 'next/image';
import styles from './practice-entry-intro.module.css';

export function PracticeEntryIntro({ choosing = false, desktopAside = false }: { choosing?: boolean; desktopAside?: boolean }) {
  return <header className={`${styles.intro} ${choosing ? styles.choosing : ''} ${desktopAside ? styles.desktopAside : ''}`}>
    <div className={styles.copy}><span>{choosing ? '从别人的真实困惑开始' : '从一件具体的小事开始'}</span><h1>{choosing ? '哪件事，也让你在意？' : '有句话，想先练着说？'}</h1></div>
    <Image className={styles.illustration} src={choosing ? '/art/question-index-v14.png' : '/art/practice-first-step-v6.png'} alt={choosing ? '翻开的索引册和分类小书架，等待你挑选一个想了解的问题。' : '桌边的同伴在倾听，留出一个位置等你说说自己的事。'} width={1536} height={1024} sizes={choosing ? "(max-width: 550px) 100vw, (max-width: 1099px) 220px, 360px" : "(max-width: 550px) 100vw, (max-width: 1099px) 220px, (max-width: 1440px) 40vw, 520px"} loading="eager" />
    <p>{choosing ? '看看知乎里正在被认真讨论的事，选一个改成自己的练习。' : '不用想好完美说法。先把这件事放在这里。'}</p>
  </header>;
}
