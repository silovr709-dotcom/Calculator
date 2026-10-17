import { describe, expect, it } from 'vitest';
import { fmtDate, fmtDateLong } from './format';

describe('даты в документах', () => {
  it('длинная дата читается по-человечески', () => {
    expect(fmtDateLong('2026-10-15')).toBe('15 октября 2026 г.');
  });

  it('короткая дата остаётся привычной', () => {
    expect(fmtDate('2026-10-15')).toBe('15.10.2026');
  });

  it('пустое или битое значение не ломает вывод', () => {
    expect(fmtDateLong('')).toBe('');
    expect(fmtDateLong('не дата')).toBe('не дата');
  });
});
