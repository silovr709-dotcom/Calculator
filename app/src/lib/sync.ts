import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import type { ClientProfile, Project, ProjectSettings, Template } from '../types';
import { loadClientProfiles, loadProjects, loadTemplates, loadGlobalSettings, saveClientProfiles, saveProjects, saveTemplates, saveGlobalSettings, defaultSettings } from './storage';

export const K_SYNC_CONFIG = 'recept.sync.config.v1';

export interface SyncConfig {
  enabled: boolean;
  roomCode: string;     // 4-значный короткий PIN-код (например, "7482")
  secretKey: string;    // уникальный токен комнаты для безопасного хранилища
  provider: 'cloud' | 'custom';
  customEndpoint?: string;
  customApiKey?: string;
  lastSyncedAt: string | null;
  autoSync: boolean;
}

export interface SyncPayload {
  version: 1;
  updatedAt: string;
  roomCode: string;
  projects: Project[];
  clients?: ClientProfile[];
  templates: Template[];
  settings: ProjectSettings;
}

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'error';

export const DEFAULT_CLOUD_API = 'https://kvdb.io/Ank3iN1oH5eX2sP9bKq1tW'; // старый KV-бакет для совместимости
export const JSON_STORAGE_PROJECT_SHARE_API = 'https://api.jsonstorage.net/v1/json';

export function defaultSyncConfig(): SyncConfig {
  return {
    enabled: false,
    roomCode: '',
    secretKey: '',
    provider: 'cloud',
    lastSyncedAt: null,
    autoSync: true,
  };
}

export function loadSyncConfig(): SyncConfig {
  try {
    const raw = localStorage.getItem(K_SYNC_CONFIG);
    if (!raw) return defaultSyncConfig();
    return { ...defaultSyncConfig(), ...JSON.parse(raw) };
  } catch {
    return defaultSyncConfig();
  }
}

export function saveSyncConfig(cfg: SyncConfig): void {
  try {
    localStorage.setItem(K_SYNC_CONFIG, JSON.stringify(cfg));
  } catch {
    // игнорируем ошибку записи
  }
}

/** Генерация новой случайной комнаты: 4-значный PIN + случайный суффикс ключа */
export function generateSyncRoom(): { roomCode: string; secretKey: string } {
  const roomCode = Math.floor(1000 + Math.random() * 9000).toString();
  const rand = Math.random().toString(36).slice(2, 10);
  const secretKey = `recept_${roomCode}_${rand}`;
  return { roomCode, secretKey };
}

/** Формирование URL-ссылки для QR-кода и мгновенного подключения второго устройства */
export function makeSyncShareUrl(roomCode: string, secretKey: string, baseUrl?: string): string {
  const origin = baseUrl || (typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : 'https://silovr709-dotcom.github.io/Calculator/');
  const cleanBase = origin.split('#')[0].split('?')[0];
  return `${cleanBase}#sync=${roomCode}:${secretKey}`;
}

/** Парсинг входящего хэша URL (при сканировании QR-кода на телефоне) */
export interface ProjectSharePayload { version: 1; type: 'project-share'; token: string; createdAt: string; project: Project }

export function parseIncomingHash(hash: string): { type: 'sync'; roomCode: string; secretKey: string } | { type: 'import'; project: Project } | { type: 'importz'; data: string } | { type: 'share'; token: string } | { type: 'shareurl'; url: string } | null {
  if (!hash) return null;
  const clean = hash.startsWith('#') ? hash.slice(1) : hash;
  
  if (clean.startsWith('sync=')) {
    const val = clean.slice('sync='.length);
    const parts = val.split(':');
    if (parts.length >= 2) {
      return { type: 'sync', roomCode: parts[0], secretKey: parts.slice(1).join(':') };
    }
  }

  if (clean.startsWith('share=')) {
    const token = decodeURIComponent(clean.slice('share='.length)).trim();
    if (/^prj_[a-z0-9_-]{12,}$/i.test(token)) return { type: 'share', token };
    return null;
  }

  if (clean.startsWith('shareurl=')) {
    const url = decodeURIComponent(clean.slice('shareurl='.length)).trim();
    if (isJsonStorageProjectShareUrl(url)) return { type: 'shareurl', url };
    return null;
  }

  if (clean.startsWith('importz=')) {
    const data = decodeURIComponent(clean.slice('importz='.length)).trim();
    if (/^[A-Za-z0-9+\-$]{16,}$/.test(data)) return { type: 'importz', data };
    return null;
  }

  if (clean.startsWith('import=')) {
    try {
      const raw = decodeURIComponent(clean.slice('import='.length));
      const p = JSON.parse(raw) as Project;
      if (p && p.name && Array.isArray(p.lines)) {
        return { type: 'import', project: p };
      }
    } catch {
      return null;
    }
  }

  return null;
}

