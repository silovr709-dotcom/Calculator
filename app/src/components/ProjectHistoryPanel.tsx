// История версий проекта: кто и когда менял, просмотр и откат одной версии.
// Версии живут на сервере и не зависят от браузера.

import { useCallback, useEffect, useState } from 'react';
import type { Project } from '../types';
import { listProjectVersions, readProjectVersion, type ProjectVersion } from '../lib/serverApi';
import { hydrate } from '../lib/photoStore';

export default function ProjectHistoryPanel(props: {
  project: Project;
  onRestore: (project: Project) => void;
}) {
  const projectId = props.project.id;
  const [versions, setVersions] = useState<ProjectVersion[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    try {
      setVersions(await listProjectVersions(projectId));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, [projectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void reload(); }, 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  const restore = async (version: ProjectVersion) => {
    if (!confirm(`Вернуть проект к версии от ${new Date(version.at).toLocaleString('ru-RU')}?\n\nТекущее состояние тоже останется в истории, откатить обратно можно в любой момент.`)) return;
    setBusy(version.file);
    try {
      const restored = await readProjectVersion<Project>(projectId, version.file);
      const hydrated = await hydrate(restored);
      props.onRestore({ ...hydrated, id: projectId, updatedAt: new Date().toISOString() });
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  if (!loaded) return <div className="project-history muted small">Загружаем историю…</div>;
  if (error) return <div className="project-history warn-box">История недоступна: {error}</div>;
  if (versions.length === 0) {
    return <div className="project-history muted small">История пока пуста: она начнёт наполняться с ближайшего сохранения проекта.</div>;
  }

  return (
    <div className="project-history">
      <ul>
        {versions.map((version, index) => (
          <li key={version.file}>
            <div className="project-history-main">
              <b>{new Date(version.at).toLocaleString('ru-RU')}</b>
              <span>{version.by || 'неизвестно кто'} · версия базы №{version.rev} · {Math.max(1, Math.round(version.size / 1024))} КБ</span>
              {version.name && version.name !== props.project.name && <em>название тогда: «{version.name}»</em>}
            </div>
            {index === 0
              ? <span className="project-history-current">текущая</span>
              : <button type="button" className="btn ghost small" disabled={busy !== ''} onClick={() => void restore(version)}>
                  {busy === version.file ? 'Возвращаю…' : 'Вернуть эту версию'}
                </button>}
          </li>
        ))}
      </ul>
      <p className="muted small">Хранятся последние 40 версий проекта. Откат меняет только этот проект — работа коллег по другим проектам не затрагивается.</p>
    </div>
  );
}
