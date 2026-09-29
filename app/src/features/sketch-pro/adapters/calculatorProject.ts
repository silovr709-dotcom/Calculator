import type { Project, ProjectSketchRef } from '../../../types';
import type { SketchDocument } from '../core/types';
import { todayRu, uid } from '../core/types';

export function createSketchDocument(project: Project, image: SketchDocument['image'], title = `Эскиз ${todayRu()}`): SketchDocument {
  const id = uid();
  const now = new Date().toISOString();
  return {
    version: 1,
    id,
    projectId: project.id,
    title,
    room: 'Кухня',
    variant: '01',
    sourceAssetId: `${id}/asset`,
    createdAt: now,
    updatedAt: now,
    image,
    objects: [],
    header: { enabled: true, project: project.name, room: 'Кухня', date: todayRu(), variant: '01' },
    integration: { projectId: project.id },
  };
}

export function toProjectSketchRef(document: SketchDocument, showInClient = true): ProjectSketchRef {
  return { id: document.id, name: document.title, room: document.room, variant: document.variant, sourceAssetId: document.sourceAssetId, updatedAt: document.updatedAt, showInClient };
}

export function upsertSketchRef(project: Project, document: SketchDocument): Project {
  const current = project.sketchPro?.documents ?? [];
  const ref = toProjectSketchRef(document, current.find((item) => item.id === document.id)?.showInClient ?? true);
  return { ...project, sketchPro: { documents: [...current.filter((item) => item.id !== ref.id), ref], activeDocumentId: ref.id } };
}

export function removeSketchRef(project: Project, sketchId: string): Project {
  const documents = (project.sketchPro?.documents ?? []).filter((item) => item.id !== sketchId);
  return { ...project, sketchPro: { documents, activeDocumentId: project.sketchPro?.activeDocumentId === sketchId ? documents[0]?.id : project.sketchPro?.activeDocumentId } };
}
