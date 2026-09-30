import type { EskizProSnapshot, KitchenModule, Project } from '../types';
import { newModule } from './modules';

export const ESKIZ_PRO_URL = 'https://silovr709-dotcom.github.io/ESCIZ/';
const DB_NAME = 'recept-eskiz-pro';
const STORE = 'projects';
const REVISIONS = 'revisions';
const DB_VERSION = 2;

export type EskizPoint = { x: number; y: number };
export type EskizEquipmentType = 'Холодильник' | 'Духовой шкаф' | 'СВЧ' | 'ПММ' | 'Варочная панель' | 'Вытяжка' | 'Стиральная машина' | 'Мойка' | 'Другое';

export type EskizBaseObject = {
  id: string;
  type: string;
  x: number;
  y: number;
  color: string;
  fontSize: number;
  width?: number;
  height?: number;
  fill?: string;
  fillOpacity?: number;
  borderRadius?: number;
  hidden?: boolean;
  locked?: boolean;
};

export type EskizDimensionObject = EskizBaseObject & {
  type: 'dimension';
  orientation: 'horizontal' | 'vertical' | 'free';
  textOrientation?: 'parallel' | 'horizontal';
  offset?: number;
  x2: number;
  y2: number;
  value: string;
  lineWidth: number;
  arrowStyle?: 'open' | 'closed' | 'tick';
  chainId?: string;
  prefix?: string;
  suffix?: string;
  tolerance?: string;
  showUnit?: boolean;
  textPosition?: 'center' | 'above' | 'below';
};

export type EskizModuleObject = EskizBaseObject & { type: 'module'; number: string; description: string };
export type EskizTextObject = EskizBaseObject & { type: 'comment' | 'link' | 'equipment'; text: string; url?: string; equipmentType?: EskizEquipmentType };
export type EskizCalloutObject = EskizBaseObject & { type: 'callout'; targetX: number; targetY: number; text: string; url?: string };
export type EskizAnchorObject = EskizBaseObject & { type: 'anchor'; label: string };
export type EskizGuideObject = EskizBaseObject & { type: 'guide'; orientation: 'horizontal' | 'vertical' };
export type EskizObject = EskizDimensionObject | EskizModuleObject | EskizTextObject | EskizCalloutObject | EskizAnchorObject | EskizGuideObject;

export interface EskizProject {
  version: 1;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  image: { dataUrl: string; width: number; height: number; name: string };
  imageDisplay?: { opacity: number; brightness: number; contrast: number; saturation: number; grayscale: boolean };
  objects: EskizObject[];
  header: { enabled: boolean; project: string; room: string; date: string; variant: string };
  integration: { projectId?: string; clientId?: string };
}

export type EskizProjectSummary = Pick<EskizProject, 'id' | 'title' | 'createdAt' | 'updatedAt'> & { thumbnail?: string; objectsCount?: number };

export interface EskizModuleMarker {
  key: string;
  eskizId: string;
  eskizTitle: string;
  objectId: string;
  number: string;
  description: string;
  x: number;
  y: number;
}

interface ParsedEskizModule {
  type: string;
  name: string;
  qty?: number;
  widthMm?: number | null;
  heightMm?: number | null;
  depthMm?: number | null;
  facades?: number;
  drawers?: number;
  shelves?: number;
  hinges?: number;
  handles?: number;
  lifts?: number;
  note: string;
}

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB недоступен в этом окружении'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' });
      if (!request.result.objectStoreNames.contains(REVISIONS)) {
        const revisions = request.result.createObjectStore(REVISIONS, { keyPath: 'id' });
        revisions.createIndex('projectId', 'projectId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Не удалось открыть базу Эскиз PRO'));
  });
}

export async function listEskizProjects(): Promise<EskizProjectSummary[]> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE).objectStore(STORE).getAll();
    request.onsuccess = () => resolve((request.result as unknown[])
      .filter(isEskizProject)
      .map((project) => ({
        id: project.id,
        title: project.title,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        thumbnail: project.image.dataUrl,
        objectsCount: project.objects.length,
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    request.onerror = () => reject(request.error ?? new Error('Не удалось прочитать эскизы'));
  });
}

export async function loadEskizProject(id: string): Promise<EskizProject | null> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE).objectStore(STORE).get(id);
    request.onsuccess = () => resolve(isEskizProject(request.result) ? request.result : null);
    request.onerror = () => reject(request.error ?? new Error('Не удалось открыть эскиз'));
  });
}

export function snapshotFromEskizProject(project: EskizProject): EskizProSnapshot {
  return {
    id: project.id,
    title: project.title,
    updatedAt: project.updatedAt,
    project,
  };
}

export function snapshotProject(snapshot?: EskizProSnapshot | null): EskizProject | null {
  return isEskizProject(snapshot?.project) ? snapshot.project : null;
}

