// Задачи и платежи CRM: чистая логика без React.
// Задачи живут внутри проекта, платежи — в карточке клиента по проекту.

import type { ClientProjectPayment, CrmTask, CrmTaskKind, PaymentEntry, PaymentKind, Project } from '../types';

export const TASK_KINDS: Array<{ id: CrmTaskKind; label: string; icon: string }> = [
  { id: 'call', label: 'Позвонить', icon: '☎' },
  { id: 'meet', label: 'Встреча', icon: '👥' },
  { id: 'measure', label: 'Замер', icon: '📐' },
  { id: 'docs', label: 'Документы', icon: '📄' },
  { id: 'payment', label: 'Оплата', icon: '₽' },
  { id: 'delivery', label: 'Доставка и монтаж', icon: '🚚' },
  { id: 'other', label: 'Другое', icon: '•' },
];

export const PAYMENT_KINDS: Array<{ id: PaymentKind; label: string }> = [
  { id: 'prepay', label: 'Предоплата' },
  { id: 'final', label: 'Доплата' },
  { id: 'extra', label: 'Доп. работы' },
  { id: 'refund', label: 'Возврат' },
];

export type TaskTone = 'overdue' | 'today' | 'soon' | 'later' | 'none' | 'done';

export function taskKindMeta(kind: CrmTaskKind) {
  return TASK_KINDS.find((item) => item.id === kind) ?? TASK_KINDS[TASK_KINDS.length - 1];
}

function dayStart(value: string): number {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? Number.NaN : date.getTime();
}

/** Срочность задачи относительно сегодняшнего дня. */
export function taskTone(task: CrmTask, today = new Date()): TaskTone {
  if (task.done) return 'done';
  if (!task.dueAt) return 'none';
  const due = dayStart(task.dueAt);
  if (Number.isNaN(due)) return 'none';
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const days = Math.round((due - base) / 86400000);
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  if (days <= 3) return 'soon';
  return 'later';
}

const TONE_ORDER: Record<TaskTone, number> = { overdue: 0, today: 1, soon: 2, later: 3, none: 4, done: 5 };

export function sortTasks(tasks: CrmTask[], today = new Date()): CrmTask[] {
  return [...tasks].sort((left, right) => {
    const byTone = TONE_ORDER[taskTone(left, today)] - TONE_ORDER[taskTone(right, today)];
    if (byTone !== 0) return byTone;
    const leftDue = left.dueAt ?? '9999-12-31';
    const rightDue = right.dueAt ?? '9999-12-31';
    if (leftDue !== rightDue) return leftDue.localeCompare(rightDue);
    return left.createdAt.localeCompare(right.createdAt);
  });
}

export function openTasks(project: Project): CrmTask[] {
  return (project.tasks ?? []).filter((task) => !task.done);
}

/** Ближайшая невыполненная задача — её показываем в строке списка. */
export function nextTask(project: Project, today = new Date()): CrmTask | null {
  const sorted = sortTasks(openTasks(project), today);
  return sorted[0] ?? null;
}

export interface TaskStats {
  open: number;
  overdue: number;
  today: number;
}

export function taskStats(projects: Project[], today = new Date()): TaskStats {
  let open = 0;
  let overdue = 0;
  let todayCount = 0;
  for (const project of projects) {
    for (const task of openTasks(project)) {
      open += 1;
      const tone = taskTone(task, today);
      if (tone === 'overdue') overdue += 1;
      if (tone === 'today') todayCount += 1;
    }
  }
  return { open, overdue, today: todayCount };
}

export function addTask(project: Project, task: Omit<CrmTask, 'id' | 'createdAt'>): Project {
  const entry: CrmTask = {
    ...task,
    id: `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
  };
  return { ...project, tasks: [...(project.tasks ?? []), entry], updatedAt: new Date().toISOString() };
}

export function patchTask(project: Project, taskId: string, patch: Partial<CrmTask>): Project {
  return {
    ...project,
    tasks: (project.tasks ?? []).map((task) => (task.id === taskId ? { ...task, ...patch } : task)),
    updatedAt: new Date().toISOString(),
  };
}

export function toggleTask(project: Project, taskId: string): Project {
  return {
    ...project,
    tasks: (project.tasks ?? []).map((task) => (task.id === taskId
      ? { ...task, done: !task.done, doneAt: task.done ? undefined : new Date().toISOString() }
      : task)),
    updatedAt: new Date().toISOString(),
  };
}

export function removeTask(project: Project, taskId: string): Project {
  return {
    ...project,
    tasks: (project.tasks ?? []).filter((task) => task.id !== taskId),
    updatedAt: new Date().toISOString(),
  };
}

/* ------------------------------- платежи ------------------------------- */

export function paymentEntries(payment?: ClientProjectPayment): PaymentEntry[] {
  return [...(payment?.entries ?? [])].sort((left, right) => right.at.localeCompare(left.at));
}

/** Итог по платежам; если список пуст — берём старое поле «оплачено». */
export function paidAmount(payment?: ClientProjectPayment): number {
  const entries = payment?.entries ?? [];
  if (entries.length > 0) return entries.reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
  return Math.max(0, Number(payment?.paidTotal ?? payment?.prepayment ?? 0) || 0);
}

export function addPayment(payment: ClientProjectPayment | undefined, entry: Omit<PaymentEntry, 'id'>): ClientProjectPayment {
  const next: PaymentEntry = { ...entry, id: `pay_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}` };
  const entries = [...(payment?.entries ?? []), next];
  const paidTotal = entries.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  return { ...(payment ?? {}), entries, paidTotal, paymentDate: entry.at };
}

export function removePayment(payment: ClientProjectPayment | undefined, id: string): ClientProjectPayment {
  const entries = (payment?.entries ?? []).filter((item) => item.id !== id);
  const paidTotal = entries.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  return { ...(payment ?? {}), entries, paidTotal };
}

/** Статус оплаты по списку платежей: он главнее ручного поля. */
export function paymentState(payment: ClientProjectPayment | undefined, total: number): {
  paid: number;
  remainder: number;
  label: string;
  tone: 'muted' | 'warn' | 'ok' | 'bad';
} {
  const paid = paidAmount(payment);
  const remainder = Math.max(0, total - paid);
  if (total > 0 && paid >= total) return { paid, remainder: 0, label: 'оплачено полностью', tone: 'ok' };
  if (paid > 0) return { paid, remainder, label: 'внесена часть', tone: 'warn' };
  if (payment?.status === 'debt') return { paid, remainder, label: 'долг', tone: 'bad' };
  return { paid, remainder: total, label: 'оплаты нет', tone: 'muted' };
}
