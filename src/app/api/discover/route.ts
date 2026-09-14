import { CAMPUS_PROFILE_OPTIONS, isCampusProfileCombinationValid, type CampusProfileFilters } from '@/domain/campus-profile-options';
import { discoverCampusQuestions, previewCampusQuestions, PROFILE_SOURCE_VERSION } from '@/server/campus-profile-library';
import { AppError } from '@/server/errors';
import { handle, response } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return handle(() => {
    const params = new URL(request.url).searchParams;
    const allowed = new Set(['education', 'schoolTier', 'stage', 'offset', 'limit', 'preview', 'expectedSourceVersion']);
    for (const key of params.keys()) {
      if (!allowed.has(key) || params.getAll(key).length !== 1) throw new AppError('INVALID_FILTER', '筛选内容不完整，请重新选择后查看。');
    }
    const filters: CampusProfileFilters = {};
    for (const dimension of ['education', 'schoolTier', 'stage'] as const) {
      const value = params.get(dimension);
      if (!value) continue;
      if (!CAMPUS_PROFILE_OPTIONS[dimension].some(option => option.value === value)) throw new AppError('INVALID_FILTER', '这个筛选项暂时无法识别，请重新选择。');
      Object.assign(filters, { [dimension]: value });
    }
    if (!isCampusProfileCombinationValid(filters)) throw new AppError('INCOMPATIBLE_FILTERS', '学历与院校类型不匹配。请按同一就读阶段重新选择，或将院校类型设为不限。');
    const expectedVersion = params.get('expectedSourceVersion');
    if (expectedVersion !== null) {
      if (!/^[a-zA-Z0-9._-]{1,80}$/.test(expectedVersion)) throw new AppError('INVALID_FILTER', '题库版本无法识别，请重新查找。');
      if (expectedVersion !== PROFILE_SOURCE_VERSION) throw new AppError('SOURCE_VERSION_CHANGED', '题库已更新，正在重新核对数量。请查看新数量后再查找。', 409);
    }
    if (params.has('preview')) {
      if (params.get('preview') !== '1' || params.has('offset') || params.has('limit')) throw new AppError('INVALID_FILTER', '数量预览内容不完整，请重新选择。');
      return response(previewCampusQuestions(filters));
    }
    const integer = (key: string, fallback: number, minimum: number, maximum: number) => {
      const value = params.get(key);
      if (value === null || value === '') return fallback;
      if (!/^\d{1,6}$/.test(value) || Number(value) < minimum || Number(value) > maximum) throw new AppError('INVALID_PAGE', '页码或每页数量有误，请重新查看。');
      return Number(value);
    };
    return response(discoverCampusQuestions(filters, integer('offset', 0, 0, 100000), integer('limit', 8, 1, 24)));
  });
}
