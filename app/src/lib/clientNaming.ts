import type { PriceItem, ProjectLine } from '../types';

/**
 * Названия позиций для клиента.
 *
 * В прайсе фабрики строки названы по-внутреннему: «Квадратный метр фасада
 * (декор под вытяжку и цоколя считаютс по кв.м) — 19мм». В КП такое показывать
 * нельзя — клиенту нужен материал: «МДФ ПВХ (1 категория; 19 мм)».
 *
 * Данные берём из самого прайса (категория, подкатегория и attrs позиции),
 * поэтому ничего не нужно переносить в проект. Если позиции прайса уже нет,
 * работает разбор по названию строки.
 */

export interface ClientNameSource {
  category: string;
  name: string;
  subcategory?: string | null;
  attrs?: Record<string, string> | null;
}

const THICKNESS_RE = /(\d{2,3})\s*мм/iu;

function firstMatch(re: RegExp, ...values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    const found = value?.match(re);
    if (found) return found[1];
  }
  return null;
}

/** «16мм» / «— 19 мм» → «19 мм» (с неразрывным пробелом не играем: в КП обычный). */
function thicknessText(...values: (string | null | undefined)[]): string {
  const mm = firstMatch(THICKNESS_RE, ...values);
  return mm ? `${mm} мм` : '';
}

/** «1 категория (плёнки)» → «1 категория»; «1 кат» → «1 категория». */
export function normalizeFacadeCategory(value?: string | null): string {
  if (!value) return '';
  const base = value.replace(/\((?:плёнки|пленки|hpl)\)/giu, '').replace(/\s+/gu, ' ').trim();
  const short = base.match(/^(\d+)\s*кат\.?$/iu);
  if (short) return `${short[1]} категория`;
  return base;
}

/** Убирает служебные хвосты прайса: «(кв.м)», «(декор под вытяжку …)», размер листа. */
function stripServiceParts(value: string): string {
  return value
    .replace(/\(\s*кв\.?\s*м\.?\s*\)/giu, '')
    .replace(/\(\s*декор[^)]*\)/giu, '')
    .replace(/\s*—\s*\d{2,3}\s*мм\s*$/iu, '')
    .replace(/\s{2,}/gu, ' ')
    .trim()
    .replace(/[,;]\s*$/u, '');
}

function wrap(base: string, parts: (string | null | undefined)[]): string {
  const inner = parts.map((part) => (part ?? '').trim()).filter(Boolean).join('; ');
  return inner ? `${base} (${inner})` : base;
}

/**
 * Клиентское имя фасадной позиции. Возвращает null, если категория не фасадная
 * или понятного названия не получается — тогда остаётся исходное имя строки.
 */
export function clientFacadeName(source: ClientNameSource): string | null {
  const category = source.category ?? '';
  if (!category.startsWith('Фасады')) return null;
  const attrs = source.attrs ?? {};
  const name = source.name ?? '';

  // МДФ в ПВХ-плёнке: категория плёнки + толщина.
  if (/ПВХ/iu.test(category) || /плёнк|пленк/iu.test(category)) {
    const cat = normalizeFacadeCategory(attrs['категория'] || source.subcategory);
    const thickness = thicknessText(attrs['толщина'], name);
    return wrap('МДФ ПВХ', [cat, thickness]);
  }

  // Эмаль: вид покрытия + фрезеровка.
  if (/эмал/iu.test(category)) {
    const kind = stripServiceParts(attrs['изделие'] || name.split('—')[0] || '');
    const milling = (attrs['фрезеровка'] || source.subcategory || '').trim();
    return wrap('МДФ эмаль', [kind, milling]);
  }

  // Пластик HPL: бренд + категория.
  if (/пластик|hpl/iu.test(category)) {
    const brandRaw = attrs['бренд'] || '';
    const brand = brandRaw.split('(')[0].trim() || stripServiceParts(name.split('—').pop() ?? '');
    const cat = normalizeFacadeCategory(attrs['категория'] || source.subcategory);
    return wrap('Пластик HPL', [brand, cat]);
  }

  // TSS: коллекция + толщина, базовое имя сохраняем («TSS Eterno»).
  if (/tss/iu.test(category)) {
    const base = (name.split('—')[0] ?? '').split(',')[0].trim() || 'TSS плита';
    const collection = (attrs['коллекция'] || '').trim();
    return wrap(base, [collection, thicknessText(attrs['толщина'], name)]);
  }

  // Стекло и зеркала: убираем размер листа, он клиенту не нужен.
  if (/стекл|зеркал/iu.test(category)) {
    const base = name.replace(/\(\s*\d+\s*[*x×][^)]*\)/giu, '').replace(/\s{2,}/gu, ' ').trim();
    return base ? `Стекло/зеркало — ${base}` : null;
  }

  return null;
}

/**
 * Имя строки проекта так, как его увидит клиент: сначала понятное название
 * материала, иначе — исходное имя из прайса.
 */
export function clientLineName(line: Pick<ProjectLine, 'category' | 'name'>, item?: PriceItem | null): string {
  const friendly = clientFacadeName({
    category: line.category,
    name: line.name,
    subcategory: item?.subcategory ?? null,
    attrs: item?.attrs ?? null,
  });
  return friendly || line.name;
}

/** Ключ ручного переименования позиции в КП: одна правка — на все такие строки. */
export function clientNameKey(line: Pick<ProjectLine, 'itemId' | 'name'>): string {
  return line.itemId || `name:${line.name}`;
}

/**
 * Итоговый резолвер для КП и документов: ручная правка менеджера важнее
 * автоматического названия.
 */
export function makeClientNameResolver(
  items: Map<string, PriceItem> | undefined,
  overrides: Record<string, string> | undefined,
): (line: ProjectLine) => string {
  return (line) => {
    const manual = overrides?.[clientNameKey(line)];
    if (manual && manual.trim()) return manual.trim();
    return clientLineName(line, items?.get(line.itemId));
  };
}
