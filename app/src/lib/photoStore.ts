// Хранение фотографий и подложек эскизов отдельными файлами на хостинге.
//
// Зачем: раньше каждое фото лежало внутри проекта строкой base64. База разрасталась
// на мегабайты, каждое сохранение гоняло их целиком, а в браузере переполнялось хранилище.
//
// Как устроено: перед отправкой на сервер каждая картинка заменяется короткой ссылкой
// «recept-file:<sha256>», а сами байты уходят один раз в отдельный файл. При загрузке
// ссылки разворачиваются обратно, поэтому весь остальной код (эскизы, PDF, Excel, ZIP)
// продолжает работать с привычными data:URL.

import { serverFileUrl, serverFilesMissing, uploadServerFile } from './serverApi';

export const FILE_REF_PREFIX = 'recept-file:';

const DATA_URL_RE = /^data:([a-z0-9.+/-]+);base64,/i;
const REF_RE = /^recept-file:([a-f0-9]{64})$/;

/** Соответствие «картинка ↔ ссылка», чтобы не считать хэш и не грузить одно и то же дважды. */
const refByDataUrl = new Map<string, string>();
const dataUrlByRef = new Map<string, string>();
const uploaded = new Set<string>();

export function isFileRef(value: unknown): value is string {
  return typeof value === 'string' && REF_RE.test(value);
}

export function fileRefId(value: string): string {
  const match = REF_RE.exec(value);
  return match ? match[1] : '';
}

export function isStorableDataUrl(value: unknown): value is string {
  return typeof value === 'string' && value.length > 4096 && DATA_URL_RE.test(value);
}

function base64FromDataUrl(dataUrl: string): { mime: string; base64: string } | null {
  const match = DATA_URL_RE.exec(dataUrl);
  if (!match) return null;
  return { mime: match[1].toLowerCase(), base64: dataUrl.slice(match[0].length) };
}

function bytesFromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const view = new Uint8Array(bytes);           // копия с обычным ArrayBuffer
  const digest = await crypto.subtle.digest('SHA-256', view.buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ------------------------------- обход структуры ------------------------------- */

type Mapper = (value: string) => string | undefined;

/** Глубокая копия с заменой строк: структура данных остаётся прежней. */
function mapDeep<T>(value: T, map: Mapper): T {
  if (typeof value === 'string') {
    const replaced = map(value);
    return (replaced === undefined ? value : replaced) as unknown as T;
  }
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const mapped = mapDeep(item, map);
      if (mapped !== item) changed = true;
      return mapped;
    });
    return (changed ? next : value) as unknown as T;
  }
  if (value && typeof value === 'object') {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const mapped = mapDeep(item, map);
      if (mapped !== item) changed = true;
      next[key] = mapped;
    }
    return (changed ? next : value) as unknown as T;
  }
  return value;
}

function collectStrings<T>(value: T, test: (s: string) => boolean, out: Set<string>): void {
  if (typeof value === 'string') {
    if (test(value)) out.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, test, out);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) collectStrings(item, test, out);
  }
}

/* --------------------------------- выгрузка --------------------------------- */

/**
 * Заменяет картинки ссылками и догружает на сервер те, которых там ещё нет.
 * Возвращает структуру того же вида — её и отправляем на сервер.
 */
export async function dehydrate<T>(value: T): Promise<T> {
  const found = new Set<string>();
  collectStrings(value, isStorableDataUrl, found);
  if (found.size === 0) return value;

  const fresh = Array.from(found).filter((dataUrl) => !refByDataUrl.has(dataUrl));
  const parsed = new Map<string, { mime: string; base64: string; hash: string }>();

  for (const dataUrl of fresh) {
    const parts = base64FromDataUrl(dataUrl);
    if (!parts) continue;
    try {
      const hash = await sha256Hex(bytesFromBase64(parts.base64));
      parsed.set(dataUrl, { ...parts, hash });
      dataUrlByRef.set(FILE_REF_PREFIX + hash, dataUrl);
    } catch {
      /* битая картинка — оставим как есть */
    }
  }

  const hashes = Array.from(new Set(Array.from(parsed.values()).map((item) => item.hash))).filter((hash) => !uploaded.has(hash));
  const missing = new Set(hashes.length > 0 ? await serverFilesMissing(hashes) : []);
  for (const hash of hashes) if (!missing.has(hash)) uploaded.add(hash);

  for (const [dataUrl, item] of parsed) {
    if (missing.has(item.hash)) {
      await uploadServerFile(item.base64, item.mime);
      uploaded.add(item.hash);
      missing.delete(item.hash);
    }
    refByDataUrl.set(dataUrl, FILE_REF_PREFIX + item.hash);
  }

  return mapDeep(value, (text) => refByDataUrl.get(text));
}

/**
 * То же самое, но без обращений к сети: заменяются только те картинки,
 * которые уже выгружены. Используется для лёгкой копии в браузере.
 */
export function dehydrateKnown<T>(value: T): T {
  if (refByDataUrl.size === 0) return value;
  return mapDeep(value, (text) => refByDataUrl.get(text));
}

/* --------------------------------- загрузка --------------------------------- */

async function fetchRef(ref: string): Promise<string> {
  const cached = dataUrlByRef.get(ref);
  if (cached) return cached;
  const id = fileRefId(ref);
  if (!id) return ref;
  const res = await fetch(serverFileUrl(id), { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Файл ${id} недоступен`);
  const blob = await res.blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.readAsDataURL(blob);
  });
  dataUrlByRef.set(ref, dataUrl);
  refByDataUrl.set(dataUrl, ref);
  uploaded.add(id);
  return dataUrl;
}

/**
 * Разворачивает ссылки обратно в картинки. Если файл сейчас недоступен (нет связи),
 * подставляем прямой адрес — изображение всё равно покажется, когда связь появится.
 */
export async function hydrate<T>(value: T): Promise<T> {
  const refs = new Set<string>();
  collectStrings(value, isFileRef, refs);
  if (refs.size === 0) return value;

  const resolved = new Map<string, string>();
  await Promise.all(Array.from(refs).map(async (ref) => {
    try {
      resolved.set(ref, await fetchRef(ref));
    } catch {
      resolved.set(ref, serverFileUrl(fileRefId(ref)));
    }
  }));

  return mapDeep(value, (text) => resolved.get(text));
}

/** Есть ли внутри структуры картинки, которые ещё не вынесены в файлы. */
export function hasInlineImages(value: unknown): boolean {
  const found = new Set<string>();
  collectStrings(value, isStorableDataUrl, found);
  return found.size > 0;
}

/** Для тестов: очистить запомненные соответствия. */
export function resetPhotoStoreCache(): void {
  refByDataUrl.clear();
  dataUrlByRef.clear();
  uploaded.clear();
}
