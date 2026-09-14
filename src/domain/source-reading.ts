import type { SourceCard } from './types';

export function sourceReadingHref(source: SourceCard): string {
  try {
    const url = new URL(source.sourceUrl ?? '');
    if (url.protocol === 'https:' && ['www.zhihu.com', 'zhihu.com', 'zhuanlan.zhihu.com'].includes(url.hostname)) return url.href;
  } catch { /* A content id still has a readable in-app source page. */ }
  return `/sources/${encodeURIComponent(source.id)}`;
}
