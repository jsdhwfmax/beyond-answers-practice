/** Chat artwork is fictional. Appearance never changes a role, facts or acceptance rules. */
export const CHAT_AVATAR_VERSION = 'chat-avatars-2026-09-13-v4';

/** Keep this v4 assignment pool and order stable so existing sessions retain their identity. */
export const CHAT_AVATARS = [
  { id: 'chat-male-ink', src: '/art/chat-avatar-male-ink-v4.png', gender: 'male', alt: '戴方框眼镜、穿藏蓝上衣的原创男性同伴' },
  { id: 'chat-female-terracotta', src: '/art/chat-avatar-female-terracotta-v4.png', gender: 'female', alt: '短卷发、穿砖红开衫的原创女性同伴' },
  { id: 'chat-male-ochre', src: '/art/chat-avatar-male-ochre-v4.png', gender: 'male', alt: '短卷发、穿赭黄衬衫的原创男性同伴' },
  { id: 'chat-female-ivory', src: '/art/chat-avatar-female-ivory-v4.png', gender: 'female', alt: '戴圆框眼镜、穿米白衬衫的原创女性同伴' },
] as const;

export type ChatAvatar = typeof CHAT_AVATARS[number];
export type ChatAvatarId = ChatAvatar['id'];

export const USER_CHAT_AVATAR = {
  id: 'chat-user-uniform',
  src: '/art/chat-avatar-user-uniform-v4.png',
  alt: '穿蓝白校服的白色圆脸原创用户头像',
} as const;

export function getChatAvatarById(id: string): ChatAvatar | undefined {
  return CHAT_AVATARS.find(avatar => avatar.id === id);
}

/**
 * A practice's persisted random UUID supplies the random choice; no render-time randomness.
 * Its final two bits are uniformly random, producing a 1:1 male/female probability.
 * Use the practice/session ID (never a branch, turn or date) across the whole conversation.
 * This frozen mapping also restores old records without a migration or localStorage race.
 */
export function getChatAvatar(sessionId: string): ChatAvatar {
  const normalized = sessionId.trim().toLowerCase();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(normalized)) {
    return CHAT_AVATARS[Number.parseInt(normalized.slice(-1), 16) % 4];
  }
  // Stable fallback for imported/demo IDs. Production practice creation uses randomUUID().
  let hash = 2166136261;
  for (const character of normalized) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  return CHAT_AVATARS[hash % 4];
}
