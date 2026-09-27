import { describe, expect, it } from 'vitest';
import type { KitchenModule } from '../types';
import { buildKitchenLayout, classifySketchTier, getSketchStyle } from './kitchenSketch';

function module(type: string, patch: Partial<KitchenModule> = {}): KitchenModule {
  return {
    id: type, type, name: type, qty: 1,
    widthMm: null, heightMm: null, depthMm: null,
    facades: 0, drawers: 0, shelves: 0, hinges: 0, handles: 0, lifts: 0,
    facadeWmm: null, facadeHmm: null,
    slots: {
      body: { mode: 'manual', itemId: null }, facade: { mode: 'default', itemId: null },
      hinge: { mode: 'default', itemId: null }, drawerSys: { mode: 'default', itemId: null },
      lift: { mode: 'default', itemId: null }, handle: { mode: 'default', itemId: null }, shelf: { mode: 'default', itemId: null },
    },
    ...patch,
  };
}

describe('kitchen sketch layout', () => {
  it('classifies tall, upper and base modules from their explicit names', () => {
    expect(classifySketchTier(module('Пенал под духовку'))).toBe('tall');
    expect(classifySketchTier(module('Антресоль'))).toBe('upper');
    expect(classifySketchTier(module('Шкаф под мойку'))).toBe('base');
  });

  it('lays out quantity instances in a continuous lower and upper run', () => {
    const layout = buildKitchenLayout([
      module('Нижний шкаф', { widthMm: 800, qty: 2 }),
      module('Верхний шкаф', { widthMm: 600, qty: 2 }),
      module('Пенал', { widthMm: 450, heightMm: 2200 }),
    ]);
    expect(layout.floor.map((m) => m.x)).toEqual([0, 800, 1600]);
    expect(layout.upper.map((m) => m.x)).toEqual([0, 600]);
    expect(layout.totalWidth).toBe(2050);
    expect(layout.totalHeight).toBe(2200);
  });

  it('uses white/oak style as the safe default', () => {
    expect(getSketchStyle().id).toBe('white-oak');
    expect(getSketchStyle('emerald-gold').name).toContain('Изумруд');
  });
});
