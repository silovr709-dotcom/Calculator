import { describe, expect, it } from 'vitest';
import { evaluateNumericExpression, formatNumericExpressionResult } from './numericExpression';

describe('numericExpression', () => {
  it('считает простые выражения для числовых полей', () => {
    expect(evaluateNumericExpression('600+120-30')).toBe(690);
    expect(evaluateNumericExpression('1000 / 2 + 75')).toBe(575);
    expect(evaluateNumericExpression('(400 + 200) * 2')).toBe(1200);
  });

  it('понимает запятую, знаки умножения/деления и проценты', () => {
    expect(evaluateNumericExpression('1,5×2')).toBe(3);
    expect(evaluateNumericExpression('900÷3')).toBe(300);
    expect(evaluateNumericExpression('50%')).toBe(0.5);
  });

  it('отклоняет небезопасные и некорректные выражения', () => {
    expect(evaluateNumericExpression('alert(1)')).toBeNull();
    expect(evaluateNumericExpression('10/0')).toBeNull();
    expect(evaluateNumericExpression('10+')).toBeNull();
  });

  it('форматирует результат без лишних нулей', () => {
    expect(formatNumericExpressionResult(125)).toBe('125');
    expect(formatNumericExpressionResult(1 / 8)).toBe('0.125');
  });
});
