import type { SketchDocument } from '../core/types';

const DB_NAME = 'recept-sketch-pro';
const DB_VERSION = 1;
const DOCUMENTS = 'documents';
const ASSETS = 'assets';

type StoredDocument = Omit<SketchDocument, 'image'> & { key: string };
type StoredAsset = { key: string; projectId: string; assetId: string; image: SketchDocument['image']; updatedAt: string };

const keyFor = (projectId: string, sketchId: string) => `${projectId}/${sketchId}`;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB недоступна в этом браузере'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DOCUMENTS)) db.createObjectStore(DOCUMENTS, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(ASSETS)) db.createObjectStore(ASSETS, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Не удалось открыть IndexedDB'));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Ошибка IndexedDB'));
  });
}

export async function saveSketchDocument(document: SketchDocument): Promise<void> {
  const db = await openDb();
  const key = keyFor(document.projectId, document.id);
  const { image, ...withoutImage } = document;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([DOCUMENTS, ASSETS], 'readwrite');
    tx.objectStore(DOCUMENTS).put({ ...withoutImage, key } satisfies StoredDocument);
    tx.objectStore(ASSETS).put({ key: keyFor(document.projectId, document.sourceAssetId), projectId: document.projectId, assetId: document.sourceAssetId, image, updatedAt: document.updatedAt } satisfies StoredAsset);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Не удалось сохранить документ Sketch PRO'));
  });
  db.close();
}

export async function loadSketchDocument(projectId: string, sketchId: string): Promise<SketchDocument | null> {
  const db = await openDb();
  const key = keyFor(projectId, sketchId);
  const stored = await new Promise<StoredDocument | undefined>((resolve, reject) => {
    const request = db.transaction(DOCUMENTS, 'readonly').objectStore(DOCUMENTS).get(key);
    request.onsuccess = () => resolve(request.result as StoredDocument | undefined);
    request.onerror = () => reject(request.error ?? new Error('Не удалось прочитать документ Sketch PRO'));
  });
  if (!stored) { db.close(); return null; }
  const asset = await new Promise<StoredAsset | undefined>((resolve, reject) => {
    const request = db.transaction(ASSETS, 'readonly').objectStore(ASSETS).get(keyFor(projectId, stored.sourceAssetId));
    request.onsuccess = () => resolve(request.result as StoredAsset | undefined);
    request.onerror = () => reject(request.error ?? new Error('Не удалось прочитать изображение Sketch PRO'));
  });
  db.close();
  if (!asset) return null;
  return { ...stored, image: asset.image };
}

export async function listSketchDocuments(projectId: string): Promise<SketchDocument[]> {
  const db = await openDb();
  const documents = await new Promise<StoredDocument[]>((resolve, reject) => {
    const request = db.transaction(DOCUMENTS, 'readonly').objectStore(DOCUMENTS).openCursor();
    const result: StoredDocument[] = [];
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { resolve(result); return; }
      const value = cursor.value as StoredDocument;
      if (value.projectId === projectId) result.push(value);
      cursor.continue();
    };
    request.onerror = () => reject(request.error ?? new Error('Не удалось прочитать документы Sketch PRO'));
  });
  db.close();
  const result = await Promise.all(documents.map(document => loadSketchDocument(projectId, document.id)));
  return result.filter((value): value is SketchDocument => !!value);
}

export async function deleteSketchDocument(projectId: string, sketchId: string, assetId: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([DOCUMENTS, ASSETS], 'readwrite');
    tx.objectStore(DOCUMENTS).delete(keyFor(projectId, sketchId));
    tx.objectStore(ASSETS).delete(keyFor(projectId, assetId));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Не удалось удалить документ Sketch PRO'));
  });
  db.close();
}

export async function saveSketchAsset(projectId: string, assetId: string, image: SketchDocument['image'], updatedAt = new Date().toISOString()): Promise<void> {
  const db = await openDb();
  await requestResult(db.transaction(ASSETS, 'readwrite').objectStore(ASSETS).put({ key: keyFor(projectId, assetId), projectId, assetId, image, updatedAt } satisfies StoredAsset));
  db.close();
}

export function sketchStorageKey(projectId: string, sketchId: string) {
  return keyFor(projectId, sketchId);
}
