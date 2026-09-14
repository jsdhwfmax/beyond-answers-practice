import { beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ discover: vi.fn() }));
vi.mock('@/server/campus-profile-library', () => ({ discoverCampusQuestions: mocks.discover }));
import { GET } from '@/app/api/discover/route';

beforeEach(() => {
  mocks.discover.mockReset().mockImplementation((filters, offset, limit) => ({ version: 'test-v1', filters, total: 0, offset, limit, matches: [] }));
});
test('public profile browsing preserves all chosen filters and needs no guest or model', async () => {
  const result = await GET(new Request('https://practice.test/api/discover?education=bachelor&schoolTier=985&stage=studying&offset=8&limit=8'));
  expect(result.status).toBe(200);
  expect(mocks.discover).toHaveBeenCalledExactlyOnceWith({ education: 'bachelor', schoolTier: '985', stage: 'studying' }, 8, 8);
  expect(result.headers.get('set-cookie')).toBeNull();
  expect(await result.json()).toMatchObject({ filters: { education: 'bachelor', schoolTier: '985', stage: 'studying' }, total: 0, matches: [] });
});
test('empty optional selections mean unfiltered browsing with bounded default pagination', async () => {
  expect((await GET(new Request('https://practice.test/api/discover?education=&schoolTier=&stage='))).status).toBe(200);
  expect(mocks.discover).toHaveBeenCalledExactlyOnceWith({}, 0, 8);
});
test.each([
  'education=university', 'schoolTier=211_non985', 'stage=unknown', 'education=master&education=bachelor',
  'authorIdentity=985', 'offset=-1', 'offset=1.5', 'limit=0', 'limit=25', 'limit=Infinity',
])('invalid or ambiguous filters and pagination fail without calling discovery: %s', async (query) => {
  const result = await GET(new Request(`https://practice.test/api/discover?${query}`));
  expect(result.status).toBe(400); expect(mocks.discover).not.toHaveBeenCalled();
});

test.each([
  'education=junior_college&schoolTier=985', 'education=junior_college&schoolTier=211',
  'education=junior_college&schoolTier=double_first_class', 'education=junior_college&schoolTier=ordinary_undergraduate',
  'education=bachelor&schoolTier=vocational_college', 'education=master&schoolTier=vocational_college', 'education=doctor&schoolTier=vocational_college',
])('contradictory pairs are rejected before discovery, never silently broadened: %s', async query => {
  const result = await GET(new Request(`https://practice.test/api/discover?${query}`));
  expect(result.status).toBe(400); expect(mocks.discover).not.toHaveBeenCalled();
  expect(await result.json()).toMatchObject({ error: { code: 'INCOMPATIBLE_FILTERS', message: expect.stringContaining('同一就读阶段') } });
});

test.each([
  ['education=junior_college&schoolTier=vocational_college', { education: 'junior_college', schoolTier: 'vocational_college' }],
  ['education=junior_college', { education: 'junior_college' }],
  ['schoolTier=vocational_college', { schoolTier: 'vocational_college' }],
  ['schoolTier=211', { schoolTier: '211' }],
] as const)('compatible and optional pairs reach discovery unchanged: %s', async (query, filters) => {
  const result = await GET(new Request(`https://practice.test/api/discover?${query}`));
  expect(result.status).toBe(200); expect(mocks.discover).toHaveBeenCalledExactlyOnceWith(filters, 0, 8);
});
