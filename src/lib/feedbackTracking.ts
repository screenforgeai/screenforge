const EXPORT_COUNT_KEY = 'screenforge.feedback.export-count';

export const MILESTONE_EXPORT_COUNT = 5;

export function incrementExportCount(): number {
  const raw = localStorage.getItem(EXPORT_COUNT_KEY);
  const current = raw !== null ? parseInt(raw, 10) : 0;
  const next = isNaN(current) ? 1 : current + 1;
  localStorage.setItem(EXPORT_COUNT_KEY, String(next));
  return next;
}
