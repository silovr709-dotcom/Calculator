import type { KitchenModule, ModuleDefaults, Pricebook, SlotKey } from '../../../types';
import { resolveSlotItemId, legendCodeForSlot, slotLabel } from './calculatorModules';

export type SketchLegendRow = {
  code: string;
  label: string;
  itemId: string;
  name: string;
  article: string | null;
  price: string;
};

const priceText = (price: number | null, priceRaw: string | null) => price == null ? (priceRaw ?? 'нет цены') : `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(price)} ₽`;

/** Материалы эскиза — только реальные PriceItem активного прайса. */
export function sketchMaterialLegend(module: KitchenModule, defaults: ModuleDefaults, pricebook: Pricebook): SketchLegendRow[] {
  const slots: SlotKey[] = ['facade', 'body', 'frame', 'handle'];
  return slots.flatMap((slot) => {
    const code = legendCodeForSlot(slot);
    const itemId = resolveSlotItemId(module, slot, defaults);
    if (!code || !itemId) return [];
    const item = pricebook.items.find((candidate) => candidate.id === itemId);
    if (!item) return [];
    return [{ code, label: slotLabel(slot), itemId: item.id, name: item.name, article: item.article, price: priceText(item.price, item.priceRaw) }];
  });
}

export function sketchMaterialLegendForModuleId(moduleId: string | undefined, modules: KitchenModule[], defaults: ModuleDefaults, pricebook: Pricebook): SketchLegendRow[] {
  const module = modules.find((candidate) => candidate.id === moduleId);
  return module ? sketchMaterialLegend(module, defaults, pricebook) : [];
}

export function materialItemIdsForModule(module: KitchenModule, defaults: ModuleDefaults, pricebook: Pricebook): string[] {
  return sketchMaterialLegend(module, defaults, pricebook).map((row) => row.itemId);
}
