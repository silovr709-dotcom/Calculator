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

function setNativeInputValue(input: HTMLInputElement, value: string): void {
  const prototype = window.HTMLInputElement.prototype;
  const prototypeDescriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  const ownDescriptor = Object.getOwnPropertyDescriptor(input, 'value');
  const setter = prototypeDescriptor?.set ?? ownDescriptor?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  const inputEvent = typeof InputEvent !== 'undefined'
    ? new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: value })
    : new Event('input', { bubbles: true });
  input.dispatchEvent(inputEvent);
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function applyExpressionToInput(input: HTMLInputElement): boolean {
  const raw = input.value;
  if (!hasMathSyntax(raw)) return false;
  const calculated = evaluateNumericExpression(raw);
  if (calculated == null) return false;
  const formatted = formatNumericExpressionResult(calculated);
  setNativeInputValue(input, formatted);
  try {
    input.setSelectionRange(formatted.length, formatted.length);
  } catch {
    // input[type=number] не поддерживает setSelectionRange — это нормально.
  }
  return true;
}

export default function NumberFieldCalculator() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || !isNumericInput(event.target)) return;
      const input = event.target;
      if (!applyExpressionToInput(input)) return;
      event.preventDefault();
      event.stopPropagation();
      if (input.dataset.numberCalculatorCommit === 'blur') {
        window.setTimeout(() => input.blur(), 0);
      }
    };

    const onFocusOut = (event: FocusEvent) => {
      if (!isNumericInput(event.target)) return;
      if (event.target.dataset.numberCalculatorCommit !== 'blur') return;
      applyExpressionToInput(event.target);
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
