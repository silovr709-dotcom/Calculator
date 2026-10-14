// Клиент серверной части калькулятора (PHP-API на хостинге).
// Если сервера нет (например, открыли сборку на GitHub Pages или локально),
// все функции сообщают об этом, и приложение продолжает работать только в браузере.

export type ServerRole = 'admin' | 'user';

export interface ServerUser {
  login: string;
  name: string;
  role: ServerRole;
  createdAt?: string;
}

export interface ServerStateMeta {
  rev: number;
  updatedAt: string;
  updatedBy: string;
  size: number;
}

export interface ServerSession {
  needsSetup: boolean;
  user: ServerUser | null;
  state: ServerStateMeta;
  version: string;
}

export interface ServerBackup {
  file: string;
  size: number;
  createdAt: string;
}

/** Сервер не отвечает или на этом адресе его нет вовсе. */
export class ServerUnavailableError extends Error {
  constructor(message = 'Сервер недоступен') {
    super(message);
    this.name = 'ServerUnavailableError';
  }
}

/** Сервер ответил ошибкой: неверный пароль, нет прав, конфликт версий и т. п. */
export class ServerRequestError extends Error {
  status: number;
  payload: Record<string, unknown>;
  constructor(status: number, message: string, payload: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ServerRequestError';
    this.status = status;
    this.payload = payload;
  }
}

/** Адрес API считается от адреса самой страницы — работает и в подпапке сайта. */
export function apiUrl(route: string, params: Record<string, string> = {}): string {
  const base = new URL('api/index.php', document.baseURI);
  base.searchParams.set('r', route);
  for (const [key, value] of Object.entries(params)) base.searchParams.set(key, value);
  return base.toString();
}

/**
 * Большую базу отправляем сжатой: на хостингах с Apache + FastCGI есть предел размера
 * запроса, а проект с фотографиями весит мегабайты. Сервер распаковывает сам.
 * Если браузер не умеет сжимать на лету — отправляем как есть.
 */
async function packBody(body: string): Promise<{ body: BodyInit; headers: Record<string, string> }> {
  if (body.length < 64 * 1024 || typeof CompressionStream === 'undefined') {
    return { body, headers: {} };
  }
  try {
    const stream = new Blob([body]).stream().pipeThrough(new CompressionStream('gzip'));
    const packed = await new Response(stream).blob();
    return { body: packed, headers: { 'X-Recept-Encoding': 'gzip' } };
  } catch {
    return { body, headers: {} };
  }
}