function cleanAppBase(baseUrl?: string): string {
  const origin = baseUrl || (typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : 'https://silovr709-dotcom.github.io/Calculator/');
  return origin.split('#')[0].split('?')[0];
}

/** Формирование старой ссылки прямого импорта одного проекта (только для очень маленьких проектов). */
export function makeProjectShareUrl(project: Project, baseUrl?: string): string {
  const cleanBase = cleanAppBase(baseUrl);
  const clone = compactProjectForShare(project);
  const json = JSON.stringify(clone);
  return `${cleanBase}#import=${encodeURIComponent(json)}`;
}

function compressProjectJson(text: string): string {
  return compressToEncodedURIComponent(text);
}

function decompressProjectJson(data: string): string {
  const json = decompressFromEncodedURIComponent(data);
  if (!json) throw new Error('Сжатая QR-ссылка проекта повреждена или неполная');
  return json;
}

function assertProjectShape(value: unknown): Project {
  const project = value as Project;
  if (!project || typeof project.name !== 'string' || !Array.isArray(project.lines)) {
    throw new Error('QR-ссылка проекта повреждена или содержит неизвестный формат');
  }
  return project;
}

/** Сжатая self-contained ссылка проекта: не зависит от облака и обычно заметно короче старого JSON-хэша. */
export async function makeCompressedProjectShareUrl(project: Project, baseUrl?: string): Promise<{ url: string; bytes: number; compressedChars: number }> {
  const cleanBase = cleanAppBase(baseUrl);
  const json = JSON.stringify(compactProjectForShare(project));
  const packed = compressProjectJson(json);
  return { url: `${cleanBase}#importz=${packed}`, bytes: json.length, compressedChars: packed.length };
}

export async function loadCompressedProjectShare(data: string): Promise<Project> {
  const json = decompressProjectJson(data.trim());
  return assertProjectShape(JSON.parse(json));
}

const QR_SAFE_INLINE_URL_LENGTH = 2200;
const QR_MAX_INLINE_URL_LENGTH = 2950;

export type ProjectQrShareMode = 'compressed' | 'cloud' | 'legacy';

export interface ProjectQrShare {
  mode: ProjectQrShareMode;
  url: string;
  bytes: number;
  urlLength: number;
  note: string;
}

/**
 * Готовит рабочую ссылку для QR-передачи проекта.
 * Сначала пробуем полностью автономный сжатый QR. Если проект слишком большой,
 * используем короткую облачную ссылку; при недоступном облаке оставляем плотный
 * сжатый QR, если он ещё помещается в лимит QR-кода.
 */
