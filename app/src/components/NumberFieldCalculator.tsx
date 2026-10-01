import { useEffect, useRef, useState } from 'react';
import { evaluateNumericExpression, formatNumericExpressionResult } from '../lib/numericExpression';

type CalculatorTarget = {
  input: HTMLInputElement;
  rect: DOMRect;
  expression: string;
};

function isNumericInput(element: EventTarget | null): element is HTMLInputElement {
  if (!(element instanceof HTMLInputElement)) return false;
  if (element.disabled || element.readOnly) return false;
  const type = element.type;
  const inputMode = element.inputMode;
  return type === 'number' || inputMode === 'numeric' || inputMode === 'decimal' || element.dataset.numberCalculator === 'true';
}

function setNativeInputValue(input: HTMLInputElement, value: string): void {
  const prototype = Object.getPrototypeOf(input) as HTMLInputElement;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function targetPosition(rect: DOMRect) {
  const width = 286;
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
  const top = rect.bottom + 8 > window.innerHeight - 210 ? Math.max(12, rect.top - 178) : rect.bottom + 8;
  return { left, top, width };
}

const BUTTONS = ['7', '8', '9', '/', '4', '5', '6', '*', '1', '2', '3', '-', '0', '.', '(', ')', '+'];

export default function NumberFieldCalculator() {
  const [target, setTarget] = useState<CalculatorTarget | null>(null);
  const [expression, setExpression] = useState('');
  const [error, setError] = useState('');
  const panelRef = useRef<HTMLDivElement | null>(null);
  const expressionRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const openFor = (input: HTMLInputElement) => {
      const rect = input.getBoundingClientRect();
      const nextExpression = input.value || input.getAttribute('placeholder') || '';
      setTarget({ input, rect, expression: nextExpression });
      setExpression(nextExpression);
      setError('');
    };
    const onFocusIn = (event: FocusEvent) => {
      if (isNumericInput(event.target)) openFor(event.target);
    };
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget as Node | null;
      if (next && panelRef.current?.contains(next)) return;
      window.setTimeout(() => {
        const active = document.activeElement;
        if (active && panelRef.current?.contains(active)) return;
        if (active && isNumericInput(active)) return;
        setTarget(null);
      }, 80);
    };
    const onScrollOrResize = () => {
      setTarget((current) => current && document.body.contains(current.input)
        ? { ...current, rect: current.input.getBoundingClientRect() }
        : null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isNumericInput(event.target)) return;
      if (event.altKey && (event.key === '=' || event.key === '+' || event.key.toLowerCase() === 'к')) {
        event.preventDefault();
        openFor(event.target);
        window.setTimeout(() => expressionRef.current?.focus(), 0);
      }
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, []);

  if (!target) return null;
  const pos = targetPosition(target.rect);
  const calculated = evaluateNumericExpression(expression);
  const calculatedText = calculated == null ? '' : formatNumericExpressionResult(calculated);

  const apply = () => {
    const result = evaluateNumericExpression(expression);
    if (result == null) {
      setError('Не смог посчитать выражение');
      return;
    }
    const formatted = formatNumericExpressionResult(result);
    setNativeInputValue(target.input, formatted);
    if (target.input.dataset.numberCalculatorCommit === 'blur') {
      target.input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    }
    setExpression(formatted);
    setError('');
    target.input.focus();
    target.input.select();
  };
  const append = (value: string) => {
    setExpression((current) => `${current}${value}`);
    setError('');
    window.setTimeout(() => expressionRef.current?.focus(), 0);
  };

  return (
    <div ref={panelRef} className="number-field-calculator" style={{ left: pos.left, top: pos.top, width: pos.width }}>
      <div className="number-field-calculator-head"><b>Калькулятор поля</b><button type="button" onClick={() => setTarget(null)}>×</button></div>
      <input
        ref={expressionRef}
        value={expression}
        inputMode="decimal"
        placeholder="например: 600+120-30"
        onChange={(event) => { setExpression(event.target.value); setError(''); }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); apply(); }
          if (event.key === 'Escape') { event.preventDefault(); setTarget(null); target.input.focus(); }
        }}
      />
      <div className="number-field-calculator-result">{error || (calculatedText ? `= ${calculatedText}` : 'Введите + − × ÷, скобки и нажмите Enter')}</div>
      <div className="number-field-calculator-buttons">
        {BUTTONS.map((button) => <button type="button" key={button} onMouseDown={(event) => event.preventDefault()} onClick={() => append(button)}>{button === '*' ? '×' : button === '/' ? '÷' : button}</button>)}
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => setExpression('')}>C</button>
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => setExpression((current) => current.slice(0, -1))}>⌫</button>
        <button type="button" className="primary" onMouseDown={(event) => event.preventDefault()} onClick={apply}>= в поле</button>
      </div>
      <small>Работает во всех числовых полях. Быстрый вызов: Alt+=</small>
    </div>
  );
}
