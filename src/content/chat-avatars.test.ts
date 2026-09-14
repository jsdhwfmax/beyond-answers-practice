import { describe, expect, test } from 'vitest';
import { CHAT_AVATARS, getChatAvatar, getChatAvatarById, USER_CHAT_AVATAR } from './chat-avatars';

describe('a practice retains one balanced counterpart identity', () => {
  test('the pool contains two fictional male and two fictional female avatars', () => {
    expect(CHAT_AVATARS.filter(avatar => avatar.gender === 'male')).toHaveLength(2);
    expect(CHAT_AVATARS.filter(avatar => avatar.gender === 'female')).toHaveLength(2);
    expect(new Set(CHAT_AVATARS.map(avatar => avatar.id)).size).toBe(4);
    expect(new Set(CHAT_AVATARS.map(avatar => avatar.src)).size).toBe(4);
    expect(CHAT_AVATARS.some(avatar => avatar.src === USER_CHAT_AVATAR.src as string)).toBe(false);
  });

  test('each equally likely UUID suffix maps to an equal-sized gender pool', () => {
    const assigned = Array.from({ length: 16 }, (_, suffix) => getChatAvatar(`d7cabc27-2026-40ab-98fe-00000000000${suffix.toString(16)}`));
    for (const avatar of CHAT_AVATARS) expect(assigned.filter(value => value.id === avatar.id)).toHaveLength(4);
    expect(assigned.filter(avatar => avatar.gender === 'male')).toHaveLength(8);
    expect(assigned.filter(avatar => avatar.gender === 'female')).toHaveLength(8);
  });

  test('reloads, UUID casing and surrounding whitespace preserve the same identity', () => {
    const id = 'D7CABC27-2026-40AB-98FE-63D5A1B24FCB';
    const avatar = getChatAvatar(id);
    expect(avatar.id).toBe('chat-female-ivory');
    expect(getChatAvatar(id.toLowerCase())).toEqual(avatar);
    expect(getChatAvatar(` ${id} `)).toEqual(avatar);
    expect(getChatAvatar(id)).toEqual(avatar);
    expect(getChatAvatarById(avatar.id)).toEqual(avatar);
  });

  test('demo and imported IDs remain deterministic without requiring browser storage', () => {
    for (const id of ['demo-HR', 'campus-fixture', '练习甲', '']) {
      expect(CHAT_AVATARS).toContainEqual(getChatAvatar(id));
      expect(getChatAvatar(id)).toEqual(getChatAvatar(id));
    }
    expect(getChatAvatarById('removed-or-unknown')).toBeUndefined();
  });
});
