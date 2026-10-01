import { useEffect } from 'react';
import { evaluateNumericExpression, formatNumericExpressionResult } from '../lib/numericExpression';

function isNumericInput(element: EventTarget | null): element is HTMLInputElement {
  if (!(element instanceof HTMLInputElement)) return false;
  if (element.disabled || element.readOnly) return false;
  const type = element.type;
  const inputMode = element.inputMode;
  return type === 'number' || inputMode === 'numeric' || inputMode === 'decimal' || element.dataset.numberCalculator === 'true';
}

function hasMathSyntax(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  // Минус в начале числа не считаем «примером», но внутренние операторы, скобки и проценты — считаем.
  return /[+*/×хx÷:%()]/iu.test(trimmed) || /.+[-−–—].+/u.test(trimmed);
}

function printableMathKey(key: string): boolean {
  return /^[0-9]$/u.test(key) || /^[+\-*/.,()×хx÷:%−–—]$/iu.test(key);
}

function normalizeInsertedKey(key: string): string {
  if (key === '×' || key.toLowerCase() === 'х') return '*';
  if (key === '÷' || key === ':') return '/';
  if (key === '−' || key === '–' || key === '—') return '-';
  return key;
}

function setInputValue(input: HTMLInputElement, value: string, dispatchEvents: boolean): void {
  const prototype = window.HTMLInputElement.prototype;
  const prototypeDescriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  const ownDescriptor = Object.getOwnPropertyDescriptor(input, 'value');
  const setter = prototypeDescriptor?.set ?? ownDescriptor?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  if (!dispatchEvents) return;
  const inputEvent = typeof InputEvent !== 'undefined'
    ? new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: value })
    : new Event('input', { bubbles: true });
  input.dispatchEvent(inputEvent);
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function setCaret(input: HTMLInputElement, position: number): void {
  try {
    input.setSelectionRange(position, position);
  } catch {
    // input[type=number] не поддерживает setSelectionRange — это нормально.
  }
}

function replaceSelection(input: HTMLInputElement, insert: string): void {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  const next = `${input.value.slice(0, start)}${insert}${input.value.slice(end)}`;
  setInputValue(input, next, false);
  setCaret(input, start + insert.length);
}

function removeSelection(input: HTMLInputElement, direction: 'backward' | 'forward'): void {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  if (start !== end) {
    setInputValue(input, `${input.value.slice(0, start)}${input.value.slice(end)}`, false);
    setCaret(input, start);
    return;
  }
  if (direction === 'backward' && start > 0) {
    setInputValue(input, `${input.value.slice(0, start - 1)}${input.value.slice(start)}`, false);
    setCaret(input, start - 1);
  }
  if (direction === 'forward' && start < input.value.length) {
    setInputValue(input, `${input.value.slice(0, start)}${input.value.slice(start + 1)}`, false);
    setCaret(input, start);
  }
}

export default function NumberFieldCalculator() {
  useEffect(() => {
    const draftMeta = new WeakMap<HTMLInputElement, { originalType: string; originalInputMode: string; originalValue: string }>();

    const enterDraftMode = (input: HTMLInputElement) => {
      if (!draftMeta.has(input)) {
        draftMeta.set(input, { originalType: input.type, originalInputMode: input.inputMode, originalValue: input.value });
      }
      if (input.type === 'number') {
        try { input.type = 'text'; } catch { /* ignore */ }
      }
      input.inputMode = 'decimal';
      input.dataset.numberExpressionDraft = 'true';
    };

    const exitDraftMode = (input: HTMLInputElement, restoreOriginalValue: boolean) => {
      const meta = draftMeta.get(input);
      if (!meta) return;
      if (restoreOriginalValue) setInputValue(input, meta.originalValue, false);
      delete input.dataset.numberExpressionDraft;
      input.inputMode = meta.originalInputMode;
      if (meta.originalType === 'number') {
        try { input.type = 'number'; } catch { /* ignore */ }
      }
      draftMeta.delete(input);
    };

    const applyExpressionToInput = (input: HTMLInputElement, allowPlainNumber = false): boolean => {
      const raw = input.value;
      if (!allowPlainNumber && !hasMathSyntax(raw)) return false;
      const calculated = evaluateNumericExpression(raw);
      if (calculated == null) return false;
      const formatted = formatNumericExpressionResult(calculated);
      setInputValue(input, formatted, true);
      setCaret(input, formatted.length);
      exitDraftMode(input, false);
      return true;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isNumericInput(event.target)) return;
      const input = event.target;
      const isDrafting = draftMeta.has(input);

      if (isDrafting) {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          const applied = applyExpressionToInput(input, true);
          if (!applied) exitDraftMode(input, true);
          if (input.dataset.numberCalculatorCommit === 'blur') window.setTimeout(() => input.blur(), 0);
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          exitDraftMode(input, true);
          return;
        }
        if (event.key === 'Backspace' || event.key === 'Delete') {
          event.preventDefault();
          event.stopPropagation();
          removeSelection(input, event.key === 'Backspace' ? 'backward' : 'forward');
          return;
        }
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (printableMathKey(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          replaceSelection(input, normalizeInsertedKey(event.key));
        }
        return;
      }

      if (event.key === 'Enter') {
        if (!applyExpressionToInput(input)) return;
        event.preventDefault();
        event.stopPropagation();
        if (input.dataset.numberCalculatorCommit === 'blur') window.setTimeout(() => input.blur(), 0);
        return;
      }

      // Для обычных input[type=number] браузер не даёт набрать «820+60».
      // Переключаем только начатый пример в локальный черновик и не шлём onChange до Enter,
      // чтобы контролируемые поля не превращали незавершённый пример в 0.
      if (input.type === 'number' && printableMathKey(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const current = input.value;
        const key = normalizeInsertedKey(event.key);
        const startsExpression = /[+*/()%]/u.test(key)
          || (key === '-' && current.length > 0);
        if (!startsExpression) return;
        event.preventDefault();
        event.stopPropagation();
        enterDraftMode(input);
        setCaret(input, input.value.length);
        replaceSelection(input, key);
      }
    };

    const onFocusOut = (event: FocusEvent) => {
      if (!isNumericInput(event.target)) return;
      const input = event.target;
      if (draftMeta.has(input)) {
        const applied = applyExpressionToInput(input, true);
        if (!applied) exitDraftMode(input, true);
        return;
      }
      if (input.dataset.numberCalculatorCommit !== 'blur') return;
      applyExpressionToInput(input);
    };

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusout', onFocusOut, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusout', onFocusOut, true);
    };
  }, []);

  // Никакого всплывающего калькулятора и иконки: пишем прямо в поле «820+60», Enter → «880».
  return null;
}
