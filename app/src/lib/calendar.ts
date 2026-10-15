// Календарь работ: свои дела (замеры, выезды, встречи) и даты из заказов в одном списке.
// Чистые функции: фильтры по сотруднику, группировка по дням, напоминания.

import type { CalendarEvent, CalendarEventKind, Project, ScheduleStatus } from '../types';
import { addDays, collectEvents, isoDay, type ScheduleEvent } from './schedule';

export const CALENDAR_KINDS: Array<{ id: CalendarEventKind; label: string; short: string }> = [
  { id: 'measure', label: 'Замер', short: 'З' },
  { id: 'delivery', label: 'Доставка', short: 'Д' },
  { id: 'install', label: 'Монтаж', short: 'М' },
  { id: 'meeting', label: 'Встреча', short: 'В' },
  { id: 'call', label: 'Звонок', short: 'Т' },
  { id: 'service', label: 'Сервис, доработка', short: 'С' },
  { id: 'other', label: 'Другое', short: '•' },
];

export function calendarKindMeta(kind: CalendarEventKind) {
  return CALENDAR_KINDS.find((item) => item.id === kind) ?? CALENDAR_KINDS[CALENDAR_KINDS.length - 1];
}

/** Единая запись календаря: и своё дело, и дата из заказа. */
export interface AgendaItem {
  id: string;
  source: 'event' | 'project';
  eventId?: string;
  projectId?: string;
  title: string;
  kind: CalendarEventKind;
  date: string;
  dayIndex?: number;
  dayCount?: number;
  timeStart?: string;
  timeEnd?: string;
  assignees: string[];
  client?: string;
  address?: string;
  note?: string;
  status: ScheduleStatus;
  done?: boolean;
}

function eventDays(event: CalendarEvent): string[] {
  const days = Math.max(1, Math.min(30, Math.round(event.days ?? 1)));
  return Array.from({ length: days }, (_, index) => addDays(event.date, index));
}

export function eventAgenda(events: CalendarEvent[]): AgendaItem[] {
  return events.flatMap((event) => {
    const days = eventDays(event);
    return days.map((date, index) => ({
      id: days.length > 1 ? `${event.id}-${index}` : event.id,
      source: 'event' as const,
      eventId: event.id,
      projectId: event.projectId,
      title: event.title,
      kind: event.kind,
      date,
      dayIndex: days.length > 1 ? index + 1 : undefined,
      dayCount: days.length > 1 ? days.length : undefined,
      timeStart: event.timeStart,
      timeEnd: event.timeEnd,
      assignees: event.assignees ?? [],
      client: event.clientName,
      address: event.address,
      note: event.note,
      status: event.status ?? 'planned',
      done: event.done,
    }));
  });
}

function fromProjectEvent(item: ScheduleEvent): AgendaItem {
  const kind: CalendarEventKind = item.kind === 'ready' ? 'other' : item.kind;
  return {
    id: item.id,
    source: 'project',
    projectId: item.projectId,
    title: item.kind === 'ready' ? `Готовность: ${item.projectName}` : `${item.projectName}`,
    kind,
    date: item.date,
    dayIndex: item.dayIndex,
    dayCount: item.dayCount,
    assignees: item.team ? [item.team] : [],
    client: item.client,
    address: item.address,
    note: item.note,
    status: item.status,
  };
}

/** Всё вместе: свои дела + даты заказов, отсортировано по дате и времени. */
export function buildAgenda(projects: Project[], events: CalendarEvent[]): AgendaItem[] {
  return [...eventAgenda(events), ...collectEvents(projects).map(fromProjectEvent)]
    .sort((left, right) => left.date.localeCompare(right.date)
      || (left.timeStart ?? '').localeCompare(right.timeStart ?? '')
      || left.title.localeCompare(right.title));
}

/** Кто участвует: нормализуем регистр, чтобы «Иван» и «иван» были одним человеком. */
export function sameAssignee(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase('ru-RU') === right.trim().toLocaleLowerCase('ru-RU');
}

export function isMine(item: AgendaItem, me: string): boolean {
  if (!me.trim()) return true;
  if (item.assignees.length === 0) return false;
  return item.assignees.some((name) => sameAssignee(name, me));
}

export function filterAgenda(items: AgendaItem[], options: { assignee?: string; kinds?: CalendarEventKind[]; hideDone?: boolean }): AgendaItem[] {
  return items.filter((item) => {
    if (options.hideDone && item.done) return false;
    if (options.kinds && options.kinds.length > 0 && !options.kinds.includes(item.kind)) return false;
    if (options.assignee && !isMine(item, options.assignee)) return false;
    return true;
  });
}

export function agendaByDay(items: AgendaItem[]): Map<string, AgendaItem[]> {
  const map = new Map<string, AgendaItem[]>();
  for (const item of items) {
    const list = map.get(item.date) ?? [];
    list.push(item);
    map.set(item.date, list);
  }
  return map;
}

export function peopleFromAgenda(items: AgendaItem[]): string[] {
  const set = new Map<string, string>();
  for (const item of items) {
    for (const name of item.assignees) {
      const key = name.trim().toLocaleLowerCase('ru-RU');
      if (key && !set.has(key)) set.set(key, name.trim());
    }
  }
  return Array.from(set.values()).sort((left, right) => left.localeCompare(right, 'ru'));
}

/* ------------------------------ напоминания ------------------------------ */

export interface Reminder {
  id: string;
  date: string;
  title: string;
  detail: string;
  tone: 'overdue' | 'today' | 'tomorrow';
}

/** Что нужно напомнить сотруднику: просрочено, сегодня и завтра. */
export function remindersFor(items: AgendaItem[], me: string, today = isoDay(new Date())): Reminder[] {
  const tomorrow = addDays(today, 1);
  return items
    .filter((item) => !item.done && isMine(item, me))
    .filter((item) => item.date <= tomorrow)
    .filter((item) => item.status !== 'done')
    .map((item) => ({
      id: item.id,
      date: item.date,
      title: `${calendarKindMeta(item.kind).label}: ${item.title}`,
      detail: [item.timeStart, item.client, item.address].filter(Boolean).join(' · '),
      tone: (item.date < today ? 'overdue' : item.date === today ? 'today' : 'tomorrow') as Reminder['tone'],
    }))
    .sort((left, right) => left.date.localeCompare(right.date));
}

/* ------------------------------ изменение ------------------------------ */

export function makeEvent(patch: Partial<CalendarEvent> & { title: string; date: string }, author?: string): CalendarEvent {
  const now = new Date().toISOString();
  return {
    id: `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    kind: 'other',
    assignees: [],
    status: 'planned',
    createdAt: now,
    createdBy: author,
    updatedAt: now,
    ...patch,
  };
}

export function patchEvent(events: CalendarEvent[], id: string, patch: Partial<CalendarEvent>): CalendarEvent[] {
  return events.map((event) => (event.id === id ? { ...event, ...patch, updatedAt: new Date().toISOString() } : event));
}

export function removeEvent(events: CalendarEvent[], id: string): CalendarEvent[] {
  return events.filter((event) => event.id !== id);
}
