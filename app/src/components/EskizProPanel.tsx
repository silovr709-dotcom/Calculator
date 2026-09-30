import { useEffect, useMemo, useRef, useState } from 'react';
import type { EskizProIntegration, Project } from '../types';
import {
  ESKIZ_PRO_URL,
  collectEskizModuleMarkers,
  listEskizProjects,
  loadEskizProject,
  readEskizFile,
  snapshotProject,
  syncEskizModulesToCalculation,
  upsertEskizSnapshot,
  type EskizProjectSummary,
} from '../lib/eskizPro';
import EskizProjectPreview from './EskizProjectPreview';

const EMPTY_LINKS: string[] = [];
const EMPTY_SNAPSHOTS: NonNullable<EskizProIntegration['snapshots']> = [];

function unique(items: string[]): string[] {
  return Array.from(new Set(items.filter(Boolean)));
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
}

function sameGithubPagesOrigin() {
  return typeof window !== 'undefined' && window.location.hostname === 'silovr709-dotcom.github.io';
}

export default function EskizProPanel(props: { project: Project; onChange: (project: Project) => void; onOpenModule?: (moduleId: string) => void }) {
  const { project } = props;
  const eskizPro = project.eskizPro ?? {};
  const linkedIds = eskizPro.linkedProjectIds ?? EMPTY_LINKS;
  const snapshots = eskizPro.snapshots ?? EMPTY_SNAPSHOTS;
  const [summaries, setSummaries] = useState<EskizProjectSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [frameKey, setFrameKey] = useState(0);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const linkedProjects = useMemo(() => linkedIds
    .map((id) => snapshotProject(snapshots.find((item) => item.id === id)))
    .filter((item): item is NonNullable<typeof item> => Boolean(item)), [linkedIds, snapshots]);
  const activeId = eskizPro.activeProjectId && linkedIds.includes(eskizPro.activeProjectId) ? eskizPro.activeProjectId : linkedIds[0] ?? null;
  const showInClient = eskizPro.showInClient !== false;
  const clientMode = eskizPro.clientMode ?? 'active';
  const moduleMarkers = useMemo(() => collectEskizModuleMarkers(linkedProjects), [linkedProjects]);
  const moduleBindings = eskizPro.moduleBindings ?? {};
  const linkedModuleCount = moduleMarkers.filter((marker) => Boolean(moduleBindings[marker.key])).length;

  const updateEskizPro = (patch: Partial<EskizProIntegration>) => props.onChange({ ...project, eskizPro: { ...eskizPro, ...patch } });

  const refresh = async () => {
    setLoading(true);
    setMessage('');
    try {
      const next = await listEskizProjects();
      setSummaries(next);
      setMessage(next.length ? `Найдено эскизов: ${next.length}` : 'В IndexedDB Эскиз PRO пока нет сохранённых проектов. Создайте/сохраните эскиз в окне слева и нажмите «Обновить список».');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось прочитать проекты Эскиз PRO');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const attach = async (id: string) => {
    setLoading(true);
    setMessage('');
    try {
      const found = await loadEskizProject(id);
      if (!found) throw new Error('Эскиз не найден. Откройте Эскиз PRO и сохраните проект ещё раз.');
      updateEskizPro({
        linkedProjectIds: unique([id, ...linkedIds]),
        activeProjectId: id,
        showInClient,
        clientMode,
        snapshots: upsertEskizSnapshot(snapshots, found),
      });
      setMessage(`Эскиз «${found.title}» привязан к проекту и сохранён в snapshot.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось привязать эскиз');
    } finally {
      setLoading(false);
    }
  };

  const sync = async (id: string) => {
    setLoading(true);
    setMessage('');
    try {
      const found = await loadEskizProject(id);
      if (!found) throw new Error('Эскиз не найден в локальной базе Эскиз PRO. Если вы на другом устройстве — импортируйте .eskiz файл.');
      updateEskizPro({ snapshots: upsertEskizSnapshot(snapshots, found) });
      setMessage(`Snapshot «${found.title}» обновлён.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось обновить snapshot');
    } finally {
      setLoading(false);
    }
  };

  const detach = (id: string) => {
    const nextIds = linkedIds.filter((item) => item !== id);
    const nextBindings = Object.fromEntries(Object.entries(moduleBindings).filter(([key]) => !key.startsWith(`${id}:`)));
    updateEskizPro({
      linkedProjectIds: nextIds,
      activeProjectId: activeId === id ? nextIds[0] ?? null : activeId,
      moduleBindings: nextBindings,
      snapshots: snapshots.filter((item) => item.id !== id),
    });
  };

  const importFile = async (file: File | null) => {
    if (!file) return;
    setLoading(true);
    setMessage('');
    try {
      const imported = await readEskizFile(file);
      updateEskizPro({
        linkedProjectIds: unique([imported.id, ...linkedIds]),
        activeProjectId: imported.id,
        showInClient,
        clientMode,
        snapshots: upsertEskizSnapshot(snapshots, imported),
      });
      setMessage(`Файл «${imported.title}» импортирован и привязан к проекту.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось импортировать .eskiz');
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const syncModulesToCalculation = () => {
    const result = syncEskizModulesToCalculation(project, linkedProjects);
    props.onChange(result.project);
    setMessage(result.markers.length
      ? `Модули из Эскиз PRO синхронизированы: создано ${result.created}, обновлено ${result.updated}. Они уже участвуют в просчёте, КП и проверке.`
      : 'В связанных эскизах нет объектов «Модуль». Добавьте в Эскиз PRO модуль как маркер/плашку и заполните его описание.');
  };

  return (
    <section className="eskiz-pro-workspace">
      <div className="card eskiz-pro-intro no-print">
        <div>
          <span className="eyebrow">ЭСКИЗ PRO</span>
          <h3>Внешний инструмент для скрина проекта, размеров и модулей-маркеров</h3>
          <p className="muted small">Откройте настоящий Эскиз PRO, загрузите скрин, нанесите размеры/подписи и добавьте объекты «Модуль» как точки/плашки. После синхронизации эти модули станут обычными позициями расчёта.</p>
        </div>
        <div className="actions">
          <a className="btn ghost" href={ESKIZ_PRO_URL} target="_blank" rel="noreferrer">Открыть в новой вкладке</a>
          <button className="btn ghost" onClick={() => setFrameKey((value) => value + 1)}>Перезагрузить окно</button>
          <button className="btn primary" disabled={loading} onClick={refresh}>Обновить список</button>
        </div>
      </div>

      {!sameGithubPagesOrigin() && (
        <div className="note no-print">В live preview Эскиз PRO открыт с другого origin, поэтому браузер может не дать калькулятору читать его IndexedDB. На основной ссылке GitHub Pages оба приложения находятся на <b>silovr709-dotcom.github.io</b>, и привязка работает напрямую. Для локальной проверки можно импортировать файл <b>.eskiz</b>.</div>
      )}

      <div className="eskiz-pro-grid">
        <div className="card eskiz-pro-frame-card no-print">
          <div className="section-head">
            <div><h3>Окно Эскиз PRO</h3><p className="muted small">Загрузите скрин, расставьте размеры, дождитесь автосохранения и нажмите «Обновить список» справа.</p></div>
          </div>
          <iframe key={frameKey} className="eskiz-pro-frame" src={ESKIZ_PRO_URL} title="Эскиз PRO" />
        </div>

        <aside className="eskiz-pro-side">
          <section className="card no-print">
            <div className="section-head"><div><h3>Связь с проектом</h3><p className="muted small">Snapshot сохраняется внутри проекта калькулятора, поэтому КП и экспорт проекта не зависят от локальной базы браузера.</p></div></div>
            <div className="eskiz-pro-kp-controls">
              <label className="chk-row"><input type="checkbox" checked={showInClient} onChange={(event) => updateEskizPro({ showInClient: event.target.checked })} /> Вставить Эскиз PRO в КП</label>
              <label>Что вставлять<select value={clientMode} onChange={(event) => updateEskizPro({ clientMode: event.target.value as EskizProIntegration['clientMode'] })}><option value="active">Только главный эскиз</option><option value="all">Все связанные эскизы</option></select></label>
            </div>
            <div className="eskiz-pro-status-cards">
              <div><b>{linkedIds.length}</b><span>привязано</span></div>
              <div><b>{activeId ? 'Да' : 'Нет'}</b><span>главный эскиз</span></div>
              <div><b>{showInClient ? 'Да' : 'Нет'}</b><span>в КП</span></div>
            </div>
            <div className="actions eskiz-pro-import-actions">
              <button className="btn ghost" onClick={() => fileRef.current?.click()}>Импорт .eskiz</button>
              <input ref={fileRef} type="file" accept=".eskiz,application/json" hidden onChange={(event) => void importFile(event.target.files?.[0] ?? null)} />
            </div>
            {message && <div className="eskiz-pro-message muted small">{message}</div>}
          </section>

          <section className="card no-print eskiz-pro-module-sync">
            <div className="section-head"><div><h3>Модули с эскиза → просчёт</h3><p className="muted small">Используйте объект «Модуль» в Эскиз PRO как точку или сноску. Описание можно писать свободно: «Низ 800 800×720×560, фасады 2, ящики 0».</p></div></div>
            <div className="eskiz-pro-module-stats"><div><b>{moduleMarkers.length}</b><span>маркеров</span></div><div><b>{linkedModuleCount}</b><span>уже связаны</span></div><div><b>{Math.max(0, moduleMarkers.length - linkedModuleCount)}</b><span>новые</span></div></div>
            <button className="btn primary block" disabled={moduleMarkers.length === 0} onClick={syncModulesToCalculation}>Создать / обновить модули в расчёте</button>
            {moduleMarkers.length === 0 ? <div className="empty small">В привязанных эскизах пока нет объектов «Модуль».</div> : (
              <div className="eskiz-pro-marker-list">
                {moduleMarkers.slice(0, 8).map((marker) => {
                  const moduleId = moduleBindings[marker.key];
                  const linkedModule = moduleId ? project.modules?.find((module) => module.id === moduleId) : null;
                  return <div key={marker.key}><b>{marker.number}</b><span>{marker.description || 'без описания'}{linkedModule ? ` → ${linkedModule.name}` : ' → будет создан'}</span>{linkedModule && props.onOpenModule && <button className="btn tiny ghost" onClick={() => props.onOpenModule?.(linkedModule.id)}>Открыть настройки</button>}</div>;
                })}
                {moduleMarkers.length > 8 && <div><b>+{moduleMarkers.length - 8}</b><span>ещё модулей</span></div>}
              </div>
            )}
          </section>

          <section className="card no-print">
            <div className="section-head"><div><h3>Найдено в Эскиз PRO</h3><p className="muted small">Проекты из IndexedDB инструмента.</p></div><button className="btn tiny ghost" disabled={loading} onClick={refresh}>↻</button></div>
            {summaries.length === 0 ? <div className="empty small">Список пуст. Сохраните эскиз в инструменте или импортируйте .eskiz файл.</div> : (
              <div className="eskiz-pro-list">
                {summaries.map((summary) => {
                  const linked = linkedIds.includes(summary.id);
                  return (
                    <article className={linked ? 'linked' : ''} key={summary.id}>
                      {summary.thumbnail && <img src={summary.thumbnail} alt="" />}
                      <div><b>{summary.title}</b><span>{formatDate(summary.updatedAt)} · объектов: {summary.objectsCount ?? '—'}</span></div>
                      <button className="btn tiny ghost" disabled={loading} onClick={() => void attach(summary.id)}>{linked ? 'Обновить/привязать' : 'Привязать'}</button>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section className="card">
            <div className="section-head"><div><h3>Привязано к расчёту</h3><p className="muted small">Эти эскизы попадут в клиентское КП.</p></div></div>
            {linkedIds.length === 0 ? <div className="empty small">Пока нет связанных эскизов.</div> : (
              <div className="eskiz-pro-linked-list">
                {linkedIds.map((id) => {
                  const snapshot = snapshots.find((item) => item.id === id);
                  const previewProject = snapshotProject(snapshot);
                  return (
                    <article className={activeId === id ? 'active' : ''} key={id}>
                      <div><b>{snapshot?.title ?? id}</b><span>{snapshot ? `snapshot ${formatDate(snapshot.updatedAt)}` : 'snapshot отсутствует'}</span></div>
                      <div className="actions">
                        <button className="btn tiny ghost" onClick={() => updateEskizPro({ activeProjectId: id })}>Главный</button>
                        <button className="btn tiny ghost" disabled={loading} onClick={() => void sync(id)}>Синхр.</button>
                        <button className="btn tiny danger" onClick={() => detach(id)}>Убрать</button>
                      </div>
                      {previewProject && <EskizProjectPreview project={previewProject} compact />}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </aside>
      </div>

      {linkedProjects.length > 0 && (
        <section className="card eskiz-pro-project-preview">
          <div className="section-head"><div><h3>Как это будет выглядеть в КП</h3><p className="muted small">Рендерим сохранённый snapshot из настоящего Эскиз PRO.</p></div></div>
          {linkedProjects.map((item) => <EskizProjectPreview key={item.id} project={item} />)}
        </section>
      )}
    </section>
  );
}
