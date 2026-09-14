export type CampusTopicKind = 'hot' | 'related';
export interface CampusTopicSource { title: string; url: string; kind: CampusTopicKind; fetchedAt: string }
export interface CampusTopic extends CampusTopicSource {
  id: string;
  contentType: 'question' | 'answer' | 'article';
  editedAt: string | null;
}
export type TopicErrorCode = 'NOT_CONFIGURED' | 'AUTH_FAILED' | 'RATE_LIMITED' | 'UNAVAILABLE' | 'INVALID_RESPONSE';
export interface CampusTopicsFeed {
  items: CampusTopic[];
  fetchedAt: string | null;
  checkedAt: string;
  lastAttemptAt: string | null;
  nextAutoRefreshAt: string | null;
  nextManualRefreshAt: string | null;
  status: 'fresh' | 'stale' | 'empty' | 'unavailable' | 'refreshing';
  refreshResult: 'updated' | 'cached' | 'cooldown' | 'failed' | 'in_progress';
  error: { code: TopicErrorCode; message: string } | null;
  hotCount: number;
  relatedCount: number;
}

/** The source is a starting point; the player supplies and edits their own situation. */
export function campusPracticeDraft(topic: CampusTopicSource) {
  return `从这条讨论想到：“${topic.title}”\n\n我想练的一次沟通是：\n我的角色和情况：\n想和谁谈、希望谈成什么：\n\n参考讨论：${topic.url}`;
}