export async function makeProjectQrShare(project: Project, baseUrl?: string): Promise<ProjectQrShare> {
  const compressed = await makeCompressedProjectShareUrl(project, baseUrl);
  if (compressed.url.length <= QR_SAFE_INLINE_URL_LENGTH) {
    return {
      mode: 'compressed',
      url: compressed.url,
      bytes: compressed.bytes,
      urlLength: compressed.url.length,
      note: `QR содержит сам проект в сжатом виде: ${compressed.url.length} символов. Облако не требуется.`,
    };
  }

  try {
    const cloud = await publishProjectShare(project, baseUrl);
    return {
      mode: 'cloud',
      url: cloud.url,
      bytes: cloud.bytes,
      urlLength: cloud.url.length,
      note: `QR содержит короткую облачную ссылку: ${cloud.url.length} символов, проект ${Math.round(cloud.bytes / 1024)} КБ.`,
    };
  } catch (cloudError) {
    if (compressed.url.length <= QR_MAX_INLINE_URL_LENGTH) {
      return {
        mode: 'compressed',
        url: compressed.url,
        bytes: compressed.bytes,
        urlLength: compressed.url.length,
        note: `Облако недоступно, поэтому QR содержит сжатый проект напрямую: ${compressed.url.length} символов.`,
      };
    }

    const legacy = makeProjectShareUrl(project, baseUrl);
    if (legacy.length <= QR_SAFE_INLINE_URL_LENGTH) {
      return {
        mode: 'legacy',
        url: legacy,
        bytes: legacy.length,
        urlLength: legacy.length,
        note: `QR подготовлен в старом формате: ${legacy.length} символов.`,
      };
    }

    throw new Error(`Не удалось подготовить QR проекта: облачная публикация недоступна (${(cloudError as Error).message}), а проект слишком большой для прямого QR (${compressed.url.length} символов). Удалите тяжёлые вложения или включите синхронизацию.`);
  }
}

export function makeProjectShareToken(projectId = 'project'): string {
  const safeId = projectId.toLowerCase().replace(/[^a-z0-9_-]+/g, '').slice(0, 18) || 'project';
  const rand = Math.random().toString(36).slice(2, 10);
  return `prj_${safeId}_${Date.now().toString(36)}_${rand}`;
}

export function makeCloudProjectShareUrl(token: string, baseUrl?: string): string {
  return `${cleanAppBase(baseUrl)}#share=${encodeURIComponent(token)}`;
}

export function isJsonStorageProjectShareUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'api.jsonstorage.net' && parsed.pathname.startsWith('/v1/json/');
  } catch {
    return false;
  }
}

export function makeJsonStorageProjectShareUrl(storageUrl: string, baseUrl?: string): string {
  return `${cleanAppBase(baseUrl)}#shareurl=${encodeURIComponent(storageUrl)}`;
}

function stripInlineBinaryForShare(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.startsWith('data:image/') || value.startsWith('data:application/') ? '' : value;
  }
  if (Array.isArray(value)) return value.map((item) => stripInlineBinaryForShare(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, stripInlineBinaryForShare(item)]));
  }
  return value;
}

export function compactProjectForShare(project: Project): Project {
  return stripInlineBinaryForShare(JSON.parse(JSON.stringify(project))) as Project;
}

export function projectShareEndpoint(token: string): string {
  return `${DEFAULT_CLOUD_API}/${encodeURIComponent(`share_${token}`)}`;
}

function assertProjectSharePayload(json: unknown): ProjectSharePayload {
  const payload = json as ProjectSharePayload;
  if (!payload || payload.version !== 1 || payload.type !== 'project-share' || !payload.project || !Array.isArray(payload.project.lines)) {
    throw new Error('QR-ссылка проекта повреждена или устарела');
  }
  return payload;
}

async function publishProjectShareToKvdb(token: string, body: string): Promise<void> {
  const headers = { 'Content-Type': 'application/json' };
  const endpoint = projectShareEndpoint(token);
  let res = await fetch(endpoint, { method: 'POST', headers, body });
  if (!res.ok) res = await fetch(endpoint, { method: 'PUT', headers, body });
  if (!res.ok) throw new Error(`KVdb HTTP ${res.status}`);
}

async function publishProjectShareToJsonStorage(body: string): Promise<string> {
  const res = await fetch(JSON_STORAGE_PROJECT_SHARE_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body,
  });
  if (!res.ok) throw new Error(`JSONStorage HTTP ${res.status}`);
  const json = (await res.json()) as { uri?: string; url?: string };
  const storageUrl = (json.uri || json.url || '').replace(/\s+/g, '');
  if (!isJsonStorageProjectShareUrl(storageUrl)) throw new Error('JSONStorage вернул некорректную ссылку');
  return storageUrl;
}

