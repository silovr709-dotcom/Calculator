// Чистая логика экрана CRM: фильтры, сортировка, подписи и сводка по воронке.
// Вынесено из компонента, чтобы поведение можно было проверить тестами.

import type { OrderWorkflowStatus } from '../types';
import { fmtDate } from './format';
import type { NextContactTone } from './crm';

export type CrmFocus = 'today' | 'week' | 'no-next' | 'active' | 'closed' | 'all';

export interface CrmStageDef {
  id: string;
  title: string;
  hint: string;
  statuses: OrderWorkflowStatus[];
}

export const CRM_STAGES: CrmStageDef[] = [
  { id: 'lead', title: 'Лид и расчёт', hint: 'замер, данные, просчёт', statuses: ['draft', 'calculating'] },
  { id: 'offer', title: 'КП у клиента', hint: 'отправлено, клиент думает', statuses: ['offerSent', 'clientThinking'] },
  { id: 'approved', title: 'Согласовано', hint: 'договор и проверка', statuses: ['approved', 'techCheck'] },
  { id: 'production', title: 'Производство', hint: 'фабрика и готовность', statuses: ['factorySent', 'production', 'ready'] },
  { id: 'closed', title: 'Закрыто', hint: 'выдано или отказ', statuses: ['delivered', 'rejected'] },
];

export const CRM_FOCUS_LABELS: Record<CrmFocus, string> = {
  today: 'Сегодня и просрочено',
  week: 'На неделе',
  'no-next': 'Без следующего шага',
  active: 'Все активные',
  closed: 'Закрытые',
  all: 'Вообще все',
};

/** Минимум данных строки, нужный для фильтрации и сортировки. */
export interface CrmRowLike {
  status: OrderWorkflowStatus;
  tone: NextContactTone;
  hasNextAction: boolean;
  closed: boolean;
  total: number;
  updatedAt: string;
  search: string;
}

export function matchesFocus(row: CrmRowLike, focus: CrmFocus): boolean {
  switch (focus) {
    case 'today': return !row.closed && (row.tone === 'overdue' || row.tone === 'today');
    case 'week': return !row.closed && (row.tone === 'overdue' || row.tone === 'today' || row.tone === 'soon');
    case 'no-next': return !row.closed && (!row.hasNextAction || row.tone === 'none');
    case 'active': return !row.closed;
    case 'closed': return row.closed;
    case 'all': return true;
    default: return true;
  }
}

export function matchesQuery(row: CrmRowLike, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase('ru-RU');
  if (!needle) return true;
  return row.search.toLocaleLowerCase('ru-RU').includes(needle);
}

const TONE_RANK: Record<NextContactTone, number> = { overdue: 0, today: 1, none: 2, soon: 3, planned: 4 };

export function compareCrmRows(left: CrmRowLike, right: CrmRowLike): number {
  const byTone = TONE_RANK[left.tone] - TONE_RANK[right.tone];
  if (byTone !== 0) return byTone;
  return right.updatedAt.localeCompare(left.updatedAt);
}

/** Человеческая подпись срока следующего контакта. */
export function toneLabel(tone: NextContactTone, value?: string): string {
  if (tone === 'none') return 'срок не назначен';
  if (tone === 'overdue') return value ? `просрочено с ${fmtDate(value)}` : 'просрочено';
  if (tone === 'today') return 'сегодня';
  if (tone === 'soon') return value ? `скоро · ${fmtDate(value)}` : 'скоро';
  return value ? fmtDate(value) : 'запланировано';
}

export interface StageSummary extends CrmStageDef {
  count: number;
  total: number;
}

export function summarizeStages(rows: CrmRowLike[]): StageSummary[] {
  return CRM_STAGES.map((stage) => {
    const stageRows = rows.filter((row) => stage.statuses.includes(row.status));
    return { ...stage, count: stageRows.length, total: stageRows.reduce((sum, row) => sum + row.total, 0) };
  });
}

export interface FocusCounts {
  today: number;
  week: number;
  noNext: number;
  active: number;
  closed: number;
  pipeline: number;
}

export function focusCounts(rows: CrmRowLike[]): FocusCounts {
  const active = rows.filter((row) => !row.closed);
  return {
    today: active.filter((row) => row.tone === 'overdue' || row.tone === 'today').length,
    week: active.filter((row) => row.tone === 'overdue' || row.tone === 'today' || row.tone === 'soon').length,
    noNext: active.filter((row) => !row.hasNextAction || row.tone === 'none').length,
    active: active.length,
    closed: rows.length - active.length,
    pipeline: active.reduce((sum, row) => sum + row.total, 0),
  };
}
