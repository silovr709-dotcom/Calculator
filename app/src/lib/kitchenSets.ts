// Готовые комплекты типовых кухонь: одна кнопка — готовый набор модулей,
// разложенный по стенам с размерами и конструкцией. Как и «быстрые конструкции»,
// комплекты НЕ выбирают корпус и материалы — только конструкцию, габариты и стену;
// корпуса и материалы заполняются слотами/параметрами проекта по умолчанию.
import type { KitchenLayoutShape, KitchenModule, KitchenWall } from '../types';
import { MODULE_PRESETS, moduleFromPreset, newModule } from './modules';

export interface KitchenSetModule {
  /** Конструкция из быстрого пресета (ящики/фасады). Можно переопределить поля ниже. */
  presetId?: string;
  /** Тип модуля, если пресет не задан. */
  type?: string;
  name: string;
  wall: KitchenWall;
  widthMm: number;
  heightMm: number;
  depthMm: number;
  facades?: number;
  drawers?: number;
  shelves?: number;
}

export interface KitchenSet {
  id: string;
  name: string;
  description: string;
  /** Планировка, которая выставляется в эскизе проекта вместе с комплектом. */
  shape: KitchenLayoutShape;
  modules: KitchenSetModule[];
}

const L = 720;  // стандартная высота нижнего ряда
const U = 720;  // высота верхнего ряда
const LD = 560; // глубина нижнего ряда
const UD = 320; // глубина верхнего ряда

