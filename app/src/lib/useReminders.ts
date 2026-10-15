// Фоновая служба напоминаний: держит таймер на ближайшее срабатывание,
// показывает уведомление браузера и помнит, о чём уже сказали.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CalendarEvent, NotifySettings, Project } from '../types';
import { buildAgenda, filterAgenda } from './calendar';
import { dueReminders, nextFireAt, passedKeys, planReminders } from './reminders';
import { notifyPermission } from './notify';

const SHOWN_KEY = 'recept.reminders.shown.v1';

function readShown(): Set<string> {
  try {
    const raw = localStorage.getItem(SHOWN_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeShown(keys: Set<string>): void {
  try {
    // Храним последние 400 ключей: больше не нужно, список не должен расти бесконечно.
    localStorage.setItem(SHOWN_KEY, JSON.stringify(Array.from(keys).slice(-400)));
  } catch {
    /* переполнено — переживём */
  }
}

export interface RemindersState {
  /** Сколько напоминаний ждёт впереди сегодня. */
  plannedToday: number;
  /** Когда прозвенит ближайшее. */
  next: Date | null;
}

export function useReminders(projects: Project[], events: CalendarEvent[], settings: NotifySettings, me: string): RemindersState {
  const shownRef = useRef<Set<string>>(readShown());
  const [state, setState] = useState<RemindersState>({ plannedToday: 0, next: null });

  const planned = useMemo(() => {
    const agenda = filterAgenda(buildAgenda(projects, events), { assignee: me });
    const byId = new Map(events.map((event) => [event.id, event]));
    return planReminders(agenda, byId, settings);
  }, [projects, events, settings, me]);

  const fire = useCallback(() => {
    const now = new Date();
    const due = dueReminders(planned, now, shownRef.current, settings);
    if (due.length > 0 && notifyPermission() === 'granted') {
      for (const reminder of due) {
        try {
          // eslint-disable-next-line no-new
          new Notification(reminder.title, { body: reminder.body, tag: reminder.key, requireInteraction: reminder.offset <= 10 });
        } catch {
          break;
        }
      }
    }
    for (const key of passedKeys(planned, now)) shownRef.current.add(key);
    if (due.length > 0) writeShown(shownRef.current);

    const today = now.toISOString().slice(0, 10);
    setState({
      plannedToday: planned.filter((item) => item.fireAt > now && item.fireAt.toISOString().slice(0, 10) === today).length,
      next: nextFireAt(planned, now, shownRef.current),
    });
  }, [planned, settings]);

  useEffect(() => {
    // Запускаем не синхронно: сначала даём интерфейсу отрисоваться.
    const start = window.setTimeout(() => fire(), 0);
    const interval = window.setInterval(() => fire(), 30 * 1000);
    const onVisible = () => { if (document.visibilityState === 'visible') fire(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fire]);

  return state;
}
