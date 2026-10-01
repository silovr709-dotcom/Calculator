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

export interface FactoryDictSuggestion {
  id: string;
  value: string;
  title: string;
  subtitle: string;
  badges: string[];
  status?: 'ok' | 'warn' | 'bad';
  search: string;
}

export interface FactoryDictSuggestionGroup {
  id: string;
  title: string;
  subtitle?: string;
  total: number;
  items: FactoryDictSuggestion[];
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

const normText = (value: string) => value.toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/[\s_*]+/g, ' ').trim();

const compact = (value: string | null | undefined) => value?.replace(/\s+/g, ' ').trim() || '';

function groupSuggestions(items: FactoryDictSuggestion[], perGroup: number, groupLimit: number): FactoryDictSuggestionGroup[] {
  const byGroup = new Map<string, FactoryDictSuggestionGroup>();
  for (const item of items) {
    const [id, title, subtitle] = item.id.split('|');
    const key = `${id}|${title}|${subtitle ?? ''}`;
    const group = byGroup.get(key) ?? { id, title, subtitle, total: 0, items: [] };
    group.total += 1;
    if (group.items.length < perGroup) group.items.push(item);
    byGroup.set(key, group);
  }
  return [...byGroup.values()].filter((group) => group.items.length > 0).slice(0, groupLimit);
}

function searchMatches(item: FactoryDictSuggestion, query: string) {
  const normalized = normText(query);
  if (!normalized) return true;
  return normalized.split(' ').every((part) => item.search.includes(part));
}

function ldspSuggestion(item: LdspColor): FactoryDictSuggestion {
  const category = compact(item.category) || compact(item.format);
  const value = `${item.texture ? '! ' : ''}${item.name}${item.article ? ` ${item.article}` : ''} (${item.brand}${category ? `, ${category}` : ''})`;
  return {
    id: `ldsp-${item.brand}-${category}|${item.brand}${category ? ` · ${category}` : ''}|ЛДСП: цвета, кромки, формат ${item.format}`,
    value,
    title: `${item.texture ? '! ' : ''}${item.name}`,
    subtitle: [item.article, item.format, item.edgingArticle ? `кромка: ${item.edgingArticle}` : ''].filter(Boolean).join(' · '),
    badges: [item.brand, category, item.texture ? 'текстура !' : '', item.sheetSurcharge ? `доплата ${item.sheetSurcharge}` : ''].filter(Boolean),
    search: normText([item.name, item.article, item.brand, item.category, item.format, item.edgingArticle].filter(Boolean).join(' ')),
  };
}

function filmSuggestion(item: FilmColor): FactoryDictSuggestion {
  return {
    id: `film-${item.brand}-${item.category}|ПВХ плёнки · ${item.brand} · ${item.category}|${item.status === 'в работе' ? 'В работе' : item.status}`,
    value: `${item.texture ? '! ' : ''}${item.code} — ${item.name} (${item.brand}, ${item.category})`,
    title: `${item.code} — ${item.name}`,
    subtitle: `${item.brand} · ${item.category}${item.onlyMillingMilo ? ' · только фрезеровка Мыло' : ''}${item.onlyMdf16 ? ' · только МДФ 16' : ''}`,
    badges: [item.status, item.texture ? 'текстура !' : '', item.onlyMillingMilo ? 'только Мыло' : ''].filter(Boolean),
    status: item.status === 'в работе' ? 'ok' : item.status === 'выведена' || item.status === 'снята' ? 'bad' : 'warn',
    search: normText([item.code, item.name, item.brand, item.category, item.status].join(' ')),
  };
}

function plasticSuggestion(item: PlasticItem): FactoryDictSuggestion {
  const collection = compact(item.collection);
  const category = compact(item.category);
  const title = `${item.article} — ${item.name}`;
  return {
    id: `plastic-${item.brand}-${collection || category}|Пластики / HPL · ${item.brand}${collection ? ` · ${collection}` : category ? ` · ${category}` : ''}|ARPA, FENIX, AGT, Rexay, ABET и другие разбивки`,
    value: `${item.texture ? '! ' : ''}Пластик ${item.brand} ${item.article} — ${item.name}${category ? ` (${category})` : ''}`,
    title,
    subtitle: [item.format, category, collection, item.edge ? `кромка: ${item.edge}` : '', item.details].filter(Boolean).join(' · '),
    badges: [item.brand, category, item.status, item.texture ? 'текстура !' : ''].filter(Boolean),
    status: item.status === 'в работе' ? 'ok' : item.status === 'выведена' || item.status === 'снята' ? 'bad' : 'warn',
    search: normText([item.article, item.name, item.brand, item.category, item.collection, item.format, item.edge, item.status].filter(Boolean).join(' ')),
  };
}

function compactSuggestion(item: CompactHplItem): FactoryDictSuggestion {
  return {
    id: `compact-${item.collection ?? 'slotex'}|Компакт Slotex · ${item.collection ?? 'без коллекции'}|HPL Compact / SolidTop`,
    value: `${item.textureCode ? '! ' : ''}Компакт Slotex ${item.code} — ${item.name}${item.textureCode ? `, текстура ${item.textureCode}` : ''}`,
    title: `${item.code} — ${item.name}`,
    subtitle: [item.collection, item.series, item.surfaceType, item.textureCode ? `текстура ${item.textureCode}` : ''].filter(Boolean).join(' · '),
    badges: ['Slotex', item.collection ?? '', item.textureCode ? 'текстура !' : ''].filter(Boolean),
    search: normText([item.code, item.name, item.collection, item.series, item.surfaceType, item.textureCode].filter(Boolean).join(' ')),
  };
}

