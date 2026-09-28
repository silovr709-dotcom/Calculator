import type { KitchenLayoutShape, KitchenModule, KitchenSketchStyleId, KitchenSketchView, KitchenWall } from '../types';

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

// ---------- Планировка и стены ----------

export interface LayoutShapeInfo {
  id: KitchenLayoutShape;
  name: string;
  hint: string;
  walls: KitchenWall[];
}

/** Доступные планировки и набор стен каждой из них. */
export const LAYOUT_SHAPES: LayoutShapeInfo[] = [
  { id: 'straight', name: 'Прямая', hint: 'Один ряд вдоль задней стены', walls: ['back'] },
  { id: 'l', name: 'Г-образная', hint: 'Левая и задняя стены', walls: ['left', 'back'] },
  { id: 'u', name: 'П-образная', hint: 'Левая, задняя и правая стены', walls: ['left', 'back', 'right'] },
];

/** Виды эскиза: развёртки стен, план сверху и объёмный вид. */
export const SKETCH_VIEWS: { id: KitchenSketchView; label: string; short: string; hint: string }[] = [
  { id: 'elevation', label: 'Развёртки стен', short: 'Фасад', hint: 'Фасадные развёртки всех активных стен' },
  { id: 'plan', label: 'План сверху', short: 'План', hint: 'Вид сверху с расстановкой по стенам' },
  { id: '3d', label: '3D · Объём', short: '3D', hint: 'Объёмный вид помещения' },
];

export const DEFAULT_LAYOUT_SHAPE: KitchenLayoutShape = 'straight';
export const DEFAULT_WALL: KitchenWall = 'back';

export const WALL_LABELS: Record<KitchenWall, string> = {
  left: 'Левая стена',
  back: 'Задняя стена',
  right: 'Правая стена',
};

export const WALL_SHORT_LABELS: Record<KitchenWall, string> = {
  left: 'Левая',
  back: 'Задняя',
  right: 'Правая',
};

/** Старые проекты без планировки считаются прямыми. */
export function normalizeLayoutShape(shape?: KitchenLayoutShape | null): KitchenLayoutShape {
  return LAYOUT_SHAPES.some((item) => item.id === shape) ? (shape as KitchenLayoutShape) : DEFAULT_LAYOUT_SHAPE;
}

/** Стены, доступные в планировке (в порядке слева направо). */
export function layoutWalls(shape?: KitchenLayoutShape | null): KitchenWall[] {
  const found = LAYOUT_SHAPES.find((item) => item.id === normalizeLayoutShape(shape));
  return found ? found.walls : ['back'];
}

/** Модуль без указанной стены (или с недоступной в планировке) относится к задней стене. */
export function moduleWall(module: KitchenModule, shape?: KitchenLayoutShape | null): KitchenWall {
  const walls = layoutWalls(shape);
  const wall = module.wall;
  return wall && walls.includes(wall) ? wall : DEFAULT_WALL;
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
  /** Стена, вдоль которой стоит модуль (учитывает планировку). */
  wall: KitchenWall;
  /** Координата вдоль своей стены, мм (у каждого яруса своя нумерация с нуля). */
  x: number;
  width: number;
  height: number;
  depth: number;
}

/** Развёртка одной стены: нижний и верхний ярусы с независимыми координатами. */
export interface KitchenWallRun {
  wall: KitchenWall;
  label: string;
  floor: SketchPlacedModule[];
  upper: SketchPlacedModule[];
  /** Длина нижнего ряда (пеналы + нижние шкафы), мм. */
  floorWidth: number;
  /** Длина верхнего ряда, мм. */
  upperWidth: number;
  /** Длина ряда нижних шкафов без пеналов — под столешницу, мм. */
  baseRunWidth: number;
  /** Длина стены = максимум ярусов, мм. */
  runWidth: number;
  /** Глубина самого глубокого модуля стены, мм. */
  depth: number;
  /** Высота самой высокой точки стены, мм. */
  totalHeight: number;
}

export interface KitchenLayout {
  shape: KitchenLayoutShape;
  /** Только стены, где есть модули, в порядке левая → задняя → правая. */
  walls: KitchenWallRun[];
  /** Все нижние модули всех стен (совместимость и общие проверки). */
  floor: SketchPlacedModule[];
  /** Все верхние модули всех стен. */
  upper: SketchPlacedModule[];
  totalWidth: number;
  /** Высота от пола до самой высокой точки, мм. */
  totalHeight: number;
  baseRunWidth: number;
  upperRunWidth: number;
}

/** Высота цоколя, мм. */
export const PLINTH_MM = 100;
/** Толщина столешницы, мм. */
export const COUNTER_MM = 38;
/** Высота фартука между столешницей и верхними шкафами, мм. */
export const BACKSPLASH_MM = 600;
/** Базовая высота нижнего шкафа, мм. */
export const BASE_HEIGHT_MM = 720;

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
 * Раскладывает модули по стенам выбранной планировки. Внутри каждой стены нижние
 * шкафы и пеналы стоят на полу в порядке проекта, а верхний ярус образует
 * отдельную непрерывную линию — координаты ярусов независимы друг от друга.
 */
