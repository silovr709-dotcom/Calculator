import { describe, expect, it } from 'vitest';
import type { KitchenModule, ModuleDefaults, Pricebook } from '../../../types';
import { moduleMaterialRefs, moduleOption, resolveSlotItemId } from './calculatorModules';
import { sketchMaterialLegend, sketchMaterialLegendForModuleId } from './calculatorMaterials';

const pricebook = {
  meta: { id: 'active', name: 'Активный прайс', supplier: 'Тест', priceYear: 2026, sourceFile: 'test', importedAt: '2026-01-01', itemCount: 5, categories: [], stats: { byCategory: {}, byUnit: {} } },
  items: [
    { id: 'body-default', name: 'Корпус Кашемир', article: 'K-1', category: 'Корпуса: ЛДСП', subcategory: null, unit: 'шт', priceKind: 'fixed', price: 1000, priceRaw: '1000', priceBasis: 'unit', attrs: {}, note: null, group: 'mdf_pvh', source: { sheet: 'test', row: 1 } },
    { id: 'body-manual', name: 'Корпус ручной', article: 'K-2', category: 'Корпуса: ЛДСП', subcategory: null, unit: 'шт', priceKind: 'fixed', price: 1200, priceRaw: '1200', priceBasis: 'unit', attrs: {}, note: null, group: 'mdf_pvh', source: { sheet: 'test', row: 2 } },
    { id: 'facade', name: 'Фасад эмаль', article: 'F-1', category: 'Фасады: Эмаль', subcategory: null, unit: 'м2', priceKind: 'fixed', price: 2500, priceRaw: '2500', priceBasis: 'm2', attrs: {}, note: null, group: 'emal', source: { sheet: 'test', row: 3 } },
    { id: 'frame', name: 'Каркас стандарт', article: null, category: 'Каркасы', subcategory: null, unit: 'шт', priceKind: 'fixed', price: 300, priceRaw: '300', priceBasis: 'unit', attrs: {}, note: null, group: null, source: { sheet: 'test', row: 4 } },
    { id: 'handle', name: 'Ручка чёрная', article: 'R-1', category: 'Ручки', subcategory: null, unit: 'шт', priceKind: 'fixed', price: 200, priceRaw: '200', priceBasis: 'unit', attrs: {}, note: null, group: null, source: { sheet: 'test', row: 5 } },
  ],
  refs: {}, notes: {}, issues: [],
} as Pricebook;

const module = {
  id: 'm-1', type: 'Нижний шкаф', name: 'Низ 800', qty: 1, widthMm: 800, heightMm: 720, depthMm: 560,
  facades: 1, drawers: 0, shelves: 1, hinges: 2, handles: 1, lifts: 0, facadeWmm: 800, facadeHmm: 720,
  slots: { body: { mode: 'default', itemId: null }, facade: { mode: 'manual', itemId: 'facade' }, frame: { mode: 'default', itemId: null }, hinge: { mode: 'default', itemId: null }, drawerSys: { mode: 'default', itemId: null }, lift: { mode: 'default', itemId: null }, handle: { mode: 'manual', itemId: 'handle' }, shelf: { mode: 'default', itemId: null }, legs: { mode: 'default', itemId: null } },
} as KitchenModule;
const defaults: ModuleDefaults = { body: 'body-default', frame: 'frame' };

describe('Sketch PRO calculator adapters', () => {
  it('resolves manual slots before project defaults and ignores missing items', () => {
    expect(resolveSlotItemId(module, 'body', defaults)).toBe('body-default');
    expect(resolveSlotItemId(module, 'facade', defaults)).toBe('facade');
    expect(moduleMaterialRefs(module, defaults, pricebook).map(ref => ref.itemId)).toEqual(['body-default', 'facade', 'frame', 'handle']);
  });

  it('builds a linked module object description from real module dimensions', () => {
    const option = moduleOption(module, defaults, pricebook);
    expect(option.id).toBe('m-1');
    expect(option.dimensions).toBe('800 × 720 × 560');
    expect(option.description).toContain('Низ 800');
    expect(option.materialRefs.every(ref => pricebook.items.some(item => item.id === ref.itemId))).toBe(true);
  });

  it('creates legend codes without inventing price items or values', () => {
    const legend = sketchMaterialLegend(module, defaults, pricebook);
    expect(legend.map(row => row.code)).toEqual(['Ф01', 'К01', 'СТ01', 'Р01']);
    expect(legend.map(row => row.itemId)).toEqual(['facade', 'body-default', 'frame', 'handle']);
    expect(legend.find(row => row.code === 'Ф01')?.price?.replace(/\u00a0/g, ' ')).toBe('2 500 ₽');
    expect(sketchMaterialLegendForModuleId('unknown', [module], defaults, pricebook)).toEqual([]);
  });
});
