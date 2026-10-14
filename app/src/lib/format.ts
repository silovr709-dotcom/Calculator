export const fmtMoney = (v: number | null | undefined): string =>
  v == null ? '—' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(v) + ' ₽';

export const fmtNum = (v: number | null | undefined, digits = 3): string =>
  v == null ? '—' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(v);

export const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('ru-RU');
};

/** Длинная дата для документов: «15 октября 2026 г.». */
export const fmtDateLong = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
};

export const todayISO = (): string => new Date().toISOString().slice(0, 10);
