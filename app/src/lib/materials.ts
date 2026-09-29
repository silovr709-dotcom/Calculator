// Каталог материалов из нормализованного прайса Висмы.
//
// В отличие от справочников цветов (factory-dicts-visma.json), этот модуль
// работает только с позициями прайса и поэтому всегда показывает фактическую
// цену, единицу измерения и источник строки. Ничего не оцениваем и не
// подставляем: позиции без числовой цены остаются в каталоге с пометкой.

import type { PriceItem, Pricebook } from '../types';

export interface MaterialGroup {
  id: string;
  label: string;
  icon: string;
  /** Категории прайса, входящие в группу. */
  categories: string[];
}

export const MATERIAL_GROUPS: MaterialGroup[] = [
  { id: 'facades', label: 'Фасады', icon: '🎨', categories: ['Фасады'] },
  { id: 'worktops', label: 'Столешницы и панели', icon: '▰', categories: ['Столешницы'] },
  { id: 'corpora', label: 'Корпуса', icon: '🧱', categories: ['Корпуса'] },
  { id: 'glass', label: 'Стекло и зеркала', icon: '◈', categories: ['Стекло'] },
  { id: 'plinth', label: 'Цоколь и длинномеры', icon: '📏', categories: ['Цоколь и длинномеры'] },
];

export interface MaterialEntry {
  item: PriceItem;
  group: MaterialGroup;
}

const categoryStarts = (item: PriceItem, prefixes: string[]) => prefixes.some((prefix) => item.category.startsWith(prefix));

/** Возвращает группу каталога для позиции прайса или null для фурнитуры и работ. */
export function materialGroupOf(item: PriceItem): MaterialGroup | null {
  if (categoryStarts(item, ['Фасады:'])) {
    // Стекло имеет отдельный фильтр, но остаётся материалом фасада.
    return item.category === 'Фасады: Стекло и зеркала'
      ? MATERIAL_GROUPS.find((g) => g.id === 'glass')!
      : MATERIAL_GROUPS.find((g) => g.id === 'facades')!;
  }
  if (categoryStarts(item, ['Столешницы:']) && item.category !== 'Столешницы: комплектующие') {
    return MATERIAL_GROUPS.find((g) => g.id === 'worktops')!;
  }
  if (categoryStarts(item, ['Корпуса:'])) return MATERIAL_GROUPS.find((g) => g.id === 'corpora')!;
  if (item.category === 'Цоколь и длинномеры') return MATERIAL_GROUPS.find((g) => g.id === 'plinth')!;
  return null;
}

/** Все материалы прайса, сохранённые в порядке исходного прайса. */
export function materialEntries(pricebook: Pricebook | undefined, groupId: string | null = null): MaterialEntry[] {
  if (!pricebook) return [];
  return pricebook.items.reduce<MaterialEntry[]>((out, item) => {
    const group = materialGroupOf(item);
    if (group && (groupId == null || group.id === groupId)) out.push({ item, group });
    return out;
  }, []);
}

/** Короткий алиас для компонентов и будущих импортёров каталога. */
export const materialsOf = materialEntries;

export interface MaterialSearchOptions {
  groupId?: string | null;
  category?: string | null;
  onlyPriced?: boolean;
  limit?: number;
}

const normalize = (value: string) => value.toLocaleLowerCase('ru').replace(/ё/g, 'е').trim();

/**
 * Ищет материал по названию, артикулу, группе, категории и атрибутам.
 * Все слова запроса обязательны; числовые размеры ищутся как часть строки,
 * поэтому «600 3000» находит формат столешницы 600*3000.
 */
export function searchMaterials(
  entries: MaterialEntry[],
  query = '',
  options: MaterialSearchOptions = {},
): MaterialEntry[] {
  const q = normalize(query);
  const terms = q.split(/\s+/).filter(Boolean);
  const filtered = entries.filter(({ item, group }) => {
    if (options.groupId && group.id !== options.groupId) return false;
    if (options.category && item.category !== options.category) return false;
    if (options.onlyPriced && !['fixed', 'percent', 'surcharge'].includes(item.priceKind)) return false;
    if (terms.length === 0) return true;
    const haystack = normalize([
      item.name,
      item.article ?? '',
      item.category,
      item.subcategory ?? '',
      group.label,
      ...Object.values(item.attrs ?? {}),
    ].join(' '));
    return terms.every((term) => haystack.includes(term));
  });
  const limit = options.limit ?? 1000;
  return filtered.slice(0, Math.max(0, limit));
}

export function materialCategories(entries: MaterialEntry[], groupId: string | null = null): string[] {
  return [...new Set(entries.filter((entry) => !groupId || entry.group.id === groupId).map((entry) => entry.item.category))]
    .sort((a, b) => a.localeCompare(b, 'ru'));
}

export function materialPriceText(item: PriceItem): string {
  if (item.price != null && (item.priceKind === 'fixed' || item.priceKind === 'surcharge')) {
    return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(item.price)} ₽`;
  }
  if (item.priceKind === 'percent' && item.price != null) return `+${item.price}%`;
  return item.priceRaw ?? 'нет цены';
}

/** Фильтр позиций прайса для поля выбора в бланке. */
export function materialFieldMatches(fieldKey: string, item: PriceItem): boolean {
  const category = item.category.toLocaleLowerCase('ru');
  if (fieldKey === 'bodyEdging' || fieldKey === 'corpusEdging') {
    return /кромк|edge/.test(`${item.name} ${item.subcategory ?? ''} ${category}`);
  }
  if (fieldKey === 'facadeEdging') {
    return item.category.startsWith('Фасады:') || /кромк/.test(`${item.name} ${item.subcategory ?? ''}`);
  }
  if (fieldKey === 'facadeMilling') return item.category.startsWith('Фасады:');
  if (fieldKey === 'worktopEdge' || fieldKey === 'worktopEdgeColor') return item.category.startsWith('Столешницы:') || item.category === 'Цоколь и длинномеры';
  if (fieldKey === 'ldspColor' || fieldKey === 'corpusColor') return item.category.startsWith('Корпуса:');
  if (fieldKey === 'facadeColor') return item.category.startsWith('Фасады:');
  return materialGroupOf(item) !== null;
}
