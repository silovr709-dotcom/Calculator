import type { Project, ProjectSettings, Template } from '../types';
import { loadProjects, loadTemplates, loadGlobalSettings, saveProjects, saveTemplates, saveGlobalSettings, defaultSettings } from './storage';

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
  templates: Template[];
  settings: ProjectSettings;
}

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'error';

const DEFAULT_CLOUD_API = 'https://kvdb.io/Ank3iN1oH5eX2sP9bKq1tW'; // изолированный KV-бакет калькулятора РЕцепт

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
export function parseIncomingHash(hash: string): { type: 'sync'; roomCode: string; secretKey: string } | { type: 'import'; project: Project } | null {
  if (!hash) return null;
  const clean = hash.startsWith('#') ? hash.slice(1) : hash;
  
  if (clean.startsWith('sync=')) {
    const val = clean.slice('sync='.length);
    const parts = val.split(':');
    if (parts.length >= 2) {
      return { type: 'sync', roomCode: parts[0], secretKey: parts.slice(1).join(':') };
    }
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

/** Формирование ссылки прямого импорта одного проекта по QR-коду (без облака) */
export function makeProjectShareUrl(project: Project, baseUrl?: string): string {
  const origin = baseUrl || (typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : 'https://silovr709-dotcom.github.io/Calculator/');
  const cleanBase = origin.split('#')[0].split('?')[0];
  // Копируем проект без тяжелых фото для компактности QR-кода
  const clone: Project = {
    ...JSON.parse(JSON.stringify(project)),
    photos: (project.photos ?? []).map((ph) => ({ ...ph, dataUrl: '' })),
  };
  const json = JSON.stringify(clone);
  return `${cleanBase}#import=${encodeURIComponent(json)}`;
}

/** Умное слияние локальных и удалённых данных по дате изменения (Smart Merge) */
export function mergeSyncData(
  local: { projects: Project[]; templates: Template[]; settings: ProjectSettings },
  remote: SyncPayload,
): {
  mergedProjects: Project[];
  mergedTemplates: Template[];
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

  // 3. Настройки
  const mergedSettings = { ...(local.settings || defaultSettings()), ...(remote.settings || {}) };

  return {
    mergedProjects,
    mergedTemplates,
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
  data: { projects: Project[]; templates: Template[]; settings: ProjectSettings },
): Promise<{ ok: boolean; error?: string }> {
  if (!cfg.enabled || !cfg.secretKey) {
    return { ok: false, error: 'Синхронизация не настроена' };
  }

  const payload: SyncPayload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    roomCode: cfg.roomCode,
    projects: data.projects,
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
  merged?: { projects: Project[]; templates: Template[]; settings: ProjectSettings };
}> {
  if (!cfg.enabled || !cfg.secretKey) {
    return { ok: false, status: 'idle', message: 'Синхронизация отключена' };
  }

  const local = {
    projects: loadProjects(),
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
  const { mergedProjects, mergedTemplates, mergedSettings, hasLocalChangesToPush, hasRemoteChangesToApply } = mergeSyncData(
    local,
    pullRes.data,
  );

  // 3. Если были локальные изменения, пушим их в облако
  if (hasLocalChangesToPush || !pullRes.data) {
    const pushRes = await pushToCloud(cfg, {
      projects: mergedProjects,
      templates: mergedTemplates,
      settings: mergedSettings,
    });
    if (!pushRes.ok) {
      // Сохраняем локально, но помечаем статус
      saveProjects(mergedProjects);
      saveTemplates(mergedTemplates);
      saveGlobalSettings(mergedSettings);
      return { ok: false, status: 'offline', message: `Локально обновлено, но не отправлено: ${pushRes.error}` };
    }
  }

  // 4. Сохраняем объединённый результат в localStorage
  if (hasRemoteChangesToApply || hasLocalChangesToPush) {
    saveProjects(mergedProjects);
    saveTemplates(mergedTemplates);
    saveGlobalSettings(mergedSettings);
  }

  const updatedCfg = { ...cfg, lastSyncedAt: new Date().toISOString() };
  saveSyncConfig(updatedCfg);

  return {
    ok: true,
    status: 'synced',
    message: `Синхронизировано: проектов ${mergedProjects.length}`,
    merged: {
      projects: mergedProjects,
      templates: mergedTemplates,
      settings: mergedSettings,
    },
  };
}
