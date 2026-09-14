'use client';

import Image from 'next/image';
import { useState, type ReactNode } from 'react';
import styles from './chat-message.module.css';

export function ChatAvatar({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(false);
  return <span className={styles.avatar} aria-hidden="true" data-avatar-src={src}>
    {!failed ? <Image src={src} alt="" width={40} height={40} sizes="40px" onError={() => setFailed(true)} /> : name.slice(0, 1)}
  </span>;
}

export function ChatMessage({ src, name, text, own = false, children }: { src: string; name: string; text: string; own?: boolean; children?: ReactNode }) {
  return <article className={`${styles.message} ${own ? styles.own : ''}`} data-speaker={own ? 'user' : 'counterpart'}>
    <ChatAvatar src={src} name={name} />
    <div className={styles.body}><strong>{name}</strong><div className={styles.bubble}><p>{text}</p>{children}</div></div>
  </article>;
}
