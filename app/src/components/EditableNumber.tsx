import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { evaluateNumericExpression } from '../lib/numericExpression';

/**
 * Число, которое правится прямо в КП: количество петель, направляющих, сумма позиции.
 *
 * Клик открывает поле, Enter или уход фокуса сохраняет, Escape отменяет.
 * Принимает выражения: «12+4», «2*6» — как и остальные числовые поля программы.
 * Пустое поле возвращает позицию к расчётному значению (onChange(null)).
 */
export default function EditableNumber(props: {
  /** Текущее значение (уже с учётом ручной правки). */
  value: number | null;
  /** Как показывать значение в режиме чтения. */
  format: (value: number | null) => string;
  /** null — сбросить правку и вернуть расчётное значение. */
  onChange: (value: number | null) => void;
  label: string;
  /** true — значение поправлено вручную: подсвечиваем и даём подсказку с расчётным. */
  edited?: boolean;
  baseHint?: string;
  disabled?: boolean;
  className?: string;
}) {
  const { value, format, onChange, label, edited = false, disabled = false } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  const start = () => {
    if (disabled) return;
    setDraft(value == null ? '' : String(Math.round(value * 1000) / 1000));
    setEditing(true);
  };
  const commit = () => {
    setEditing(false);
    const raw = draft.trim();
    if (!raw) { onChange(null); return; }
    const parsed = evaluateNumericExpression(raw);
    if (parsed == null || parsed < 0) return;
    if (value != null && Math.abs(parsed - value) < 0.0005) return;
    onChange(parsed);
  };
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); setEditing(false); return; }
    if (event.key === 'Enter') { event.preventDefault(); commit(); }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={`editable-field editable-number editing ${props.className ?? ''}`}
        value={draft}
        aria-label={label}
        inputMode="decimal"
        placeholder="пусто — вернуть расчёт"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={onKey}
      />
    );
  }

  return (
    <span
      className={`editable-text editable-number ${edited ? 'edited' : ''} ${disabled ? 'locked' : ''} ${props.className ?? ''}`}
      role={disabled ? undefined : 'button'}
      tabIndex={disabled ? undefined : 0}
      title={disabled ? undefined : edited && props.baseHint ? `Поправлено вручную. По расчёту: ${props.baseHint}. Пустое поле вернёт расчёт.` : 'Нажмите, чтобы изменить прямо в КП'}
      aria-label={label}
      onClick={start}
      onKeyDown={(event) => { if (!disabled && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); start(); } }}
    >{format(value)}</span>
  );
}
