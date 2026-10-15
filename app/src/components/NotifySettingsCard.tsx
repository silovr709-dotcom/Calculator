// Настройки напоминаний: за сколько предупреждать, во сколько будить и когда молчать.
// Хранятся на устройстве — у каждого сотрудника свои.

import { useState } from 'react';
import type { NotifySettings } from '../types';
import { CALENDAR_KINDS } from '../lib/calendar';
import ReminderPicker from './ReminderPicker';
import type { CalendarEventKind } from '../types';
import { askNotifyPermission, notifyPermission, type NotifyPermission } from '../lib/notify';

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

export default function NotifySettingsCard(props: {
  value: NotifySettings;
  onChange: (next: NotifySettings) => void;
}) {
  const [permission, setPermission] = useState<NotifyPermission>(() => notifyPermission());
  const { value } = props;

  const setKindRule = (kind: CalendarEventKind, list: number[]) => {
    const byKind = { ...(value.byKind ?? {}) };
    if (list.length === 0) delete byKind[kind];
    else byKind[kind] = list;
    props.onChange({ ...value, byKind });
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
        <p className="muted small">Сколько угодно напоминаний на одно дело: выберите готовые интервалы или задайте свой — хоть «за 45 минут», хоть «за 3 недели».</p>
        <ReminderPicker value={value.defaults} onChange={(defaults) => props.onChange({ ...value, defaults })} />
      </div>

      <details className="notify-block notify-kinds">
        <summary>
          <b>Свои правила для типов дел</b>
          <small>{Object.keys(value.byKind ?? {}).length > 0 ? `настроено: ${Object.keys(value.byKind ?? {}).length}` : 'все по умолчанию'}</small>
        </summary>
        <p className="muted small">Например, о монтаже предупреждать за двое суток, а о звонке — за 10 минут.</p>
        {CALENDAR_KINDS.map((kind) => (
          <div className="notify-kind-row" key={kind.id}>
            <b>{kind.label}</b>
            <ReminderPicker
              compact
              inheritLabel="как общие"
              value={value.byKind?.[kind.id] ?? []}
              onChange={(list) => setKindRule(kind.id, list)}
            />
          </div>
        ))}
      </details>

      <div className="notify-block">
        <b>Повторять, пока не отмечено</b>
        <p className="muted small">Если дело не закрыто, приложение напомнит ещё раз после начала — удобно для звонков и оплат.</p>
        <div className="notify-grid">
          <label>Повтор каждые
            <select value={value.repeatEveryMin ?? 0} onChange={(event) => props.onChange({ ...value, repeatEveryMin: Number(event.target.value) })}>
              {[0, 5, 10, 15, 30, 60, 120].map((minutes) => (
                <option key={minutes} value={minutes}>{minutes === 0 ? 'не повторять' : `${minutes} мин`}</option>
              ))}
            </select>
          </label>
          <label>Сколько раз
            <select value={value.repeatCount ?? 2} disabled={!value.repeatEveryMin}
              onChange={(event) => props.onChange({ ...value, repeatCount: Number(event.target.value) })}>
              {[1, 2, 3, 5, 10].map((count) => <option key={count} value={count}>{count}</option>)}
            </select>
          </label>
        </div>
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
