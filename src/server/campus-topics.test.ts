import { afterEach, describe, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { CampusTopicsService, LocalTopicCache, startLocalTopicRefresh, TOPIC_REFRESH_MIN_MS, TOPIC_TTL_MS } from './campus-topics-cache';
import { collectCampusTopics, fetchZhihuPublic, parsePublicTopics, publicZhihuUrl, ZhihuPublicError, type PublicTopicFetcher } from './zhihu-public';
import { campusPracticeDraft } from '@/domain/campus-topics';

const DATE = Date.parse('2026-09-13T08:00:00Z');
const response = (titles: string[], start = 1) => ({ Code: 0, Data: { Items: titles.map((Title, index) => ({ Title, Url: `https://www.zhihu.com/question/${start + index}`, EditTime: 1650000000 })) } });
const hot = response(['大学如何选择社团？', '新生选课有什么困惑？']);
const related = response(Array.from({ length: 8 }, (_, index) => `大学生活问题${index}？`), 30);
const cache = () => new LocalTopicCache(`.local/qa/campus-topics-tests/${randomUUID()}.json`);
const fetcher = () => vi.fn<PublicTopicFetcher>().mockImplementation(async request => request.kind === 'hot' ? hot : related);
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('public topic collection', () => {
  test('hot source stays distinct, links stay original, and question answers are deduplicated', async () => {
    const fetch = vi.fn<PublicTopicFetcher>().mockImplementation(async request => request.kind === 'hot' ? hot : { Code: 0, Data: { Items: [
      { Title: '大学如何选择社团？ - 知乎', Url: 'https://www.zhihu.com/question/1/answer/99?utm_source=official' },
      { Title: '大学室友该怎样沟通？', Url: 'https://www.zhihu.com/question/3/answer/100?utm_source=official', EditTime: 1650000000 },
      { Title: '大学室友该怎样沟通？', Url: 'https://www.zhihu.com/question/3/answer/101' },
      { Title: '校园伪造链接', Url: 'https://www.zhihu.com.evil.test/question/4' },
    ] } });
    const topics = await collectCampusTopics(fetch, () => DATE);
    expect(topics.map(item => item.id)).toEqual(['question:1', 'question:2', 'question:3']);
    expect(topics[0].kind).toBe('hot'); expect(topics[2].kind).toBe('related');
    expect(topics[2].url).toBe('https://www.zhihu.com/question/3/answer/100?utm_source=official');
    expect(topics[2].editedAt).toBe(new Date(1650000000 * 1000).toISOString());
    expect(topics[2].fetchedAt).toBe(new Date(DATE).toISOString()); expect(topics[2]).not.toHaveProperty('heat');
  });
  test('enough relevant hot items avoid unnecessary search calls', async () => {
    const fetch = vi.fn<PublicTopicFetcher>().mockResolvedValue(response(Array.from({ length: 12 }, (_, index) => `大学问题${index}？`)));
    expect(await collectCampusTopics(fetch, () => DATE)).toHaveLength(8); expect(fetch).toHaveBeenCalledTimes(1);
  });
  test.each(['http://www.zhihu.com/question/1', 'javascript:alert(1)', 'https://user:secret@www.zhihu.com/question/1', 'https://evil.test/question/1', 'https://www.zhihu.com/people/1'])('only documented public content links survive: %s', url => { expect(publicZhihuUrl(url)).toBeNull(); });
  test('business errors are not empty results; missing dates are never filled with now', () => {
    expect(() => parsePublicTopics({ Code: 30001, Data: null }, 'hot', new Date(DATE).toISOString())).toThrow(expect.objectContaining({ code: 'RATE_LIMITED' }));
    const [topic] = parsePublicTopics({ Code: 0, Data: { Items: [{ Title: '大学新生如何选课？', Url: 'https://www.zhihu.com/question/1' }] } }, 'hot', new Date(DATE).toISOString());
    expect(topic.editedAt).toBeNull();
  });
  test('portable HTTP uses the fixed official host and does not expose secret on failure', async () => {
    vi.stubEnv('ZHIHU_ACCESS_SECRET', 'synthetic-not-a-real-secret');
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(hot), { status: 200 })); vi.stubGlobal('fetch', fetch);
    await fetchZhihuPublic({ kind: 'hot' });
    const [url, init] = fetch.mock.calls[0]; expect(url.origin).toBe('https://developer.zhihu.com'); expect(url.searchParams.get('Limit')).toBe('30');
    expect(init.headers.Authorization).toBe('Bearer synthetic-not-a-real-secret'); expect(init.redirect).toBe('error');
    fetch.mockResolvedValue(new Response('sensitive server message', { status: 401 }));
    await expect(fetchZhihuPublic({ kind: 'hot' })).rejects.toMatchObject({ code: 'AUTH_FAILED', message: 'AUTH_FAILED' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  test('choosing a title makes an editable non-author draft, not a claim about the player', () => {
    const draft = campusPracticeDraft({ title: '大学室友如何相处？', url: 'https://www.zhihu.com/question/1', kind: 'related', fetchedAt: new Date(DATE).toISOString() });
    expect(draft).toContain('我的角色和情况：'); expect(draft).toContain('想和谁谈、希望谈成什么：'); expect(draft).toContain('https://www.zhihu.com/question/1'); expect(draft).not.toContain('不要假装');
  });
});

describe('shared live cache', () => {
  test('ten concurrent readers share one fetch cycle and receive the same result', async () => {
    const fetch = fetcher(); const service = new CampusTopicsService(cache(), fetch, () => DATE);
    const views = await Promise.all(Array.from({ length: 10 }, () => service.get()));
    expect(fetch).toHaveBeenCalledTimes(3); expect(views.every(view => view.items.length === 8 && view.fetchedAt === views[0].fetchedAt && view.status === 'fresh')).toBe(true);
  });
  test('fresh GET is cached, force is globally throttled, refresh time is not check time', async () => {
    let now = DATE; const fetch = fetcher(); const repository = cache(); const service = new CampusTopicsService(repository, fetch, () => now);
    const first = await service.get(); now += 60_000;
    const second = await service.get(); expect(second.fetchedAt).toBe(first.fetchedAt); expect(second.checkedAt).not.toBe(first.checkedAt);
    expect((await service.get(true)).refreshResult).toBe('cooldown'); expect(fetch).toHaveBeenCalledTimes(3);
    const restarted = new CampusTopicsService(new LocalTopicCache((repository as unknown as {file:string}).file), fetch, () => now);
    expect((await restarted.get(true)).refreshResult).toBe('cooldown');
    now += TOPIC_REFRESH_MIN_MS; expect((await service.get(true)).refreshResult).toBe('updated'); expect(fetch).toHaveBeenCalledTimes(6);
  });
  test('upstream failure keeps previous data/date, marks stale, and backs off', async () => {
    let now = DATE; const fetch = fetcher(); const service = new CampusTopicsService(cache(), fetch, () => now);
    const first = await service.get(); now += TOPIC_TTL_MS;
    fetch.mockRejectedValue(new ZhihuPublicError('RATE_LIMITED'));
    const failed = await service.get(); expect(failed.items).toEqual(first.items); expect(failed.fetchedAt).toBe(first.fetchedAt); expect(failed.status).toBe('stale'); expect(failed.error?.code).toBe('RATE_LIMITED');
    await service.get(); await service.get(true); expect(fetch).toHaveBeenCalledTimes(4);
  });
  test('a partial search failure cannot refresh the timestamp of old titles', async () => {
    let now = DATE; const fetch = fetcher(); const service = new CampusTopicsService(cache(), fetch, () => now); const first = await service.get(); now += TOPIC_TTL_MS;
    fetch.mockImplementation(async request => { if (request.kind === 'related') throw new ZhihuPublicError('UNAVAILABLE'); return hot; });
    const failed = await service.get(); expect(failed.fetchedAt).toBe(first.fetchedAt); expect(failed.items).toEqual(first.items);
  });
  test('no-cache failure is unavailable, while successful empty retrieval is honestly empty', async () => {
    const unavailable = await new CampusTopicsService(cache(), async () => { throw new ZhihuPublicError('NOT_CONFIGURED'); }, () => DATE).get();
    expect(unavailable.status).toBe('unavailable'); expect(unavailable.fetchedAt).toBeNull(); expect(unavailable.items).toEqual([]);
    const empty = await new CampusTopicsService(cache(), async () => response([]), () => DATE).get(); expect(empty.status).toBe('empty'); expect(empty.fetchedAt).toBe(new Date(DATE).toISOString());
  });
  test('an expired lease cannot overwrite a later refresh', async () => {
    const repository = cache(); await repository.read(); expect(await repository.claim(DATE, 'old')).toBe(true);
    expect(await repository.claim(DATE + TOPIC_REFRESH_MIN_MS, 'new')).toBe(true);
    expect(await repository.finish('old', DATE + TOPIC_REFRESH_MIN_MS, { version: 1, fetchedAt: null, items: [], error: 'UNAVAILABLE' })).toBe(false);
    expect((await repository.read()).leaseToken).toBe('new');
  });
  test('the running local server timer performs an hourly refresh without a visitor', async () => {
    vi.useFakeTimers(); vi.setSystemTime(DATE); const fetch = fetcher(); const service = new CampusTopicsService(cache(), fetch); await service.get();
    const timer = startLocalTopicRefresh(service);
    await vi.advanceTimersByTimeAsync(TOPIC_TTL_MS); await service.get();
    expect(fetch).toHaveBeenCalledTimes(6); clearInterval(timer);
  });
});