export function upsertEskizSnapshot(snapshots: EskizProSnapshot[] | undefined, project: EskizProject): EskizProSnapshot[] {
  const next = (snapshots ?? []).filter((item) => item.id !== project.id);
  return [snapshotFromEskizProject(project), ...next].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function readEskizFile(file: File): Promise<EskizProject> {
  if (!file.name.toLowerCase().endsWith('.eskiz') && file.type && !file.type.includes('json')) throw new Error('Выберите файл проекта .eskiz');
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error('Файл .eskiz повреждён или имеет неверный формат');
  }
  const payload = parsed as { format?: string; project?: unknown };
  if (payload.format !== 'recept-eskiz' || !isEskizProject(payload.project)) throw new Error('Это не проект Эскиз PRO или его версия не поддерживается');
  return payload.project;
}

export function isEskizProject(value: unknown): value is EskizProject {
  if (!value || typeof value !== 'object') return false;
  const project = value as Partial<EskizProject>;
  return project.version === 1
    && typeof project.id === 'string'
    && typeof project.title === 'string'
    && typeof project.createdAt === 'string'
    && typeof project.updatedAt === 'string'
    && Boolean(project.image)
    && typeof project.image?.dataUrl === 'string'
    && typeof project.image?.width === 'number'
    && typeof project.image?.height === 'number'
    && Array.isArray(project.objects)
    && Boolean(project.header);
}

const normalizeText = (value: string) => value.toLocaleLowerCase('ru').replace(/ё/g, 'е');

function firstLine(value: string): string {
  return value.split('\n').map((line) => line.trim()).find(Boolean) ?? '';
}

function numberFrom(text: string, patterns: RegExp[]): number | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const raw = match[1] ?? match[2];
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

function inferModuleType(text: string): string {
  const normalized = normalizeText(text);
  if (/мойк|раковин/.test(normalized)) return 'Шкаф под мойку';
  if (/духов|\bдш\b|oven/.test(normalized)) return 'Шкаф под духовой шкаф';
  if (/холод|х-?к|fridge/.test(normalized)) return 'Шкаф под холодильник';
  if (/пенал|колон|высок/.test(normalized)) return 'Пенал';
  if (/верх|навес|антресол/.test(normalized)) return 'Верхний шкаф';
  if (/открыт|полк|стеллаж/.test(normalized)) return 'Открытая секция';
  if (/панел|боковин|наклад/.test(normalized)) return 'Декоративная панель';
  return 'Нижний шкаф';
}

function defaultDimensions(type: string) {
  if (type === 'Верхний шкаф') return { widthMm: 600, heightMm: 720, depthMm: 320 };
  if (type === 'Пенал' || type === 'Шкаф под холодильник') return { widthMm: 600, heightMm: 2140, depthMm: 560 };
  if (type === 'Декоративная панель') return { widthMm: 600, heightMm: 720, depthMm: 18 };
  return { widthMm: 600, heightMm: 720, depthMm: 560 };
}

function parseDimensions(text: string): Pick<ParsedEskizModule, 'widthMm' | 'heightMm' | 'depthMm'> {
  const match = text.match(/(\d{2,4})\s*(?:x|х|×|\*)\s*(\d{2,4})(?:\s*(?:x|х|×|\*)\s*(\d{2,4}))?/i);
  if (match) {
    return { widthMm: Number(match[1]), heightMm: Number(match[2]), depthMm: match[3] ? Number(match[3]) : undefined };
  }
  const width = numberFrom(text, [/(?:ширина|ш)\s*[:=-]?\s*(\d{2,4})/i, /(?:^|\D)(\d{3,4})\s*мм(?:\D|$)/i]);
  const height = numberFrom(text, [/(?:высота|в)\s*[:=-]?\s*(\d{2,4})/i]);
  const depth = numberFrom(text, [/(?:глубина|г)\s*[:=-]?\s*(\d{2,4})/i]);
  return { widthMm: width, heightMm: height, depthMm: depth };
}

export function collectEskizModuleMarkers(projects: EskizProject[]): EskizModuleMarker[] {
  return projects.flatMap((project) => project.objects
    .filter((object): object is EskizModuleObject => object.type === 'module' && !object.hidden)
    .map((object) => ({
      key: `${project.id}:${object.id}`,
      eskizId: project.id,
      eskizTitle: project.title,
      objectId: object.id,
      number: object.number.trim() || 'Модуль',
      description: object.description.trim(),
      x: object.x,
      y: object.y,
    })));
}

