// Фрезеровки фасадов Висмы (каталог 2026) и их связь с прайсом.
//
// Главное, ради чего этот справочник нужен в расчёте: категория фрезеровки (1–4)
// напрямую задаёт цену квадратного метра фасада в прайсе «ВИСМА 2026 КХМ».
//   ПВХ   → лист «МДФ(ПВХ)», раздел «N категория (плёнки)», строка «Квадратный метр фасада … — 16/19/22мм»
//   эмаль → лист «Эмаль»,    раздел «фрезеровка N кат»,      строки «матовая/глянец/металлик-глянец (кв.м)»
// Ничего не досчитываем и не усредняем: берём ровно те строки прайса, что есть.

import type { PriceItem, Pricebook } from '../types';

export interface MillingSizes {
  /** Глухой фасад, «высота*ширина» в мм. null — фабрика не изготавливает. */
  blind: string | null;
  /** Рамка с крестом. */
  rk: string | null;
  /** Рамка без креста. */
  rbk: string | null;
  /** Фасад ящика. */
  drawer: string | null;
}

export interface Milling {
  name: string;
  slug: string;
  /** Категория 1–4: ею прайс задаёт цену фасада. */
  category: number;
  categoryLabel: string;
  /** Вид фаски/обкатки: «классика», «R3», «мыло», фирменные («марко», «дублин»…). */
  faska: string | null;
  frameWidthMm: string | null;
  /** Толщина МДФ, мм: «16», «19», «22», «25», иногда диапазон «16-19». */
  mdfThicknessMm: string;
  /** В чём изготавливается: «ПВХ» и/или «эмаль». */
  coatings: string[];
  onlyEnamel: boolean;
  sizes: MillingSizes;
  /** Шаг рисунка, мм — только у фрезеровок со сплошным рисунком. */
  stepMm: string | null;
  note: string | null;
  /** Путь к превью относительно BASE_URL. */
  image: string;
  source: { file: string; pdfPage: number; printedPage: number };
}

export interface MillingsGroup {
  label: string;
  legend?: Record<string, string>;
  issues?: { level: string; text: string }[];
  items: Milling[];
}

export const MILLING_CATEGORIES = [1, 2, 3, 4] as const;

