// Локальное хранилище: проекты, настройки, шаблоны, загруженные версии прайса.
// Всё хранится отдельно от исходного прайса; наценки не влияют на цены Висмы.
import type { Project, ProjectSettings, Template, Pricebook, KbArticle } from '../types';

const K_PROJECTS = 'recept.projects.v1';
const K_SETTINGS = 'recept.settings.v1';
const K_TEMPLATES = 'recept.templates.v1';
const K_KNOWLEDGE = 'recept-kb-articles';
const K_PRICEBOOKS = 'recept.pricebooks.v1'; // загруженные (кроме встроенного)

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
let quotaWarned = false;
function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // квота localStorage исчерпана — данные этого сохранения НЕ записаны
    if (!quotaWarned) {
      quotaWarned = true;
      alert('Хранилище браузера переполнено — последнее изменение НЕ сохранено.\n\nЧаще всего это из-за большого количества фото в проектах: удалите лишние фото или выгрузите проект в файл (.json) через Экспорт.');
    }
    return false;
  }
}

// ---------- настройки по умолчанию: НИЧЕГО не придумано, поля пустые ----------
export function defaultSettings(): ProjectSettings {
  return {
    markupBasePct: null,
    markupByGroup: {},
    extraExpenses: [],
    applyEmalRule: true,
    assemblyCost: null,
    deliveryCost: null,
    clientRounding: 1,
  };
}

export const loadGlobalSettings = (): ProjectSettings => read(K_SETTINGS, defaultSettings());
export const saveGlobalSettings = (s: ProjectSettings) => write(K_SETTINGS, s);

export const loadProjects = (): Project[] => read<Project[]>(K_PROJECTS, []);
export const saveProjects = (p: Project[]) => write(K_PROJECTS, p);

export const loadTemplates = (): Template[] => read<Template[]>(K_TEMPLATES, []);
export const saveTemplates = (t: Template[]) => write(K_TEMPLATES, t);

export const loadKbArticles = (): KbArticle[] => read<KbArticle[]>(K_KNOWLEDGE, []);
export const saveKbArticles = (a: KbArticle[]) => write(K_KNOWLEDGE, a);

export const loadStoredPricebooks = (): Pricebook[] => read<Pricebook[]>(K_PRICEBOOKS, []);
export const saveStoredPricebooks = (p: Pricebook[]) => write(K_PRICEBOOKS, p);

export function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function downloadFile(filename: string, content: string | Blob, mime = 'application/octet-stream') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---------- Резервная копия всех данных ----------

export interface Backup {
  kind: 'recept-backup';
  version: 1;
  exportedAt: string;
  projects: Project[];
  settings: ProjectSettings;
  templates: Template[];
  pricebooks: Pricebook[]; // загруженные версии прайса (встроенный не нужен)
  kbArticles?: KbArticle[];
}

export function makeBackup(): Backup {
  return {
    kind: 'recept-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    projects: loadProjects(),
    settings: loadGlobalSettings(),
    templates: loadTemplates(),
    pricebooks: loadStoredPricebooks(),
    kbArticles: loadKbArticles(),
  };
}

/** Восстановление из копии. Возвращает описание или бросает ошибку с понятным текстом. */
export function restoreBackup(raw: string): string {
  let b: Backup;
  try { b = JSON.parse(raw); } catch { throw new Error('Файл не является корректным JSON.'); }
  if (b?.kind !== 'recept-backup' || !Array.isArray(b.projects)) {
    throw new Error('Это не файл резервной копии РЕцепта (ожидается kind=recept-backup).');
  }
  const okP = saveProjects(b.projects);
  const okS = saveGlobalSettings(b.settings ?? defaultSettings());
  const okT = saveTemplates(b.templates ?? []);
  const okB = saveStoredPricebooks(b.pricebooks ?? []);
  const okK = saveKbArticles(b.kbArticles ?? []);
  if (!okP || !okS || !okT || !okB || !okK) throw new Error('Не хватило места в хранилище браузера — данные восстановлены не полностью.');
  return `Восстановлено: проектов ${b.projects.length}, шаблонов ${(b.templates ?? []).length}, версий прайса ${(b.pricebooks ?? []).length} (копия от ${b.exportedAt.slice(0, 10)})`;
}
