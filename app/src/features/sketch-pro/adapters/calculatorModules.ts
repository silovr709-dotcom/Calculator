import type { KitchenModule, ModuleDefaults, Pricebook, SlotKey, Project } from '../../../types';
import type { ModuleObject, SketchMaterialReference } from '../core/types';

export type SketchModuleOption = {
  id: string;
  label: string;
  dimensions: string;
  description: string;
  module: KitchenModule;
  materialRefs: SketchMaterialReference[];
};

const slots: SlotKey[] = ['body', 'facade', 'frame', 'hinge', 'drawerSys', 'lift', 'handle', 'shelf', 'legs'];
const slotLabels: Record<SlotKey, string> = {
  body: 'Корпус', facade: 'Фасад', frame: 'Каркас', hinge: 'Петли', drawerSys: 'Ящики', lift: 'Подъёмники', handle: 'Ручки', shelf: 'Полки', legs: 'Опоры',
};
const legendCodes: Partial<Record<SlotKey, string>> = { facade: 'Ф01', body: 'К01', frame: 'СТ01', handle: 'Р01' };

export function resolveSlotItemId(module: KitchenModule, slot: SlotKey, defaults: ModuleDefaults): string | null {
  const choice = module.slots?.[slot];
  if (choice?.mode === 'manual') return choice.itemId;
  return defaults[slot] ?? null;
}

export function moduleMaterialRefs(module: KitchenModule, defaults: ModuleDefaults, pricebook: Pricebook): SketchMaterialReference[] {
  return slots.flatMap((slot) => {
    const itemId = resolveSlotItemId(module, slot, defaults);
    if (!itemId) return [];
    const item = pricebook.items.find((candidate) => candidate.id === itemId);
    if (!item) return [];
    return [{ moduleId: module.id, slot, itemId: item.id, label: slotLabels[slot] }];
  });
}

export function moduleOption(module: KitchenModule, defaults: ModuleDefaults, pricebook: Pricebook): SketchModuleOption {
  const dimensions = [module.widthMm, module.heightMm, module.depthMm].map((value) => value == null ? '—' : `${value}`).join(' × ');
  const materialRefs = moduleMaterialRefs(module, defaults, pricebook);
  return {
    id: module.id,
    label: module.name || module.type,
    dimensions,
    description: `${module.name || module.type}\n${dimensions} мм`,
    module,
    materialRefs,
  };
}

export function sketchModuleOptions(project: Project, pricebook: Pricebook): SketchModuleOption[] {
  return (project.modules ?? []).map((module) => moduleOption(module, project.moduleDefaults ?? {}, pricebook));
}

export function moduleObjectFromCalculator(module: KitchenModule, defaults: ModuleDefaults, pricebook: Pricebook, position: { x: number; y: number }, number: string): ModuleObject {
  const option = moduleOption(module, defaults, pricebook);
  return {
    id: crypto.randomUUID(), type: 'module', x: position.x, y: position.y, number, description: option.description,
    color: '#20242b', fontSize: 22, sourceModuleId: module.id, materialRefs: option.materialRefs,
  };
}

export function legendCodeForSlot(slot: SlotKey): string | null {
  return legendCodes[slot] ?? null;
}

export function slotLabel(slot: SlotKey): string {
  return slotLabels[slot];
}
