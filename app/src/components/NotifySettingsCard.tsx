// Настройки напоминаний: за сколько предупреждать, во сколько будить и когда молчать.
// Хранятся на устройстве — у каждого сотрудника свои.

import { useState } from 'react';
import type { NotifySettings } from '../types';
import { REMINDER_OPTIONS, formatOffset } from '../lib/reminders';
import { askNotifyPermission, notifyPermission, type NotifyPermission } from '../lib/notify';

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

export default function NotifySettingsCard(props: {
  value: NotifySettings;
  onChange: (next: NotifySettings) => void;
}) {
  const [permission, setPermission] = useState<NotifyPermission>(() => notifyPermission());
  const { value } = props;

  const toggleDefault = (minutes: number) => {
    const has = value.defaults.includes(minutes);
    const next = has ? value.defaults.filter((item) => item !== minutes) : [...value.defaults, minutes];
    props.onChange({ ...value, defaults: next.sort((a, b) => a - b) });
  };

  const test = () => {
    if (notifyPermission() !== 'granted') return;
    try {
      // eslint-disable-next-line no-new
      new Notification('РЕцепт: проверка уведомлений', { body: 'Так будет выглядеть напоминание о деле.' });
    } catch {
      alert('Браузер не показал уведомление. Проверьте разрешения в настройках сайта.');
    }
  };

  return (
    <section className="card notify-card">
      <div className="section-head">
        <div>
          <h3>Уведомления и напоминания</h3>
          <p className="muted small">Настройки хранятся на этом устройстве: у каждого сотрудника свои.</p>
        </div>
        <span className={`notify-permission ${permission}`}>
          {permission === 'granted' ? 'разрешены'
            : permission === 'denied' ? 'запрещены в браузере'
            : permission === 'unsupported' ? 'не поддерживаются' : 'не включены'}
        </span>
      </div>

      {permission !== 'granted' && (
        <div className="notify-permission-row">
          <button type="button" className="btn primary" disabled={permission === 'denied' || permission === 'unsupported'}
            onClick={() => { void askNotifyPermission().then(setPermission); }}>
            Включить уведомления
          </button>
          {permission === 'denied' && <span className="muted small">Разрешение снято в браузере: откройте значок замка рядом с адресом сайта и включите уведомления.</span>}
        </div>
      )}

      <div className="notify-block">
        <b>Когда напоминать по умолчанию</b>
        <p className="muted small">Применяется ко всем делам, у которых не заданы свои интервалы. Можно выбрать несколько.</p>
        <div className="notify-chips">
          {REMINDER_OPTIONS.map((option) => (
            <button key={option.minutes} type="button"
              className={value.defaults.includes(option.minutes) ? 'active' : ''}
              onClick={() => toggleDefault(option.minutes)}>
              {option.label}
            </button>
          ))}
        </div>
        <p className="muted small">
          {value.defaults.length === 0
            ? 'Сейчас напоминания отключены — ни одно дело не побеспокоит.'
            : `Сейчас: ${value.defaults.map(formatOffset).join(', ').toLowerCase()}.`}
        </p>
      </div>

      <div className="notify-grid">
        <label>Дела без времени считать на
          <select value={value.allDayHour} onChange={(event) => props.onChange({ ...value, allDayHour: Number(event.target.value) })}>
            {HOURS.map((hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}
          </select>
        </label>
        <label>Не беспокоить раньше
          <select value={value.quietFrom} onChange={(event) => props.onChange({ ...value, quietFrom: Number(event.target.value) })}>
            {HOURS.map((hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}
          </select>
        </label>
        <label>Не беспокоить позже
          <select value={value.quietUntil} onChange={(event) => props.onChange({ ...value, quietUntil: Number(event.target.value) })}>
            {HOURS.map((hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}
          </select>
        </label>
        <label className="notify-check">
          <input type="checkbox" checked={value.includeProjects}
            onChange={(event) => props.onChange({ ...value, includeProjects: event.target.checked })} />
          Напоминать и о датах заказов (замер, доставка, монтаж)
        </label>
      </div>

      <div className="notify-actions">
        <button type="button" className="btn ghost" disabled={permission !== 'granted'} onClick={test}>Показать пример уведомления</button>
      </div>
    </section>
  );
}
