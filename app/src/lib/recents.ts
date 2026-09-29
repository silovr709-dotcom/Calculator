// «Недавно использованные» позиции прайса для каталога. Хранятся локально в браузере,
// не входят в проект и не влияют на расчёт.

const STORAGE_KEY = 'visma-recent-items-v1';
export const RECENTS_LIMIT = 8;

/** Чистая функция: поднимает id наверх списка, ограничивает длину. */
export function pushRecent(list: string[], id: string, limit: number = RECENTS_LIMIT): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, Math.max(1, limit));
}

export function loadRecentItems(): string[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function saveRecentItems(ids: string[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids.slice(0, RECENTS_LIMIT)));
  } catch { /* приватный режим и т.п. — не критично */ }
}

/** Загрузить список, поднять позицию и сохранить. Возвращает обновлённый список. */
export function recordRecentItem(id: string): string[] {
  const next = pushRecent(loadRecentItems(), id);
  saveRecentItems(next);
  return next;
}
