/** ローカル時刻での YYYY-MM-DD */
export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayKey(): string {
  return toDateKey(new Date());
}

function parseKey(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** from から to までの日数（to が後なら正） */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseKey(to) - parseKey(from)) / 86_400_000);
}

export function addDays(key: string, n: number): string {
  const d = new Date(parseKey(key) + n * 86_400_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function formatJa(key: string): string {
  const [, m, d] = key.split('-').map(Number);
  const w = '日月火水木金土'[new Date(parseKey(key)).getUTCDay()];
  return `${m}/${d}(${w})`;
}
