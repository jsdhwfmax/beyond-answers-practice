'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react';
import { LoaderCircle, Music2, Pause, Play, RotateCcw, X } from 'lucide-react';
import { createMusicPlayback, type MusicPlaybackSnapshot } from '@/domain/music-playback';
import { initialMusicOrbPosition, musicOrbPoint, moveMusicOrb, musicOrbKeyboardDelta, parseMusicOrbPosition, type MusicOrbPosition, type MusicOrbViewport } from '@/domain/music-orb';
import styles from './background-music.module.css';

const VOLUME_KEY = 'beyond-answers-music-volume-v1';
const POSITION_KEY = 'beyond-answers-music-position-v1';
const PAUSED_KEY = 'beyond-answers-music-paused-v2';
const DEFAULT_VOLUME = 0.15;
const ORB_SIZE = 48;
function readSavedVolume() {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    const value: unknown = raw === null ? null : JSON.parse(raw);
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1) return value;
  } catch { /* Preferences are optional. */ }
  return DEFAULT_VOLUME;
}
function subscribeVolume(onChange: () => void) {
  const changed = (event: StorageEvent) => { if (event.key === VOLUME_KEY || event.key === null) onChange(); };
  window.addEventListener('storage', changed);
  return () => window.removeEventListener('storage', changed);
}
const defaultVolume = () => DEFAULT_VOLUME;
const subscribeHydration = () => () => {};
const clientHydrated = () => true;
const serverHydrated = () => false;
function viewport(): MusicOrbViewport {
  const view = window.visualViewport;
  return { width: view?.width ?? window.innerWidth, height: view?.height ?? window.innerHeight, offsetLeft: view?.offsetLeft ?? 0, offsetTop: view?.offsetTop ?? 0 };
}

