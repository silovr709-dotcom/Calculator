import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

/**
 * Текст, который редактируется прямо на странице КП.
 *
 * Клик — открывает поле, Enter (для многострочных — Ctrl/⌘+Enter) или уход
 * фокуса сохраняет, Escape отменяет. В печать и PDF уходит только текст:
 * оформление «редактируемости» помечено классом и скрывается при печати.
 */
export default function EditableText(props: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  disabled?: boolean;
  className?: string;
  as?: 'span' | 'div';
  label?: string;
}) {
  const { value, onChange, placeholder = 'нажмите, чтобы заполнить', multiline = false, disabled = false } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!editing) return;
    const node = multiline ? areaRef.current : inputRef.current;
    node?.focus();
    node?.select();
  }, [editing, multiline]);

  const start = () => {
    if (disabled) return;
    setDraft(value);
    setEditing(true);
  };
  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next !== value.trim()) onChange(next);
  };
  const cancel = () => { setDraft(value); setEditing(false); };
  const onKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); cancel(); return; }
    if (event.key === 'Enter' && (!multiline || event.ctrlKey || event.metaKey)) { event.preventDefault(); commit(); }
  };

  const Tag = props.as ?? 'span';

  if (editing) {
    return multiline
      ? <textarea
          ref={areaRef}
          className={`editable-field editing ${props.className ?? ''}`}
          rows={Math.min(6, Math.max(2, draft.split('\n').length))}
          value={draft}
          aria-label={props.label}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={onKey}
        />
      : <input
          ref={inputRef}
          className={`editable-field editing ${props.className ?? ''}`}
          value={draft}
          aria-label={props.label}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={onKey}
        />;
  }

  const empty = !value.trim();
  return (
    <Tag
      className={`editable-text ${empty ? 'empty' : ''} ${disabled ? 'locked' : ''} ${props.className ?? ''}`}
      role={disabled ? undefined : 'button'}
      tabIndex={disabled ? undefined : 0}
      title={disabled ? undefined : 'Нажмите, чтобы изменить прямо в КП'}
      aria-label={props.label}
      onClick={start}
      onKeyDown={(event) => { if (!disabled && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); start(); } }}
    >{empty ? placeholder : value}</Tag>
  );
}
