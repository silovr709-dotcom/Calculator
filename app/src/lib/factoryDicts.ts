// Справочники разбивок Висма: извлечены ETL-скриптом tools/extract_factory_dicts.py
// из реальных файлов репозитория (разбивка 2026 ЛДСП, разбивка ПВХ, разбивка 2026 пластиков).
// Ничего не придумываем: совпадение с бланком проверяем по данным самих разбивок.
import type { BlankIssue, FactoryBlankField } from './factoryBlank';

export interface LdspColor { name: string; texture: boolean; brand: string; format: string; category: string; edgingArticle: string | null }
export interface FilmColor { code: string; name: string; status: string; texture: boolean; brand: string; category: string; onlyMillingMilo?: boolean; onlyMdf16?: boolean }
export interface PlasticItem { article: string; name: string; brand: string; format: string | null; category: string | null; status: string }

export interface FactoryDicts {
  id: string; name: string;
  groups: {
    ldspColors: { label: string; items: LdspColor[] };
    films: { label: string; items: FilmColor[] };
    plastics: { label: string; items: PlasticItem[] };
  };
}

export async function loadFactoryDicts(baseUrl: string): Promise<FactoryDicts | null> {
  try {
    const res = await fetch(`${baseUrl}data/factory-dicts-visma.json`);
    if (!res.ok) return null;
    return (await res.json()) as FactoryDicts;
  } catch {
    return null;
  }
}

/** Значение-подсказка для datalist конкретного поля бланка. */
export function dictSuggestions(fieldKey: string, dicts: FactoryDicts, limit = 40): string[] {
  const { ldspColors, films, plastics } = dicts.groups;
  const uniq = (arr: (string | null)[]) => [...new Set(arr.filter((v): v is string => Boolean(v && v !== 'нет')))].slice(0, limit);
  switch (fieldKey) {
    case 'ldspColor':
    case 'corpusColor':
      return ldspColors.items.map((i) => `${i.texture ? '!' : ''}${i.name} (${i.brand}, ${i.category || i.format})`);
    case 'bodyEdging':
    case 'corpusEdging':
      return uniq(ldspColors.items.map((i) => i.edgingArticle ? `0,4мм ${i.edgingArticle} GP` : null));
    case 'facadeColor':
      return films.items.filter((i) => i.status === 'в работе').map((i) => `${i.texture ? '! ' : ''}${i.code} — ${i.name} (${i.brand})`);
    case 'facadeEdging':
      return [
        ...uniq(ldspColors.items.map((i) => i.edgingArticle ? `1мм ${i.edgingArticle}` : null)),
        ...uniq(plastics.items.map((i) => `кромка ${i.brand} под ${i.article}`)),
      ].slice(0, limit);
    default:
      return [];
  }
}

const normText = (value: string) => value.toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/[\s_*]+/g, ' ').trim();

interface DictHit { texture: boolean; status?: string; label: string }

/** Находит позиции разбивок, упомянутые в тексте значения поля (по имени/коду). */
function findDictMentions(value: string, dicts: FactoryDicts): DictHit[] {
  const text = ` ${normText(value)} `;
  if (!text.trim()) return [];
  const hits: DictHit[] = [];
  const consider = (needleRaw: string | null, hit: Omit<DictHit, 'label'>, label: string) => {
    if (!needleRaw) return;
    const needle = ` ${normText(needleRaw)} `;
    if (needle.trim().length >= 3 && text.includes(needle)) hits.push({ ...hit, label });
  };
  for (const item of dicts.groups.ldspColors.items) {
    consider(item.name, { texture: item.texture }, `ЛДСП «${item.name}»`);
    consider(item.edgingArticle, { texture: false }, `кромка GP «${item.edgingArticle}»`);
  }
  for (const item of dicts.groups.films.items) {
    consider(item.code, { texture: item.texture, status: item.status }, `плёнка ${item.code}`);
    consider(item.name, { texture: item.texture, status: item.status }, `плёнка «${item.name}»`);
  }
  for (const item of dicts.groups.plastics.items) {
    consider(item.article, { texture: false, status: item.status }, `пластик ${item.article}`);
    consider(item.name, { texture: false, status: item.status }, item.name.slice(0, 40));
  }
  return hits;
}

/**
 * Дополнительные проверки бланка по правилам самих разбивок (не придумываем):
 *  — «!» текстуры обязательны по инструкции (иначе претензии не принимаются) → 🔴;
 *  — «выведена»/«снята» позиции в работу не берутся → 🔴 при использовании.
 */
export function checkDictRules(fields: { field: FactoryBlankField; value: string }[], dicts: FactoryDicts): BlankIssue[] {
  const issues: BlankIssue[] = [];
  const seen = new Set<string>();
  for (const { field, value } of fields) {
    if (!value.trim()) continue;
    const hits = findDictMentions(value, dicts);
    const textureHits = hits.filter((h) => h.texture);
    if (textureHits.length > 0 && !value.includes('!')) {
      const key = `${field.key}:tex`;
      if (!seen.has(key)) {
        seen.add(key);
        issues.push({
          fieldKey: field.key, label: field.label, level: 'error',
          text: `Похоже на текстурную позицию (${textureHits[0].label}) — по разбивке фабрики перед цветом обязателен знак «!», иначе претензии по направлению текстуры не принимаются`,
        });
      }
    }
    const retired = hits.find((h) => h.status === 'выведена');
    if (retired) {
      const key = `${field.key}:ret`;
      if (!seen.has(key)) {
        seen.add(key);
        issues.push({ fieldKey: field.key, label: field.label, level: 'error', text: `${retired.label} выведена фабрикой — в работу не берётся, замените` });
      }
    }
    const discontinued = hits.find((h) => h.status === 'снята');
    if (discontinued) {
      const key = `${field.key}:disc`;
      if (!seen.has(key)) {
        seen.add(key);
        issues.push({ fieldKey: field.key, label: field.label, level: 'error', text: `${discontinued.label} снята с производства поставщиком — в работу не берётся, замените` });
      }
    }
  }
  return issues;
}
