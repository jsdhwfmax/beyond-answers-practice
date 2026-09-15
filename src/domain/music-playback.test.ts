import { describe, expect, it, vi } from 'vitest';
import { createMusicPlayback, type MusicAudio, type MusicPlaybackSnapshot } from './music-playback';

function pendingPlay() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class TestAudio extends EventTarget implements MusicAudio {
  src = '';
  volume = 1;
  paused = true;
  error: { code: number } | null = null;
  attempts: ReturnType<typeof pendingPlay>[] = [];
  play = vi.fn(() => {
    const pending = pendingPlay();
    this.attempts.push(pending);
    this.paused = false;
    return pending.promise;
  });
  pause = vi.fn(() => { this.paused = true; this.dispatchEvent(new Event('pause')); });
  load = vi.fn(() => { this.error = null; });
  removeAttribute = vi.fn((name: string) => { if (name === 'src') this.src = ''; });
  playing() { this.paused = false; this.dispatchEvent(new Event('playing')); }
  fail() { this.error = { code: 2 }; this.dispatchEvent(new Event('error')); }
}

function setup(initiallyPaused = false) {
  const audio = new TestAudio();
  const snapshots: MusicPlaybackSnapshot[] = [];
  const preference = vi.fn();
  const environment = { hidden: false, volume: 0.4 };
  const player = createMusicPlayback(audio, {
    getVolume: () => environment.volume,
    isHidden: () => environment.hidden,
    onChange: value => snapshots.push(value),
    onManualPreference: preference,
    initiallyPaused,
  });
  return { audio, snapshots, preference, environment, player, current: () => snapshots.at(-1)! };
}

const blockedError = () => Object.assign(new Error('Autoplay blocked'), { name: 'NotAllowedError' });
const tick = async () => { await Promise.resolve(); };