/** Kept alive by the root layout; the floating control takes no document space. */
export default function BackgroundMusic() {
  const hydrated = useSyncExternalStore(subscribeHydration, clientHydrated, serverHydrated);
  const savedVolume = useSyncExternalStore(subscribeVolume, readSavedVolume, defaultVolume);
  const [volumeOverride, setVolumeOverride] = useState<number | null>(null);
  const volume = volumeOverride ?? savedVolume;
  const volumeRef = useRef(DEFAULT_VOLUME);
  const audioRef = useRef<HTMLAudioElement>(null);
  const playerRef = useRef<ReturnType<typeof createMusicPlayback> | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  const orbRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const positionRef = useRef<MusicOrbPosition | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; startPosition: MusicOrbPosition; moved: boolean } | null>(null);
  const animationFrame = useRef<number | null>(null);
  const pendingPosition = useRef<MusicOrbPosition | null>(null);
  const suppressClick = useRef(false);
  const [playback, setPlayback] = useState<MusicPlaybackSnapshot>({ status: 'idle', message: '' });
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const volumeId = useId();
  const hintId = useId();

  const placePanel = useCallback(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const view = viewport();
    const point = musicOrbPoint(positionRef.current ?? initialMusicOrbPosition(view), view);
    const inset = Math.min(12, view.width / 4, view.height / 4);
    const width = Math.max(1, Math.min(288, view.width - inset * 2));
    panel.style.width = `${width}px`;
    panel.style.maxHeight = `${Math.max(1, view.height - inset * 2)}px`;
    const height = panel.getBoundingClientRect().height;
    const left = Math.max((view.offsetLeft ?? 0) + inset, Math.min(point.x + ORB_SIZE - width, (view.offsetLeft ?? 0) + view.width - width - inset));
    const desiredTop = point.y - height - 12 >= (view.offsetTop ?? 0) + inset ? point.y - height - 12 : point.y + ORB_SIZE + 12;
    const top = Math.max((view.offsetTop ?? 0) + inset, Math.min(desiredTop, (view.offsetTop ?? 0) + view.height - height - inset));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }, []);

  const placeOrb = useCallback((position: MusicOrbPosition, persist = false) => {
    positionRef.current = position;
    const point = musicOrbPoint(position, viewport());
    const root = rootRef.current;
    if (root) {
      root.style.left = `${point.x}px`; root.style.top = `${point.y}px`;
      root.style.right = 'auto'; root.style.bottom = 'auto';
    }
    placePanel();
    if (persist) try { localStorage.setItem(POSITION_KEY, JSON.stringify(position)); } catch { /* Optional. */ }
  }, [placePanel]);

  useEffect(() => {
    volumeRef.current = volume;
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    let initiallyPaused = false;
    try { initiallyPaused = sessionStorage.getItem(PAUSED_KEY) === 'true'; } catch { /* Optional. */ }
    const player = createMusicPlayback(audio, {
      getVolume: () => volumeRef.current, isHidden: () => document.hidden,
      onChange: setPlayback, initiallyPaused,
      onManualPreference: paused => { try { sessionStorage.setItem(PAUSED_KEY, String(paused)); } catch { /* Optional. */ } },
    });
    playerRef.current = player;
    const gesture = (event: MouseEvent | KeyboardEvent) => {
      if (!event.isTrusted || (event.target instanceof Node && rootRef.current?.contains(event.target))) return;
      if (event instanceof KeyboardEvent && (event.isComposing || event.ctrlKey || event.metaKey || event.altKey || ['Shift', 'Control', 'Alt', 'Meta', 'Escape'].includes(event.key))) return;
      player.userGesture();
    };
    const visibility = () => { if (document.hidden) player.pauseForHidden(); else player.startAutomatic(); };
    document.addEventListener('click', gesture, true);
    document.addEventListener('keydown', gesture, true);
    document.addEventListener('visibilitychange', visibility);
    player.startAutomatic();
    return () => {
      document.removeEventListener('click', gesture, true);
      document.removeEventListener('keydown', gesture, true);
      document.removeEventListener('visibilitychange', visibility);
      player.dispose(); playerRef.current = null;
    };
  }, []);

  useEffect(() => {
    let saved: MusicOrbPosition | null = null;
    try { saved = parseMusicOrbPosition(localStorage.getItem(POSITION_KEY)); } catch { /* Optional. */ }
    placeOrb(saved ?? initialMusicOrbPosition(viewport()));
    const resize = () => {
      // A viewport change ends an active drag; preserve its latest bounded position.
      dragRef.current = null;
      if (orbRef.current) delete orbRef.current.dataset.dragging;
      if (animationFrame.current !== null) cancelAnimationFrame(animationFrame.current);
      animationFrame.current = null; pendingPosition.current = null;
      placeOrb(positionRef.current ?? initialMusicOrbPosition(viewport()));
    };
    window.addEventListener('resize', resize);
    const visual = window.visualViewport;
    visual?.addEventListener('resize', resize);
    visual?.addEventListener('scroll', resize);
    return () => {
      window.removeEventListener('resize', resize);
      visual?.removeEventListener('resize', resize);
      visual?.removeEventListener('scroll', resize);
      if (animationFrame.current !== null) cancelAnimationFrame(animationFrame.current);
    };
  }, [placeOrb]);

  useLayoutEffect(() => {
    if (!expanded || !panelRef.current) return;
    placePanel();
    const observer = new ResizeObserver(placePanel);
    observer.observe(panelRef.current);
    return () => observer.disconnect();
  }, [expanded, placePanel]);

  useEffect(() => {
    if (!expanded) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setExpanded(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setExpanded(false); orbRef.current?.focus({ preventScroll: true }); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [expanded]);

  function startDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    suppressClick.current = false;
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, startPosition: positionRef.current ?? initialMusicOrbPosition(viewport()), moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function drag(event: ReactPointerEvent<HTMLButtonElement>) {
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const delta = { x: event.clientX - current.startX, y: event.clientY - current.startY };
    if (!current.moved && Math.hypot(delta.x, delta.y) < 6) return;
    current.moved = true; suppressClick.current = true;
    event.currentTarget.dataset.dragging = 'true';
    setExpanded(false);
    pendingPosition.current = moveMusicOrb(current.startPosition, delta, viewport());
    if (animationFrame.current === null) animationFrame.current = requestAnimationFrame(() => {
      animationFrame.current = null;
      if (pendingPosition.current) placeOrb(pendingPosition.current);
    });
  }
  function endDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (animationFrame.current !== null) cancelAnimationFrame(animationFrame.current);
    animationFrame.current = null;
    if (current.moved && pendingPosition.current) placeOrb(pendingPosition.current, true);
    pendingPosition.current = null;
    delete event.currentTarget.dataset.dragging;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function changeVolume(value: number) {
    const next = Math.max(0, Math.min(1, value));
    volumeRef.current = next; setVolumeOverride(next);
    if (audioRef.current) audioRef.current.volume = next;
    try { localStorage.setItem(VOLUME_KEY, JSON.stringify(next)); } catch { /* Optional. */ }
  }
  const { status, message } = playback;
  const playing = status === 'playing';
  const playbackLabel = playing ? '暂停音乐' : status === 'loading' ? '取消加载' : status === 'error' ? '重试播放' : status === 'paused' ? '继续播放' : '播放主题曲';
  const statusLabel = playing ? '音乐正在播放' : status === 'loading' ? '音乐正在加载' : status === 'error' ? '音乐需要重试' : '音乐已暂停';
  const PlaybackIcon = playing ? Pause : status === 'loading' ? LoaderCircle : Play;
  return <aside ref={rootRef} className={styles.floating} aria-label="主题曲播放器" data-playback-status={status} data-controls-state="orb">
    <audio ref={audioRef} preload="none" loop aria-hidden="true" />
    <button ref={orbRef} className={styles.orb} type="button" disabled={!hydrated}
      aria-label={`${statusLabel}，${expanded ? '收起控制' : '打开控制'}`} aria-expanded={expanded} aria-controls={panelId} aria-describedby={hintId}
      title="点击打开音乐设置 · 拖动可移动"
      onPointerDown={startDrag} onPointerMove={drag} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}
      onClick={event => { if (suppressClick.current && event.detail !== 0) { suppressClick.current = false; return; } setExpanded(value => !value); }}
      onKeyDown={event => {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        const delta = musicOrbKeyboardDelta(event.key);
        if (delta) { event.preventDefault(); placeOrb(moveMusicOrb(positionRef.current ?? initialMusicOrbPosition(viewport()), delta, viewport()), true); }
        if (event.key === 'Home') { event.preventDefault(); placeOrb(initialMusicOrbPosition(viewport()), true); }
      }}>
      <Music2 className={styles.note} size={22} strokeWidth={1.7} aria-hidden="true" />
      <span className={styles.indicator} aria-hidden="true">{status === 'loading' ? <LoaderCircle size={10} className={styles.loading} /> : playing ? <span /> : <Pause size={9} />}</span>
    </button>
    <span id={hintId} className="sr-only">点击打开音乐设置。可拖动；键盘方向键移动，Home 键恢复位置。</span>
    {expanded && <div ref={panelRef} id={panelId} className={styles.panel} role="group" aria-label="主题曲设置">
      <div className={styles.panelHeading}><strong>我们的下一句</strong><button type="button" className={styles.closeButton} aria-label="收起音乐设置" onClick={() => { setExpanded(false); orbRef.current?.focus({ preventScroll: true }); }}><X size={16} aria-hidden="true" /></button></div>
      <p className={styles.description}>让校园的旋律，陪你把下一句说出来。</p>
      <button className={styles.panelPlayback} type="button" onClick={() => playerRef.current?.toggle()} aria-label={playbackLabel}><PlaybackIcon size={15} className={status === 'loading' ? styles.loading : undefined} aria-hidden="true" /><span>{playbackLabel}</span></button>
      <div className={styles.volumeLabel}><label htmlFor={volumeId}>音乐音量</label><output htmlFor={volumeId}>{Math.round(volume * 100)}%</output></div>
      <input id={volumeId} className={styles.volume} type="range" min="0" max="100" step="1" value={Math.round(volume * 100)} aria-valuetext={`${Math.round(volume * 100)}%`} onChange={event => changeVolume(Number(event.target.value) / 100)} />
      <p className={styles.hint}>也可用设备音量键调节。切到后台会暂停。</p>
      {message && <p className={status === 'error' ? styles.error : styles.message}>{message}</p>}
      <button className={styles.resetPosition} type="button" onClick={() => placeOrb(initialMusicOrbPosition(viewport()), true)}><RotateCcw size={12} aria-hidden="true" />恢复小球位置</button>
    </div>}
    <span className="sr-only" role="status" aria-live="polite">{playing ? '主题曲正在播放。' : message}</span>
  </aside>;
}