async function request<T>(route: string, init: RequestInit = {}, params: Record<string, string> = {}): Promise<T> {
  let res: Response;
  const packed = typeof init.body === 'string' ? await packBody(init.body) : null;
  try {
    res = await fetch(apiUrl(route, params), {
      credentials: 'same-origin',
      cache: 'no-store',
      ...init,
      body: packed ? packed.body : init.body,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(packed ? packed.headers : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new ServerUnavailableError('Нет связи с сервером');
  }

  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    if (res.status === 413 || res.status === 500) {
      throw new ServerRequestError(res.status, 'Хостинг не принял данные такого размера. Поднимите post_max_size и upload_max_filesize в настройках PHP (файл .user.ini) или уменьшите количество фотографий в проектах.');
    }
    // Не JSON — значит по этому адресу нет нашего API (статичный хостинг, страница 404 и т. п.).
    throw new ServerUnavailableError('На этом адресе нет серверной части');
  }

  if (!res.ok) {
    throw new ServerRequestError(res.status, String(json.error ?? `Ошибка сервера (HTTP ${res.status})`), json);
  }
  return json as T;
}

export async function fetchSession(): Promise<ServerSession> {
  const json = await request<{ needsSetup: boolean; user: ServerUser | null; state: ServerStateMeta; version: string }>('session');
  return { needsSetup: json.needsSetup, user: json.user, state: json.state, version: json.version };
}

export async function serverHealth(): Promise<{ version: string; php: string; needsSetup: boolean; maxUploadMb: number }> {
  return request('health');
}

export async function serverSetup(login: string, password: string, name: string): Promise<ServerUser> {
  const json = await request<{ user: ServerUser }>('setup', { method: 'POST', body: JSON.stringify({ login, password, name }) });
  return json.user;
}

export async function serverLogin(login: string, password: string): Promise<ServerUser> {
  const json = await request<{ user: ServerUser }>('login', { method: 'POST', body: JSON.stringify({ login, password }) });
  return json.user;
}

export async function serverLogout(): Promise<void> {
  await request('logout', { method: 'POST' });
}

export async function changeOwnPassword(oldPassword: string, newPassword: string): Promise<void> {
  await request('password', { method: 'POST', body: JSON.stringify({ oldPassword, newPassword }) });
}

export async function fetchServerState<T>(): Promise<{ rev: number; updatedAt: string; updatedBy: string; data: T }> {
  return request('state');
}

export type SaveStateResult =
  | { ok: true; rev: number; updatedAt: string; size: number }
  | { ok: false; conflict: true; rev: number; updatedAt: string; updatedBy: string; data: unknown };

export async function saveServerState(baseRev: number, data: unknown): Promise<SaveStateResult> {
  try {
    const json = await request<{ rev: number; updatedAt: string; size: number }>('state', {
      method: 'PUT',
      body: JSON.stringify({ baseRev, data }),
    });
    return { ok: true, rev: json.rev, updatedAt: json.updatedAt, size: json.size };
  } catch (error) {
    if (error instanceof ServerRequestError && error.status === 409) {
      const payload = error.payload as { rev: number; updatedAt: string; updatedBy: string; data: unknown };
      return { ok: false, conflict: true, rev: payload.rev, updatedAt: payload.updatedAt, updatedBy: payload.updatedBy, data: payload.data };
    }
    throw error;
  }
}

export async function listServerUsers(): Promise<ServerUser[]> {
  const json = await request<{ users: ServerUser[] }>('users');
  return json.users;
}

export async function saveServerUser(user: { login: string; password: string; name: string; role: ServerRole }): Promise<ServerUser> {
  const json = await request<{ user: ServerUser }>('users', { method: 'POST', body: JSON.stringify(user) });
  return json.user;
}

export async function deleteServerUser(login: string): Promise<void> {
  await request('users', { method: 'DELETE' }, { login });
}

export async function listServerBackups(): Promise<ServerBackup[]> {
  const json = await request<{ backups: ServerBackup[] }>('backups');
  return json.backups;
}

export async function restoreServerBackup<T>(file: string): Promise<{ rev: number; data: T }> {
  return request('backups/restore', { method: 'POST', body: JSON.stringify({ file }) });
}

/** Публикация проекта для передачи на телефон по QR — на своём сервере, без внешних сервисов. */
export async function putServerShare(payload: unknown): Promise<{ id: string; url: string }> {
  const json = await request<{ id: string }>('share', { method: 'POST', body: JSON.stringify({ payload }) });
  const url = new URL(document.baseURI);
  url.hash = `#share=${json.id}`;
  return { id: json.id, url: url.toString() };
}

export async function getServerShare<T>(id: string): Promise<T> {
  const json = await request<{ payload: T }>('share', {}, { id });
  return json.payload;
}

/* ----------------------- файлы проектов (фото, подложки эскизов) ----------------------- */

/** Какие файлы (по хэшу содержимого) сервер ещё не знает. */
export async function serverFilesMissing(hashes: string[]): Promise<string[]> {
  if (hashes.length === 0) return [];
  const json = await request<{ missing: string[] }>('files/missing', { method: 'POST', body: JSON.stringify({ hashes }) });
  return json.missing ?? [];
}

/** Загрузка одного файла; имя на сервере — sha256 содержимого, повторы не дублируются. */
export async function uploadServerFile(base64: string, mime: string): Promise<{ id: string; size: number; reused: boolean }> {
  return request('files', { method: 'POST', body: JSON.stringify({ mime, data: base64 }) });
}

/** Прямой адрес файла: по нему работают <img>, документы и ссылки на телефоне. */
export function serverFileUrl(id: string): string {
  return apiUrl('files', { id });
}

/** Сколько файлов и места занято на хостинге. */
export async function serverFilesUsage(): Promise<{ files: number; bytes: number }> {
  return request('files/usage');
}

/** Уборка: удалить файлы, на которые больше нет ссылок (только для владельца). */
export async function serverFilesGc(): Promise<{ removed: number; freed: number; files: number; bytes: number }> {
  return request('files/gc', { method: 'POST' });
}

/* ----------------------- КП по ссылке для клиента ----------------------- */

export interface PublishedOffer {
  id: string;
  projectId: string;
  title: string;
  client: string;
  total: number;
  createdAt: string;
  updatedAt: string;
  views: number;
  lastViewAt: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  approveComment: string | null;
}

export interface PublicOffer<T> {
  title: string;
  client: string;
  total: number;
  payload: T;
  createdAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
  approveComment: string | null;
}

/** Публикация КП: возвращает ссылку, которую можно отправить клиенту. */
export async function publishClientOffer(input: {
  id?: string;
  projectId: string;
  title: string;
  client: string;
  total: number;
  payload: unknown;
}): Promise<{ id: string; url: string; offer: PublishedOffer }> {
  const json = await request<{ id: string; offer: PublishedOffer }>('offers', { method: 'POST', body: JSON.stringify(input) });
  const url = new URL(document.baseURI);
  url.hash = `#offer=${json.id}`;
  return { id: json.id, url: url.toString(), offer: json.offer };
}

/** Чтение КП клиентом — без входа, по длинной ссылке. */
export async function fetchPublicOffer<T>(id: string): Promise<PublicOffer<T>> {
  return request<PublicOffer<T>>('offers', {}, { id });
}

/** Клиент нажал «Согласовать». */
export async function approvePublicOffer(id: string, input: { name: string; comment?: string }): Promise<{ approvedAt: string; approvedBy: string }> {
  return request('offers/approve', { method: 'POST', body: JSON.stringify(input) }, { id });
}

export async function listPublishedOffers(): Promise<PublishedOffer[]> {
  const json = await request<{ offers: PublishedOffer[] }>('offers/list');
  return json.offers ?? [];
}

export async function revokePublishedOffer(id: string): Promise<void> {
  await request('offers', { method: 'DELETE' }, { id });
}
