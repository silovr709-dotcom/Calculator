import { useRef, useState, type MouseEvent } from 'react';
import type { MeasurementCommunication, MeasurementData, MeasurementOpening, MeasurementPhotoAnnotation, MeasurementWall, Project, ProjectPhoto } from '../types';
import { calibratedPhotoLengthMm, emptyMeasurement } from '../lib/measurement';
import { uid } from '../lib/storage';

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.onerror = reject; reader.readAsDataURL(file); });
}

async function compressMeasurementPhoto(file: File): Promise<string> {
  const dataUrl = await readDataUrl(file);
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const value = new Image();
    value.onload = () => resolve(value);
    value.onerror = reject;
    value.src = dataUrl;
  });
  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.84);
}

type PhotoDimensionSource = { id: string; label: string; valueMm: number | null };

export default function MeasurementPanel(props: { project: Project; onChange: (project: Project) => void }) {
  const { project } = props;
  const data = project.measurement ?? emptyMeasurement(project);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(data.photos[0]?.id ?? null);
  const [photoTool, setPhotoTool] = useState<{ photoId: string; mode: 'calibrate' | 'dimension' | 'marker'; firstPoint?: { x: number; y: number } } | null>(null);
  const [photoDimensionSourceId, setPhotoDimensionSourceId] = useState('manual');
  const photoDimensionSources: PhotoDimensionSource[] = [
    { id: 'manual', label: 'Ввести размер вручную', valueMm: null },
    ...data.walls.map((wall) => ({ id: `wall:${wall.id}`, label: `Стена: ${wall.name}`, valueMm: wall.lengthMm })),
    ...data.openings.map((opening) => ({ id: `opening:${opening.id}`, label: `${opening.kind === 'window' ? 'Окно' : opening.kind === 'door' ? 'Дверь' : 'Проём'}: ${opening.name}`, valueMm: opening.widthMm })),
    ...data.communications.map((item) => ({ id: `communication:${item.id}`, label: `Точка: ${item.name}`, valueMm: item.offsetMm })),
  ];
  const update = (patch: Partial<MeasurementData>) => props.onChange({ ...project, measurement: { ...data, ...patch, updatedAt: new Date().toISOString() } });
  const updateWall = (id: string, patch: Partial<MeasurementWall>) => update({ walls: data.walls.map((wall) => wall.id === id ? { ...wall, ...patch } : wall) });
  const updateOpening = (id: string, patch: Partial<MeasurementOpening>) => update({ openings: data.openings.map((opening) => opening.id === id ? { ...opening, ...patch } : opening) });
  const updateCommunication = (id: string, patch: Partial<MeasurementCommunication>) => update({ communications: data.communications.map((item) => item.id === id ? { ...item, ...patch } : item) });
  const addPhoto = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const photos: ProjectPhoto[] = [];
      for (const file of Array.from(files)) if (file.type.startsWith('image/')) photos.push({ id: uid('measure-photo'), name: file.name.replace(/\.[^.]+$/, ''), dataUrl: await compressMeasurementPhoto(file), addedAt: new Date().toISOString(), showToClient: false });
      update({ photos: [...data.photos, ...photos] });
    } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };
  const updatePhotoAnnotations = (photoId: string, annotations: MeasurementPhotoAnnotation[]) => update({ photos: data.photos.map((photo) => photo.id === photoId ? { ...photo, measurementAnnotations: annotations } : photo) });
  const updatePhoto = (photoId: string, patch: Partial<ProjectPhoto>) => update({ photos: data.photos.map((photo) => photo.id === photoId ? { ...photo, ...patch } : photo) });
  const addPhotoAnnotation = (photo: ProjectPhoto, annotation: MeasurementPhotoAnnotation) => updatePhotoAnnotations(photo.id, [...(photo.measurementAnnotations ?? []), annotation]);
  const photoPoint = (event: MouseEvent<HTMLDivElement>, element: HTMLDivElement) => {
    const rect = element.getBoundingClientRect();
    return { x: Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)), y: Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100)) };
  };
  const handlePhotoStageClick = (photo: ProjectPhoto, event: MouseEvent<HTMLDivElement>) => {
    if (!photoTool || photoTool.photoId !== photo.id) return;
    const point = photoPoint(event, event.currentTarget);
    if (photoTool.mode === 'marker') {
      const label = window.prompt('Что отметить на фото?', 'Проверить')?.trim();
      if (label) addPhotoAnnotation(photo, { id: uid('photo-mark'), type: 'marker', x1: point.x, y1: point.y, label });
      setPhotoTool(null);
      return;
    }
    if (!photoTool.firstPoint) {
      setPhotoTool({ ...photoTool, firstPoint: point });
      return;
    }
    const source = photoDimensionSources.find((item) => item.id === photoDimensionSourceId);
    if (photoTool.mode === 'calibrate') {
      const defaultValue = source?.valueMm != null ? String(source.valueMm) : '';
      const value = window.prompt('Известная длина этого отрезка, мм:', defaultValue)?.trim() ?? '';
      const lengthMm = Number(value);
      if (Number.isFinite(lengthMm) && lengthMm > 0) {
        updatePhoto(photo.id, { measurementCalibration: { x1: photoTool.firstPoint.x, y1: photoTool.firstPoint.y, x2: point.x, y2: point.y, lengthMm } });
      }
      setPhotoTool(null);
      return;
    }
    const calibration = photo.measurementCalibration;
    const calibratedValue = calibration ? calibratedPhotoLengthMm(calibration, photoTool.firstPoint, point, event.currentTarget.clientWidth, event.currentTarget.clientHeight) : null;
    const label = window.prompt('Подпись размера:', source?.id === 'manual' ? 'Размер' : source?.label ?? 'Размер')?.trim();
    if (!label) { setPhotoTool(null); return; }
    const defaultValue = calibratedValue ?? source?.valueMm ?? null;
    const value = calibratedValue == null ? window.prompt('Размер в миллиметрах (необязательно):', defaultValue == null ? '' : String(defaultValue))?.trim() ?? '' : '';
    const valueMm = calibratedValue ?? (value && Number.isFinite(Number(value)) ? Number(value) : null);
    addPhotoAnnotation(photo, { id: uid('photo-dim'), type: 'dimension', x1: photoTool.firstPoint.x, y1: photoTool.firstPoint.y, x2: point.x, y2: point.y, label, valueMm, accuracy: calibratedValue != null ? 'calibrated' : 'preliminary' });
    setPhotoTool(null);
  };
  const removeFrom = <T extends { id: string }>(items: T[], id: string) => items.filter((item) => item.id !== id);
  const selectedPhoto = data.photos.find((photo) => photo.id === selectedPhotoId) ?? data.photos[0] ?? null;

  return (
    <div className="measurement-page">
      <div className="measurement-intro"><div><span className="eyebrow">МОБИЛЬНЫЙ РЕЖИМ ЗАМЕРА</span><h2>Снимите помещение до расчёта</h2><p>Заполняйте на телефоне прямо у клиента. Эти данные сохраняются внутри проекта и не меняют расчёт автоматически.</p></div><div className="measurement-stamp">{data.updatedAt ? `обновлено ${new Date(data.updatedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : ''}</div></div>
      <section className="card"><div className="section-head"><div><h3>Помещение</h3><p className="muted small">Данные замера сохраняются внутри проекта и не меняют эскиз или расчёт автоматически.</p></div></div><div className="grid3"><label>Высота помещения, мм<input type="number" min={0} value={data.roomHeightMm ?? ''} placeholder="не измерено" onChange={(event) => update({ roomHeightMm: event.target.value ? Number(event.target.value) : null })} /></label><div className="measurement-hint"><b>Форма кухни:</b> {project.sketch?.shape === 'l' ? 'Г-образная' : project.sketch?.shape === 'u' ? 'П-образная' : 'прямая'}<span>Длины можно уточнить здесь и использовать в планировщике.</span></div></div></section>

      <section className="card"><div className="section-head"><h3>Стены</h3><button className="btn tiny ghost" onClick={() => update({ walls: [...data.walls, { id: uid('wall'), name: `Стена ${data.walls.length + 1}`, lengthMm: null }] })}>+ Стена</button></div><div className="measurement-walls">{data.walls.map((wall) => <div className="measurement-wall" key={wall.id}><input className="measurement-wall-name" value={wall.name} onChange={(event) => updateWall(wall.id, { name: event.target.value })} /><input type="number" min={0} placeholder="Длина, мм" value={wall.lengthMm ?? ''} onChange={(event) => updateWall(wall.id, { lengthMm: event.target.value ? Number(event.target.value) : null })} /><input placeholder="Заметка" value={wall.note ?? ''} onChange={(event) => updateWall(wall.id, { note: event.target.value })} /><button className="btn tiny danger" onClick={() => update({ walls: removeFrom(data.walls, wall.id) })}>✕</button></div>)}</div></section>

      <section className="card"><div className="section-head"><h3>Окна и двери</h3><div><button className="btn tiny ghost" onClick={() => update({ openings: [...data.openings, { id: uid('opening'), kind: 'window', name: 'Новое окно', offsetMm: null, widthMm: null, heightMm: null }] })}>+ Окно</button><button className="btn tiny ghost" onClick={() => update({ openings: [...data.openings, { id: uid('opening'), kind: 'door', name: 'Новая дверь', offsetMm: null, widthMm: null, heightMm: null }] })}>+ Дверь</button></div></div>{data.openings.length === 0 && <div className="empty small">Добавьте проёмы, если они влияют на расстановку модулей.</div>}<div className="measurement-list">{data.openings.map((opening) => <div className="measurement-record" key={opening.id}><div className="measurement-record-top"><select value={opening.kind} onChange={(event) => updateOpening(opening.id, { kind: event.target.value as MeasurementOpening['kind'] })}><option value="window">Окно</option><option value="door">Дверь</option><option value="other">Другое</option></select><input value={opening.name} onChange={(event) => updateOpening(opening.id, { name: event.target.value })} /><button className="btn tiny danger" onClick={() => update({ openings: removeFrom(data.openings, opening.id) })}>Удалить</button></div><div className="grid4"><label>Стена<select value={opening.wallId ?? ''} onChange={(event) => updateOpening(opening.id, { wallId: event.target.value || undefined })}><option value="">не указано</option>{data.walls.map((wall) => <option key={wall.id} value={wall.id}>{wall.name}</option>)}</select></label><label>Отступ, мм<input type="number" value={opening.offsetMm ?? ''} onChange={(event) => updateOpening(opening.id, { offsetMm: event.target.value ? Number(event.target.value) : null })} /></label><label>Ширина, мм<input type="number" value={opening.widthMm ?? ''} onChange={(event) => updateOpening(opening.id, { widthMm: event.target.value ? Number(event.target.value) : null })} /></label><label>Высота, мм<input type="number" value={opening.heightMm ?? ''} onChange={(event) => updateOpening(opening.id, { heightMm: event.target.value ? Number(event.target.value) : null })} /></label></div><input placeholder="Подоконник / примечание" value={opening.note ?? ''} onChange={(event) => updateOpening(opening.id, { note: event.target.value })} /></div>)}</div></section>

      <section className="card"><div className="section-head"><h3>Коммуникации</h3><button className="btn tiny ghost" onClick={() => update({ communications: [...data.communications, { id: uid('communication'), kind: 'water', name: 'Новая точка', offsetMm: null, heightMm: null }] })}>+ Точка</button></div>{data.communications.length === 0 && <div className="empty small">Отметьте воду, газ, электричество и вентиляцию, чтобы не забыть их при проектировании.</div>}<div className="measurement-list">{data.communications.map((item) => <div className="measurement-record" key={item.id}><div className="measurement-record-top"><select value={item.kind} onChange={(event) => updateCommunication(item.id, { kind: event.target.value as MeasurementCommunication['kind'] })}><option value="water">Вода / слив</option><option value="gas">Газ</option><option value="electricity">Электричество</option><option value="ventilation">Вентиляция</option><option value="other">Другое</option></select><input value={item.name} onChange={(event) => updateCommunication(item.id, { name: event.target.value })} /><button className="btn tiny danger" onClick={() => update({ communications: removeFrom(data.communications, item.id) })}>Удалить</button></div><div className="grid3"><label>Стена<select value={item.wallId ?? ''} onChange={(event) => updateCommunication(item.id, { wallId: event.target.value || undefined })}><option value="">не указано</option>{data.walls.map((wall) => <option key={wall.id} value={wall.id}>{wall.name}</option>)}</select></label><label>Отступ, мм<input type="number" value={item.offsetMm ?? ''} onChange={(event) => updateCommunication(item.id, { offsetMm: event.target.value ? Number(event.target.value) : null })} /></label><label>Высота, мм<input type="number" value={item.heightMm ?? ''} onChange={(event) => updateCommunication(item.id, { heightMm: event.target.value ? Number(event.target.value) : null })} /></label></div><input placeholder="Примечание" value={item.note ?? ''} onChange={(event) => updateCommunication(item.id, { note: event.target.value })} /></div>)}</div></section>

      <section className="card">
        <div className="section-head">
          <div><h3>Фото замера</h3><p className="muted small">Сфотографируйте помещение камерой телефона, затем нанесите размеры и точки прямо поверх фотографии.</p></div>
          <div className="measurement-photo-actions">
            <button className="btn primary" disabled={busy} onClick={() => cameraRef.current?.click()}>📷 Снять помещение</button>
            <button className="btn ghost" disabled={busy} onClick={() => fileRef.current?.click()}>+ Из файла</button>
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(event) => addPhoto(event.target.files)} />
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(event) => addPhoto(event.target.files)} />
          </div>
        </div>
        {data.photos.length === 0 ? <div className="empty small">Добавьте общий план помещения или отдельные стены. Фото сохраняются только внутри проекта.</div> : (
          <>
            <div className="measurement-photo-grid">{data.photos.map((photo) => <figure className={selectedPhoto?.id === photo.id ? 'selected' : ''} key={photo.id} onClick={() => { setSelectedPhotoId(photo.id); setPhotoTool(null); }}><img src={photo.dataUrl} alt={photo.name} /><figcaption>{photo.name}<button className="btn tiny danger" onClick={(event) => { event.stopPropagation(); update({ photos: removeFrom(data.photos, photo.id) }); if (selectedPhotoId === photo.id) setSelectedPhotoId(data.photos.find((item) => item.id !== photo.id)?.id ?? null); }}>✕</button></figcaption></figure>)}</div>
            {selectedPhoto && <div className="measurement-photo-editor">
              <div className="measurement-photo-editor-head"><div><b>Разметка: {selectedPhoto.name}</b><span className="muted small">{photoTool?.mode === 'calibrate' ? (photoTool.firstPoint ? 'Теперь нажмите вторую точку известного отрезка' : 'Нажмите две точки известного отрезка') : photoTool?.mode === 'dimension' ? (photoTool.firstPoint ? 'Теперь нажмите вторую точку размерной линии' : 'Нажмите первую и вторую точки на фотографии') : photoTool?.mode === 'marker' ? 'Нажмите место для отметки' : 'Выберите инструмент разметки'}</span></div><div className="measurement-photo-tools"><label className="photo-dimension-source">Известный размер<select value={photoDimensionSourceId} onChange={(event) => setPhotoDimensionSourceId(event.target.value)}>{photoDimensionSources.map((source) => <option key={source.id} value={source.id}>{source.label}{source.valueMm != null ? ` · ${source.valueMm} мм` : ''}</option>)}</select></label><button className={`btn tiny ${photoTool?.mode === 'calibrate' ? 'primary' : 'ghost'}`} onClick={() => setPhotoTool(photoTool?.mode === 'calibrate' ? null : { photoId: selectedPhoto.id, mode: 'calibrate' })}>⚖ Калибровать</button><button className={`btn tiny ${photoTool?.mode === 'dimension' ? 'primary' : 'ghost'}`} onClick={() => setPhotoTool(photoTool?.mode === 'dimension' ? null : { photoId: selectedPhoto.id, mode: 'dimension' })}>↔ Добавить размер</button><button className={`btn tiny ${photoTool?.mode === 'marker' ? 'primary' : 'ghost'}`} onClick={() => setPhotoTool(photoTool?.mode === 'marker' ? null : { photoId: selectedPhoto.id, mode: 'marker' })}>⊙ Отметить точку</button>{selectedPhoto.measurementCalibration && <button className="btn tiny danger" onClick={() => { updatePhoto(selectedPhoto.id, { measurementCalibration: undefined }); setPhotoTool(null); }}>Сбросить масштаб</button>}</div></div>
              <div className="measurement-photo-stage" onClick={(event) => handlePhotoStageClick(selectedPhoto, event)}><img src={selectedPhoto.dataUrl} alt={`Разметка ${selectedPhoto.name}`} /><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{selectedPhoto.measurementCalibration && <g className="photo-annotation calibration"><line x1={selectedPhoto.measurementCalibration.x1} y1={selectedPhoto.measurementCalibration.y1} x2={selectedPhoto.measurementCalibration.x2} y2={selectedPhoto.measurementCalibration.y2} /><text x={(selectedPhoto.measurementCalibration.x1 + selectedPhoto.measurementCalibration.x2) / 2} y={(selectedPhoto.measurementCalibration.y1 + selectedPhoto.measurementCalibration.y2) / 2 - 2}>масштаб: {selectedPhoto.measurementCalibration.lengthMm} мм</text></g>}{(selectedPhoto.measurementAnnotations ?? []).map((annotation) => annotation.type === 'dimension' ? <g key={annotation.id} className="photo-annotation dimension"><line x1={annotation.x1} y1={annotation.y1} x2={annotation.x2} y2={annotation.y2} /><circle cx={annotation.x1} cy={annotation.y1} r="0.9" /><circle cx={annotation.x2} cy={annotation.y2} r="0.9" /><text x={((annotation.x1 + (annotation.x2 ?? annotation.x1)) / 2)} y={((annotation.y1 + (annotation.y2 ?? annotation.y1)) / 2) - 2}>{annotation.label}{annotation.valueMm ? ` · ${annotation.valueMm} мм` : ''}{annotation.accuracy === 'calibrated' ? ' ✓' : ' ?'}</text></g> : <g key={annotation.id} className="photo-annotation marker"><circle cx={annotation.x1} cy={annotation.y1} r="1.8" /><text x={annotation.x1 + 2} y={annotation.y1 - 2}>{annotation.label}</text></g>)}</svg>{photoTool?.firstPoint && photoTool.photoId === selectedPhoto.id && <span className="photo-first-point" style={{ left: `${photoTool.firstPoint.x}%`, top: `${photoTool.firstPoint.y}%` }} />}</div>
              {selectedPhoto.measurementCalibration && <div className="photo-calibration-status">✓ Фото откалибровано по отрезку {selectedPhoto.measurementCalibration.lengthMm} мм. Размеры с галочкой рассчитываются по масштабу; «?» — предварительные.</div>}
              {(selectedPhoto.measurementAnnotations ?? []).length > 0 && <div className="photo-annotation-list">{(selectedPhoto.measurementAnnotations ?? []).map((annotation) => <div key={annotation.id}><span>{annotation.type === 'dimension' ? '↔' : '⊙'} {annotation.label}{annotation.valueMm ? ` — ${annotation.valueMm} мм` : ''} <small>{annotation.accuracy === 'calibrated' ? 'точно по масштабу' : annotation.type === 'dimension' ? 'предварительно' : ''}</small></span><button className="btn tiny danger" onClick={() => updatePhotoAnnotations(selectedPhoto.id, (selectedPhoto.measurementAnnotations ?? []).filter((item) => item.id !== annotation.id))}>Удалить</button></div>)}</div>}
            </div>}
          </>
        )}
      </section>
      <section className="card"><h3>Заметки замерщика</h3><textarea rows={5} placeholder="Неровности стен, уровень пола, пожелания клиента, что проверить повторно…" value={data.notes} onChange={(event) => update({ notes: event.target.value })} /></section>
    </div>
  );
}
