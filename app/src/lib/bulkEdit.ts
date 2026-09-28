import type { ExtraFacadePart, KitchenModule, KitchenWall, SlotChoice, SlotKey } from '../types';

export interface BulkModulePatch {
  widthMm?: number | null;
  heightMm?: number | null;
  depthMm?: number | null;
  wall?: KitchenWall;
  slots?: Partial<Record<SlotKey, string | null>>;
  /** Отдельные фасадные детали (боковины, накладки) — полностью заменяют список у выбранных модулей. */
  extraFacadeParts?: ExtraFacadePart[];
  /** Процентные надбавки нестандартных габаритов — заменяют списки у выбранных модулей. */
  surcharges?: string[];
  automaticSurcharges?: string[];
}

/** Применяет только явно переданные поля к выбранным модулям. */
export function applyBulkModuleEdits(modules: KitchenModule[], ids: string[], patch: BulkModulePatch): KitchenModule[] {
  const selected = new Set(ids);
  return modules.map((module) => {
    if (!selected.has(module.id)) return module;
    const next: KitchenModule = { ...module };
    if ('widthMm' in patch) next.widthMm = patch.widthMm ?? null;
    if ('heightMm' in patch) next.heightMm = patch.heightMm ?? null;
    if ('depthMm' in patch) next.depthMm = patch.depthMm ?? null;
    if ((('widthMm' in patch && patch.widthMm !== module.widthMm)
      || ('heightMm' in patch && patch.heightMm !== module.heightMm)
      || ('depthMm' in patch && patch.depthMm !== module.depthMm))
      && next.facadeSpecStatus === 'applied') {
      next.facadeSpecStatus = 'outdated';
    }
    if ((('widthMm' in patch && patch.widthMm !== module.widthMm)
      || ('heightMm' in patch && patch.heightMm !== module.heightMm)
      || ('depthMm' in patch && patch.depthMm !== module.depthMm))
      && next.hingeSpecStatus === 'applied') {
      next.hingeSpecStatus = 'outdated';
    }
    if (patch.wall) next.wall = patch.wall;
    if (patch.slots) {
      const slots: Record<SlotKey, SlotChoice> = { ...module.slots };
      for (const [key, itemId] of Object.entries(patch.slots) as [SlotKey, string | null][]) {
        slots[key] = { mode: 'manual', itemId };
      }
      next.slots = slots;
    }
    // Пробник копируется глубоко, чтобы правка одного модуля не меняла остальные
    if (patch.extraFacadeParts) next.extraFacadeParts = JSON.parse(JSON.stringify(patch.extraFacadeParts));
    if (patch.surcharges) next.surcharges = [...patch.surcharges];
    if (patch.automaticSurcharges) next.automaticSurcharges = [...patch.automaticSurcharges];
    return next;
  });
}

/** Копирует размеры, стену, комплектацию, отдельные детали и надбавки источника в другие модули. */
export function copyModuleValues(source: KitchenModule): BulkModulePatch {
  return {
    widthMm: source.widthMm,
    heightMm: source.heightMm,
    depthMm: source.depthMm,
    wall: source.wall,
    slots: Object.fromEntries(Object.entries(source.slots).map(([key, choice]) => [key, choice.mode === 'manual' ? choice.itemId : null])) as Partial<Record<SlotKey, string | null>>,
    extraFacadeParts: JSON.parse(JSON.stringify(source.extraFacadeParts ?? [])),
    surcharges: [...(source.surcharges ?? [])],
    automaticSurcharges: [...(source.automaticSurcharges ?? [])],
  };
}

/**
 * «Заполнить как у верхней позиции» (Ctrl+D в таблице): копирует высоту, глубину,
 * количество опор и все материалы слотов из модуля, стоящего НАД первым выбранным,
 * во все выбранные модули. Ширину, фасады и ящики не трогает — они обычно разные.
 */
export function fillFromAbove(modules: KitchenModule[], selectedIds: string[]): { modules: KitchenModule[]; changed: number; sourceName: string | null } {
  const selected = new Set(selectedIds);
  const firstIdx = modules.findIndex((m) => selected.has(m.id));
  if (firstIdx <= 0) return { modules, changed: 0, sourceName: null };
  const source = modules[firstIdx - 1];
  if (selected.has(source.id)) return { modules, changed: 0, sourceName: null };
  let changed = 0;
  const next = modules.map((module, i) => {
    if (!selected.has(module.id) || i === firstIdx - 1) return module;
    changed += 1;
    const res: KitchenModule = {
      ...module,
      heightMm: source.heightMm,
      depthMm: source.depthMm,
      legs: source.legs,
      slots: JSON.parse(JSON.stringify(source.slots)) as KitchenModule['slots'],
    };
    if (source.heightMm !== module.heightMm && module.facadeSpecStatus === 'applied') res.facadeSpecStatus = 'outdated';
    if (source.heightMm !== module.heightMm && module.hingeSpecStatus === 'applied') res.hingeSpecStatus = 'outdated';
    return res;
  });
  return { modules: next, changed, sourceName: source.name };
}
