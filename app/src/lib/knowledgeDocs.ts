// Полные тексты документов фабрики (инструкции по бланкам, технички) и поиск по ним.
//
// Тексты готовит tools/extract_knowledge_docs.py из PDF в корне репозитория,
// результат лежит в public/data/knowledge-docs.json. Документ разбит на секции
// с заголовком и номером страницы — так в выдаче видно, откуда взят ответ.

export interface KbDocSection {
  id: string;
  heading: string;
  page: number;
  text: string;
}

export interface KbDoc {
  id: string;
  title: string;
  category: string;
  file: string;
  pages: number;
  sections: KbDocSection[];
}

export interface KnowledgeDocs {
  id: string;
  name: string;
  docs: KbDoc[];
}

let cache: KnowledgeDocs | null = null;

/** Загружает тексты документов (один раз за сессию). */
export async function loadKnowledgeDocs(baseUrl: string): Promise<KnowledgeDocs | null> {
  if (cache) return cache;
  try {
    const res = await fetch(`${baseUrl}data/knowledge-docs.json`);
    if (!res.ok) return null;
    cache = (await res.json()) as KnowledgeDocs;
    return cache;
  } catch {
    return null;
  }
}

/** Нормализация: регистр, ё→е, только буквы и цифры. */
export const normalize = (s: string): string =>
  s.toLowerCase().replace(/ё/g, 'е').replace(/[^0-9a-zа-я]+/g, ' ').trim();

export const tokenize = (s: string): string[] => normalize(s).split(' ').filter((t) => t.length > 1);

/**
 * Расстояние Дамерау — Левенштейна с ранним выходом.
 * Нужно, чтобы поиск прощал опечатки: «сталешница» находит «столешница».
 */
export function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Сколько опечаток прощаем слову такой длины. */
export const allowedTypos = (len: number): number => (len >= 8 ? 2 : len >= 5 ? 1 : 0);

/** Совпадает ли токен запроса с токеном текста (точно, по префиксу или с опечаткой). */
export function tokenMatches(queryToken: string, textToken: string): boolean {
  if (textToken.startsWith(queryToken)) return true;
  const max = allowedTypos(queryToken.length);
  if (max === 0) return false;
  return editDistance(queryToken, textToken, max) <= max;
}

export interface DocHit {
  doc: KbDoc;
  section: KbDocSection;
  score: number;
  /** Кусок текста вокруг первого совпадения — для показа в выдаче. */
  snippet: string;
}

const SNIPPET_RADIUS = 130;

function makeSnippet(text: string, queryTokens: string[]): string {
  const norm = normalize(text);
  let at = -1;
  for (const t of queryTokens) {
    const i = norm.indexOf(t);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0 || text.length <= SNIPPET_RADIUS * 2) return text.slice(0, SNIPPET_RADIUS * 2);
  const from = Math.max(0, at - SNIPPET_RADIUS);
  const to = Math.min(text.length, at + SNIPPET_RADIUS);
  return `${from > 0 ? '…' : ''}${text.slice(from, to).trim()}${to < text.length ? '…' : ''}`;
}

/**
 * Поиск по секциям документов. Возвращает отсортированный список совпадений.
 * Секция получает очки за каждый найденный токен запроса; заголовок весит больше текста.
 */
export function searchDocs(docs: KbDoc[], query: string, limit = 40): DocHit[] {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return [];
  const phrase = normalize(query);
  const hits: DocHit[] = [];

  for (const doc of docs) {
    for (const section of doc.sections) {
      const headNorm = normalize(section.heading);
      const bodyNorm = normalize(section.text);
      const headTokens = headNorm.split(' ').filter(Boolean);
      const bodyTokens = bodyNorm.split(' ').filter(Boolean);
      let score = 0;
      let matched = 0;

      for (const q of qTokens) {
        let best = 0;
        if (headNorm.includes(q)) best = 8;
        else if (headTokens.some((t) => tokenMatches(q, t))) best = 5;
        if (bodyNorm.includes(q)) best = Math.max(best, 4);
        else if (bodyTokens.some((t) => tokenMatches(q, t))) best = Math.max(best, 2);
        if (best > 0) matched += 1;
        score += best;
      }
      // нашлись не все слова запроса — сильно снижаем вес
      if (matched === 0) continue;
      if (matched < qTokens.length) score = score * (matched / qTokens.length) * 0.6;
      // точное вхождение всей фразы — заметный бонус
      if (phrase.length > 3 && bodyNorm.includes(phrase)) score += 6;

      hits.push({ doc, section, score, snippet: makeSnippet(section.text, qTokens) });
    }
  }

  return hits.sort((a, b) => b.score - a.score || a.section.id.localeCompare(b.section.id)).slice(0, limit);
}
