const sourceDateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Display the saved observation date, independent of the viewer's time zone. */
export function sourceAsOf(value: string | null | undefined): string {
  if (!value) return '';
  const datePart = /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0];
  if (!datePart) return '';
  const calendarDate = new Date(`${datePart}T00:00:00.000Z`);
  if (!Number.isFinite(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== datePart) return '';
  if (value === datePart) return `截至 ${datePart}`;
  // A timestamp without a zone would depend on the machine running the page.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return '';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? `截至 ${sourceDateFormat.format(date)}` : '';
}

export function sourceVotesLabel(answer: { voteCount: number; fetchedAt?: string | null } | undefined): string {
  const votes = answer ? answer.voteCount.toLocaleString('zh-CN') : '—';
  const asOf = sourceAsOf(answer?.fetchedAt);
  return `${votes} 赞同${asOf ? ` · ${asOf}` : ''}`;
}
