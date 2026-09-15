export type MusicPlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'waiting' | 'error';

export interface MusicPlaybackSnapshot {
  status: MusicPlaybackStatus;
  message: string;
}

/** The part of an audio element needed here; no browser globals are accessed. */
export interface MusicAudio {
  src: string;
  volume: number;
  readonly paused: boolean;
  readonly error: { readonly code: number } | null;
  play(): Promise<void>;
  pause(): void;
  load(): void;
  removeAttribute(name: string): void;
  addEventListener(type: 'playing' | 'pause' | 'error', listener: () => void): void;
  removeEventListener(type: 'playing' | 'pause' | 'error', listener: () => void): void;
}

export interface MusicPlaybackOptions {
  getVolume: () => number;
  isHidden: () => boolean;
  onChange: (snapshot: MusicPlaybackSnapshot) => void;
  initiallyPaused?: boolean;
  onManualPreference?: (paused: boolean) => void;
}

const AUDIO_SOURCE = '/audio/our-next-line-v1.mp3';
const HIDDEN_MESSAGE = '切到后台后已暂停，想听时可以继续播放。';
const ERROR_MESSAGE = '暂时没能播放，请检查网络后点「重试播放」。';

/**
 * Tries audible playback without circumventing browser autoplay policy. A
 * blocked automatic attempt may be retried from one genuine user interaction;
 * a manual or background pause always needs an explicit toggle to resume.
 */
export function createMusicPlayback(audio: MusicAudio, options: MusicPlaybackOptions) {
  let disposed = false;
  let started = false;
  let sourceAssigned = false;
  let attempt = 0;
  let intendedPlay = false;
  let automatic = !options.initiallyPaused;
  let gestureRetried = false;
  let snapshot: MusicPlaybackSnapshot = {
    status: options.initiallyPaused ? 'paused' : 'idle',
    message: '',
  };

  function emit(status: MusicPlaybackStatus, message = '') {
    if (disposed || (snapshot.status === status && snapshot.message === message)) return;
    snapshot = { status, message };
    options.onChange({ ...snapshot });
  }

  function stop(message: string) {
    intendedPlay = false;
    automatic = false;
    attempt += 1;
    emit('paused', message);
    audio.pause();
    options.onManualPreference?.(true);
  }

  function pauseForHidden() {
    if (disposed || !options.isHidden()) return;
    // A waiting autoplay attempt must also be disarmed when leaving the page.
    if (!intendedPlay && snapshot.status !== 'waiting' && snapshot.status !== 'idle') return;
    stop(HIDDEN_MESSAGE);
  }

  function fail(error: unknown, currentAttempt: number) {
    if (disposed || currentAttempt !== attempt || !intendedPlay) return;
    if (options.isHidden()) {
      pauseForHidden();
      return;
    }
    intendedPlay = false;
    audio.pause();
    const blocked = typeof error === 'object' && error !== null
      && 'name' in error && error.name === 'NotAllowedError';
    if (blocked) {
      emit('waiting', automatic && !gestureRetried
        ? '浏览器暂未允许自动播放，点击页面后会再试一次，也可点「播放主题曲」。'
        : '浏览器暂未允许播放，请点「播放主题曲」再试。');
    } else {
      automatic = false;
      emit('error', ERROR_MESSAGE);
    }
  }

  function play() {
    if (disposed) return;
    if (options.isHidden()) {
      stop(HIDDEN_MESSAGE);
      return;
    }
    const currentAttempt = ++attempt;
    intendedPlay = true;
    emit('loading');
    try {
      if (!sourceAssigned) {
        audio.src = AUDIO_SOURCE;
        sourceAssigned = true;
      } else if (audio.error) audio.load();
      const volume = options.getVolume();
      audio.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0.15;
      // Keep this call synchronous so a caller's real click/key activation is
      // available to the browser. A resolved promise alone is not playback proof.
      void audio.play().then(() => {
        // Disposal can be followed by a new controller on the same element
        // (for example React Strict Mode); an old callback must not pause it.
        if (disposed) return;
        if (!intendedPlay || options.isHidden()) {
          if (options.isHidden() && intendedPlay) pauseForHidden();
          else if (!audio.paused) audio.pause();
        }
      }, error => fail(error, currentAttempt));
    } catch (error) {
      fail(error, currentAttempt);
    }
  }

  function onPlaying() {
    if (disposed) return;
    if (options.isHidden()) {
      if (intendedPlay) pauseForHidden();
      else if (!audio.paused) audio.pause();
      return;
    }
    if (!intendedPlay) {
      if (!audio.paused) audio.pause();
      return;
    }
    if (!audio.paused) emit('playing');
  }

  function onPause() {
    // Queued pause events from an older attempt cannot stop a resumed element.
    if (disposed || !audio.paused || !intendedPlay) return;
    intendedPlay = false;
    automatic = false;
    attempt += 1;
    emit('paused');
    options.onManualPreference?.(true);
  }

  function onError() {
    // A queued error from an earlier load must not overwrite a later pause or
    // retry, for which load() has cleared the element's current MediaError.
    if (disposed || !intendedPlay || !audio.error) return;
    intendedPlay = false;
    automatic = false;
    attempt += 1;
    emit('error', ERROR_MESSAGE);
    audio.pause();
  }

  audio.addEventListener('playing', onPlaying);
  audio.addEventListener('pause', onPause);
  audio.addEventListener('error', onError);
  options.onChange({ ...snapshot });

  return {
    startAutomatic() {
      if (disposed || started) return;
      started = true;
      if (automatic) play();
    },
    userGesture() {
      if (disposed || !started || !automatic || gestureRetried
        || (snapshot.status !== 'waiting' && snapshot.status !== 'loading')) return;
      gestureRetried = true;
      play();
    },
    toggle() {
      if (disposed) return;
      if (intendedPlay || !audio.paused) {
        stop('');
        return;
      }
      automatic = false;
      options.onManualPreference?.(false);
      play();
    },
    pauseForHidden,
    dispose() {
      if (disposed) return;
      disposed = true;
      intendedPlay = false;
      attempt += 1;
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('error', onError);
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    },
  };
}
