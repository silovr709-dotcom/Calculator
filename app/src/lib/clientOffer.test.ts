import { describe, expect, it } from 'vitest';
import { roundClientPrice } from './engine';

describe('клиентская цена', () => {
  it('округляет вверх до выбранного шага и не меняет точную цену', () => {
    expect(roundClientPrice(1234.01, 1)).toBe(1234.01);
    expect(roundClientPrice(1234.01, 10)).toBe(1240);
    expect(roundClientPrice(1234.01, 100)).toBe(1300);
    expect(roundClientPrice(1234.01, 1000)).toBe(2000);
  });
});
