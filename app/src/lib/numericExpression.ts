function normalizeExpression(value: string): string {
  return value
    .trim()
    .replace(/,/g, '.')
    .replace(/[×хx]/giu, '*')
    .replace(/[÷:]/g, '/')
    .replace(/[−–—]/g, '-')
    .replace(/\s+/g, '');
}

export function evaluateNumericExpression(value: string): number | null {
  const source = normalizeExpression(value);
  if (!source) return null;
  let index = 0;

  const peek = () => source[index] ?? '';
  const eat = (char: string) => {
    if (peek() !== char) return false;
    index += 1;
    return true;
  };

  const parseNumber = (): number | null => {
    const start = index;
    while (/\d/u.test(peek())) index += 1;
    if (eat('.')) while (/\d/u.test(peek())) index += 1;
    if (index === start || source.slice(start, index) === '.') return null;
    const parsed = Number(source.slice(start, index));
    return Number.isFinite(parsed) ? parsed : null;
  };

  const parseFactor = (): number | null => {
    if (eat('+')) return parseFactor();
    if (eat('-')) {
      const value = parseFactor();
      return value == null ? null : -value;
    }
    let value: number | null;
    if (eat('(')) {
      value = parseExpression();
      if (value == null || !eat(')')) return null;
    } else {
      value = parseNumber();
    }
    if (value == null) return null;
    while (eat('%')) value /= 100;
    return value;
  };

  const parseTerm = (): number | null => {
    let value = parseFactor();
    if (value == null) return null;
    while (peek() === '*' || peek() === '/') {
      const operator = peek();
      index += 1;
      const right = parseFactor();
      if (right == null) return null;
      if (operator === '*') value *= right;
      else {
        if (right === 0) return null;
        value /= right;
      }
    }
    return value;
  };

  function parseExpression(): number | null {
    let value = parseTerm();
    if (value == null) return null;
    while (peek() === '+' || peek() === '-') {
      const operator = peek();
      index += 1;
      const right = parseTerm();
      if (right == null) return null;
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  }

  const result = parseExpression();
  if (result == null || index !== source.length || !Number.isFinite(result)) return null;
  return Object.is(result, -0) ? 0 : result;
}

export function formatNumericExpressionResult(value: number, precision = 4): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(precision).replace(/0+$/u, '').replace(/\.$/u, '');
}
