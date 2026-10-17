// График работ: замеры, доставки и монтажи по всем заказам.
// Чистые функции: строят события из проектов, собирают календарь и ищут накладки.

import type { Project, ProjectSchedule, ScheduleStatus } from '../types';

export type ScheduleEventKind = 'measure' | 'ready' | 'delivery' | 'install';

export const SCHEDULE_KINDS: Array<{ id: ScheduleEventKind; label: string; short: string }> = [
  { id: 'measure', label: 'Замер', short: 'З' },
  { id: 'ready', label: 'Готовность на фабрике', short: 'Ф' },
  { id: 'delivery', label: 'Доставка', short: 'Д' },
  { id: 'install', label: 'Монтаж', short: 'М' },
];

export const SCHEDULE_STATUSES: Array<{ id: ScheduleStatus; label: string }> = [
  { id: 'planned', label: 'Запланировано' },
  { id: 'confirmed', label: 'Подтверждено клиентом' },
  { id: 'done', label: 'Выполнено' },
  { id: 'problem', label: 'Проблема' },
];

export interface ScheduleEvent {
  id: string;
  projectId: string;
  projectName: string;
  client: string;
  kind: ScheduleEventKind;
  /** Дата в формате YYYY-MM-DD. */
  date: string;
  /** Для монтажа длиной в несколько дней — порядковый день и всего дней. */
  dayIndex?: number;
  dayCount?: number;
  team?: string;
  address?: string;
  note?: string;
  status: ScheduleStatus;
  /** К монтажу приложены файлы. */
  hasFiles?: boolean;
}

export function isoDay(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDays(day: string, count: number): string {
  const date = new Date(`${day}T00:00:00`);
  if (Number.isNaN(date.getTime())) return day;
  date.setDate(date.getDate() + count);
  return isoDay(date);
}

function scheduleOf(project: Project): ProjectSchedule {
  return project.schedule ?? {};
}

/** Все события расписания по одному проекту. */
export function projectEvents(project: Project): ScheduleEvent[] {
  const schedule = scheduleOf(project);
  const base = {
    projectId: project.id,
    projectName: project.name,
    client: project.client || 'Без клиента',
    team: schedule.team,
    address: schedule.address,
    note: schedule.note,
    status: schedule.status ?? 'planned',
    hasFiles: (schedule.attachments ?? []).length > 0,
  };
  const events: ScheduleEvent[] = [];
  if (schedule.measureAt) events.push({ ...base, id: `${project.id}-measure`, kind: 'measure', date: schedule.measureAt });
  if (schedule.readyAt) events.push({ ...base, id: `${project.id}-ready`, kind: 'ready', date: schedule.readyAt });
  if (schedule.deliveryAt) events.push({ ...base, id: `${project.id}-delivery`, kind: 'delivery', date: schedule.deliveryAt });
  if (schedule.installAt) {
    const days = Math.max(1, Math.min(14, Math.round(schedule.installDays ?? 1)));
    for (let index = 0; index < days; index += 1) {
      events.push({
        ...base,
        id: `${project.id}-install-${index}`,
        kind: 'install',
        date: addDays(schedule.installAt, index),
        dayIndex: index + 1,
        dayCount: days,
      });
    }
  }
  return events;
}

export function collectEvents(projects: Project[]): ScheduleEvent[] {
  return projects
    .flatMap(projectEvents)
    .sort((left, right) => left.date.localeCompare(right.date) || left.projectName.localeCompare(right.projectName));
}

export function eventsByDay(events: ScheduleEvent[]): Map<string, ScheduleEvent[]> {
  const map = new Map<string, ScheduleEvent[]>();
  for (const event of events) {
    const list = map.get(event.date) ?? [];
    list.push(event);
    map.set(event.date, list);
  }
  return map;
}

/** Сетка месяца: всегда начинается с понедельника и содержит целые недели. */
export function monthGrid(anchor: Date): string[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const shift = (first.getDay() + 6) % 7;          // понедельник = 0
  const start = new Date(first);
  start.setDate(first.getDate() - shift);
  const days: string[] = [];
  for (let index = 0; index < 42; index += 1) {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    days.push(isoDay(day));
  }
  return days;
}

export function weekGrid(anchor: Date): string[] {
  const shift = (anchor.getDay() + 6) % 7;
  const start = new Date(anchor);
  start.setDate(anchor.getDate() - shift);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return isoDay(day);
  });
}

