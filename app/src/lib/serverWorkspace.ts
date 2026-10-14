// Рабочая база целиком: что именно хранится на сервере и как она сливается
// с тем, что уже лежит в браузере. Здесь только чистые функции — их легко проверить тестами.

import type { ClientProfile, KbArticle, Pricebook, Project, ProjectSettings, Template } from '../types';
import {
  defaultSettings,
  loadClientProfiles, loadGlobalSettings, loadKbArticles, loadProjects, loadStoredPricebooks, loadTemplates,
  saveClientProfiles, saveGlobalSettings, saveKbArticles, saveProjects, saveStoredPricebooks, saveTemplates,
} from './storage';
import { mergeSyncData } from './sync';

export interface Workspace {
  projects: Project[];
  clients: ClientProfile[];
  templates: Template[];
  settings: ProjectSettings;
  pricebooks: Pricebook[];
  knowledge: KbArticle[];
}

export function emptyWorkspace(): Workspace {
  return { projects: [], clients: [], templates: [], settings: defaultSettings(), pricebooks: [], knowledge: [] };
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** Приводим что угодно, пришедшее с сервера, к рабочей базе — без падений на битых данных. */
export function normalizeWorkspace(raw: unknown): Workspace {
  if (!raw || typeof raw !== 'object') return emptyWorkspace();
  const value = raw as Record<string, unknown>;
  const settings = value.settings && typeof value.settings === 'object' && !Array.isArray(value.settings)
    ? { ...defaultSettings(), ...(value.settings as ProjectSettings) }
    : defaultSettings();
  return {
    projects: asArray<Project>(value.projects).filter((item) => item && typeof item === 'object' && typeof item.id === 'string'),
    clients: asArray<ClientProfile>(value.clients).filter((item) => item && typeof item === 'object' && typeof item.id === 'string'),
    templates: asArray<Template>(value.templates).filter((item) => item && typeof item === 'object' && typeof item.id === 'string'),
    settings,
    pricebooks: asArray<Pricebook>(value.pricebooks),
    knowledge: asArray<KbArticle>(value.knowledge),
  };
}

/** Рабочая база из локального хранилища браузера. */
export function readLocalWorkspace(): Workspace {
  return {
    projects: loadProjects(),
    clients: loadClientProfiles(),
    templates: loadTemplates(),
    settings: loadGlobalSettings(),
    pricebooks: loadStoredPricebooks(),
    knowledge: loadKbArticles(),
  };
}

/** Записываем базу в браузер: он остаётся быстрым кэшем и страховкой при обрыве связи. */
export function writeLocalWorkspace(workspace: Workspace): void {
  saveProjects(workspace.projects);
  saveClientProfiles(workspace.clients);
  saveTemplates(workspace.templates);
  saveGlobalSettings(workspace.settings);
  saveStoredPricebooks(workspace.pricebooks);
  saveKbArticles(workspace.knowledge);
}

/**
 * Короткая подпись содержимого: по ней понимаем, изменилось ли что-то на самом деле.
 * Полное сравнение JSON было бы слишком дорогим — база весит мегабайты.
 */
export function workspaceSignature(workspace: Workspace): string {
  const part = (items: Array<{ id: string; updatedAt?: string; createdAt?: string }>) =>
    items.map((item) => `${item.id}:${item.updatedAt ?? item.createdAt ?? ''}`).join(',');
  return [
    part(workspace.projects),
    part(workspace.clients),
    workspace.templates.map((item) => item.id).join(','),
    workspace.knowledge.map((item) => `${item.id}:${item.updatedAt ?? ''}`).join(','),
    workspace.pricebooks.map((book) => book.meta?.id ?? '').join(','),
    JSON.stringify(workspace.settings ?? {}),
  ].join('|');
}

/**
 * Слияние своей версии базы с серверной: по каждому проекту и клиенту побеждает более
 * свежая правка, удалённые у себя записи возвращаются с сервера (так данные не теряются).
 */
export function mergeWorkspaces(local: Workspace, remote: Workspace): Workspace {
  const merged = mergeSyncData(
    { projects: local.projects, clients: local.clients, templates: local.templates, settings: local.settings },
    { version: 1, updatedAt: new Date().toISOString(), roomCode: '', projects: remote.projects, clients: remote.clients, templates: remote.templates, settings: remote.settings },
  );

  const knowledge = new Map<string, KbArticle>();
  for (const article of remote.knowledge) knowledge.set(article.id, article);
  for (const article of local.knowledge) {
    const existing = knowledge.get(article.id);
    const localTime = new Date(article.updatedAt ?? 0).getTime();
    const existingTime = existing ? new Date(existing.updatedAt ?? 0).getTime() : -1;
    if (!existing || localTime >= existingTime) knowledge.set(article.id, article);
  }

  const pricebooks = new Map<string, Pricebook>();
  for (const book of remote.pricebooks) if (book?.meta?.id) pricebooks.set(book.meta.id, book);
  for (const book of local.pricebooks) if (book?.meta?.id) pricebooks.set(book.meta.id, book);

  return {
    projects: merged.mergedProjects,
    clients: merged.mergedClients,
    templates: merged.mergedTemplates,
    settings: merged.mergedSettings,
    pricebooks: Array.from(pricebooks.values()),
    knowledge: Array.from(knowledge.values()),
  };
}

/** Человеческий размер базы — показываем в панели сервера. */
export function formatWorkspaceSize(bytes: number): string {
  if (!bytes) return '—';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  return `${(bytes / 1048576).toFixed(1)} МБ`;
}