const norm = (value: string) => value.toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
/** Для поиска в свободном тексте бланка: «Фасад: Арка 2, плёнка» → « фасад арка 2 плёнка ». */
const matchNorm = (value: string) => ` ${norm(value).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;

/** Живой поиск: название, фаска, толщина, покрытие, примечание. */
export function searchMillings(
  items: Milling[],
  query: string,
  filters: { category?: number | null; coating?: string | null; thickness?: string | null } = {},
): Milling[] {
  const terms = norm(query).split(' ').filter(Boolean);
  return items.filter((m) => {
    if (filters.category && m.category !== filters.category) return false;
    if (filters.coating && !m.coatings.includes(filters.coating)) return false;
    if (filters.thickness && m.mdfThicknessMm !== filters.thickness) return false;
    if (!terms.length) return true;
    const hay = norm([
      m.name, m.categoryLabel, m.faska ?? '', m.frameWidthMm ?? '', `${m.mdfThicknessMm}мм`,
      m.coatings.join(' '), m.note ?? '',
    ].join(' '));
    return terms.every((t) => hay.includes(t));
  });
}

/**
 * Находит фрезеровку по свободному тексту поля бланка («Фасад — Пирамида, ПВХ»).
 * Сначала точное совпадение имени, затем самое длинное вхождение, чтобы
 * «Арка 2» не находилась как «Арка», а «Марокко 2» — как «Марокко».
 */
export function findMilling(value: string, items: Milling[]): Milling | null {
  const text = matchNorm(value);
  if (!text.trim()) return null;
  const exact = items.find((m) => norm(m.name) === norm(value));
  if (exact) return exact;
  const hits = items.filter((m) => text.includes(matchNorm(m.name)));
  if (!hits.length) return null;
  return hits.reduce((best, m) => (m.name.length > best.name.length ? m : best));
}

export interface MillingPrice {
  coating: 'ПВХ' | 'эмаль';
  /** «16мм» для ПВХ, «матовая»/«глянец»/«металлик-глянец» для эмали. */
  variant: string;
  price: number;
  unit: string;
  item: PriceItem;
}

const PVH_ROW = 'Квадратный метр фасада';
const ENAMEL_ROWS = ['матовая (кв.м)', 'глянец (кв.м)', 'металлик-глянец (кв.м)'];

/**
 * Цены квадратного метра фасада для этой фрезеровки из прайса.
 * Пусто — значит в прайсе такой строки нет: сумму не выдумываем.
 */
export function millingPrices(milling: Milling, pricebook: Pricebook | undefined): MillingPrice[] {
  if (!pricebook) return [];
  const out: MillingPrice[] = [];

  if (milling.coatings.includes('ПВХ')) {
    const sub = `${milling.category} категория (плёнки)`;
    for (const item of pricebook.items) {
      if (item.subcategory !== sub) continue;
      if (!item.name.startsWith(PVH_ROW)) continue;
      if (item.price == null) continue;
      out.push({
        coating: 'ПВХ',
        variant: item.attrs['толщина'] ?? item.name.split('—').pop()!.trim(),
        price: item.price,
        unit: item.unit ?? 'кв.м',
        item,
      });
    }
  }

  if (milling.coatings.includes('эмаль')) {
    const sub = `фрезеровка ${milling.category} кат`;
    for (const label of ENAMEL_ROWS) {
      const item = pricebook.items.find(
        (i) => i.subcategory === sub && i.attrs['изделие'] === label && i.price != null,
      );
      if (item) {
        out.push({
          coating: 'эмаль',
          variant: label.replace(' (кв.м)', ''),
          price: item.price!,
          unit: item.unit ?? 'кв.м',
          item,
        });
      }
    }
  }

  return out;
}

/** Минимальная цена м² фасада с этой фрезеровкой — для быстрой прикидки в списке. */
export function millingPriceFrom(milling: Milling, pricebook: Pricebook | undefined): MillingPrice | null {
  const prices = millingPrices(milling, pricebook).filter((p) => p.unit === 'кв.м');
  if (!prices.length) return null;
  return prices.reduce((min, p) => (p.price < min.price ? p : min));
}

export interface MillingIssue {
  level: 'error' | 'warn';
  text: string;
}

/**
 * Проверки по самому каталогу — без догадок:
 *  — фрезеровки нет в каталоге 2026 → предупреждение (возможно, снята);
 *  — фрезеровка «только эмаль», а в бланке ПВХ/плёнка → ошибка;
 *  — «Переход рисунка не совпадает» / «Радиус не изготавливается» → показываем как есть;
 *  — плёнка с пометкой «*» (только «Мыло») с другой фрезеровкой → ошибка.
 */
export function checkMillingValue(
  value: string,
  items: Milling[],
  context: { mentionsPvh?: boolean; mentionsEnamel?: boolean; onlyMiloFilm?: boolean } = {},
): MillingIssue[] {
  const text = value.trim();
  if (!text) return [];
  const issues: MillingIssue[] = [];
  const milling = findMilling(text, items);

  if (!milling) {
    issues.push({
      level: 'warn',
      text: `«${text}» не найдена в каталоге фрезеровок 2026 (${items.length} позиций) — проверьте название или согласуйте с фабрикой`,
    });
    return issues;
  }

  if (milling.onlyEnamel && context.mentionsPvh) {
    issues.push({
      level: 'error',
      text: `Фрезеровка «${milling.name}» по каталогу изготавливается только в эмали, а в бланке указан ПВХ`,
    });
  }
  if (context.mentionsEnamel && !milling.coatings.includes('эмаль')) {
    issues.push({
      level: 'error',
      text: `Фрезеровка «${milling.name}» по каталогу в эмали не изготавливается`,
    });
  }
  if (context.onlyMiloFilm && norm(milling.name) !== 'мыло') {
    issues.push({
      level: 'error',
      text: `Выбранная плёнка идёт только с фрезеровкой «Мыло», а указана «${milling.name}»`,
    });
  }
  if (milling.note) {
    issues.push({ level: 'warn', text: `«${milling.name}»: ${milling.note} (каталог, стр. ${milling.source.pdfPage})` });
  }
  return issues;
}
