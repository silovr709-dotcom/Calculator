// Напоминания о делах: всплывающие уведомления браузера + список внутри приложения.
// Работает и на телефоне: уведомление приходит, пока вкладка открыта или висит в фоне.

import type { Reminder } from './calendar';

const SEEN_KEY = 'recept.notified.v1';

export type NotifyPermission = 'default' | 'granted' | 'denied' | 'unsupported';

export function notifyPermission(): NotifyPermission {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission as NotifyPermission;
}

export async function askNotifyPermission(): Promise<NotifyPermission> {
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission as NotifyPermission;
  try {
    return (await Notification.requestPermission()) as NotifyPermission;
  } catch {
    return 'denied';
  }
}

function readSeen(): Record<string, string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeSeen(value: Record<string, string>): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(value));
  } catch {
    /* переполнено — не страшно, просто покажем напоминание ещё раз */
  }
}

/**
 * Показывает уведомления по напоминаниям, о которых сегодня ещё не говорили.
 * Возвращает, сколько уведомлений реально показали.
 */
export function pushReminderNotifications(reminders: Reminder[], today: string): number {
  if (notifyPermission() !== 'granted') return 0;
  const seen = readSeen();
  let shown = 0;
  for (const reminder of reminders) {
    const key = `${reminder.id}:${reminder.date}`;
    if (seen[key] === today) continue;
    try {
      const prefix = reminder.tone === 'overdue' ? 'Просрочено' : reminder.tone === 'today' ? 'Сегодня' : 'Завтра';
      // eslint-disable-next-line no-new
      new Notification(`${prefix}: ${reminder.title}`, {
        body: reminder.detail || 'Откройте график работ в РЕцепте',
        tag: key,
      });
      seen[key] = today;
      shown += 1;
    } catch {
      break;   // браузер не дал показать — не пытаемся дальше
    }
  }
  if (shown > 0) writeSeen(seen);
  return shown;
}