/** Какое поле дат заказа отвечает за событие этого типа — нужно для переноса мышью. */
export function scheduleFieldForKind(kind: ScheduleEventKind): 'measureAt' | 'readyAt' | 'deliveryAt' | 'installAt' {
  if (kind === 'measure') return 'measureAt';
  if (kind === 'ready') return 'readyAt';
  if (kind === 'delivery') return 'deliveryAt';
  return 'installAt';
}

export interface ScheduleWarning {
  projectId: string;
  text: string;
}

/**
 * Проверки графика: монтаж раньше готовности, бригада занята в двух местах,
 * монтаж без адреса и доставка после монтажа.
 */
export function scheduleWarnings(projects: Project[]): ScheduleWarning[] {
  const warnings: ScheduleWarning[] = [];
  const busy = new Map<string, Map<string, string[]>>();   // бригада → день → проекты

  for (const project of projects) {
    const schedule = scheduleOf(project);
    if (!schedule.installAt) continue;

    if (schedule.readyAt && schedule.readyAt > schedule.installAt) {
      warnings.push({ projectId: project.id, text: `«${project.name}»: монтаж назначен раньше готовности на фабрике` });
    }
    if (schedule.deliveryAt && schedule.deliveryAt > schedule.installAt) {
      warnings.push({ projectId: project.id, text: `«${project.name}»: доставка позже монтажа` });
    }
    if (!schedule.address?.trim()) {
      warnings.push({ projectId: project.id, text: `«${project.name}»: у монтажа не указан адрес` });
    }
    if (!schedule.team?.trim()) {
      warnings.push({ projectId: project.id, text: `«${project.name}»: не назначена бригада` });
    }

    const team = schedule.team?.trim();
    if (!team) continue;
    const days = Math.max(1, Math.round(schedule.installDays ?? 1));
    for (let index = 0; index < days; index += 1) {
      const day = addDays(schedule.installAt, index);
      const byDay = busy.get(team) ?? new Map<string, string[]>();
      const list = byDay.get(day) ?? [];
      list.push(project.name);
      byDay.set(day, list);
      busy.set(team, byDay);
    }
  }

  for (const [team, byDay] of busy) {
    for (const [day, names] of byDay) {
      if (names.length > 1) {
        warnings.push({ projectId: '', text: `Бригада «${team}» ${day}: одновременно ${names.length} монтажа — ${names.join(', ')}` });
      }
    }
  }
  return warnings;
}

/** Ближайшие события начиная с сегодняшнего дня. */
export function upcomingEvents(events: ScheduleEvent[], from: string, days = 14): ScheduleEvent[] {
  const until = addDays(from, days);
  return events.filter((event) => event.date >= from && event.date <= until);
}

export interface TeamLoad {
  team: string;
  days: number;
  projects: number;
}

export function teamLoad(events: ScheduleEvent[]): TeamLoad[] {
  const map = new Map<string, { days: Set<string>; projects: Set<string> }>();
  for (const event of events) {
    if (event.kind !== 'install') continue;
    const team = event.team?.trim() || 'Без бригады';
    const current = map.get(team) ?? { days: new Set<string>(), projects: new Set<string>() };
    current.days.add(event.date);
    current.projects.add(event.projectId);
    map.set(team, current);
  }
  return Array.from(map.entries())
    .map(([team, value]) => ({ team, days: value.days.size, projects: value.projects.size }))
    .sort((left, right) => right.days - left.days);
}
