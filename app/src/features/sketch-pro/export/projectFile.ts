import type { SketchDocument } from '../core/types';
import { uid } from '../core/types';

export const ESKIZ_MIME = 'application/vnd.recept.eskiz+json';

export function downloadProjectFile(project: SketchDocument) {
  const payload = { format: 'recept-eskiz', version: 1, exportedAt: new Date().toISOString(), project };
  const blob = new Blob([JSON.stringify(payload)], { type: ESKIZ_MIME });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${safeName(project.title)}.eskiz`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

export async function readProjectFile(file: File, projectId: string): Promise<SketchDocument> {
  if (!file.name.toLowerCase().endsWith('.eskiz') && file.type && !file.type.includes('json')) throw new Error('Выберите файл проекта .eskiz');
  let parsed: unknown;
  try { parsed = JSON.parse(await file.text()); } catch { throw new Error('Файл проекта повреждён или имеет неверный формат'); }
  const source = parsed as { format?: string; version?: number; project?: unknown };
  if (source.format !== 'recept-eskiz' || (source.version !== undefined && source.version !== 1) || !isProject(source.project)) throw new Error('Это не проект Эскиз PRO версии 1 или файл повреждён');
  const project = structuredClone(source.project);
  const now = new Date().toISOString();
  const id = uid();
  return {
    ...project,
    id,
    projectId,
    sourceAssetId: `${id}/asset`,
    createdAt: now,
    updatedAt: now,
    integration: { ...project.integration, projectId },
    objects: project.objects.map(object => object.type === 'module' ? { ...object, sourceModuleId: object.sourceModuleId } : object),
  };
}

function isProject(value: unknown): value is SketchDocument {
  if (!value || typeof value !== 'object') return false;
  const p = value as Partial<SketchDocument>;
  return p.version === 1 && typeof p.title === 'string' && !!p.image && typeof p.image.dataUrl === 'string' && Number.isFinite(p.image.width) && Number.isFinite(p.image.height) && Array.isArray(p.objects) && !!p.header;
}

function safeName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, '-').trim() || 'Проект Эскиз PRO';
}
