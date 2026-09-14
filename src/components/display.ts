import { TASKS } from '@/domain/scenarios';
import type { Change, TaskId } from '@/domain/types';

/** Present persisted changes in ordinary language without rewriting event data. */
export function displayChange(change: Change): { label: string; before: string; after: string; reason: string } {
  const labels: Record<string, string> = { taskIds: '交付范围', 'transfer.elapsed': '已用模拟时间', 'workplace.tableDeadline': '竞品表截止' };
  const value = (text: string) => {
    if (!text) return '尚未确认';
    if (change.field === 'taskIds') return text.split(',').map((id) => id.trim()).filter(Boolean).map((id) => TASKS[id as TaskId]?.title ?? '待核对任务').join('、');
    if (change.field === 'transfer.elapsed') return /^\d+$/.test(text) ? `${text} 分钟` : text;
    return text;
  };
  return { label: labels[change.field] ?? '本轮记录', before: value(change.before), after: value(change.after), reason: change.reason };
}
