'use client';

import Image from 'next/image';
import { useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { DEFAULT_PORTRAIT_ID, DEFAULT_SCENE_ID, PORTRAITS, SCENES, portraitFor, sceneFor, type PortraitId, type SceneId } from '@/content/visuals';
import styles from './practice-stage.module.css';

export interface StageCastMember { id: string; name: string; role: string; src: string }
export interface PracticeStageProps {
  variant?: 'conversation' | 'welcome'; title?: string; counterpartRole?: string;
  sceneId?: string; portraitId?: string;
  onSceneChange?: (id: SceneId) => void; onPortraitChange?: (id: PortraitId) => void;
  status?: 'ready' | 'thinking' | 'speaking' | 'pending' | 'ended'; children?: ReactNode;
  cast?: StageCastMember[]; activeActorId?: string; className?: string;
}

/** This stage displays original art and recorded speaker identity, never a score. */
export function PracticeStage({ variant = 'conversation', title, counterpartRole, sceneId, portraitId, onSceneChange, onPortraitChange, status = 'ready', children, cast, activeActorId, className = '' }: PracticeStageProps) {
  const [localScene, setLocalScene] = useState<SceneId>(variant === 'welcome' ? 'scene-panorama' : DEFAULT_SCENE_ID);
  const [localPortrait, setLocalPortrait] = useState<PortraitId>(DEFAULT_PORTRAIT_ID);
  const [selector, setSelector] = useState<'people' | 'places' | null>(null);
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const peopleButton = useRef<HTMLButtonElement>(null); const placesButton = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const scene = sceneFor(sceneId ?? localScene); const portrait = portraitFor(portraitId ?? localPortrait);
  const fixedCast = Boolean(cast?.length); const showPortraits = variant !== 'welcome';
  const people: StageCastMember[] = fixedCast ? cast! : [{ id: portrait.id, name: counterpartRole || portrait.name, role: '原创模拟角色', src: portrait.src }];
  const activePerson = activeActorId ? people.find(person => person.id === activeActorId) : undefined;
  const statusText = status === 'thinking' ? '正在组织回应' : status === 'pending' ? '这轮尚未完成，原话已保留' : status === 'ended' ? '这次尝试已保存' : status === 'speaking' ? activePerson ? `刚才是${activePerson.name}的回应，轮到你` : '对方已回应，轮到你了' : '轮到你，慢慢说';
  const fail = (src: string) => setFailedImages(images => images.includes(src) ? images : [...images, src]);
  const closeSelector = () => { setSelector(null); (selector === 'people' ? peopleButton : placesButton).current?.focus(); };
  const selectScene = (id: SceneId) => { if (onSceneChange) onSceneChange(id); else setLocalScene(id); closeSelector(); };
  const selectPortrait = (id: PortraitId) => { if (onPortraitChange) onPortraitChange(id); else setLocalPortrait(id); closeSelector(); };
  return <section className={`${styles.stage} ${styles[variant]} ${fixedCast ? styles.withCast : ''} ${className}`} aria-label={variant === 'welcome' ? '重返校园' : '面对面练习舞台'} data-scene={scene.id} data-portrait={!fixedCast ? portrait.id : undefined}>
    <div className={styles.frame}>
      {!failedImages.includes(scene.src) && <Image className={styles.background} src={scene.src} alt="" fill sizes={variant === 'welcome' ? '100vw' : '(max-width: 760px) 100vw, 850px'} style={{ objectPosition: scene.position }} loading="eager" onError={() => fail(scene.src)} />}
      <div className={styles.shade} aria-hidden="true" />
      <div className={styles.copy}>
        <span className={styles.place}>{scene.name}</span>
        {title && <h2>{title}</h2>}
        {children && <div className={styles.content}>{children}</div>}
        {variant === 'conversation' && <p className={styles.status} aria-live="polite"><span className={status === 'thinking' ? styles.thinkingDot : styles.dot} aria-hidden="true" />{statusText}</p>}
      </div>
      {showPortraits && <div className={styles.people} style={{ '--cast-count': people.length } as CSSProperties} aria-label={fixedCast ? '参与对话的原创角色' : '选择的原创同伴'}>
        {people.map(person => <figure key={`${person.id}:${person.src}`} className={`${styles.person} ${activeActorId === person.id ? styles.activePerson : ''}`} data-active={activeActorId === person.id ? 'true' : 'false'}>
          <div className={styles.portrait}>
            {!failedImages.includes(person.src) ? <Image src={person.src} alt={fixedCast ? `${person.name}的原创角色肖像` : portrait.alt} fill sizes={fixedCast ? '(max-width: 760px) 82px, 120px' : '(max-width: 760px) 135px, 200px'} style={{ objectPosition: fixedCast ? '50% 15%' : portrait.position }} loading="eager" onError={() => fail(person.src)} /> : <span className={styles.artMissing}>人物图暂未载入</span>}
          </div>
          <figcaption><strong>{person.name}</strong><span>{fixedCast ? person.role : '原创模拟角色'}</span>{activeActorId === person.id && <small>刚才回应</small>}</figcaption>
        </figure>)}
      </div>}
    </div>
    {variant === 'conversation' && <div className={styles.toolbar}>
      <p>{fixedCast ? '角色的身份与分工以情境设定为准' : '这是一场模拟，你可以换个同伴和地方'}</p>
      <div>{!fixedCast && <button ref={peopleButton} type="button" aria-expanded={selector === 'people'} aria-controls={panelId} onClick={() => selector === 'people' ? closeSelector() : setSelector('people')}>换个同伴</button>}<button ref={placesButton} type="button" aria-expanded={selector === 'places'} aria-controls={panelId} onClick={() => selector === 'places' ? closeSelector() : setSelector('places')}>换个地方</button></div>
    </div>}
    {selector && <div className={styles.selector} id={panelId} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeSelector(); } }}>
      <div className={styles.selectorHeading}><h3>{selector === 'people' ? '选一位想面对面聊聊的同伴' : '选一个坐下来聊的地方'}</h3><button type="button" onClick={closeSelector}>收起</button></div>
      <p>只改变画面，不改变练习的角色、已确认的事实或可用时间。</p>
      <div className={`${styles.choices} ${selector === 'people' ? styles.portraitChoices : styles.sceneChoices}`} role="group" aria-label={selector === 'people' ? '同伴形象' : '练习地点'}>
        {selector === 'people' ? PORTRAITS.map(option => <button key={option.id} type="button" aria-pressed={portrait.id === option.id} onClick={() => selectPortrait(option.id)}><span className={styles.choiceImage}><Image src={option.src} alt="" fill sizes="110px" style={{ objectPosition: option.position }} loading="lazy" /></span><strong>{option.name}</strong><span>{option.description}</span></button>) : SCENES.map(option => <button key={option.id} type="button" aria-pressed={scene.id === option.id} onClick={() => selectScene(option.id)}><span className={styles.choiceImage}><Image src={option.src} alt="" fill sizes="(max-width: 760px) 150px, 200px" loading="lazy" /></span><strong>{option.name}</strong><span>{option.description}</span></button>)}
      </div>
    </div>}
  </section>;
}
