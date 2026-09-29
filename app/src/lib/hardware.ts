// Справочник фурнитуры для базы знаний: берём актуальный прайс и раскладываем
// позиции по понятным группам (петли, ручки, направляющие, опоры…), чтобы
// технолог искал «петля 110» и сразу видел артикул, единицу и цену.

import type { PriceItem, Pricebook } from '../types';
import { tokenize, tokenMatches, normalize } from './knowledgeDocs';

export interface HardwareGroup {
  id: string;
  label: string;
  icon: string;
  /** Категории прайса, попадающие в группу. */
  categories: string[];
}

export const HARDWARE_GROUPS: HardwareGroup[] = [
  { id: 'hinges', label: 'Петли', icon: '🔩', categories: ['Петли'] },
  { id: 'handles', label: 'Ручки', icon: '🚪', categories: ['Ручки'] },
  { id: 'drawers', label: 'Направляющие и системы выдвижения', icon: '📥', categories: ['Системы выдвижения'] },
  { id: 'lifts', label: 'Подъёмные механизмы', icon: '⬆️', categories: ['Подъёмные механизмы'] },
  { id: 'legs', label: 'Опоры, ножки и цоколь', icon: '🦵', categories: ['Опоры и ножки', 'Цоколь и длинномеры'] },
  { id: 'inner', label: 'Внутреннее наполнение', icon: '🧺', categories: ['Внутреннее наполнение', 'Бутылочницы и карго', 'Посудосушители'] },
  { id: 'light', label: 'Электрика и свет', icon: '💡', categories: ['Электрика и свет'] },
  { id: 'sinks', label: 'Мойки', icon: '🚰', categories: ['Мойки'] },
  { id: 'blum', label: 'Фурнитура BLUM', icon: '🅱️', categories: ['Фурнитура BLUM (доп. лист)'] },
  { id: 'gola', label: 'GOLA и профили', icon: '📏', categories: ['GOLA / профили'] },
  { id: 'body', label: 'Комплектация каркасов', icon: '🧱', categories: ['Доп. комплектация каркасов', 'Дополнительные элементы'] },
];

export interface HardwareEntry {
  item: PriceItem;
  group: HardwareGroup;
}

/** Все позиции фурнитуры прайса, разложенные по группам. */
export function hardwareEntries(pricebook: Pricebook | undefined): HardwareEntry[] {
  if (!pricebook) return [];
  const byCategory = new Map<string, HardwareGroup>();
  for (const g of HARDWARE_GROUPS) for (const c of g.categories) byCategory.set(c, g);

  const out: HardwareEntry[] = [];
  for (const item of pricebook.items) {
    const group = byCategory.get(item.category);
    if (group) out.push({ item, group });
  }
  return out;
}

/** Сколько позиций в каждой группе (для бейджей в интерфейсе). */
export function hardwareCounts(entries: HardwareEntry[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of entries) counts[e.group.id] = (counts[e.group.id] ?? 0) + 1;
  return counts;
}

/**
 * Поиск по фурнитуре: прощает опечатки и понимает числа («петля 110»).
 * Числовые токены ищутся строго — 110 не должно находить 100.
 */
export function searchHardware(entries: HardwareEntry[], query: string, groupId: string | null, limit = 300): HardwareEntry[] {
  const scoped = groupId ? entries.filter((e) => e.group.id === groupId) : entries;
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return scoped.slice(0, limit);

  const scored: { entry: HardwareEntry; score: number }[] = [];
  for (const entry of scoped) {
    const haystack = normalize(`${entry.item.name} ${entry.item.article ?? ''} ${entry.item.subcategory ?? ''} ${entry.item.category}`);
    const tokens = haystack.split(' ').filter(Boolean);
    let score = 0;
    let matched = 0;
    for (const q of qTokens) {
      const isNumber = /^\d+$/.test(q);
      let best = 0;
      if (isNumber) {
        if (tokens.includes(q)) best = 6;
        else if (tokens.some((t) => t.includes(q))) best = 3;
      } else if (haystack.includes(q)) {
        best = 5;
      } else if (tokens.some((t) => tokenMatches(q, t))) {
        best = 2;
      }
      if (best > 0) matched += 1;
      score += best;
    }
    if (matched < qTokens.length) continue; // нужны все слова запроса
    scored.push({ entry, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.entry.item.name.localeCompare(b.entry.item.name))
    .slice(0, limit)
    .map((s) => s.entry);
}
