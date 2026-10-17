// Память настроек экранов: фильтры, сортировка, выбранный период.
// Один механизм на всё приложение, чтобы каждый экран открывался так,
// как его оставили, и не приходилось заново щёлкать фильтры.

const PREFIX = 'recept.view.';

export function loadViewPrefs<T extends object>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<T>;
    if (!parsed || typeof parsed !== 'object') return fallback;
    // Берём только известные поля: старые версии настроек не ломают экран.
    const result = { ...fallback };
    for (const field of Object.keys(fallback) as Array<keyof T>) {
      const value = parsed[field];
      if (value !== undefined && typeof value === typeof fallback[field]) {
        result[field] = value as T[keyof T];
      }
    }
    return result;
  } catch {
    return fallback;
  }
}

export function saveViewPrefs<T extends object>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* переполнено — настройки просто не запомнятся */
  }
}

/** Выходные: суббота и воскресенье. Используется для подсветки в календаре. */
export function isWeekend(day: string): boolean {
  const date = new Date(`${day}T00:00:00`);
  if (Number.isNaN(date.getTime())) return false;
  const weekday = date.getDay();
  return weekday === 0 || weekday === 6;
}
