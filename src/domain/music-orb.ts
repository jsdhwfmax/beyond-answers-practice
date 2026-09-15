export const MUSIC_ORB_SIZE = 48;
export const MUSIC_ORB_MARGIN = 12;
export const MUSIC_ORB_INITIAL_BOTTOM_GAP = 88;
export const MUSIC_ORB_KEYBOARD_STEP = 16;

/** Coordinates stored independently of viewport size. */
export interface MusicOrbPosition { x: number; y: number }
/** Layout viewport coordinates, also used for pointer deltas. */
export interface MusicOrbPoint { x: number; y: number }
export interface MusicOrbViewport {
  width: number;
  height: number;
  offsetLeft?: number;
  offsetTop?: number;
}

function finite(value: number | undefined, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function axisBounds(size: number, offset: number | undefined) {
  const start = finite(offset);
  const available = Math.max(0, finite(size)) - MUSIC_ORB_SIZE;
  // If the orb cannot fit, keep its centre in the visible viewport.
  if (available <= 0) return { min: start + available / 2, max: start + available / 2 };
  const inset = Math.min(MUSIC_ORB_MARGIN, available / 2);
  return { min: start + inset, max: start + available - inset };
}

function bounds(viewport: MusicOrbViewport) {
  return {
    x: axisBounds(viewport.width, viewport.offsetLeft),
    y: axisBounds(viewport.height, viewport.offsetTop),
  };
}

/** Convert a saved position to visible coordinates after resize, zoom or keyboard changes. */
export function musicOrbPoint(position: MusicOrbPosition, viewport: MusicOrbViewport): MusicOrbPoint {
  const area = bounds(viewport);
  return {
    x: area.x.min + clamp(finite(position.x, 0.5), 0, 1) * (area.x.max - area.x.min),
    y: area.y.min + clamp(finite(position.y, 0.5), 0, 1) * (area.y.max - area.y.min),
  };
}

/** Clamp a dragged point and convert it to the size-independent saved form. */
export function musicOrbPosition(point: MusicOrbPoint, viewport: MusicOrbViewport): MusicOrbPosition {
  const area = bounds(viewport);
  const relative = (value: number, axis: { min: number; max: number }) => axis.max === axis.min
    ? 0.5
    : clamp((finite(value, axis.min) - axis.min) / (axis.max - axis.min), 0, 1);
  return { x: relative(point.x, area.x), y: relative(point.y, area.y) };
}

export function initialMusicOrbPosition(viewport: MusicOrbViewport): MusicOrbPosition {
  const area = bounds(viewport);
  return musicOrbPosition({
    x: area.x.max,
    y: finite(viewport.offsetTop) + Math.max(0, finite(viewport.height))
      - MUSIC_ORB_SIZE - MUSIC_ORB_INITIAL_BOTTOM_GAP,
  }, viewport);
}

export function moveMusicOrb(
  position: MusicOrbPosition,
  delta: MusicOrbPoint,
  viewport: MusicOrbViewport,
): MusicOrbPosition {
  const point = musicOrbPoint(position, viewport);
  return musicOrbPosition({ x: point.x + finite(delta.x), y: point.y + finite(delta.y) }, viewport);
}

/** Null leaves unrelated keys available for the normal button interaction. */
export function musicOrbKeyboardDelta(key: string, step = MUSIC_ORB_KEYBOARD_STEP): MusicOrbPoint | null {
  const amount = Number.isFinite(step) && step > 0 ? step : MUSIC_ORB_KEYBOARD_STEP;
  switch (key) {
    case 'ArrowLeft': return { x: -amount, y: 0 };
    case 'ArrowRight': return { x: amount, y: 0 };
    case 'ArrowUp': return { x: 0, y: -amount };
    case 'ArrowDown': return { x: 0, y: amount };
    default: return null;
  }
}

/** Ignore malformed storage while recovering numeric coordinates outside their legal range. */
export function parseMusicOrbPosition(raw: string | null): MusicOrbPosition | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const position = value as Record<string, unknown>;
    if (typeof position.x !== 'number' || !Number.isFinite(position.x)
      || typeof position.y !== 'number' || !Number.isFinite(position.y)) return null;
    return { x: clamp(position.x, 0, 1), y: clamp(position.y, 0, 1) };
  } catch {
    return null;
  }
}
