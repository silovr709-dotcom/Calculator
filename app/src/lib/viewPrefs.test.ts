import { describe, expect, it, beforeEach, vi } from 'vitest';
import { isWeekend, loadViewPrefs, saveViewPrefs } from './viewPrefs';

/** В тестовой среде своего хранилища нет — подменяем простым объектом. */
function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
    clear: () => data.clear(),
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    get length() { return data.size; },
  };
}

describe('память настроек экранов', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', memoryStorage()); });

  it('возвращает значения по умолчанию, когда ничего не сохранено', () => {
    expect(loadViewPrefs('crm', { focus: 'active', sort: 'urgency' })).toEqual({ focus: 'active', sort: 'urgency' });
  });

  it('сохраняет и восстанавливает настройки', () => {
    saveViewPrefs('crm', { focus: 'today', sort: 'money' });
    expect(loadViewPrefs('crm', { focus: 'active', sort: 'urgency' })).toEqual({ focus: 'today', sort: 'money' });
  });

  it('игнорирует лишние и битые поля', () => {
    localStorage.setItem('recept.view.crm', JSON.stringify({ focus: 42, sort: 'money', левое: true }));
    expect(loadViewPrefs('crm', { focus: 'active', sort: 'urgency' })).toEqual({ focus: 'active', sort: 'money' });
  });

  it('не падает на испорченном хранилище', () => {
    localStorage.setItem('recept.view.crm', 'не json');
    expect(loadViewPrefs('crm', { focus: 'active' })).toEqual({ focus: 'active' });
  });

  it('понимает выходные', () => {
    expect(isWeekend('2026-10-17')).toBe(true);   // суббота
    expect(isWeekend('2026-10-18')).toBe(true);   // воскресенье
    expect(isWeekend('2026-10-19')).toBe(false);  // понедельник
    expect(isWeekend('не дата')).toBe(false);
  });
});
