import { describe, expect, it } from 'vitest';
import { defaultSettings } from './storage';

describe('совместимость мастера', () => {
  it('старые настройки имеют безопасное значение округления', () => {
    expect(defaultSettings().clientRounding).toBe(1);
  });
});
