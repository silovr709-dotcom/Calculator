// Выбор напоминаний: готовые интервалы чипами плюс свой — любое число и единица.
// Используется и в общих настройках, и у конкретного дела.

import { useState } from 'react';
import { REMINDER_OPTIONS, formatOffset, offsetFromInput, shortOffset } from '../lib/reminders';

type Unit = 'min' | 'hour' | 'day' | 'week';

const UNITS: Array<{ id: Unit; label: string }> = [
  { id: 'min', label: 'минут' },
  { id: 'hour', label: 'часов' },
  { id: 'day', label: 'дней' },
  { id: 'week', label: 'недель' },
];

export default function ReminderPicker(props: {
  value: number[];
  onChange: (next: number[]) => void;
  /** Текст первого чипа «как в настройках»; если не задан — чип не показываем. */
  inheritLabel?: string;
  compact?: boolean;
}) {
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState<Unit>('min');

  const toggle = (minutes: number) => {
    const next = props.value.includes(minutes)
      ? props.value.filter((item) => item !== minutes)
      : [...props.value, minutes];
    props.onChange(next.sort((a, b) => a - b));
  };

  const addCustom = () => {
    const minutes = offsetFromInput(Number(amount.replace(',', '.')), unit);
    if (minutes == null) return;
    if (!props.value.includes(minutes)) props.onChange([...props.value, minutes].sort((a, b) => a - b));
    setAmount('');
  };

  // Свои интервалы, которых нет среди готовых, показываем отдельными чипами с крестиком.
  const custom = props.value.filter((minutes) => !REMINDER_OPTIONS.some((option) => option.minutes === minutes));

  return (
    <div className="reminder-picker">
      <div className="notify-chips">
        {props.inheritLabel && (
          <button type="button" className={props.value.length === 0 ? 'active' : ''} onClick={() => props.onChange([])}>
            {props.inheritLabel}
          </button>
        )}
        {REMINDER_OPTIONS.map((option) => (
          <button key={option.minutes} type="button" className={props.value.includes(option.minutes) ? 'active' : ''}
            onClick={() => toggle(option.minutes)}>
            {props.compact ? option.short : option.label}
          </button>
        ))}
        {custom.map((minutes) => (
          <button key={minutes} type="button" className="active custom" onClick={() => toggle(minutes)}
            title="Нажмите, чтобы убрать">
            {props.compact ? shortOffset(minutes) : formatOffset(minutes)} ✕
          </button>
        ))}
      </div>

      <div className="reminder-custom">
        <span>Свой интервал: за</span>
        <input value={amount} inputMode="numeric" placeholder="например, 45"
          onChange={(event) => setAmount(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') addCustom(); }} />
        <select value={unit} onChange={(event) => setUnit(event.target.value as Unit)}>
          {UNITS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <button type="button" className="btn tiny ghost" disabled={!amount.trim()} onClick={addCustom}>Добавить</button>
      </div>

      <p className="muted small">
        {props.value.length === 0
          ? (props.inheritLabel ? 'Используются общие настройки.' : 'Напоминаний нет.')
          : `Напомним ${props.value.length} раз: ${props.value.map((minutes) => formatOffset(minutes).toLowerCase()).join(', ')}.`}
      </p>
    </div>
  );
}
