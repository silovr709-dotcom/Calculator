import type { KitchenModule, KitchenSketchStyleId } from '../types';

/** Ряд в фасадной развёртке кухни. */
export type SketchTier = 'base' | 'upper' | 'tall';

export interface SketchStyle {
  id: KitchenSketchStyleId;
  name: string;
  facade: string;
  facadeDark: string;
  body: string;
  counter: string;
  counterEdge: string;
  handle: string;
  accent: string;
  line: string;
  backsplash: string;
  floor: string;
}

/** Готовые сочетания фасадов и столешницы для эскиза. */
export const SKETCH_STYLES: SketchStyle[] = [
  {
    id: 'white-oak', name: 'Белый глянец / Дуб', facade: '#f8faf9', facadeDark: '#dce4df', body: '#f0f3f1',
    counter: '#b7895d', counterEdge: '#855f3e', handle: '#52615b', accent: '#14655c', line: '#496057', backsplash: '#eaf0ed', floor: '#d6bd9d',
  },
  {
    id: 'graphite-marble', name: 'Графит матовый / Чёрный мрамор', facade: '#3d4650', facadeDark: '#252c34', body: '#66717c',
    counter: '#1f252b', counterEdge: '#080b0e', handle: '#cbd1d5', accent: '#9bb8ae', line: '#e2eaed', backsplash: '#d8dce0', floor: '#a7a09a',
  },
  {
    id: 'cashmere-stone', name: 'Кашемир / Светлый камень', facade: '#cfc4b6', facadeDark: '#ac9e8c', body: '#e1dad0',
    counter: '#ded8cd', counterEdge: '#a69a8a', handle: '#5e554d', accent: '#846d55', line: '#514941', backsplash: '#eee9e2', floor: '#c9c0b5',
  },
  {
    id: 'scandi-wotan', name: 'Сканди / Дуб вотан', facade: '#edf1ed', facadeDark: '#d7dfd9', body: '#e8ece8',
    counter: '#8d6246', counterEdge: '#5e3d29', handle: '#3e4d47', accent: '#567e6b', line: '#465a51', backsplash: '#f6f6f2', floor: '#b98c68',
  },
  {
    id: 'emerald-gold', name: 'Изумруд / Золото', facade: '#17665d', facadeDark: '#0d493f', body: '#3c7a70',
    counter: '#e8e1d5', counterEdge: '#af9f87', handle: '#bf913d', accent: '#bf913d', line: '#eaf5ef', backsplash: '#f2eee6', floor: '#bca789',
  },
];

export const DEFAULT_SKETCH_STYLE: KitchenSketchStyleId = 'white-oak';

export function getSketchStyle(id?: KitchenSketchStyleId): SketchStyle {
  return SKETCH_STYLES.find((style) => style.id === id) ?? SKETCH_STYLES[0];
}

function textFor(module: KitchenModule): string {
  return `${module.type} ${module.name} ${module.note ?? ''}`.toLocaleLowerCase('ru');
}

/**
 * Назначение яруса вычисляется только из явно названного типа/наименования.
 * Если тип не распознан, он остаётся нижним модулем — ничего не добавляем в расчёт.
 */
export function classifySketchTier(module: KitchenModule): SketchTier {
  const value = textFor(module);
  if (/(пенал|холодиль|колонн|высок)/u.test(value)) return 'tall';
  if (/(верхн|навес|антресол|хлебниц)/u.test(value)) return 'upper';
  return 'base';
}

export interface SketchPlacedModule {
  /** Модуль исходного проекта. */
  module: KitchenModule;
  /** Идентификатор исходного модуля — все экземпляры qty ведут к нему. */
  sourceId: string;
  /** Номер экземпляра при qty > 1. */
  instance: number;
  sourceIndex: number;
  tier: SketchTier;
  x: number;
  width: number;
  height: number;
  depth: number;
}

export interface KitchenLayout {
  floor: SketchPlacedModule[];
  upper: SketchPlacedModule[];
  totalWidth: number;
  /** Высота от пола до самой высокой точки, мм. */
  totalHeight: number;
  baseRunWidth: number;
  upperRunWidth: number;
}

const safePositive = (value: number | null | undefined, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;

export function moduleSketchDimensions(module: KitchenModule, tier = classifySketchTier(module)) {
  const defaults = tier === 'upper'
    ? { width: 600, height: 720, depth: 320 }
    : tier === 'tall'
      ? { width: 600, height: 2100, depth: 560 }
      : { width: 600, height: 720, depth: 560 };
  return {
    width: safePositive(module.widthMm, defaults.width),
    height: safePositive(module.heightMm, defaults.height),
    depth: safePositive(module.depthMm, defaults.depth),
  };
}

/**
 * Раскладывает модули в фасадную линию. Нижние шкафы и пеналы стоят на полу
 * в порядке проекта; верхний ярус — отдельной непрерывной линией над фартуком.
 */
export function buildKitchenLayout(modules: KitchenModule[]): KitchenLayout {
  const floor: SketchPlacedModule[] = [];
  const upper: SketchPlacedModule[] = [];
  let floorX = 0;
  let upperX = 0;
  let baseRunWidth = 0;

  modules.forEach((module, sourceIndex) => {
    const tier = classifySketchTier(module);
    const dimensions = moduleSketchDimensions(module, tier);
    const qty = Math.max(0, Math.round(module.qty || 0));
    for (let instance = 0; instance < qty; instance += 1) {
      const placed: SketchPlacedModule = {
        module,
        sourceId: module.id,
        sourceIndex,
        instance,
        tier,
        x: tier === 'upper' ? upperX : floorX,
        ...dimensions,
      };
      if (tier === 'upper') {
        upper.push(placed);
        upperX += dimensions.width;
      } else {
        floor.push(placed);
        floorX += dimensions.width;
        if (tier === 'base') baseRunWidth = floorX;
      }
    }
  });

  // Стандартная высота: цоколь 100 + стол 720 + столешница 38 + фартук 600 + верх 720.
  const normalHeight = 100 + 720 + 38 + 600 + Math.max(720, ...upper.map((m) => m.height));
  const tallHeight = Math.max(0, ...floor.filter((m) => m.tier === 'tall').map((m) => m.height));
  return {
    floor,
    upper,
    totalWidth: Math.max(floorX, upperX, 1),
    totalHeight: Math.max(normalHeight, tallHeight, 100 + 720 + 38),
    baseRunWidth,
    upperRunWidth: upperX,
  };
}

export function isSinkModule(module: KitchenModule): boolean {
  return /(мойк|раковин)/iu.test(textFor(module));
}

export function isOvenModule(module: KitchenModule): boolean {
  return /(духов|oven)/iu.test(textFor(module));
}

export function hasHob(module: KitchenModule): boolean {
  return /(вароч|плит|hob)/iu.test(textFor(module));
}

export function isOpenModule(module: KitchenModule): boolean {
  return /(открыт|полк|витрин)/iu.test(textFor(module)) || (module.facades === 0 && module.drawers === 0 && module.shelves > 0);
}
