import { useRef, useState } from 'react';
import type { Project, ProjectPhoto } from '../types';
import { uid } from '../lib/storage';
import { fmtDate } from '../lib/format';

/** Сжатие изображения в браузере: длинная сторона ≤ 1400 px, JPEG ~0.82 */
async function compressImage(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = dataUrl;
  });
  const MAX = 1400;
  const scale = Math.min(1, MAX / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.82);
}

export default function PhotosPanel(props: { project: Project; onChange: (p: Project) => void }) {
  const { project } = props;
  const photos = project.photos ?? [];
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [zoom, setZoom] = useState<ProjectPhoto | null>(null);

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true); setErr(null);
    const next: ProjectPhoto[] = [...photos];
    try {
      for (const f of Array.from(files)) {
        if (!f.type.startsWith('image/')) { setErr(`«${f.name}» — не изображение, пропущено`); continue; }
        const dataUrl = await compressImage(f);
        next.push({ id: uid('ph'), name: f.name.replace(/\.[^.]+$/, ''), dataUrl, addedAt: new Date().toISOString(), showToClient: true });
      }
      props.onChange({ ...project, photos: next });
    } catch {
      setErr('Не удалось обработать файл. Поддерживаются JPG/PNG/WebP.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const upd = (id: string, patch: Partial<ProjectPhoto>) =>
    props.onChange({ ...project, photos: photos.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  const del = (id: string) => props.onChange({ ...project, photos: photos.filter((p) => p.id !== id) });

  return (
    <div className="card">
      <h3>Фото и эскизы проекта</h3>
      <div className="muted small">
        Визуализации из PRO100, эскизы, фото помещения. Хранятся внутри проекта (сжимаются до ~1400 px), попадают в файл проекта .json
        и — если включено — на первую страницу клиентского КП. Автоматический расчёт по фото не выполняется: размеры и комплектация задаются в «Позициях кухни».
      </div>
      <div className="photo-toolbar">
        <button className="btn primary" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? 'Обработка…' : '+ Загрузить фото'}
        </button>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => addFiles(e.target.files)} />
        {err && <span className="warn small">{err}</span>}
      </div>
      {photos.length === 0 ? (
        <div className="empty">Фото пока нет. Нажмите «Загрузить фото» — можно выбрать несколько файлов сразу (JPG/PNG/WebP).</div>
      ) : (
        <div className="photo-grid">
          {photos.map((p) => (
            <figure className="photo-card" key={p.id}>
              <img src={p.dataUrl} alt={p.name} onClick={() => setZoom(p)} />
              <figcaption>
                <input value={p.name} onChange={(e) => upd(p.id, { name: e.target.value })} placeholder="подпись…" />
                <div className="photo-meta">
                  <span className="muted small">{fmtDate(p.addedAt.slice(0, 10))}</span>
                  <label className="chk small"><input type="checkbox" checked={p.showToClient} onChange={(e) => upd(p.id, { showToClient: e.target.checked })} /> в КП клиенту</label>
                  <button className="btn tiny danger" onClick={() => del(p.id)}>✕</button>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      {zoom && (
        <div className="modal-back photo-zoom" onMouseDown={() => setZoom(null)}>
          <img src={zoom.dataUrl} alt={zoom.name} />
        </div>
      )}
    </div>
  );
}
