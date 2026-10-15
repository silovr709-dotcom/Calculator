// Напоминания о делах: за сколько предупредить, когда именно сработает
// и что уже показывали. Чистые функции — всё поведение проверяется тестами.

import type { CalendarEvent, NotifySettings } from '../types';
import type { AgendaItem } from './calendar';
import { calendarKindMeta } from './calendar';

export const REMINDER_OPTIONS: Array<{ minutes: number; label: string; short: string }> = [
  { minutes: 0, label: 'В момент начала', short: 'в момент' },
  { minutes: 1, label: 'За 1 минуту', short: '1 мин' },
  { minutes: 5, label: 'За 5 минут', short: '5 мин' },
  { minutes: 10, label: 'За 10 минут', short: '10 мин' },
  { minutes: 15, label: 'За 15 минут', short: '15 мин' },
  { minutes: 30, label: 'За 30 минут', short: '30 мин' },
  { minutes: 60, label: 'За час', short: '1 ч' },
  { minutes: 120, label: 'За 2 часа', short: '2 ч' },
  { minutes: 240, label: 'За 4 часа', short: '4 ч' },
  { minutes: 1440, label: 'За сутки', short: '1 день' },
  { minutes: 2880, label: 'За 2 дня', short: '2 дня' },
  { minutes: 10080, label: 'За неделю', short: 'неделя' },
];

export const DEFAULT_NOTIFY_SETTINGS: NotifySettings = {
  defaults: [60, 1440],
  allDayHour: 9,
  quietFrom: 8,
  quietUntil: 22,
  includeProjects: true,
};

export function normalizeNotifySettings(raw?: Partial<NotifySettings> | null): NotifySettings {
  const value = raw ?? {};
  const defaults = Array.isArray(value.defaults)
    ? Array.from(new Set(value.defaults.filter((item) => Number.isFinite(item) && item >= 0))).sort((a, b) => a - b)
    : DEFAULT_NOTIFY_SETTINGS.defaults;
  const hour = (input: unknown, fallback: number) => {
    const number = Number(input);
    return Number.isFinite(number) && number >= 0 && number <= 23 ? Math.round(number) : fallback;
  };
  return {
    defaults,
    allDayHour: hour(value.allDayHour, DEFAULT_NOTIFY_SETTINGS.allDayHour),
    quietFrom: hour(value.quietFrom, DEFAULT_NOTIFY_SETTINGS.quietFrom),
    quietUntil: hour(value.quietUntil, DEFAULT_NOTIFY_SETTINGS.quietUntil),
    includeProjects: value.includeProjects !== false,
  };
}

/** «За 10 минут», «За 2 часа», «За неделю» — человеческая подпись интервала. */
export function formatOffset(minutes: number): string {
  const known = REMINDER_OPTIONS.find((option) => option.minutes === minutes);
  if (known) return known.label;
  if (minutes < 60) return `За ${minutes} мин`;
  if (minutes < 1440) return `За ${Math.round(minutes / 60)} ч`;
  return `За ${Math.round(minutes / 1440)} дн.`;
}

/** Момент начала дела: дата + время, а для дел без времени — заданный час. */
export function eventStart(item: { date: string; timeStart?: string }, allDayHour: number): Date {
  const time = item.timeStart && /^\d{2}:\d{2}$/.test(item.timeStart)
    ? item.timeStart
    : `${String(allDayHour).padStart(2, '0')}:00`;
  return new Date(`${item.date}T${time}:00`);
}

export function remindersOf(event: Pick<CalendarEvent, 'reminders'>, settings: NotifySettings): number[] {
  const list = event.reminders && event.reminders.length > 0 ? event.reminders : settings.defaults;
  return Array.from(new Set(list.filter((item) => Number.isFinite(item) && item >= 0))).sort((a, b) => a - b);
}

export interface PlannedReminder {
  key: string;
  itemId: string;
  fireAt: Date;
  offset: number;
  title: string;
  body: string;
}

/** Попадает ли момент в разрешённые часы: ночью не тревожим. */
export function inQuietHours(moment: Date, settings: NotifySettings): boolean {
  const hour = moment.getHours();
  if (settings.quietFrom === settings.quietUntil) return false;
  if (settings.quietFrom < settings.quietUntil) return hour < settings.quietFrom || hour >= settings.quietUntil;
  return hour < settings.quietFrom && hour >= settings.quietUntil;
}

/** Все напоминания по делам: что и когда должно прозвенеть. */
export function planReminders(items: AgendaItem[], eventsById: Map<string, CalendarEvent>, settings: NotifySettings): PlannedReminder[] {
  const planned: PlannedReminder[] = [];
  for (const item of items) {
    if (item.done || item.status === 'done') continue;
    if (item.source === 'project' && !settings.includeProjects) continue;
    if (item.dayIndex && item.dayIndex > 1) continue;    // напоминаем один раз, в первый день

    const event = item.eventId ? eventsById.get(item.eventId) : undefined;
    const offsets = remindersOf(event ?? {}, settings);
    const start = eventStart(item, settings.allDayHour);
    if (Number.isNaN(start.getTime())) continue;

    for (const offset of offsets) {
      const fireAt = new Date(start.getTime() - offset * 60000);
      planned.push({
        key: `${item.id}|${offset}|${item.date}`,
        itemId: item.id,
        fireAt,
        offset,
        title: `${calendarKindMeta(item.kind).label}: ${item.client || item.title}`,
        body: [
          offset === 0 ? 'начинается сейчас' : `${formatOffset(offset).toLowerCase()}`,
          item.timeStart ? `в ${item.timeStart}` : null,
          item.address,
          item.assignees.join(', '),
        ].filter(Boolean).join(' · '),
      });
    }
  }
  return planned.sort((left, right) => left.fireAt.getTime() - right.fireAt.getTime());
}

/**
 * Что пора показать прямо сейчас: время пришло, ещё не показывали и не глубокая ночь.
 * По одному делу показываем только самое свежее напоминание: если человек
 * открыл приложение позже, незачем сыпать «за сутки», «за час» и «за 10 минут» подряд.
 */
export function dueReminders(planned: PlannedReminder[], now: Date, shown: Set<string>, settings: NotifySettings, lateToleranceMin = 120): PlannedReminder[] {
  if (inQuietHours(now, settings)) return [];
  const ready = planned.filter((reminder) => {
    if (shown.has(reminder.key)) return false;
    const diff = now.getTime() - reminder.fireAt.getTime();
    return diff >= 0 && diff <= lateToleranceMin * 60000;
  });
  const best = new Map<string, PlannedReminder>();
  for (const reminder of ready) {
    const current = best.get(reminder.itemId);
    if (!current || reminder.offset < current.offset) best.set(reminder.itemId, reminder);
  }
  return Array.from(best.values()).sort((left, right) => left.fireAt.getTime() - right.fireAt.getTime());
}

/** Ключи, которые уже «прошли» — их помечаем показанными, чтобы не всплыли позже. */
export function passedKeys(planned: PlannedReminder[], now: Date): string[] {
  return planned.filter((reminder) => reminder.fireAt.getTime() <= now.getTime()).map((reminder) => reminder.key);
}

/** Ближайшее срабатывание — на него ставим таймер. */
export function nextFireAt(planned: PlannedReminder[], now: Date, shown: Set<string>): Date | null {
  const future = planned
    .filter((reminder) => !shown.has(reminder.key) && reminder.fireAt.getTime() > now.getTime())
    .sort((left, right) => left.fireAt.getTime() - right.fireAt.getTime());
  return future[0]?.fireAt ?? null;
}