function edgeMaker(value: string, title: string, subtitle: string, source: string, badges: string[]): FactoryDictSuggestion {
  const maker = /рехау|rehau/i.test(value) ? 'Rehau' : /gp/i.test(value) ? 'GP Plast' : source;
  return {
    id: `edge-${maker}|Кромки · ${maker}|подбор кромок из разбивок ЛДСП/пластиков`,
    value,
    title,
    subtitle,
    badges: [maker, ...badges].filter(Boolean),
    search: normText([value, title, subtitle, source, maker, ...badges].join(' ')),
  };
}

export function factoryDictSuggestionGroups(fieldKey: string, dicts: FactoryDicts, query = '', perGroup = 7, groupLimit = 12): FactoryDictSuggestionGroup[] {
  const { ldspColors, films, plastics } = dicts.groups;
  let suggestions: FactoryDictSuggestion[] = [];
  switch (fieldKey) {
    case 'ldspColor':
    case 'corpusColor':
      suggestions = ldspColors.items.map(ldspSuggestion);
      break;
    case 'bodyEdging':
    case 'corpusEdging':
      suggestions = [
        ...ldspColors.items.filter((i) => Boolean(i.edgingArticle)).map((i) => edgeMaker(`0,4мм ${i.edgingArticle}${/gp/i.test(i.edgingArticle ?? '') ? '' : ' GP'}`, i.edgingArticle!, `${i.name} · ${i.brand} · ${i.category || i.format}`, i.brand, [i.category])),
        ...(dicts.groups.ldspEdges?.items ?? []).map((i) => edgeMaker(`${i.edge}${i.article ? ` (${i.article})` : ''}`, i.edge, [i.brand, i.article].filter(Boolean).join(' · '), i.brand, [i.edge])),
      ];
      break;
    case 'facadeColor':
      suggestions = [
        ...films.items.filter((i) => i.status === 'в работе' || query.trim()).map(filmSuggestion),
        ...plastics.items.filter((i) => i.status === 'в работе' || query.trim()).map(plasticSuggestion),
        ...(dicts.groups.compactHpl?.items ?? []).map(compactSuggestion),
      ];
      break;
    case 'facadeMilling':
      suggestions = millingsOf(dicts).map((m) => ({
        id: `milling-${m.categoryLabel}-${m.mdfThicknessMm}|Фрезеровки · ${m.categoryLabel}|МДФ ${m.mdfThicknessMm} мм · ${m.coatings.join('/')}`,
        value: `${m.name} (${m.categoryLabel}, ${m.mdfThicknessMm} мм, ${m.coatings.join('/')})`,
        title: m.name,
        subtitle: [m.categoryLabel, `${m.mdfThicknessMm} мм`, m.coatings.join('/'), m.note ?? ''].filter(Boolean).join(' · '),
        badges: [m.categoryLabel, `${m.mdfThicknessMm} мм`, ...m.coatings],
        search: normText([m.name, m.categoryLabel, m.mdfThicknessMm, ...m.coatings, m.note ?? ''].join(' ')),
      }));
      break;
    case 'facadeEdging':
      suggestions = [
        ...ldspColors.items.filter((i) => Boolean(i.edgingArticle)).map((i) => edgeMaker(`1мм ${i.edgingArticle}`, i.edgingArticle!, `${i.name} · ${i.brand} · ${i.category || i.format}`, i.brand, [i.category])),
        ...plastics.items.map((i) => edgeMaker(i.edge ? `кромка ${i.edge} (${i.brand} ${i.article})` : `кромка ${i.brand} под ${i.article}`, i.edge || `${i.brand} ${i.article}`, [i.name, i.category, i.collection].filter(Boolean).join(' · '), i.brand, [i.category ?? '', i.status])),
      ];
      break;
    default:
      return [];
  }
  return groupSuggestions(suggestions.filter((item) => searchMatches(item, query)), perGroup, groupLimit);
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
    case 'facadeColor': {
      const filmLimit = Math.max(1, Math.ceil(limit * 0.5));
      const plasticLimit = Math.max(1, Math.ceil(limit * 0.4));
      const compactLimit = Math.max(0, limit - filmLimit - plasticLimit);
      return [
        ...films.items.filter((i) => i.status === 'в работе').slice(0, filmLimit).map((i) => `${i.texture ? '! ' : ''}${i.code} — ${i.name} (${i.brand})`),
        ...plastics.items.filter((i) => i.status === 'в работе').slice(0, plasticLimit).map((i) => `${i.texture ? '! ' : ''}Пластик ${i.brand} ${i.article} — ${i.name}${i.category ? ` (${i.category})` : ''}`),
        ...(dicts.groups.compactHpl?.items ?? []).slice(0, compactLimit).map((i) => `${i.textureCode ? '! ' : ''}Компакт Slotex ${i.code} — ${i.name}${i.textureCode ? `, текстура ${i.textureCode}` : ''}`),
      ].slice(0, limit);
    }
    case 'facadeMilling':
      return millingsOf(dicts).map((m) => `${m.name} (${m.categoryLabel}, ${m.mdfThicknessMm} мм, ${m.coatings.join('/')})`);
    case 'facadeEdging':
      return [
        ...uniq(ldspColors.items.map((i) => i.edgingArticle ? `1мм ${i.edgingArticle}` : null)),
        ...uniq(plastics.items.map((i) => i.edge ? `кромка ${i.edge} (${i.brand} ${i.article})` : `кромка ${i.brand} под ${i.article}`)),
      ].slice(0, limit);
    default:
      return [];
  }
}


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
