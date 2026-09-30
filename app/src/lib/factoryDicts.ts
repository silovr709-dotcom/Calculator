// Справочники разбивок Висма: извлечены ETL-скриптом tools/extract_factory_dicts.py
// из реальных файлов репозитория (все разбивки ЛДСП/толщин/кромок, ПВХ, пластиков, compact Slotex).
// Ничего не придумываем: совпадение с бланком проверяем по данным самих разбивок.
import type { BlankIssue, FactoryBlankField } from './factoryBlank';
import { checkMillingValue, type Milling, type MillingsGroup } from './millings';

export interface SourceRef { file: string; sheet?: string; row?: number; pdfPage?: number; printedPage?: number }
export interface LdspColor { name: string; article?: string | null; texture: boolean; brand: string; format: string; category: string; edgingArticle: string | null; manufacturerEdge04?: string | null; manufacturerEdge1or2?: string | null; sheetSurcharge?: string | null; overuseRule?: string | null; sources?: SourceRef[] }
export interface LdspThicknessItem { brand: string; name: string; article?: string | null; category?: string; textureCode?: string | null; thicknesses: Record<string, string>; edgeAvailability?: Record<string, string>; sources?: SourceRef[] }
export interface LdspEdgeItem { brand: string; name: string; article?: string | null; edge: string; sources?: SourceRef[] }
export interface FilmColor { code: string; name: string; status: string; texture: boolean; brand: string; category: string; onlyMillingMilo?: boolean; onlyMdf16?: boolean; sources?: SourceRef[] }
export interface PlasticItem { article: string; name: string; brand: string; format: string | null; category: string | null; status: string; texture?: boolean; collection?: string | null; edge?: string | null; details?: string | null; sources?: SourceRef[] }
export interface CompactHplItem { brand: string; collection?: string | null; series?: string | null; code: string; name: string; textureCode?: string | null; surfaceType?: string | null; availability: Record<string, string>; sources?: SourceRef[] }

export interface FactoryDicts {
  id: string; name: string; sources?: string[];
  groups: {
    ldspColors: { label: string; legend?: Record<string, string>; items: LdspColor[] };
    ldspThickness?: { label: string; legend?: Record<string, string>; items: LdspThicknessItem[] };
    ldspEdges?: { label: string; legend?: Record<string, string>; items: LdspEdgeItem[] };
    films: { label: string; legend?: Record<string, string>; items: FilmColor[] };
    plastics: { label: string; legend?: Record<string, string>; items: PlasticItem[] };
    compactHpl?: { label: string; legend?: Record<string, string>; items: CompactHplItem[] };
    /** Фрезеровки фасадов из «Каталога фрезеровок ВИСМА 2026». */
    millings: MillingsGroup;
  };
}

/** Фрезеровки справочника (пустой список, если файл справочников старой версии). */
export function millingsOf(dicts: FactoryDicts | null | undefined): Milling[] {
  return dicts?.groups?.millings?.items ?? [];
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
      return uniq([
        ...ldspColors.items.map((i) => i.edgingArticle ? `0,4мм ${i.edgingArticle} GP` : null),
        ...(dicts.groups.ldspEdges?.items ?? []).map((i) => i.edge ? `${i.edge}${i.article ? ` (${i.article})` : ''}` : null),
      ]);
    case 'facadeColor':
      return films.items.filter((i) => i.status === 'в работе').map((i) => `${i.texture ? '! ' : ''}${i.code} — ${i.name} (${i.brand})`);
    case 'facadeMilling':
      return millingsOf(dicts).map((m) => `${m.name} (${m.categoryLabel}, ${m.mdfThicknessMm} мм, ${m.coatings.join('/')})`);
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
    consider(item.article ?? null, { texture: item.texture }, `ЛДСП ${item.article}`);
    consider(item.edgingArticle, { texture: false }, `кромка GP «${item.edgingArticle}»`);
  }
  for (const item of dicts.groups.ldspEdges?.items ?? []) {
    consider(item.article ?? null, { texture: false }, `подбор кромки ${item.article}`);
    consider(item.edge, { texture: false }, `кромка «${item.edge}»`);
  }
  for (const item of dicts.groups.films.items) {
    consider(item.code, { texture: item.texture, status: item.status }, `плёнка ${item.code}`);
    consider(item.name, { texture: item.texture, status: item.status }, `плёнка «${item.name}»`);
  }
  for (const item of dicts.groups.plastics.items) {
    consider(item.article, { texture: Boolean(item.texture), status: item.status }, `пластик ${item.article}`);
    consider(item.name, { texture: Boolean(item.texture), status: item.status }, item.name.slice(0, 40));
    consider(item.edge ?? null, { texture: false, status: item.status }, `кромка ${item.edge}`);
  }
  for (const item of dicts.groups.compactHpl?.items ?? []) {
    consider(item.code, { texture: Boolean(item.textureCode) }, `компакт Slotex ${item.code}`);
    consider(item.name, { texture: Boolean(item.textureCode) }, `компакт Slotex «${item.name}»`);
  }
  return hits;
}

/**
 * Дополнительные проверки бланка по правилам самих разбивок (не придумываем):
 *  — «!» текстуры обязательны по инструкции (иначе претензии не принимаются) → 🔴;
 *  — «выведена»/«снята» позиции в работу не берутся → 🔴 при использовании;
 *  — фрезеровка сверяется с каталогом 2026: покрытие (эмаль/ПВХ), плёнки «только Мыло»,
 *    примечания страницы каталога («переход рисунка не совпадает», «радиус не изготавливается»).
 */
export function checkDictRules(fields: { field: FactoryBlankField; value: string }[], dicts: FactoryDicts): BlankIssue[] {
  const issues: BlankIssue[] = [];
  const seen = new Set<string>();

  // Контекст для правил фрезеровок: покрытие фасада и плёнка «только Мыло».
  const facadeText = fields
    .filter(({ field }) => field.section.startsWith('Фасад'))
    .map(({ value }) => value)
    .join(' ');
  const facadeNorm = normText(facadeText);
  const millingContext = {
    mentionsPvh: /\bпвх\b|плен(ка|ки|ке)/.test(facadeNorm),
    mentionsEnamel: /эмал/.test(facadeNorm),
    onlyMiloFilm: dicts.groups.films.items.some(
      (f) => f.onlyMillingMilo && f.code && normText(facadeText).includes(normText(f.code)),
    ),
  };

  for (const { field, value } of fields) {
    if (!value.trim()) continue;

    if (field.key === 'facadeMilling') {
      for (const issue of checkMillingValue(value, millingsOf(dicts), millingContext)) {
        issues.push({ fieldKey: field.key, label: field.label, level: issue.level, text: issue.text });
      }
    }
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