export function buildKitchenLayout(modules: KitchenModule[], shape?: KitchenLayoutShape | null): KitchenLayout {
  const normalizedShape = normalizeLayoutShape(shape);
  const walls = layoutWalls(normalizedShape);
  const runs = new Map<KitchenWall, KitchenWallRun>(walls.map((wall) => [wall, {
    wall,
    label: WALL_LABELS[wall],
    floor: [],
    upper: [],
    floorWidth: 0,
    upperWidth: 0,
    baseRunWidth: 0,
    runWidth: 0,
    depth: 0,
    totalHeight: 0,
  }]));

  modules.forEach((module, sourceIndex) => {
    const tier = classifySketchTier(module);
    const dimensions = moduleSketchDimensions(module, tier);
    const wall = moduleWall(module, normalizedShape);
    const run = runs.get(wall)!;
    const qty = Math.max(0, Math.round(module.qty || 0));
    for (let instance = 0; instance < qty; instance += 1) {
      const placed: SketchPlacedModule = {
        module,
        sourceId: module.id,
        sourceIndex,
        instance,
        tier,
        wall,
        x: tier === 'upper' ? run.upperWidth : run.floorWidth,
        ...dimensions,
      };
      if (tier === 'upper') {
        run.upper.push(placed);
        run.upperWidth += dimensions.width;
      } else {
        run.floor.push(placed);
        run.floorWidth += dimensions.width;
        if (tier === 'base') run.baseRunWidth = run.floorWidth;
      }
      run.depth = Math.max(run.depth, dimensions.depth);
    }
  });

  const activeRuns = walls.map((wall) => runs.get(wall)!).filter((run) => run.floor.length > 0 || run.upper.length > 0);
  for (const run of activeRuns) {
    run.runWidth = Math.max(run.floorWidth, run.upperWidth);
    run.totalHeight = runHeight(run);
    if (run.depth <= 0) run.depth = 560;
  }

  const floor = activeRuns.flatMap((run) => run.floor);
  const upper = activeRuns.flatMap((run) => run.upper);
  return {
    shape: normalizedShape,
    walls: activeRuns,
    floor,
    upper,
    totalWidth: Math.max(1, ...activeRuns.map((run) => run.runWidth)),
    totalHeight: Math.max(PLINTH_MM + BASE_HEIGHT_MM + COUNTER_MM, ...activeRuns.map((run) => run.totalHeight)),
    baseRunWidth: Math.max(0, ...activeRuns.map((run) => run.baseRunWidth)),
    upperRunWidth: Math.max(0, ...activeRuns.map((run) => run.upperWidth)),
  };
}

function runHeight(run: KitchenWallRun): number {
  // Стандартная высота: цоколь 100 + стол 720 + столешница 38 + фартук 600 + верх 720.
  const normalHeight = run.upper.length
    ? upperBottomMm(run) + Math.max(...run.upper.map((m) => m.height))
    : PLINTH_MM + baseHeightMm(run) + COUNTER_MM;
  const tallHeight = Math.max(0, ...run.floor.filter((m) => m.tier === 'tall').map((m) => m.height));
  return Math.max(normalHeight, tallHeight, PLINTH_MM + BASE_HEIGHT_MM + COUNTER_MM);
}

/** Высота корпуса нижнего ряда стены (без цоколя и столешницы), мм. */
export function baseHeightMm(run: KitchenWallRun): number {
  return Math.max(BASE_HEIGHT_MM, ...run.floor.filter((item) => item.tier === 'base').map((item) => item.height));
}

/** Участок стены, занятый нижними шкафами (под столешницу), мм. */
export function baseSpanMm(run: KitchenWallRun): { start: number; end: number } {
  const items = run.floor.filter((item) => item.tier === 'base');
  if (!items.length) return { start: 0, end: 0 };
  return {
    start: Math.min(...items.map((item) => item.x)),
    end: Math.max(...items.map((item) => item.x + item.width)),
  };
}

/** Низ верхнего ряда стены от пола, мм. */
export function upperBottomMm(run: KitchenWallRun): number {
  return PLINTH_MM + baseHeightMm(run) + COUNTER_MM + BACKSPLASH_MM;
}

/** Отметка низа модуля от пола, мм. */
export function placedBottomMm(placed: SketchPlacedModule, run: KitchenWallRun): number {
  if (placed.tier === 'upper') return upperBottomMm(run);
  if (placed.tier === 'tall') return 0;
  return PLINTH_MM;
}

/** Габариты помещения для плана и 3D, мм. */
export interface RoomBox {
  /** Ширина по задней стене, мм. */
  width: number;
  /** Глубина помещения от задней стены к зрителю, мм. */
  depth: number;
  backDepth: number;
  leftDepth: number;
  rightDepth: number;
}

export function roomBox(layout: KitchenLayout): RoomBox {
  const run = (wall: KitchenWall) => layout.walls.find((item) => item.wall === wall);
  const back = run('back');
  const left = run('left');
  const right = run('right');
  const backDepth = back?.depth ?? 0;
  const leftDepth = left?.depth ?? 0;
  const rightDepth = right?.depth ?? 0;
  const width = Math.max(back?.runWidth ?? 0, leftDepth + rightDepth + 600, 1200);
  const sideLength = Math.max(left?.runWidth ?? 0, right?.runWidth ?? 0);
  const depth = Math.max(backDepth + sideLength, backDepth + 900, 1500);
  return { width, depth, backDepth, leftDepth, rightDepth };
}

/** Прямоугольник модуля в плане, мм: x — вдоль задней стены, y — от задней стены к зрителю. */
export interface PlanRect { x0: number; x1: number; y0: number; y1: number }

export function planRect(placed: SketchPlacedModule, layout: KitchenLayout): PlanRect {
  const room = roomBox(layout);
  if (placed.wall === 'left') {
    const y0 = room.backDepth + placed.x;
    return { x0: 0, x1: placed.depth, y0, y1: y0 + placed.width };
  }
  if (placed.wall === 'right') {
    const y0 = room.backDepth + placed.x;
    return { x0: room.width - placed.depth, x1: room.width, y0, y1: y0 + placed.width };
  }
  return { x0: placed.x, x1: placed.x + placed.width, y0: 0, y1: placed.depth };
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