export async function publishProjectShare(project: Project, baseUrl?: string): Promise<{ token: string; url: string; bytes: number }> {
  const token = makeProjectShareToken(project.id);
  const payload: ProjectSharePayload = {
    version: 1,
    type: 'project-share',
    token,
    createdAt: new Date().toISOString(),
    project: compactProjectForShare(project),
  };
  const body = JSON.stringify(payload);
  const errors: string[] = [];

  try {
    await publishProjectShareToKvdb(token, body);
    return { token, url: makeCloudProjectShareUrl(token, baseUrl), bytes: body.length };
  } catch (error) {
    errors.push((error as Error).message || 'KVdb недоступен');
  }

  try {
    const storageUrl = await publishProjectShareToJsonStorage(body);
    return { token, url: makeJsonStorageProjectShareUrl(storageUrl, baseUrl), bytes: body.length };
  } catch (error) {
    errors.push((error as Error).message || 'JSONStorage недоступен');
  }

  throw new Error(`Не удалось опубликовать проект для QR: ${errors.join('; ')}`);
}

export async function loadProjectShare(token: string): Promise<Project> {
  const res = await fetch(projectShareEndpoint(token), { method: 'GET', headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Не удалось загрузить проект по QR (HTTP ${res.status})`);
  return assertProjectSharePayload(await res.json()).project;
}

export async function loadJsonStorageProjectShare(storageUrl: string): Promise<Project> {
  if (!isJsonStorageProjectShareUrl(storageUrl)) throw new Error('QR-ссылка проекта указывает на неизвестное хранилище');
  const res = await fetch(storageUrl, { method: 'GET', headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Не удалось загрузить проект по QR (HTTP ${res.status})`);
  return assertProjectSharePayload(await res.json()).project;
}

/** Умное слияние локальных и удалённых данных по дате изменения (Smart Merge) */
export function mergeSyncData(
  local: { projects: Project[]; clients?: ClientProfile[]; templates: Template[]; settings: ProjectSettings },
  remote: SyncPayload,
): {
  mergedProjects: Project[];
  mergedTemplates: Template[];
  mergedClients: ClientProfile[];
  mergedSettings: ProjectSettings;
  hasLocalChangesToPush: boolean;
  hasRemoteChangesToApply: boolean;
} {
  let hasLocalChangesToPush = false;
  let hasRemoteChangesToApply = false;

  // 1. Слияние проектов по ID
  const projectMap = new Map<string, Project>();
  const remoteProjMap = new Map<string, Project>((remote.projects ?? []).map((p) => [p.id, p]));

  // Проверяем локальные проекты
  for (const lp of local.projects) {
    const rp = remoteProjMap.get(lp.id);
    if (!rp) {
      // Есть локально, но нет в облаке -> нужно отправить в облако
      projectMap.set(lp.id, lp);
      hasLocalChangesToPush = true;
    } else {
      const lTime = new Date(lp.updatedAt || lp.createdAt || 0).getTime();
      const rTime = new Date(rp.updatedAt || rp.createdAt || 0).getTime();
      if (lTime >= rTime) {
        projectMap.set(lp.id, lp);
        if (lTime > rTime) hasLocalChangesToPush = true;
      } else {
        projectMap.set(lp.id, rp);
        hasRemoteChangesToApply = true;
      }
    }
  }

  // Добавляем проекты, которые есть в облаке, но отсутствуют локально
  for (const rp of remote.projects ?? []) {
    if (!projectMap.has(rp.id)) {
      projectMap.set(rp.id, rp);
      hasRemoteChangesToApply = true;
    }
  }

  const mergedProjects = Array.from(projectMap.values()).sort((a, b) => {
    const tA = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const tB = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return tB - tA;
  });

  // 2. Слияние шаблонов по ID
  const tplMap = new Map<string, Template>();
  for (const lt of local.templates) tplMap.set(lt.id, lt);
  for (const rt of remote.templates ?? []) {
    if (!tplMap.has(rt.id)) {
      tplMap.set(rt.id, rt);
      hasRemoteChangesToApply = true;
    }
  }
  const mergedTemplates = Array.from(tplMap.values());
  if (mergedTemplates.length > (remote.templates ?? []).length) {
    hasLocalChangesToPush = true;
  }

  // 3. Слияние клиентов по ID и updatedAt
  const clientMap = new Map<string, ClientProfile>();
  const remoteClients = remote.clients ?? [];
  const remoteClientMap = new Map<string, ClientProfile>(remoteClients.map((client) => [client.id, client]));
  for (const localClient of local.clients ?? []) {
    const remoteClient = remoteClientMap.get(localClient.id);
    if (!remoteClient) {
      clientMap.set(localClient.id, localClient);
      hasLocalChangesToPush = true;
    } else {
      const localTime = new Date(localClient.updatedAt || localClient.createdAt || 0).getTime();
      const remoteTime = new Date(remoteClient.updatedAt || remoteClient.createdAt || 0).getTime();
      if (localTime >= remoteTime) {
        clientMap.set(localClient.id, localClient);
        if (localTime > remoteTime) hasLocalChangesToPush = true;
      } else {
        clientMap.set(localClient.id, remoteClient);
        hasRemoteChangesToApply = true;
      }
    }
  }
  for (const remoteClient of remoteClients) {
    if (!clientMap.has(remoteClient.id)) {
      clientMap.set(remoteClient.id, remoteClient);
      hasRemoteChangesToApply = true;
    }
  }
  const mergedClients = Array.from(clientMap.values()).sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt));

  // 4. Настройки
  const mergedSettings = { ...(local.settings || defaultSettings()), ...(remote.settings || {}) };

  return {
    mergedProjects,
    mergedTemplates,
    mergedClients,
    mergedSettings,
    hasLocalChangesToPush,
    hasRemoteChangesToApply,
  };
}

