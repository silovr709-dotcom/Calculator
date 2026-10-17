// Клиент серверной части калькулятора (PHP-API на хостинге).
// Если сервера нет (например, открыли сборку на GitHub Pages или локально),
// все функции сообщают об этом, и приложение продолжает работать только в браузере.

import { prettyUrl } from './prettyUrl';

export type ServerRole = 'admin' | 'manager' | 'measurer' | 'installer' | 'user';

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
/** Корень приложения: от него считаются все адреса, даже когда открыта страница /kp/… */
export function appRootUrl(): URL {
  return new URL(import.meta.env.BASE_URL || '/', window.location.origin);
}

export function apiUrl(route: string, params: Record<string, string> = {}): string {
  const base = new URL('api/index.php', appRootUrl());
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
  const url = appRootUrl();
  url.hash = `#share=${json.id}`;
  return { id: json.id, url: prettyUrl(url) };
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
  return { id: json.id, url: clientOfferUrl(json.id), offer: json.offer };
}

/**
 * Ссылка для клиента. На своём домене получается короткий человеческий адрес
 * вида https://рецепт-про.рф/kp/7b4111e41d60a92b, в остальных случаях — через #offer=.
 */
export function clientOfferUrl(id: string): string {
  const root = appRootUrl();
  if (root.pathname === '/') {
    return prettyUrl(new URL(`kp/${id}`, root));
  }
  const url = new URL(root);
  url.hash = `#offer=${id}`;
  return prettyUrl(url);
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

/* ----------------------- документы проекта на хостинге ----------------------- */

export type ProjectDocumentKind = 'offer' | 'specification' | 'contract' | 'receipt' | 'sketch' | 'package' | 'blank' | 'other';
export type ProjectDocumentStatus = 'created' | 'sent' | 'signed' | 'paid';

export interface ProjectDocument {
  id: string;
  fileId: string;
  kind: ProjectDocumentKind;
  name: string;
  size: number;
  status: ProjectDocumentStatus;
  statusAt: string;
  createdAt: string;
  createdBy: string;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.readAsDataURL(blob);
  });
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}

/** Кладём выгруженный документ рядом с проектом на хостинге. */
export async function saveProjectDocument(input: {
  projectId: string;
  kind: ProjectDocumentKind;
  name: string;
  blob: Blob;
}): Promise<ProjectDocument> {
  const json = await request<{ document: ProjectDocument }>('docs', {
    method: 'POST',
    body: JSON.stringify({
      projectId: input.projectId,
      kind: input.kind,
      name: input.name,
      mime: input.blob.type || 'application/octet-stream',
      data: await blobToBase64(input.blob),
    }),
  });
  return json.document;
}

export async function listProjectDocuments(projectId: string): Promise<ProjectDocument[]> {
  const json = await request<{ documents: ProjectDocument[] }>('docs', {}, { projectId });
  return json.documents ?? [];
}

export async function setProjectDocumentStatus(projectId: string, id: string, status: ProjectDocumentStatus): Promise<ProjectDocument> {
  const json = await request<{ document: ProjectDocument }>('docs/status', { method: 'POST', body: JSON.stringify({ projectId, id, status }) });
  return json.document;
}

export async function deleteProjectDocument(projectId: string, id: string): Promise<void> {
  await request('docs', { method: 'DELETE' }, { projectId, id });
}

/* ----------------------- история версий проекта ----------------------- */

export interface ProjectVersion {
  file: string;
  rev: number;
  at: string;
  by: string;
  name: string;
  size: number;
}

export async function listProjectVersions(projectId: string): Promise<ProjectVersion[]> {
  const json = await request<{ versions: ProjectVersion[] }>('history', {}, { projectId });
  return json.versions ?? [];
}

export async function readProjectVersion<T>(projectId: string, file: string): Promise<T> {
  const json = await request<{ project: T }>('history/item', {}, { projectId, file });
  return json.project;
}

/* ----------------------- наряд на монтаж для мастера ----------------------- */

export type WorkOrderStatus = 'sent' | 'onway' | 'started' | 'done' | 'problem';

export interface WorkOrderLogEntry {
  at: string;
  status: WorkOrderStatus;
  comment: string;
  by: string;
}

export interface WorkOrderSummary {
  id: string;
  projectId: string;
  eventId: string;
  status: WorkOrderStatus;
  updatedAt: string;
  views: number;
  lastComment: string;
  lastBy: string;
  log: WorkOrderLogEntry[];
}

export interface WorkOrderPhoto {
  fileId: string;
  at: string;
  by: string;
  comment: string;
}

export interface WorkOrderPayload {
  title: string;
  client: string;
  phone?: string;
  address?: string;
  date: string;
  time?: string;
  team?: string;
  note?: string;
  manager?: string;
  managerPhone?: string;
  items: string[];
  /** Эскиз и другие картинки, которые видит мастер: ссылки на файлы сервера. */
  images?: string[];
}

