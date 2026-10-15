import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOTIFY_SETTINGS, dueReminders, eventStart, formatOffset, inQuietHours,
  nextFireAt, normalizeNotifySettings, passedKeys, planReminders, remindersOf,
} from './reminders';
import type { AgendaItem } from './calendar';
import type { CalendarEvent } from '../types';

const settings = { ...DEFAULT_NOTIFY_SETTINGS, defaults: [10, 60], allDayHour: 9, quietFrom: 8, quietUntil: 22 };

const item = (patch: Partial<AgendaItem>): AgendaItem => ({
  id: 'e1', source: 'event', eventId: 'e1', title: 'Замер', kind: 'measure',
  date: '2026-10-20', assignees: ['Пётр'], status: 'planned', ...patch,
});

describe('настройка напоминаний', () => {
  it('подписывает интервалы по-человечески', () => {
    expect(formatOffset(0)).toBe('В момент начала');
    expect(formatOffset(10)).toBe('За 10 минут');
    expect(formatOffset(120)).toBe('За 2 часа');
    expect(formatOffset(10080)).toBe('За неделю');
  });

  it('у дела без времени начало берётся из настроек', () => {
    expect(eventStart({ date: '2026-10-20' }, 9).getHours()).toBe(9);
    expect(eventStart({ date: '2026-10-20', timeStart: '14:30' }, 9).getHours()).toBe(14);
  });

  it('свои интервалы дела важнее умолчаний', () => {
    expect(remindersOf({ reminders: [5] }, settings)).toEqual([5]);
    expect(remindersOf({}, settings)).toEqual([10, 60]);
  });

  it('строит план срабатываний на каждое дело', () => {
    const planned = planReminders([item({ timeStart: '10:00' })], new Map(), settings);
    expect(planned).toHaveLength(2);
    expect(planned[0].fireAt.getHours()).toBe(9);     // за час
    expect(planned[1].fireAt.getMinutes()).toBe(50);  // за 10 минут
  });

  it('по выполненным делам не напоминает', () => {
    expect(planReminders([item({ done: true })], new Map(), settings)).toHaveLength(0);
  });

  it('многодневное дело напоминает только про первый день', () => {
    const planned = planReminders([item({ dayIndex: 2, dayCount: 3 })], new Map(), settings);
    expect(planned).toHaveLength(0);
  });

  it('даты заказов можно отключить', () => {
    const projectItem = item({ id: 'p1-install', source: 'project', eventId: undefined, projectId: 'p1' });
    expect(planReminders([projectItem], new Map(), settings)).toHaveLength(2);
    expect(planReminders([projectItem], new Map(), { ...settings, includeProjects: false })).toHaveLength(0);
  });

  it('учитывает личные интервалы из события', () => {
    const event = { id: 'e1', reminders: [1440] } as unknown as CalendarEvent;
    const planned = planReminders([item({ timeStart: '10:00' })], new Map([['e1', event]]), settings);
    expect(planned).toHaveLength(1);
    expect(planned[0].fireAt.toISOString().slice(0, 10)).toBe('2026-10-19');
  });

  it('ночью не беспокоит', () => {
    expect(inQuietHours(new Date('2026-10-20T03:00:00'), settings)).toBe(true);
    expect(inQuietHours(new Date('2026-10-20T12:00:00'), settings)).toBe(false);
  });

  it('по одному делу показывает только самое свежее напоминание', () => {
    const planned = planReminders([item({ timeStart: '10:00' })], new Map(), settings);
    const now = new Date('2026-10-20T09:55:00');
    const due = dueReminders(planned, now, new Set(), settings);
    expect(due).toHaveLength(1);
    expect(due[0].offset).toBe(10);          // «за час» уже неактуально
    // Приложение помечает показанными все прошедшие ключи, поэтому второй раз тишина.
    expect(dueReminders(planned, now, new Set(passedKeys(planned, now)), settings)).toHaveLength(0);
  });

  it('прошедшие напоминания помечаются и не всплывают снова', () => {
    const planned = planReminders([item({ timeStart: '10:00' })], new Map(), settings);
    const keys = passedKeys(planned, new Date('2026-10-20T09:55:00'));
    expect(keys).toHaveLength(2);
    expect(dueReminders(planned, new Date('2026-10-20T09:56:00'), new Set(keys), settings)).toHaveLength(0);
  });

  it('старые напоминания не всплывают через сутки', () => {
    const planned = planReminders([item({ timeStart: '10:00' })], new Map(), settings);
    expect(dueReminders(planned, new Date('2026-10-21T12:00:00'), new Set(), settings)).toHaveLength(0);
  });

  it('подсказывает время ближайшего срабатывания', () => {
    const planned = planReminders([item({ timeStart: '10:00' })], new Map(), settings);
    const next = nextFireAt(planned, new Date('2026-10-20T08:00:00'), new Set());
    expect(next?.getHours()).toBe(9);
  });

  it('настройки чистятся от мусора', () => {
    const normalized = normalizeNotifySettings({ defaults: [60, 60, -5, 10], allDayHour: 99 } as never);
    expect(normalized.defaults).toEqual([10, 60]);
    expect(normalized.allDayHour).toBe(9);
  });
});
