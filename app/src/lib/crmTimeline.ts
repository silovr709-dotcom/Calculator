// Лента событий по сделке: задачи, оплаты, документы, статусы, заметки и
// поведение клиента со ссылкой на КП — всё в одном потоке по времени.

import type { ClientHistoryEntry, ClientProjectPayment, CrmTask, Project } from '../types';
import { PAYMENT_KINDS, taskKindMeta } from './crmTasks';

export type TimelineKind = 'task' | 'payment' | 'document' | 'status' | 'note' | 'contact' | 'offer' | 'project';

export interface TimelineEvent {
  id: string;
  at: string;
  kind: TimelineKind;
  title: string;
  detail?: string;
  author?: string;
}

export interface TimelineSources {
  project: Project;
  history: ClientHistoryEntry[];
  payment?: ClientProjectPayment;
  offer?: { createdAt?: string; views?: number; lastViewAt?: string | null; approvedAt?: string | null; approvedBy?: string | null } | null;
}

function taskEvents(tasks: CrmTask[]): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (const task of tasks) {
    const meta = taskKindMeta(task.kind);
    events.push({
      id: `task-add-${task.id}`,
      at: task.createdAt,
      kind: 'task',
      title: `Задача: ${task.title}`,
      detail: [meta.label, task.dueAt ? `срок ${task.dueAt}` : 'без срока', task.assignee].filter(Boolean).join(' · '),
      author: task.createdBy,
    });
    if (task.done && task.doneAt) {
      events.push({
        id: `task-done-${task.id}`,
        at: task.doneAt,
        kind: 'task',
        title: `Выполнено: ${task.title}`,
        detail: meta.label,
        author: task.assignee,
      });
    }
  }
  return events;
}

function paymentEvents(payment?: ClientProjectPayment): TimelineEvent[] {
  return (payment?.entries ?? []).map((entry) => ({
    id: `pay-${entry.id}`,
    at: entry.at,
    kind: 'payment' as const,
    title: `${PAYMENT_KINDS.find((item) => item.id === entry.kind)?.label ?? 'Платёж'}: ${entry.amount.toLocaleString('ru-RU')} ₽`,
    detail: entry.comment,
    author: entry.createdBy,
  }));
}

function offerEvents(offer: TimelineSources['offer']): TimelineEvent[] {
  if (!offer) return [];
  const events: TimelineEvent[] = [];
  if (offer.createdAt) events.push({ id: 'offer-created', at: offer.createdAt, kind: 'offer', title: 'Клиенту отправлена ссылка на КП' });
  if (offer.lastViewAt) {
    events.push({
      id: 'offer-view',
      at: offer.lastViewAt,
      kind: 'offer',
      title: 'Клиент открывал КП',
      detail: offer.views && offer.views > 1 ? `всего открытий: ${offer.views}` : undefined,
    });
  }
  if (offer.approvedAt) {
    events.push({ id: 'offer-approved', at: offer.approvedAt, kind: 'offer', title: 'Клиент согласовал КП', detail: offer.approvedBy ?? undefined });
  }
  return events;
}

function historyEvents(history: ClientHistoryEntry[], projectId: string): TimelineEvent[] {
  return history
    .filter((entry) => !entry.projectId || entry.projectId === projectId)
    .map((entry) => ({
      id: `hist-${entry.id}`,
      at: entry.createdAt,
      kind: (entry.kind === 'document' ? 'document'
        : entry.kind === 'status' ? 'status'
        : entry.kind === 'payment' ? 'payment'
        : entry.kind === 'contact' ? 'contact'
        : entry.kind === 'project' ? 'project'
        : 'note') as TimelineKind,
      title: entry.title,
      detail: entry.text,
    }));
}

/** Собранная лента: новые события сверху. */
export function buildDealTimeline(sources: TimelineSources): TimelineEvent[] {
  const events = [
    ...taskEvents(sources.project.tasks ?? []),
    ...paymentEvents(sources.payment),
    ...offerEvents(sources.offer),
    ...historyEvents(sources.history, sources.project.id),
  ];
  if (sources.project.createdAt) {
    events.push({ id: 'project-created', at: sources.project.createdAt, kind: 'project', title: 'Сделка создана' });
  }
  return events
    .filter((event) => Boolean(event.at))
    .sort((left, right) => right.at.localeCompare(left.at));
}
