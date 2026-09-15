import { describe, expect, test } from 'vitest';
import {
  initialMusicOrbPosition,
  moveMusicOrb,
  musicOrbKeyboardDelta,
  musicOrbPoint,
  musicOrbPosition,
  parseMusicOrbPosition,
} from './music-orb';

const phone = { width: 390, height: 844 };

describe('music orb placement', () => {
  test('starts at the right with room above bottom inputs', () => {
    expect(musicOrbPoint(initialMusicOrbPosition(phone), phone)).toEqual({ x: 330, y: 708 });
  });

  test('dragging beyond every edge leaves the complete ball inside the visible area', () => {
    expect(musicOrbPoint(musicOrbPosition({ x: -900, y: -900 }, phone), phone))
      .toEqual({ x: 12, y: 12 });
    expect(musicOrbPoint(musicOrbPosition({ x: 9000, y: 9000 }, phone), phone))
      .toEqual({ x: 330, y: 784 });
  });

  test('a smaller visual viewport and its offsets determine the accessible area', () => {
    const keyboardViewport = { width: 320, height: 450, offsetLeft: 15, offsetTop: 100 };
    expect(musicOrbPoint({ x: 0, y: 0 }, keyboardViewport)).toEqual({ x: 27, y: 112 });
    expect(musicOrbPoint({ x: 1, y: 1 }, keyboardViewport)).toEqual({ x: 275, y: 490 });
    expect(musicOrbPoint(initialMusicOrbPosition(keyboardViewport), keyboardViewport))
      .toEqual({ x: 275, y: 414 });
  });

  test('saved relative position remains visible after orientation and size changes', () => {
    const saved = musicOrbPosition({ x: 330, y: 398 }, phone);
    const portrait = { ...saved };
    const landscape = { width: 844, height: 390 };
    expect(musicOrbPoint(saved, landscape)).toEqual({ x: 784, y: 171 });
    expect(saved).toEqual(portrait);
    expect(musicOrbPoint(saved, phone)).toEqual({ x: 330, y: 398 });
  });

  test('tiny viewports reduce margins and then centre an orb that cannot fit', () => {
    expect(musicOrbPoint({ x: 0, y: 1 }, { width: 60, height: 60 })).toEqual({ x: 6, y: 6 });
    const tiny = { width: 24, height: 30, offsetLeft: 2, offsetTop: 4 };
    expect(musicOrbPoint(initialMusicOrbPosition(tiny), tiny)).toEqual({ x: -10, y: -5 });
    expect(musicOrbPosition({ x: 500, y: -500 }, tiny)).toEqual({ x: 0.5, y: 0.5 });
  });

  test('unavailable viewport values never propagate NaN or infinity to CSS', () => {
    const invalid = { width: Number.NaN, height: Number.POSITIVE_INFINITY, offsetLeft: Number.NaN };
    expect(musicOrbPoint(initialMusicOrbPosition(invalid), invalid)).toEqual({ x: -24, y: -24 });
  });
});

describe('music orb saved position', () => {
  test.each([null, '', 'invalid', 'null', '[]', '{}', '{"x":"0.5","y":1}', '{"x":0}', '{"x":1e999,"y":0}'])
    ('ignores malformed saved value %s', (raw) => {
      expect(parseMusicOrbPosition(raw)).toBeNull();
    });

  test('valid stored position restores and numeric overflows clamp to an edge', () => {
    expect(parseMusicOrbPosition('{"x":0.25,"y":0.75}')).toEqual({ x: 0.25, y: 0.75 });
    expect(parseMusicOrbPosition('{"x":-2,"y":7}')).toEqual({ x: 0, y: 1 });
  });
});

describe('music orb movement', () => {
  test('keyboard moves exactly one step and leaves activation keys alone', () => {
    const start = musicOrbPosition({ x: 100, y: 200 }, phone);
    const left = musicOrbKeyboardDelta('ArrowLeft');
    expect(left).toEqual({ x: -16, y: 0 });
    expect(musicOrbPoint(moveMusicOrb(start, left!, phone), phone)).toEqual({ x: 84, y: 200 });
    expect(musicOrbKeyboardDelta('ArrowRight')).toEqual({ x: 16, y: 0 });
    expect(musicOrbKeyboardDelta('ArrowUp')).toEqual({ x: 0, y: -16 });
    expect(musicOrbKeyboardDelta('ArrowDown', 32)).toEqual({ x: 0, y: 32 });
    expect(musicOrbKeyboardDelta('Enter')).toBeNull();
    expect(musicOrbKeyboardDelta(' ')).toBeNull();
  });

  test('drag deltas and repeated keyboard movement cannot lose the orb offscreen', () => {
    const start = initialMusicOrbPosition(phone);
    expect(musicOrbPoint(moveMusicOrb(start, { x: 99999, y: -99999 }, phone), phone))
      .toEqual({ x: 330, y: 12 });
    expect(musicOrbPoint(moveMusicOrb({ x: 0, y: 0 }, { x: -16, y: -16 }, phone), phone))
      .toEqual({ x: 12, y: 12 });
    expect(start).toEqual(initialMusicOrbPosition(phone));
  });
});