export function parseEskizModuleMarker(marker: EskizModuleMarker, existing?: KitchenModule | null): ParsedEskizModule {
  const text = [marker.number, marker.description].filter(Boolean).join('\n');
  const normalized = normalizeText(text);
  const type = inferModuleType(text);
  const dims = parseDimensions(text);
  const defaults = defaultDimensions(type);
  const qty = numberFrom(normalized, [/(?:кол-?во|количество|qty)\s*[:=-]?\s*(\d+)/i, /(\d+)\s*шт/i]);
  const drawers = numberFrom(normalized, [/(?:ящик|ящики|ящиков)\s*[:=-]?\s*(\d+)/i, /(\d+)\s*(?:ящик|ящика|ящиков)/i]);
  const facades = numberFrom(normalized, [/(?:фасад|фасады|двери|дверей)\s*[:=-]?\s*(\d+)/i, /(\d+)\s*(?:фасад|фасада|фасадов|двери|дверей)/i]);
  const shelves = numberFrom(normalized, [/(?:полк|полки|полок)\s*[:=-]?\s*(\d+)/i, /(\d+)\s*(?:полк|полки|полок)/i]);
  const hinges = numberFrom(normalized, [/(?:петл|петли|петель)\s*[:=-]?\s*(\d+)/i, /(\d+)\s*(?:петл|петли|петель)/i]);
  const handles = numberFrom(normalized, [/(?:ручк|ручки|ручек)\s*[:=-]?\s*(\d+)/i, /(\d+)\s*(?:ручк|ручки|ручек)/i]);
  const lifts = numberFrom(normalized, [/(?:подъем|подъём|лифт|aventos)\D*(\d+)/i]);
  const nameBase = firstLine(marker.description) || type;
  const name = `${marker.number ? `${marker.number} — ` : ''}${nameBase}`.trim();
  const resolvedDrawers = drawers ?? (existing ? undefined : (type === 'Шкаф под духовой шкаф' ? 1 : 0));
  const resolvedFacades = facades ?? (existing ? undefined : (resolvedDrawers && resolvedDrawers > 0 ? resolvedDrawers : (type === 'Открытая секция' ? 0 : ((dims.widthMm ?? defaults.widthMm) >= 700 ? 2 : 1))));
  return {
    type,
    name,
    qty: qty ?? (existing ? undefined : 1),
    widthMm: dims.widthMm ?? (existing ? undefined : defaults.widthMm),
    heightMm: dims.heightMm ?? (existing ? undefined : defaults.heightMm),
    depthMm: dims.depthMm ?? (existing ? undefined : defaults.depthMm),
    facades: resolvedFacades,
    drawers: resolvedDrawers,
    shelves: shelves ?? (existing ? undefined : (type === 'Пенал' ? 4 : type === 'Открытая секция' ? 2 : type === 'Шкаф под мойку' ? 0 : 1)),
    hinges: hinges ?? (existing ? undefined : (resolvedFacades && (!resolvedDrawers || resolvedDrawers === 0) ? resolvedFacades * 2 : 0)),
    handles: handles ?? (existing ? undefined : Math.max(resolvedFacades ?? 0, resolvedDrawers ?? 0)),
    lifts: lifts ?? (existing ? undefined : 0),
    note: `Из Эскиз PRO: ${marker.eskizTitle}; маркер ${marker.number}${marker.description ? ` — ${marker.description.replace(/\s+/g, ' ').slice(0, 120)}` : ''}`,
  };
}

function applyDefined<T extends object>(target: T, patch: Partial<T>): T {
  const next = { ...target };
  for (const [key, value] of Object.entries(patch) as [keyof T, T[keyof T]][]) {
    if (value !== undefined) next[key] = value;
  }
  return next;
}

function moduleFromMarker(marker: EskizModuleMarker): KitchenModule {
  const parsed = parseEskizModuleMarker(marker, null);
  return applyDefined({ ...newModule(parsed.type), type: parsed.type, name: parsed.name }, parsed);
}

export function syncEskizModulesToCalculation(project: Project, eskizProjects: EskizProject[]): { project: Project; created: number; updated: number; markers: EskizModuleMarker[] } {
  const markers = collectEskizModuleMarkers(eskizProjects);
  const bindings = { ...(project.eskizPro?.moduleBindings ?? {}) };
  const modules = [...(project.modules ?? [])];
  let created = 0;
  let updated = 0;

  for (const marker of markers) {
    const boundId = bindings[marker.key];
    const foundIndex = boundId ? modules.findIndex((module) => module.id === boundId) : -1;
    if (foundIndex >= 0) {
      const parsed = parseEskizModuleMarker(marker, modules[foundIndex]);
      modules[foundIndex] = applyDefined(modules[foundIndex], parsed);
      updated += 1;
    } else {
      const module = moduleFromMarker(marker);
      bindings[marker.key] = module.id;
      modules.push(module);
      created += 1;
    }
  }

  return {
    project: {
      ...project,
      modules,
      eskizPro: {
        ...(project.eskizPro ?? {}),
        moduleBindings: bindings,
      },
    },
    created,
    updated,
    markers,
  };
}