describe('music playback intent and browser events', () => {
  it('does not fetch until start and only calls actual playing playback', async () => {
    const { audio, player, current } = setup();
    expect(current().status).toBe('idle');
    expect(audio.src).toBe('');
    expect(audio.play).not.toHaveBeenCalled();
    player.startAutomatic();
    player.startAutomatic();
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(audio.src).toBe('/audio/our-next-line-v1.mp3');
    expect(audio.volume).toBe(0.4);
    expect(current().status).toBe('loading');
    audio.attempts[0].resolve();
    await tick();
    expect(current().status).toBe('loading');
    audio.playing();
    expect(current().status).toBe('playing');
  });

  it('waits after blocked autoplay, then retries synchronously on the first gesture', async () => {
    const { audio, player, current } = setup();
    player.startAutomatic();
    audio.paused = true;
    audio.attempts[0].reject(blockedError());
    await tick();
    expect(current().status).toBe('waiting');
    player.userGesture();
    expect(audio.play).toHaveBeenCalledTimes(2);
    player.userGesture();
    expect(audio.play).toHaveBeenCalledTimes(2);
    audio.playing();
    expect(current().status).toBe('playing');
  });

  it('uses a gesture arriving before the automatic rejection and ignores that old rejection', async () => {
    const { audio, player, current } = setup();
    player.startAutomatic();
    player.userGesture();
    audio.playing();
    audio.attempts[0].reject(blockedError());
    await tick();
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(current().status).toBe('playing');
  });

  it('preserves a saved pause until an explicit play button', () => {
    const { audio, player, current, preference } = setup(true);
    player.startAutomatic();
    player.userGesture();
    expect(audio.play).not.toHaveBeenCalled();
    expect(current().status).toBe('paused');
    player.toggle();
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(preference).toHaveBeenLastCalledWith(false);
  });

  it('does not revive a manual pause on a later gesture, promise, or playing event', async () => {
    const { audio, player, current, preference } = setup();
    player.startAutomatic();
    player.toggle();
    expect(current().status).toBe('paused');
    expect(preference).toHaveBeenLastCalledWith(true);
    player.userGesture();
    player.startAutomatic();
    audio.playing();
    expect(audio.paused).toBe(true);
    audio.attempts[0].resolve();
    await tick();
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(current().status).toBe('paused');
  });

  it('pauses pending playback in the background and resumes only through toggle', async () => {
    const { audio, player, current, environment } = setup();
    player.startAutomatic();
    environment.hidden = true;
    player.pauseForHidden();
    expect(current()).toEqual({ status: 'paused', message: '切到后台后已暂停，想听时可以继续播放。' });
    audio.paused = false;
    audio.attempts[0].resolve();
    await tick();
    expect(audio.paused).toBe(true);
    environment.hidden = false;
    player.userGesture();
    expect(audio.play).toHaveBeenCalledTimes(1);
    player.toggle();
    audio.playing();
    expect(current().status).toBe('playing');
  });

  it('disarms waiting autoplay when the page becomes hidden', async () => {
    const { audio, player, current, environment } = setup();
    player.startAutomatic();
    audio.paused = true;
    audio.attempts[0].reject(blockedError());
    await tick();
    environment.hidden = true;
    player.pauseForHidden();
    environment.hidden = false;
    player.userGesture();
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(current().status).toBe('paused');
  });

  it('does not start downloading or playing when initially hidden', () => {
    const { audio, player, current, environment } = setup();
    environment.hidden = true;
    player.startAutomatic();
    expect(audio.src).toBe('');
    expect(audio.play).not.toHaveBeenCalled();
    expect(current().status).toBe('paused');
  });

  it('handles a real playing event arriving after the page was hidden before visibility handling', () => {
    const { audio, player, current, environment } = setup();
    player.startAutomatic();
    environment.hidden = true;
    audio.playing();
    expect(audio.paused).toBe(true);
    expect(current().status).toBe('paused');
  });

  it('does not let an old rejected promise overwrite a newer successful play', async () => {
    const { audio, player, current } = setup();
    player.startAutomatic();
    player.toggle();
    player.toggle();
    audio.playing();
    audio.attempts[0].reject(new Error('Old request aborted'));
    await tick();
    expect(current().status).toBe('playing');
  });

  it('does not let an old resolved promise pause a newer play', async () => {
    const { audio, player, current } = setup();
    player.startAutomatic();
    player.toggle();
    player.toggle();
    audio.playing();
    const pauseCalls = audio.pause.mock.calls.length;
    audio.attempts[0].resolve();
    await tick();
    expect(audio.pause).toHaveBeenCalledTimes(pauseCalls);
    expect(current().status).toBe('playing');
  });

  it('ignores a queued pause event once the audio element has resumed', () => {
    const { audio, player, current } = setup();
    player.startAutomatic();
    audio.playing();
    audio.dispatchEvent(new Event('pause'));
    expect(current().status).toBe('playing');
    audio.paused = true;
    audio.dispatchEvent(new Event('pause'));
    expect(current().status).toBe('paused');
  });

  it('exposes load failure, reloads on retry, and waits for actual playing', () => {
    const { audio, player, current } = setup();
    player.startAutomatic();
    audio.fail();
    expect(current().status).toBe('error');
    expect(audio.paused).toBe(true);
    player.userGesture();
    expect(audio.play).toHaveBeenCalledTimes(1);
    player.toggle();
    expect(audio.load).toHaveBeenCalledTimes(1);
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(current().status).toBe('loading');
    audio.playing();
    expect(current().status).toBe('playing');
  });

  it('ignores an old error after manual pause or after a retry cleared the error', () => {
    const { audio, player, current } = setup();
    player.startAutomatic();
    player.toggle();
    audio.fail();
    expect(current().status).toBe('paused');
    player.toggle();
    audio.playing();
    audio.dispatchEvent(new Event('error'));
    expect(current().status).toBe('playing');
  });

  it('allows explicit retry after a rejected play promise', async () => {
    const { audio, player, current } = setup();
    player.startAutomatic();
    audio.paused = true;
    audio.attempts[0].reject(new Error('Network failure'));
    await tick();
    expect(current().status).toBe('error');
    player.toggle();
    audio.playing();
    expect(current().status).toBe('playing');
  });

  it('cleans media/listeners and ignores late callbacks after disposal', async () => {
    const { audio, player, snapshots } = setup();
    const removeListener = vi.spyOn(audio, 'removeEventListener');
    player.startAutomatic();
    player.dispose();
    const count = snapshots.length;
    expect(removeListener).toHaveBeenCalledTimes(3);
    expect(audio.src).toBe('');
    expect(audio.load).toHaveBeenCalledTimes(1);
    expect(audio.paused).toBe(true);
    player.startAutomatic();
    player.userGesture();
    player.toggle();
    player.pauseForHidden();
    player.dispose();
    audio.dispatchEvent(new Event('playing'));
    audio.dispatchEvent(new Event('pause'));
    audio.dispatchEvent(new Event('error'));
    audio.attempts[0].reject(new Error('Late abort'));
    await tick();
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(snapshots).toHaveLength(count);
    expect(audio.load).toHaveBeenCalledTimes(1);
  });

  it('an old disposed controller cannot pause a new controller sharing the element', async () => {
    const { audio, player } = setup();
    player.startAutomatic();
    player.dispose();
    const nextChanges = vi.fn();
    const next = createMusicPlayback(audio, { getVolume: () => 0.4, isHidden: () => false, onChange: nextChanges });
    next.startAutomatic();
    audio.playing();
    const pauseCalls = audio.pause.mock.calls.length;
    audio.attempts[0].resolve();
    await tick();
    expect(audio.pause).toHaveBeenCalledTimes(pauseCalls);
    expect(nextChanges).toHaveBeenLastCalledWith({ status: 'playing', message: '' });
    next.dispose();
  });

  it.each([[-1, 0], [2, 1], [NaN, 0.15]])('clamps saved volume %s to %s', (saved, expected) => {
    const { audio, player, environment } = setup();
    environment.volume = saved;
    player.startAutomatic();
    expect(audio.volume).toBe(expected);
  });
});