/** Получение URL для API облачного хранилища */
export function getEndpointUrl(cfg: SyncConfig): string {
  if (cfg.provider === 'custom' && cfg.customEndpoint) {
    return cfg.customEndpoint.replace(/\/+$/, '') + '/' + encodeURIComponent(cfg.secretKey);
  }
  return `${DEFAULT_CLOUD_API}/${encodeURIComponent(cfg.secretKey)}`;
}

/** Отправка данных в облако */
export async function pushToCloud(
  cfg: SyncConfig,
  data: { projects: Project[]; clients?: ClientProfile[]; templates: Template[]; settings: ProjectSettings },
): Promise<{ ok: boolean; error?: string }> {
  if (!cfg.enabled || !cfg.secretKey) {
    return { ok: false, error: 'Синхронизация не настроена' };
  }

  const payload: SyncPayload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    roomCode: cfg.roomCode,
    projects: data.projects,
    clients: data.clients ?? loadClientProfiles(),
    templates: data.templates,
    settings: data.settings,
  };

  const url = getEndpointUrl(cfg);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (cfg.customApiKey) headers['Authorization'] = `Bearer ${cfg.customApiKey}`;

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      // Попробуем метод PUT, если POST вернул ошибку
      const resPut = await fetch(url, {
        method: 'PUT',
        headers,
        body: JSON.stringify(payload),
      });
      if (!resPut.ok) {
        return { ok: false, error: `Ошибка облака (HTTP ${resPut.status})` };
      }
    }

    return { ok: true };
  } catch (e) {
    clearTimeout(timer);
    const msg = (e as Error).name === 'AbortError' ? 'Таймаут соединения' : (e as Error).message || 'Нет связи с сервером';
    return { ok: false, error: msg };
  }
}

