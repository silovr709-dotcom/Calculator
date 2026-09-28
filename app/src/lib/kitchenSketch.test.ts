import { describe, expect, it } from 'vitest';
import type { KitchenModule } from '../types';
import {
  BASE_HEIGHT_MM, COUNTER_MM, PLINTH_MM, buildKitchenLayout, classifySketchTier, getSketchStyle,
  layoutWalls, moduleWall, normalizeLayoutShape, placedBottomMm, planRect, roomBox, upperBottomMm,
} from './kitchenSketch';

function module(type: string, patch: Partial<KitchenModule> = {}): KitchenModule {
  return {
    id: type, type, name: type, qty: 1,
    widthMm: null, heightMm: null, depthMm: null,
    facades: 0, drawers: 0, shelves: 0, hinges: 0, handles: 0, lifts: 0,
    facadeWmm: null, facadeHmm: null,
    slots: {
      body: { mode: 'manual', itemId: null }, facade: { mode: 'default', itemId: null }, frame: { mode: 'default', itemId: null },
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

describe('kitchen layout shapes and walls', () => {
  it('exposes walls available for each shape', () => {
    expect(layoutWalls('straight')).toEqual(['back']);
    expect(layoutWalls('l')).toEqual(['left', 'back']);
    expect(layoutWalls('u')).toEqual(['left', 'back', 'right']);
  });

  it('treats projects without a shape as straight', () => {
    expect(normalizeLayoutShape(undefined)).toBe('straight');
    expect(normalizeLayoutShape(null)).toBe('straight');
    expect(normalizeLayoutShape('unknown' as never)).toBe('straight');
    expect(buildKitchenLayout([module('Нижний шкаф')]).shape).toBe('straight');
  });

  it('puts modules without a wall — and walls missing from the shape — on the back wall', () => {
    expect(moduleWall(module('Нижний шкаф'), 'u')).toBe('back');
    expect(moduleWall(module('Нижний шкаф', { wall: 'left' }), 'l')).toBe('left');
    // прямая планировка: левая стена недоступна, модуль уходит на заднюю
    expect(moduleWall(module('Нижний шкаф', { wall: 'left' }), 'straight')).toBe('back');
    expect(moduleWall(module('Нижний шкаф', { wall: 'right' }), 'l')).toBe('back');
  });

  it('keeps an old straight project identical when the shape is absent', () => {
    const mods = [module('Нижний шкаф', { widthMm: 800, wall: 'left' }), module('Нижний шкаф 2', { widthMm: 600, wall: 'right' })];
    const layout = buildKitchenLayout(mods);
    expect(layout.walls).toHaveLength(1);
    expect(layout.walls[0].wall).toBe('back');
    expect(layout.floor.map((m) => m.x)).toEqual([0, 800]);
    expect(layout.totalWidth).toBe(1400);
  });

  it('spreads modules across the walls of an L-shaped kitchen', () => {
    const layout = buildKitchenLayout([
      module('Нижний шкаф левый', { widthMm: 600, wall: 'left' }),
      module('Нижний шкаф левый 2', { widthMm: 450, wall: 'left' }),
      module('Нижний шкаф задний', { widthMm: 800, wall: 'back' }),
      module('Нижний шкаф без стены', { widthMm: 400 }),
    ], 'l');
    expect(layout.walls.map((run) => run.wall)).toEqual(['left', 'back']);
    const left = layout.walls[0];
    const back = layout.walls[1];
    expect(left.floor.map((m) => m.x)).toEqual([0, 600]);
    expect(left.runWidth).toBe(1050);
    // задняя стена считает координаты со своего нуля, независимо от левой
    expect(back.floor.map((m) => m.x)).toEqual([0, 800]);
    expect(back.runWidth).toBe(1200);
    expect(layout.totalWidth).toBe(1200);
    expect(layout.floor).toHaveLength(4);
  });

  it('fills all three walls of a U-shaped kitchen', () => {
    const layout = buildKitchenLayout([
      module('Нижний левый', { widthMm: 900, wall: 'left' }),
      module('Нижний задний', { widthMm: 1200, wall: 'back' }),
      module('Нижний правый', { widthMm: 700, wall: 'right' }),
    ], 'u');
    expect(layout.walls.map((run) => run.wall)).toEqual(['left', 'back', 'right']);
    expect(layout.walls.map((run) => run.runWidth)).toEqual([900, 1200, 700]);
    expect(layout.walls.every((run) => run.floor.every((m) => m.x === 0))).toBe(true);
  });

  it('numbers lower and upper tiers independently on every wall', () => {
    const layout = buildKitchenLayout([
      module('Верхний шкаф левый', { widthMm: 500, wall: 'left' }),
      module('Нижний шкаф левый', { widthMm: 800, wall: 'left' }),
      module('Верхний шкаф левый 2', { widthMm: 500, wall: 'left', qty: 2 }),
      module('Нижний шкаф задний', { widthMm: 600, wall: 'back', qty: 2 }),
      module('Верхний шкаф задний', { widthMm: 400, wall: 'back' }),
    ], 'u');
    const left = layout.walls.find((run) => run.wall === 'left')!;
    const back = layout.walls.find((run) => run.wall === 'back')!;
    expect(left.floor.map((m) => m.x)).toEqual([0]);
    expect(left.upper.map((m) => m.x)).toEqual([0, 500, 1000]);
    expect(left.floorWidth).toBe(800);
    expect(left.upperWidth).toBe(1500);
    expect(back.floor.map((m) => m.x)).toEqual([0, 600]);
    expect(back.upper.map((m) => m.x)).toEqual([0]);
    expect(layout.upperRunWidth).toBe(1500);
  });

  it('places tiers at their own heights above the floor', () => {
    const layout = buildKitchenLayout([
      module('Нижний шкаф', { widthMm: 800, heightMm: 720 }),
      module('Верхний шкаф', { widthMm: 800, heightMm: 900 }),
      module('Пенал', { widthMm: 600, heightMm: 2200 }),
    ]);
    const run = layout.walls[0];
    const [base, tall] = run.floor;
    expect(placedBottomMm(base, run)).toBe(PLINTH_MM);
    expect(placedBottomMm(tall, run)).toBe(0);
    expect(upperBottomMm(run)).toBe(PLINTH_MM + BASE_HEIGHT_MM + COUNTER_MM + 600);
    expect(placedBottomMm(run.upper[0], run)).toBe(upperBottomMm(run));
    expect(layout.totalHeight).toBe(2358);
  });

  it('maps every wall into plan coordinates of the room', () => {
    const layout = buildKitchenLayout([
      module('Нижний левый', { widthMm: 1000, depthMm: 560, wall: 'left' }),
      module('Нижний задний', { widthMm: 3000, depthMm: 600, wall: 'back' }),
      module('Нижний правый', { widthMm: 800, depthMm: 500, wall: 'right' }),
    ], 'u');
    const room = roomBox(layout);
    expect(room.width).toBe(3000);
    expect(room.backDepth).toBe(600);
    expect(room.depth).toBe(1600);
    const [left, back, right] = layout.walls.map((run) => planRect(run.floor[0], layout));
    expect(left).toEqual({ x0: 0, x1: 560, y0: 600, y1: 1600 });
    expect(back).toEqual({ x0: 0, x1: 3000, y0: 0, y1: 600 });
    expect(right).toEqual({ x0: 2500, x1: 3000, y0: 600, y1: 1400 });
  });
});