export const KITCHEN_SETS: KitchenSet[] = [
  {
    id: 'straight-2400',
    name: 'Прямая 2,4 м',
    description: 'Нижний ряд: мойка 800, ящик+дверь 600, 2 ящика 600, узкий 400. Верхний ряд симметричен.',
    shape: 'straight',
    modules: [
      { presetId: 'sink', name: 'Шкаф под мойку', wall: 'back', widthMm: 800, heightMm: L, depthMm: LD },
      { presetId: 'base-1-door-drawer', name: 'Нижний шкаф · ящик + дверь', wall: 'back', widthMm: 600, heightMm: L, depthMm: LD },
      { presetId: 'base-2-drawers', name: 'Нижний шкаф · 2 ящика', wall: 'back', widthMm: 600, heightMm: L, depthMm: LD },
      { type: 'Нижний шкаф', name: 'Нижний шкаф узкий', wall: 'back', widthMm: 400, heightMm: L, depthMm: LD, facades: 1, shelves: 1 },
      { presetId: 'wall-2-doors', name: 'Верхний шкаф 800', wall: 'back', widthMm: 800, heightMm: U, depthMm: UD },
      { presetId: 'wall-2-doors', name: 'Верхний шкаф 600', wall: 'back', widthMm: 600, heightMm: U, depthMm: UD },
      { presetId: 'wall-2-doors', name: 'Верхний шкаф 600', wall: 'back', widthMm: 600, heightMm: U, depthMm: UD },
      { type: 'Верхний шкаф', name: 'Верхний шкаф 400', wall: 'back', widthMm: 400, heightMm: U, depthMm: UD, facades: 1, shelves: 1 },
    ],
  },
  {
    id: 'straight-3000',
    name: 'Прямая 3,0 м',
    description: 'Нижний ряд: мойка 800, духовка 600, ящик+дверь 600, 2 двери 600, 3 ящика 400. Верхний ряд симметричен.',
    shape: 'straight',
    modules: [
      { presetId: 'sink', name: 'Шкаф под мойку', wall: 'back', widthMm: 800, heightMm: L, depthMm: LD },
      { presetId: 'oven', name: 'Шкаф под духовой шкаф', wall: 'back', widthMm: 600, heightMm: L, depthMm: LD },
      { presetId: 'base-1-door-drawer', name: 'Нижний шкаф · ящик + дверь', wall: 'back', widthMm: 600, heightMm: L, depthMm: LD },
      { presetId: 'base-2-doors', name: 'Нижний шкаф · 2 двери', wall: 'back', widthMm: 600, heightMm: L, depthMm: LD },
      { presetId: 'base-3-drawers', name: 'Нижний шкаф · 3 ящика', wall: 'back', widthMm: 400, heightMm: L, depthMm: LD },
      { presetId: 'wall-2-doors', name: 'Верхний шкаф 800', wall: 'back', widthMm: 800, heightMm: U, depthMm: UD },
      { presetId: 'wall-2-doors', name: 'Верхний шкаф 600', wall: 'back', widthMm: 600, heightMm: U, depthMm: UD },
      { presetId: 'wall-2-doors', name: 'Верхний шкаф 600', wall: 'back', widthMm: 600, heightMm: U, depthMm: UD },
      { presetId: 'wall-2-doors', name: 'Верхний шкаф 600', wall: 'back', widthMm: 600, heightMm: U, depthMm: UD },
      { type: 'Верхний шкаф', name: 'Верхний шкаф 400', wall: 'back', widthMm: 400, heightMm: U, depthMm: UD, facades: 1, shelves: 1 },
    ],
  },
  {
    id: 'l-2400-1800',
    name: 'Г-образная 2,4 × 1,8 м',
    description: 'Угол слева. Задняя стена: угловой 900, мойка 800, ящик+дверь 700. Левая: духовка 600, узкий 300. Верх — по стенам.',
    shape: 'l',
    modules: [
      { type: 'Нижний шкаф', name: 'Угловой нижний шкаф', wall: 'back', widthMm: 900, heightMm: L, depthMm: LD, facades: 1, shelves: 1 },
      { presetId: 'sink', name: 'Шкаф под мойку', wall: 'back', widthMm: 800, heightMm: L, depthMm: LD },
      { presetId: 'base-1-door-drawer', name: 'Нижний шкаф · ящик + дверь', wall: 'back', widthMm: 700, heightMm: L, depthMm: LD },
      { presetId: 'oven', name: 'Шкаф под духовой шкаф', wall: 'left', widthMm: 600, heightMm: L, depthMm: LD },
      { type: 'Нижний шкаф', name: 'Нижний шкаф узкий', wall: 'left', widthMm: 300, heightMm: L, depthMm: LD, facades: 1, shelves: 1 },
      { type: 'Верхний шкаф', name: 'Угловой верхний шкаф', wall: 'back', widthMm: 600, heightMm: U, depthMm: UD, facades: 1, shelves: 1 },
      { presetId: 'wall-2-doors', name: 'Верхний шкаф 800', wall: 'back', widthMm: 800, heightMm: U, depthMm: UD },
      { presetId: 'wall-2-doors', name: 'Верхний шкаф 600', wall: 'back', widthMm: 600, heightMm: U, depthMm: UD },
      { type: 'Верхний шкаф', name: 'Верхний шкаф 400', wall: 'back', widthMm: 400, heightMm: U, depthMm: UD, facades: 1, shelves: 1 },
      { presetId: 'wall-2-doors', name: 'Верхний шкаф 600', wall: 'left', widthMm: 600, heightMm: U, depthMm: UD },
      { type: 'Верхний шкаф', name: 'Верхний шкаф 300', wall: 'left', widthMm: 300, heightMm: U, depthMm: UD, facades: 1, shelves: 1 },
    ],
  },
  {
    id: 'u-2400-2000',
    name: 'П-образная 2,4 × 2,0 × 1,8 м',
    description: 'Углы слева и справа, пенал справа. Задняя стена: технический 800, мойка 800, 2 ящика 800. Верх — по стенам.',
    shape: 'u',
    modules: [
      { type: 'Нижний шкаф', name: 'Угловой нижний шкаф', wall: 'left', widthMm: 900, heightMm: L, depthMm: LD, facades: 1, shelves: 1 },
      { presetId: 'oven', name: 'Шкаф под духовой шкаф', wall: 'left', widthMm: 600, heightMm: L, depthMm: LD },
      { presetId: 'base-2-doors', name: 'Нижний шкаф · 2 двери', wall: 'back', widthMm: 800, heightMm: L, depthMm: LD },
      { presetId: 'sink', name: 'Шкаф под мойку', wall: 'back', widthMm: 800, heightMm: L, depthMm: LD },
      { presetId: 'base-2-drawers', name: 'Нижний шкаф · 2 ящика', wall: 'back', widthMm: 800, heightMm: L, depthMm: LD },
      { type: 'Нижний шкаф', name: 'Угловой нижний шкаф', wall: 'right', widthMm: 900, heightMm: L, depthMm: LD, facades: 1, shelves: 1 },
      { presetId: 'base-3-drawers', name: 'Нижний шкаф · 3 ящика', wall: 'right', widthMm: 600, heightMm: L, depthMm: LD },
      { presetId: 'tall', name: 'Пенал', wall: 'right', widthMm: 600, heightMm: 2100, depthMm: LD },
      { type: 'Верхний шкаф', name: 'Угловой верхний шкаф', wall: 'left', widthMm: 600, heightMm: U, depthMm: UD, facades: 1, shelves: 1 },
      { presetId: 'wall-2-doors', name: 'Верхний шкаф 600', wall: 'left', widthMm: 600, heightMm: U, depthMm: UD },
      { presetId: 'wall-2-doors', name: 'Верхний шкаф 800', wall: 'back', widthMm: 800, heightMm: U, depthMm: UD },
      { presetId: 'wall-2-doors', name: 'Верхний шкаф 800', wall: 'back', widthMm: 800, heightMm: U, depthMm: UD },
      { presetId: 'wall-2-doors', name: 'Верхний шкаф 800', wall: 'back', widthMm: 800, heightMm: U, depthMm: UD },
      { type: 'Верхний шкаф', name: 'Угловой верхний шкаф', wall: 'right', widthMm: 600, heightMm: U, depthMm: UD, facades: 1, shelves: 1 },
      { presetId: 'wall-2-doors', name: 'Верхний шкаф 600', wall: 'right', widthMm: 600, heightMm: U, depthMm: UD },
    ],
  },
];

/** Разворачивает комплект в модули с уникальными id. Корпуса/материалы намеренно не задаются. */
export function modulesFromKitchenSet(set: KitchenSet): KitchenModule[] {
  return set.modules.map((spec) => {
    const preset = spec.presetId ? MODULE_PRESETS.find((p) => p.id === spec.presetId) : undefined;
    const base = preset ? moduleFromPreset(preset) : newModule(spec.type ?? 'Нижний шкаф');
    const module: KitchenModule = {
      ...base,
      name: spec.name || base.name,
      wall: spec.wall,
      widthMm: spec.widthMm,
      heightMm: spec.heightMm,
      depthMm: spec.depthMm,
    };
    if (spec.facades != null) module.facades = spec.facades;
    if (spec.drawers != null) module.drawers = spec.drawers;
    if (spec.shelves != null) module.shelves = spec.shelves;
    return module;
  });
}

/** Суммарная ширина модулей комплекта по стене (для подписей и проверок). */
export function kitchenSetWallWidth(set: KitchenSet, wall: KitchenWall): number {
  return set.modules.filter((m) => m.wall === wall).reduce((sum, m) => sum + m.widthMm, 0);
}
