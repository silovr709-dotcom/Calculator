import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Pricebook, Project } from '../../../types';
import { createSketchDocument, removeSketchRef, upsertSketchRef } from '../adapters/calculatorProject';
import { sketchMaterialLegendForModuleId } from '../adapters/calculatorMaterials';
import { sketchModuleOptions } from '../adapters/calculatorModules';
import type { SketchDocument } from '../core/types';
import { readProjectFile } from '../export/projectFile';
import { deleteSketchDocument, loadSketchDocument, saveSketchDocument } from '../storage/indexedDb';
import Editor from './SketchEditor';
import './sketchPro.css';
import './sketchProOverrides.css';

type Props = {
  project: Project;
  pricebook: Pricebook;
  onChange: (project: Project) => void;
  onSelectModule: (moduleId: string) => void;
};

function readImage(file: File): Promise<SketchDocument['image']> {
  return new Promise((resolve, reject) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { reject(new Error('Поддерживаются JPG, PNG и WEBP')); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('Файл не является корректным изображением'));
      image.onload = () => resolve({ dataUrl: String(reader.result), width: image.naturalWidth, height: image.naturalHeight, name: file.name });
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export default function SketchProPanel({ project, pricebook, onChange, onSelectModule }: Props) {
  const [document, setDocument] = useState<SketchDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const imageInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const loadedProjectId = useRef<string | null>(null);
  const moduleOptions = useMemo(() => sketchModuleOptions(project, pricebook), [project, pricebook]);

  const refs = useMemo(() => project.sketchPro?.documents ?? [], [project.sketchPro?.documents]);
  const loadActive = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const activeId = project.sketchPro?.activeDocumentId ?? refs[0]?.id;
      if (activeId) setDocument(await loadSketchDocument(project.id, activeId));
      else setDocument(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось открыть документ Sketch PRO');
    } finally { setLoading(false); }
  }, [project.id, project.sketchPro, refs]);

  useEffect(() => {
    if (loadedProjectId.current === project.id) return;
    loadedProjectId.current = project.id;
    void loadActive();
  }, [loadActive, project.id]);

  const openDocument = async (id: string) => {
    setError(''); setLoading(true);
    try { setDocument(await loadSketchDocument(project.id, id)); onChange({ ...project, sketchPro: { ...project.sketchPro, documents: refs, activeDocumentId: id } }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось открыть документ Sketch PRO'); }
    finally { setLoading(false); }
  };

  const saveDocument = async (next: SketchDocument) => {
    await saveSketchDocument(next);
    setDocument(next);
    onChange(upsertSketchRef(project, next));
  };

  const createFromImage = async (file?: File) => {
    if (!file) return;
    setLoading(true); setError('');
    try {
      const next = createSketchDocument(project, await readImage(file));
      await saveDocument(next);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось создать эскиз'); }
    finally { setLoading(false); }
  };

  const importDocument = async (file?: File) => {
    if (!file) return;
    setLoading(true); setError('');
    try {
      const next = await readProjectFile(file, project.id);
      await saveDocument(next);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось импортировать .eskiz'); }
    finally { setLoading(false); }
  };

  const closeDocument = () => setDocument(null);

  const removeDocument = async (id: string) => {
    const ref = refs.find(item => item.id === id);
    if (!ref || !confirm('Удалить документ Sketch PRO?')) return;
    await deleteSketchDocument(project.id, id, ref.sourceAssetId);
    const next = removeSketchRef(project, id);
    onChange(next);
    if (document?.id === id) setDocument(null);
  };

  if (document) return <div className="sketch-pro-root sketch-pro-editor-shell"><Editor
    initialProject={document}
    onClose={closeDocument}
    onSave={saveDocument}
    moduleOptions={moduleOptions}
    legendForModule={(moduleId) => sketchMaterialLegendForModuleId(moduleId, project.modules ?? [], project.moduleDefaults ?? {}, pricebook)}
    onOpenModule={onSelectModule}
  /></div>;

  return <section className="sketch-pro-root sketch-pro-panel">
    <div className="sketch-pro-empty-head"><div><span className="eyebrow">ЭСКИЗ PRO · ПРОЕКТ {project.name}</span><h2>Технические эскизы кухни</h2><p>Загрузите скрин из PRO100 или импортируйте проект .eskiz версии 1. Документы и изображения сохраняются в IndexedDB отдельно от проекта.</p></div><div className="sketch-pro-actions"><input ref={imageInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={event => { void createFromImage(event.target.files?.[0]); event.currentTarget.value = ''; }}/><button className="primary-btn" onClick={() => imageInput.current?.click()}>Загрузить изображение</button><input ref={importInput} type="file" accept=".eskiz,application/json" hidden onChange={event => { void importDocument(event.target.files?.[0]); event.currentTarget.value = ''; }}/><button className="secondary-btn" onClick={() => importInput.current?.click()}>Импорт .eskiz</button></div></div>
    {error && <div className="error-toast">{error}</div>}
    {loading && <div className="sketch-pro-loading">Открываем хранилище Sketch PRO…</div>}
    {!loading && refs.length === 0 && <div className="sketch-pro-empty-card"><b>Документов пока нет</b><span>Первый экран редактора создаётся поверх загруженного изображения. Старый автоматический эскиз проекта не изменяется.</span></div>}
    {refs.length > 0 && <div className="sketch-pro-documents"><div className="section-title"><h3>Документы проекта</h3><span>{refs.length}</span></div>{refs.map(ref => <article className="sketch-pro-document-card" key={ref.id}><div><strong>{ref.name}</strong><span>{ref.room} · вариант {ref.variant} · изменён {new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ref.updatedAt))}</span><small>Изображение и полная модель в IndexedDB · ключ {project.id}/{ref.id}</small></div><div><button className="secondary-btn" onClick={() => void openDocument(ref.id)}>Открыть редактор</button><button className="icon-btn" title="Удалить" onClick={() => void removeDocument(ref.id)}>×</button></div></article>)}</div>}
    <div className="sketch-pro-legend-note"><b>Интеграция с расчётом</b><span>Модули из «Позиции кухни» привязываются к объектам эскиза через sourceModuleId. В инспекторе доступны реальные позиции активного прайса и легенда Ф01 · К01 · СТ01 · Р01.</span></div>
  </section>;
}
