'use client';

import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { ChevronDown, LoaderCircle, Music2, Pause, Play, Volume2, VolumeX, X } from 'lucide-react';
import styles from './background-music.module.css';

const AUDIO_SOURCE = '/audio/our-next-line-v1.mp3';
const VOLUME_KEY = 'beyond-answers-music-volume-v1';
const DEFAULT_VOLUME = 0.15;
type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

function readSavedVolume() {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    const saved: unknown = raw === null ? null : JSON.parse(raw);
    if (typeof saved === 'number' && Number.isFinite(saved) && saved >= 0 && saved <= 1) return saved;
  } catch { /* Storage is optional. */ }
  return DEFAULT_VOLUME;
}
function subscribeVolume(onChange: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === VOLUME_KEY || event.key === null) onChange(); };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}
const defaultVolumeSnapshot = () => DEFAULT_VOLUME;
const subscribeHydration = () => () => {};
const clientHydratedSnapshot = () => true;
const serverHydratedSnapshot = () => false;

/** The root layout keeps this media element alive during client navigation. */
export default function BackgroundMusic() {
  const hydrated = useSyncExternalStore(subscribeHydration, clientHydratedSnapshot, serverHydratedSnapshot);
  const audioRef = useRef<HTMLAudioElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLButtonElement>(null);
  const compactRef = useRef<HTMLButtonElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const manualControlsRef = useRef(false);
  const focusCompactRef = useRef(false);
  const focusRetryRef = useRef(false);
  const hasPlayedRef = useRef(false);
  const attemptRef = useRef(0);
  const intendedPlayRef = useRef(false);
  const disposedRef = useRef(false);
  const volumeRef = useRef(DEFAULT_VOLUME);
  const [status, setStatus] = useState<PlaybackStatus>('idle');
  const savedVolume = useSyncExternalStore(subscribeVolume, readSavedVolume, defaultVolumeSnapshot);
  const [volumeOverride, setVolumeOverride] = useState<number | null>(null);
  const volume = volumeOverride ?? savedVolume;
  const [expanded, setExpanded] = useState(false);
  const [compact, setCompact] = useState(false);
  const [message, setMessage] = useState('');
  const panelId = useId();
  const volumeId = useId();

  useEffect(() => {
    disposedRef.current = false;
    const audio = audioRef.current;
    if (audio) audio.volume = volumeRef.current;

    const pauseOnHidden = () => {
      if (!document.hidden || !audio || (!intendedPlayRef.current && audio.paused)) return;
      intendedPlayRef.current = false;
      attemptRef.current += 1;
      audio.pause();
      setStatus('paused');
      setMessage('切到后台后已暂停，想听时可以继续播放。');
    };
    document.addEventListener('visibilitychange', pauseOnHidden);
    return () => {
      disposedRef.current = true;
      intendedPlayRef.current = false;
      attemptRef.current += 1;
      document.removeEventListener('visibilitychange', pauseOnHidden);
      if (audio) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      }
    };
  }, []);

  useEffect(() => {
    volumeRef.current = volume;
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    if (!compact || !focusCompactRef.current) return;
    focusCompactRef.current = false;
    compactRef.current?.focus({ preventScroll: true });
  }, [compact]);

  useEffect(() => {
    if (status !== 'error' || compact || !focusRetryRef.current) return;
    focusRetryRef.current = false;
    retryRef.current?.focus({ preventScroll: true });
  }, [compact, status]);

  useEffect(() => {
    if (!expanded) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !controlsRef.current?.contains(event.target)) {
        manualControlsRef.current = false;
        setExpanded(false);
        if (status === 'playing') setCompact(true);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      manualControlsRef.current = false;
      setExpanded(false);
      if (status === 'playing' && !compact) {
        focusCompactRef.current = true;
        setCompact(true);
      } else (compact ? compactRef.current : settingsRef.current)?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [compact, expanded, status]);

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    const attempt = ++attemptRef.current;
    if (intendedPlayRef.current || !audio.paused) {
      intendedPlayRef.current = false;
      audio.pause();
      setStatus('paused');
      setMessage('');
      return;
    }

    // Assigning src only inside this click handler avoids a pre-gesture audio request.
    if (!audio.hasAttribute('src')) audio.src = AUDIO_SOURCE;
    else if (audio.error) audio.load();
    audio.volume = volumeRef.current;
    intendedPlayRef.current = true;
    setStatus('loading');
    setMessage('');
    try {
      await audio.play();
      if (disposedRef.current || attempt !== attemptRef.current) return;
      if (!intendedPlayRef.current || document.hidden) {
        audio.pause();
        return;
      }
      setStatus('playing');
    } catch {
      if (disposedRef.current || attempt !== attemptRef.current) return;
      intendedPlayRef.current = false;
      setStatus('error');
      setMessage('暂时没能播放，请检查网络后点「重试播放」。');
      focusRetryRef.current = Boolean(controlsRef.current?.contains(document.activeElement));
      manualControlsRef.current = false;
      setCompact(false);
      setExpanded(true);
    }
  };

  const changeVolume = (value: number) => {
    const next = Math.max(0, Math.min(1, value));
    volumeRef.current = next;
    setVolumeOverride(next);
    if (audioRef.current) audioRef.current.volume = next;
    try { localStorage.setItem(VOLUME_KEY, JSON.stringify(next)); } catch { /* Optional preference. */ }
  };

  const failPlayback = () => {
    if (disposedRef.current) return;
    intendedPlayRef.current = false;
    attemptRef.current += 1;
    focusRetryRef.current = Boolean(controlsRef.current?.contains(document.activeElement));
    manualControlsRef.current = false;
    setStatus('error');
    setMessage('音乐加载中断了，请检查网络后点「重试播放」。');
    setCompact(false);
    setExpanded(true);
  };

  const label = status === 'playing' ? '暂停音乐' : status === 'loading' ? '取消加载'
    : status === 'error' ? '重试播放' : status === 'paused' ? '继续播放' : '播放主题曲';
  const PlaybackIcon = status === 'playing' ? Pause : status === 'loading' ? LoaderCircle : Play;

  const closePanel = () => {
    manualControlsRef.current = false;
    setExpanded(false);
    if (status === 'playing' && !compact) {
      focusCompactRef.current = true;
      setCompact(true);
    } else (compact ? compactRef.current : settingsRef.current)?.focus({ preventScroll: true });
  };
  const compactLabel = status === 'playing' ? '音乐正在播放，打开控制' : status === 'loading' ? '音乐正在加载，打开控制' : '音乐已暂停，打开控制';

  return <aside className={styles.bar} aria-label="主题曲播放器" data-playback-status={status} data-controls-state={compact ? 'compact' : 'full'}>
    <audio ref={audioRef} preload="none" loop aria-hidden="true"
      onPlaying={() => {
        if (disposedRef.current) return;
        if (!intendedPlayRef.current || document.hidden) { audioRef.current?.pause(); return; }
        setStatus('playing');
        // Only a real playing event collapses the bar. Opening the controls is
        // deliberate, so later buffering/playing events must not dismiss them.
        const firstPlaying = !hasPlayedRef.current;
        hasPlayedRef.current = true;
        if (firstPlaying || !manualControlsRef.current) {
          manualControlsRef.current = false;
          if (!compact) focusCompactRef.current = Boolean(controlsRef.current?.contains(document.activeElement));
          setExpanded(false);
          setCompact(true);
        }
      }}
      onPause={() => {
        // A queued pause event can arrive after a newer click has resumed this element.
        if (disposedRef.current || !audioRef.current?.paused) return;
        intendedPlayRef.current = false;
        setStatus(previous => previous === 'idle' || previous === 'error' ? previous : 'paused');
      }}
      onError={failPlayback}
    />
    <div className={styles.inner}>
      {!compact && <span className={styles.title}><Music2 size={16} aria-hidden="true" /><span>我们的下一句</span></span>}
      <div ref={controlsRef} className={styles.controls}>
        {compact ? <button ref={compactRef} className={styles.compactButton} type="button" aria-label={compactLabel}
          aria-expanded={expanded} aria-controls={panelId} onClick={() => {
            manualControlsRef.current = !expanded;
            setExpanded(previous => !previous);
          }}>
          {status === 'playing' ? <Music2 size={14} aria-hidden="true" /> : status === 'loading' ? <LoaderCircle className={styles.loading} size={14} aria-hidden="true" /> : <Pause size={13} aria-hidden="true" />}
          <span>音乐</span><ChevronDown size={12} aria-hidden="true" />
        </button> : <>
        <button ref={retryRef} className={styles.playButton} type="button" onClick={togglePlayback} aria-label={label} disabled={!hydrated}>
          <PlaybackIcon className={status === 'loading' ? styles.loading : undefined} size={15} aria-hidden="true" />
          <span>{label}</span>
        </button>
        <button ref={settingsRef} className={styles.settingsButton} type="button"
          aria-label="音乐音量与设置" aria-expanded={expanded} aria-controls={panelId} disabled={!hydrated}
          onClick={() => {
            manualControlsRef.current = !expanded;
            setExpanded(previous => !previous);
          }}>
          {volume === 0 ? <VolumeX size={17} aria-hidden="true" /> : <Volume2 size={17} aria-hidden="true" />}
          <ChevronDown size={12} aria-hidden="true" />
        </button>
        </>}
        {expanded ? <div id={panelId} className={styles.panel} role="group" aria-label="主题曲设置">
          <div className={styles.panelHeading}><strong>我们的下一句</strong>
            <button type="button" className={styles.closeButton} aria-label="收起音乐设置" onClick={closePanel}><X size={16} aria-hidden="true" /></button>
          </div>
          <p className={styles.description}>让校园的旋律，陪你把下一句说出来。</p>
          {compact && <button className={styles.panelPlayback} type="button" onClick={togglePlayback} aria-label={label}>
            <PlaybackIcon className={status === 'loading' ? styles.loading : undefined} size={15} aria-hidden="true" /><span>{label}</span>
          </button>}
          <div className={styles.volumeLabel}><label htmlFor={volumeId}>音乐音量</label><output htmlFor={volumeId}>{Math.round(volume * 100)}%</output></div>
          <input id={volumeId} className={styles.volume} type="range" min="0" max="100" step="1"
            value={Math.round(volume * 100)} aria-valuetext={`${Math.round(volume * 100)}%`}
            onChange={event => changeVolume(Number(event.target.value) / 100)} />
          <p className={styles.hint}>也可用设备音量键调节。切到后台会暂停。</p>
          {message ? <p className={status === 'error' ? styles.error : styles.message}>{message}</p> : null}
        </div> : null}
      </div>
    </div>
    <span className="sr-only" role="status" aria-live="polite">{status === 'playing' ? `主题曲正在播放${compact && !expanded ? '，播放器已收起，可通过顶部的音乐按钮打开控制。' : ''}` : message}</span>
  </aside>;
}