export async function publishWorkOrder(input: { id?: string; projectId?: string; eventId?: string; payload: WorkOrderPayload }):
Promise<{ id: string; url: string; order: WorkOrderSummary }> {
  const json = await request<{ id: string; order: WorkOrderSummary }>('workorder', { method: 'POST', body: JSON.stringify(input) });
  return { id: json.id, url: workOrderUrl(json.id), order: json.order };
}

/** Короткая ссылка мастеру: открывается на телефоне без пароля. */
export function workOrderUrl(id: string): string {
  const root = appRootUrl();
  if (root.pathname === '/') return prettyUrl(new URL(`mo/${id}`, root));
  const url = new URL(root);
  url.hash = `#order=${id}`;
  return prettyUrl(url);
}

export async function fetchWorkOrder(id: string): Promise<{ payload: WorkOrderPayload; status: WorkOrderStatus; log: WorkOrderLogEntry[]; photos: WorkOrderPhoto[]; createdAt: string }> {
  return request('workorder', {}, { id });
}

/** Фото с объекта от мастера — без входа, по ссылке наряда. */
export async function addWorkOrderPhoto(id: string, input: { blob: Blob; who?: string; comment?: string }): Promise<WorkOrderPhoto[]> {
  const json = await request<{ photos: WorkOrderPhoto[] }>('workorder/photo', {
    method: 'POST',
    body: JSON.stringify({
      mime: input.blob.type || 'image/jpeg',
      data: await blobToBase64(input.blob),
      who: input.who ?? '',
      comment: input.comment ?? '',
    }),
  }, { id });
  return json.photos ?? [];
}

export async function markWorkOrder(id: string, input: { status: WorkOrderStatus; comment?: string; who?: string }):
Promise<{ status: WorkOrderStatus; log: WorkOrderLogEntry[] }> {
  return request('workorder/mark', { method: 'POST', body: JSON.stringify(input) }, { id });
}

export async function listWorkOrders(): Promise<WorkOrderSummary[]> {
  const json = await request<{ orders: WorkOrderSummary[] }>('workorder/list');
  return json.orders ?? [];
}

export async function revokeWorkOrder(id: string): Promise<void> {
  await request('workorder', { method: 'DELETE' }, { id });
}

/* ----------------------- уведомления в Telegram ----------------------- */

export interface TelegramChat { name: string; chatId: string }

export interface NotifyServerSettings {
  enabled: boolean;
  tokenSet: boolean;
  tokenHint: string;
  chats: TelegramChat[];
  cronKey: string;
  leadMinutes: number;
  dailyHour: number;
  /** Час вечерней сводки «что завтра». */
  eveningHour: number;
  /** Сообщать сразу, когда дело появилось в графике. */
  notifyNew: boolean;
  /** Утренняя сводка «что сегодня». */
  morningDigest: boolean;
  /** Вечерняя сводка «что завтра». */
  eveningDigest: boolean;
  /** За сколько минут будильники внутри подписного календаря телефона. */
  icsAlarms: number[];
  timezoneOffset: number;
}

export async function fetchNotifyServerSettings(): Promise<NotifyServerSettings> {
  const json = await request<{ settings: NotifyServerSettings }>('notify/settings');
  return json.settings;
}

export async function saveNotifyServerSettings(input: {
  enabled: boolean;
  token?: string;
  chats: TelegramChat[];
  leadMinutes: number;
  timezoneOffset: number;
  eveningHour?: number;
  dailyHour?: number;
  notifyNew?: boolean;
  morningDigest?: boolean;
  eveningDigest?: boolean;
  icsAlarms?: number[];
}): Promise<{ cronKey: string; tokenSet: boolean }> {
  return request('notify/settings', { method: 'POST', body: JSON.stringify(input) });
}

export interface TelegramContact { chatId: string; name: string; text: string; at: string }

/** Кто недавно писал боту — из этого списка добавляем получателей. */
export async function fetchTelegramContacts(): Promise<{ bot: string; contacts: TelegramContact[] }> {
  return request('notify/contacts');
}

export async function sendNotifyTest(chatId: string): Promise<{ ok: boolean; error?: string | null }> {
  return request('notify/test', { method: 'POST', body: JSON.stringify({ chatId }) });
}

/** Ссылка подписки календаря: добавляется в телефон сотрудника. */
export function calendarSubscriptionUrl(key: string, who?: string): string {
  return apiUrl('ics', who ? { key, who } : { key });
}

/** Ссылка для планировщика хостинга. */
export function cronNotifyUrl(key: string): string {
  return apiUrl('cron/notify', { key });
}
