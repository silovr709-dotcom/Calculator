// Аналитика по базе проектов: деньги, конверсия, средний чек.
// Чистые функции без React и без обращений к сети — их легко проверить тестами.

import type { OrderWorkflowStatus, Project } from '../types';

export interface ProjectMoney {
  id: string;
  name: string;
  client: string;
  date: string;
  status: OrderWorkflowStatus;
  client_total: number;
  cost: number;
  margin: number;
  marginPct: number | null;
}

/** Воронка: какие статусы считаем «отправлено клиенту» и «выиграно». */
export const SENT_STATUSES: OrderWorkflowStatus[] = ['offerSent', 'clientThinking', 'approved', 'techCheck', 'factorySent', 'production', 'ready', 'delivered', 'rejected'];
export const WON_STATUSES: OrderWorkflowStatus[] = ['approved', 'techCheck', 'factorySent', 'production', 'ready', 'delivered'];
export const LOST_STATUSES: OrderWorkflowStatus[] = ['rejected'];

export function projectStatus(project: Project): OrderWorkflowStatus {
  return project.orderWorkflow?.status ?? 'draft';
}

export interface AnalyticsTotals {
  projects: number;
  sent: number;
  won: number;
  lost: number;
  /** Доля выигранных среди тех, где КП уже уходило клиенту, %. */
  conversionPct: number | null;
  wonRevenue: number;
  wonMargin: number;
  wonMarginPct: number | null;
  averageCheck: number | null;
  pipeline: number;
}

export function analyticsTotals(rows: ProjectMoney[]): AnalyticsTotals {
  const sent = rows.filter((row) => SENT_STATUSES.includes(row.status));
  const won = rows.filter((row) => WON_STATUSES.includes(row.status));
  const lost = rows.filter((row) => LOST_STATUSES.includes(row.status));
  const open = rows.filter((row) => !WON_STATUSES.includes(row.status) && !LOST_STATUSES.includes(row.status));

  const wonRevenue = won.reduce((sum, row) => sum + row.client_total, 0);
  const wonMargin = won.reduce((sum, row) => sum + row.margin, 0);

  return {
    projects: rows.length,
    sent: sent.length,
    won: won.length,
    lost: lost.length,
    conversionPct: sent.length > 0 ? (won.length / sent.length) * 100 : null,
    wonRevenue,
    wonMargin,
    wonMarginPct: wonRevenue > 0 ? (wonMargin / wonRevenue) * 100 : null,
    averageCheck: won.length > 0 ? wonRevenue / won.length : null,
    pipeline: open.reduce((sum, row) => sum + row.client_total, 0),
  };
}

export interface MonthRow {
  month: string;        // 2026-10
  label: string;        // октябрь 2026
  projects: number;
  won: number;
  revenue: number;      // сумма выигранных
  margin: number;
  offered: number;      // сумма всех КП месяца
}

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

export function monthLabel(month: string): string {
  const [year, index] = month.split('-');
  const position = Number(index) - 1;
  return position >= 0 && position < 12 ? `${MONTHS[position]} ${year}` : month;
}

export function analyticsByMonth(rows: ProjectMoney[]): MonthRow[] {
  const map = new Map<string, MonthRow>();
  for (const row of rows) {
    const month = (row.date || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    const current = map.get(month) ?? { month, label: monthLabel(month), projects: 0, won: 0, revenue: 0, margin: 0, offered: 0 };
    current.projects += 1;
    current.offered += row.client_total;
    if (WON_STATUSES.includes(row.status)) {
      current.won += 1;
      current.revenue += row.client_total;
      current.margin += row.margin;
    }
    map.set(month, current);
  }
  return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month));
}

export interface ClientRow {
  client: string;
  projects: number;
  revenue: number;
  margin: number;
}

export function analyticsByClient(rows: ProjectMoney[], limit = 8): ClientRow[] {
  const map = new Map<string, ClientRow>();
  for (const row of rows) {
    const client = row.client.trim() || 'Без клиента';
    const current = map.get(client) ?? { client, projects: 0, revenue: 0, margin: 0 };
    current.projects += 1;
    if (WON_STATUSES.includes(row.status)) {
      current.revenue += row.client_total;
      current.margin += row.margin;
    }
    map.set(client, current);
  }
  return Array.from(map.values())
    .sort((a, b) => b.revenue - a.revenue || b.projects - a.projects)
    .slice(0, limit);
}

/** Самые частые модули по всей базе — что продаём чаще всего. */
export function analyticsTopModules(projects: Project[], limit = 10): { name: string; qty: number; projects: number }[] {
  const map = new Map<string, { name: string; qty: number; projects: number }>();
  for (const project of projects) {
    const seen = new Set<string>();
    for (const module of project.modules ?? []) {
      const name = (module.name || '').trim();
      if (!name) continue;
      const current = map.get(name) ?? { name, qty: 0, projects: 0 };
      current.qty += module.qty || 1;
      if (!seen.has(name)) {
        current.projects += 1;
        seen.add(name);
      }
      map.set(name, current);
    }
  }
  return Array.from(map.values()).sort((a, b) => b.qty - a.qty).slice(0, limit);
}
