import type { EskizProSnapshot } from '../types';

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
