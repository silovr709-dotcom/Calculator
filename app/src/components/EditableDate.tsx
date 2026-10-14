// Дата в документе: в КП это должна быть строка «15 октября 2026 г.», а не поле ввода.
// Клик превращает её в календарь, уход фокуса — обратно в текст. В печать и PDF
// уходит только текст: рамка и значок календаря остаются на экране.

import { useEffect, useRef, useState } from 'react';
import { fmtDateLong } from '../lib/format';

export default function EditableDate(props: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const { value, onChange, label, placeholder = 'выбрать дату', disabled = false } = props;
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editing) return;
    const node = inputRef.current;
    node?.focus();
    node?.showPicker?.();
  }, [editing]);

  if (editing && !disabled) {
    return (
      <input
        ref={inputRef}
        className="editable-date"
        type="date"
        value={value}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === 'Escape') setEditing(false); }}
      />
    );
  }

  return (
    <button
      type="button"
      className={`editable-date-text${value ? '' : ' empty'}`}
      aria-label={label}
      disabled={disabled}
      onClick={() => setEditing(true)}
    >
      {value ? fmtDateLong(value) : placeholder}
    </button>
  );
}
