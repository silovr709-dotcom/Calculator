import type { KitchenModule, KitchenWall, SlotChoice, SlotKey } from '../types';

export interface BulkModulePatch {
  widthMm?: number | null;
  heightMm?: number | null;
  depthMm?: number | null;
  wall?: KitchenWall;
  slots?: Partial<Record<SlotKey, string | null>>;
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
    return next;
  });
}

/** Копирует размеры, стену и комплектацию источника в другие модули. */
export function copyModuleValues(source: KitchenModule): BulkModulePatch {
  return {
    widthMm: source.widthMm,
    heightMm: source.heightMm,
    depthMm: source.depthMm,
    wall: source.wall,
    slots: Object.fromEntries(Object.entries(source.slots).map(([key, choice]) => [key, choice.mode === 'manual' ? choice.itemId : null])) as Partial<Record<SlotKey, string | null>>,
  };
}
