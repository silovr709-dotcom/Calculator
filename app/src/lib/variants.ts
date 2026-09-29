import type { CalculationVariant, KitchenModule, Pricebook, Project, ProjectSettings, SlotKey } from '../types';
import { calcTotals, lineFromItem } from './engine';
import { lineMatchesChecklistKey } from './checklist';
import { moduleToLines } from './modules';
import { uid } from './storage';

export const VARIANT_PRESETS: { name: string; description: string }[] = [
  { name: 'Эконом', description: 'Практичные фасады и базовая фурнитура' },
  { name: 'Стандарт', description: 'Сбалансированный состав проекта' },
  { name: 'Премиум', description: 'Выбранные материалы и усиленная фурнитура' },
];

export function createVariant(name: string, description: string, settings: ProjectSettings): CalculationVariant {
  return { id: uid('variant'), name, description, defaults: {}, slotOverrides: {}, settings: JSON.parse(JSON.stringify(settings)) as ProjectSettings, clientVisible: true };
}

/** Применяет вариант поверх проекта, не изменяя исходные ручные значения. */
export function moduleForVariant(module: KitchenModule, variant: CalculationVariant): KitchenModule {
  const slots = { ...module.slots };
  for (const [key, itemId] of Object.entries(variant.slotOverrides) as [SlotKey, string | null][]) {
    slots[key] = { mode: 'manual', itemId };
  }
  return { ...module, slots };
}

/** Строки проекта с учётом варианта: заменяет столешницу/стеновую панель на позицию варианта,
 *  сохраняя количество и параметры исходной строки (длина/листы и т.п. не сбрасываются). */
export function linesForVariant(project: Project, pricebook: Pricebook, variant: CalculationVariant) {
  const overrides = variant.surfaceOverrides;
  if (!overrides || (!overrides.worktop && !overrides.wallPanel)) return project.lines;
  return project.lines.map((line) => {
    for (const key of ['worktop', 'wallPanel'] as const) {
      const itemId = overrides[key];
      if (!itemId || !lineMatchesChecklistKey(key, line)) continue;
      const item = pricebook.items.find((candidate) => candidate.id === itemId);
      if (!item) return line; // позиция пропала из прайса — оставляем исходную
      return lineFromItem(item, line.pricebookId, line.qty, line.params);
    }
    return line;
  });
}

export function calculateVariant(project: Project, pricebook: Pricebook, variant: CalculationVariant) {
  const defaults = { ...(project.moduleDefaults ?? {}), ...variant.defaults };
  const moduleLines = (project.modules ?? []).flatMap((module) => moduleToLines(moduleForVariant(module, variant), defaults, pricebook));
  const lines = [...moduleLines, ...linesForVariant(project, pricebook, variant)];
  return { ...calcTotals(lines, variant.settings), lines };
}