/** Получение данных из облака */
export async function pullFromCloud(
  cfg: SyncConfig,
): Promise<{ ok: boolean; data?: SyncPayload; error?: string }> {
  if (!cfg.enabled || !cfg.secretKey) {
    return { ok: false, error: 'Синхронизация не настроена' };
  }

  const url = getEndpointUrl(cfg);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (cfg.customApiKey) headers['Authorization'] = `Bearer ${cfg.customApiKey}`;

    const res = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.status === 404) {
      // Комната ещё пустая — данных пока нет
      return { ok: true, data: undefined };
    }

    if (!res.ok) {
      return { ok: false, error: `Ошибка облака (HTTP ${res.status})` };
    }

    const json = (await res.json()) as SyncPayload;
    if (!json || json.version !== 1 || !Array.isArray(json.projects)) {
      return { ok: false, error: 'Некорректный формат данных в облаке' };
    }

    return { ok: true, data: json };
  } catch (e) {
    clearTimeout(timer);
    const msg = (e as Error).name === 'AbortError' ? 'Таймаут соединения' : (e as Error).message || 'Нет связи с сервером';
    return { ok: false, error: msg };
  }
}

/**
 * Полный цикл двусторонней синхронизации:
 * 1. Читает облако.
 * 2. Сливает локальные и удалённые проекты по датам изменения (Smart Merge).
 * 3. Если локально были новые изменения — отправляет объединённую базу в облако.
 * 4. Сохраняет и возвращает объединённые данные.
 */
export async function performFullSync(cfg: SyncConfig): Promise<{
  ok: boolean;
  status: SyncStatus;
  message: string;
  merged?: { projects: Project[]; clients?: ClientProfile[]; templates: Template[]; settings: ProjectSettings };
}> {
  if (!cfg.enabled || !cfg.secretKey) {
    return { ok: false, status: 'idle', message: 'Синхронизация отключена' };
  }

  const local = {
    projects: loadProjects(),
    clients: loadClientProfiles(),
    templates: loadTemplates(),
    settings: loadGlobalSettings(),
  };

  // 1. Читаем из облака
  const pullRes = await pullFromCloud(cfg);
  if (!pullRes.ok) {
    return { ok: false, status: 'offline', message: pullRes.error || 'Ошибка подключения' };
  }

  // Если в облаке пока пусто, отправляем локальную базу
  if (!pullRes.data) {
    const pushRes = await pushToCloud(cfg, local);
    if (!pushRes.ok) {
      return { ok: false, status: 'error', message: pushRes.error || 'Не удалось загрузить данные в облако' };
    }
    const updatedCfg = { ...cfg, lastSyncedAt: new Date().toISOString() };
    saveSyncConfig(updatedCfg);
    return {
      ok: true,
      status: 'synced',
      message: 'Все проекты загружены в облако',
      merged: local,
    };
  }

  // 2. Слияние
  const { mergedProjects, mergedTemplates, mergedClients, mergedSettings, hasLocalChangesToPush, hasRemoteChangesToApply } = mergeSyncData(
    local,
    pullRes.data,
  );

  // 3. Если были локальные изменения, пушим их в облако
  if (hasLocalChangesToPush || !pullRes.data) {
    const pushRes = await pushToCloud(cfg, {
      projects: mergedProjects,
      clients: mergedClients,
      templates: mergedTemplates,
      settings: mergedSettings,
    });
    if (!pushRes.ok) {
      // Сохраняем локально, но помечаем статус
      saveProjects(mergedProjects);
      saveClientProfiles(mergedClients);
      saveTemplates(mergedTemplates);
      saveGlobalSettings(mergedSettings);
      return { ok: false, status: 'offline', message: `Локально обновлено, но не отправлено: ${pushRes.error}` };
    }
  }

  // 4. Сохраняем объединённый результат в localStorage
  if (hasRemoteChangesToApply || hasLocalChangesToPush) {
    saveProjects(mergedProjects);
    saveClientProfiles(mergedClients);
    saveTemplates(mergedTemplates);
    saveGlobalSettings(mergedSettings);
  }

  const updatedCfg = { ...cfg, lastSyncedAt: new Date().toISOString() };
  saveSyncConfig(updatedCfg);

  return {
    ok: true,
    status: 'synced',
    message: `Синхронизировано: проектов ${mergedProjects.length}, клиентов ${mergedClients.length}`,
    merged: {
      projects: mergedProjects,
      clients: mergedClients,
      templates: mergedTemplates,
      settings: mergedSettings,
    },
  };
}
