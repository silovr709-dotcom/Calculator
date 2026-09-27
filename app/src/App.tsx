import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Pricebook, Project, ProjectSettings, Template } from './types';
import {
  loadGlobalSettings, saveGlobalSettings,
  loadProjects, saveProjects, loadTemplates, saveTemplates,
  loadStoredPricebooks, saveStoredPricebooks, uid,
} from './lib/storage';
import {
  loadSyncConfig, saveSyncConfig, performFullSync, parseIncomingHash,
  pushToCloud,
} from './lib/sync';
import type { SyncConfig, SyncStatus } from './lib/sync';
import { todayISO } from './lib/format';
import Dashboard from './components/Dashboard';
import ProjectEditor from './components/ProjectEditor';
import SettingsPanel from './components/SettingsPanel';
import PricebookView from './components/PricebookView';
import QuickCalc from './components/QuickCalc';
import SyncPanel from './components/SyncPanel';

type View =
  | { kind: 'dashboard' }
  | { kind: 'project'; id: string }
  | { kind: 'quick' }
  | { kind: 'settings' }
  | { kind: 'pricebook' }
  | { kind: 'sync' };

export default function App() {
  const [builtin, setBuiltin] = useState<Pricebook | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stored, setStored] = useState<Pricebook[]>(() => loadStoredPricebooks());
  const [projects, setProjects] = useState<Project[]>(() => loadProjects());
  const [templates, setTemplates] = useState<Template[]>(() => loadTemplates());
  const [globalSettings, setGlobalSettings] = useState<ProjectSettings>(() => loadGlobalSettings());
  const [activePricebookId, setActivePricebookId] = useState<string>(() => localStorage.getItem('recept.activePb') ?? 'visma-2026');
  const [view, setView] = useState<View>({ kind: 'dashboard' });
  const [savedFlash, setSavedFlash] = useState(false);
  const [syncConfig, setSyncConfig] = useState<SyncConfig>(() => loadSyncConfig());
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(() => (loadSyncConfig().enabled ? 'synced' : 'idle'));

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/pricebook-visma-2026.json`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((pb: Pricebook) => setBuiltin(pb))
      .catch((e) => setLoadError(String(e)));
  }, []);

  // Обработка URL-хэша при старте (сканирование QR-кода на телефоне)
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash) return;
    const parsed = parseIncomingHash(hash);
    if (!parsed) return;

    if (parsed.type === 'sync') {
      const cfg: SyncConfig = {
        ...loadSyncConfig(),
        enabled: true,
        roomCode: parsed.roomCode,
        secretKey: parsed.secretKey,
      };
      saveSyncConfig(cfg);
      setSyncConfig(cfg);
      setSyncStatus('syncing');
      performFullSync(cfg).then((res) => {
        setSyncStatus(res.status);
        if (res.merged) {
          setProjects(res.merged.projects);
          setTemplates(res.merged.templates);
          setGlobalSettings(res.merged.settings);
          alert('📱 Устройство успешно подключено к синхронизации! Проекты загружены.');
        }
      });
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    } else if (parsed.type === 'import') {
      const p = parsed.project;
      p.id = uid('prj');
      p.updatedAt = new Date().toISOString();
      const next = [p, ...loadProjects()];
      saveProjects(next);
      setProjects(next);
      setView({ kind: 'project', id: p.id });
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      alert(`📱 Проект «${p.name}» успешно импортирован на это устройство!`);
    }
  }, []);

  // Первоначальная и фоновая периодическая синхронизация
  useEffect(() => {
    const cfg = loadSyncConfig();
    if (!cfg.enabled) return;

    const doSync = async () => {
      setSyncStatus('syncing');
      const res = await performFullSync(loadSyncConfig());
      setSyncStatus(res.status);
      if (res.merged) {
        setProjects(res.merged.projects);
        setTemplates(res.merged.templates);
        setGlobalSettings(res.merged.settings);
      }
    };

    doSync();
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') doSync();
    }, 25000);

    const onFocus = () => doSync();
    window.addEventListener('focus', onFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const pricebooks = useMemo<Pricebook[]>(
    () => (builtin ? [builtin, ...stored] : [...stored]),
    [builtin, stored],
  );
  const activePricebook = pricebooks.find((p) => p.meta.id === activePricebookId) ?? pricebooks[0] ?? null;

  const persistProjects = useCallback((next: Project[]) => {
    setProjects(next);
    if (!saveProjects(next)) alert('Не удалось сохранить: закончилось место локального хранилища. Экспортируйте старые проекты в файл и удалите их.');
    else {
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1200);
      const cfg = loadSyncConfig();
      if (cfg.enabled) {
        pushToCloud(cfg, { projects: next, templates: loadTemplates(), settings: loadGlobalSettings() })
          .then((r) => setSyncStatus(r.ok ? 'synced' : 'offline'));
      }
    }
  }, []);

  const persistTemplates = useCallback((next: Template[]) => {
    setTemplates(next);
    saveTemplates(next);
    const cfg = loadSyncConfig();
    if (cfg.enabled) {
      pushToCloud(cfg, { projects: loadProjects(), templates: next, settings: loadGlobalSettings() })
        .then((r) => setSyncStatus(r.ok ? 'synced' : 'offline'));
    }
  }, []);

  const persistSettings = useCallback((s: ProjectSettings) => {
    setGlobalSettings(s);
    saveGlobalSettings(s);
    const cfg = loadSyncConfig();
    if (cfg.enabled) {
      pushToCloud(cfg, { projects: loadProjects(), templates: loadTemplates(), settings: s })
        .then((r) => setSyncStatus(r.ok ? 'synced' : 'offline'));
    }
  }, []);

  const persistStoredPricebooks = useCallback((next: Pricebook[]) => {
    setStored(next);
    if (!saveStoredPricebooks(next)) alert('Прайс слишком большой для локального хранилища браузера. Он будет доступен до перезагрузки страницы; для постоянного использования положите JSON в app/public/data и пересоберите приложение.');
  }, []);

  const chooseActivePb = useCallback((id: string) => {
    setActivePricebookId(id);
    localStorage.setItem('recept.activePb', id);
  }, []);

  const createProject = useCallback((data: { name: string; client: string; date: string; comment: string }, lines: Project['lines'] = [], modules?: Project['modules'], moduleDefaults?: Project['moduleDefaults']) => {
    if (!activePricebook) return;
    const p: Project = {
      id: uid('prj'),
      name: data.name || 'Без названия',
      client: data.client,
      date: data.date || todayISO(),
      comment: data.comment,
      status: 'draft',
      pricebookId: activePricebook.meta.id,
      pricebookName: `${activePricebook.meta.name} (импорт ${activePricebook.meta.importedAt.slice(0, 10)})`,
      lines,
      modules: modules ?? [],
      moduleDefaults: moduleDefaults ?? {},
      settings: JSON.parse(JSON.stringify(globalSettings)),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    persistProjects([p, ...projects]);
    setView({ kind: 'project', id: p.id });
  }, [activePricebook, globalSettings, projects, persistProjects]);

  const updateProject = useCallback((p: Project) => {
    persistProjects(projects.map((x) => (x.id === p.id ? { ...p, updatedAt: new Date().toISOString() } : x)));
  }, [projects, persistProjects]);

  const duplicateProject = useCallback((id: string) => {
    const src = projects.find((p) => p.id === id);
    if (!src) return;
    const copy: Project = {
      ...JSON.parse(JSON.stringify(src)),
      id: uid('prj'),
      name: `${src.name} (копия)`,
      status: 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    persistProjects([copy, ...projects]);
    setView({ kind: 'project', id: copy.id });
  }, [projects, persistProjects]);

  const deleteProject = useCallback((id: string) => {
    if (!confirm('Удалить проект безвозвратно?')) return;
    persistProjects(projects.filter((p) => p.id !== id));
    setView({ kind: 'dashboard' });
  }, [projects, persistProjects]);

  const importProject = useCallback((file: File) => {
    file.text().then((t) => {
      try {
        const p = JSON.parse(t) as Project;
        if (!p.id || !Array.isArray(p.lines)) throw new Error('не похоже на файл проекта');
        p.id = uid('prj');
        persistProjects([p, ...projects]);
      } catch (e) { alert(`Не удалось импортировать проект: ${e}`); }
    });
  }, [projects, persistProjects]);

  if (loadError) {
    return <div className="app-fatal">Не удалось загрузить базу прайса: {loadError}</div>;
  }
  if (!activePricebook) {
    return <div className="app-fatal">Загрузка базы прайса…</div>;
  }

  const current = view.kind === 'project' ? projects.find((p) => p.id === view.id) : undefined;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-name">РЕцепт</div>
          <div className="brand-sub">калькулятор кухонь · Висма</div>
        </div>
        <nav>
          <button className={view.kind === 'dashboard' ? 'active' : ''} onClick={() => setView({ kind: 'dashboard' })}>Проекты</button>
          <button className={view.kind === 'quick' ? 'active' : ''} onClick={() => setView({ kind: 'quick' })}>Быстрый расчёт</button>
          <button className={view.kind === 'pricebook' ? 'active' : ''} onClick={() => setView({ kind: 'pricebook' })}>Прайс и версии</button>
          <button className={view.kind === 'settings' ? 'active' : ''} onClick={() => setView({ kind: 'settings' })}>Настройки</button>
          <button className={view.kind === 'sync' ? 'active' : ''} onClick={() => setView({ kind: 'sync' })}>
            📱 Синхронизация
            {syncConfig.enabled && (
              <span className={`nav-sync-badge ${syncStatus}`} title={`Синхронизация: ${syncStatus === 'synced' ? 'в сети' : syncStatus === 'syncing' ? 'обновление...' : 'офлайн'}`} />
            )}
          </button>
        </nav>
        <div className="sidebar-foot">
          <div className="pb-badge" title={activePricebook.meta.sourceFile}>
            Прайс: <b>{activePricebook.meta.name}</b>
            <span>{activePricebook.meta.itemCount} позиций</span>
          </div>
          {savedFlash && <div className="saved-flash">Сохранено ✓</div>}
        </div>
      </aside>
      <main className="main">
        {view.kind === 'dashboard' && (
          <Dashboard
            pricebooks={pricebooks}
            projects={projects}
            onOpen={(id) => setView({ kind: 'project', id })}
            onCreate={createProject}
            onDuplicate={duplicateProject}
            onDelete={deleteProject}
            onImport={importProject}
            onQuick={() => setView({ kind: 'quick' })}
            onOpenSync={() => setView({ kind: 'sync' })}
            pricebookLabel={`${activePricebook.meta.name} · импорт ${activePricebook.meta.importedAt.slice(0, 10)}`}
          />
        )}
        {view.kind === 'sync' && (
          <SyncPanel
            projects={projects}
            templates={templates}
            settings={globalSettings}
            syncStatus={syncStatus}
            onSetSyncStatus={setSyncStatus}
            onSyncUpdated={(data) => {
              setProjects(data.projects);
              setTemplates(data.templates);
              setGlobalSettings(data.settings);
              setSyncConfig(loadSyncConfig());
            }}
          />
        )}
        {view.kind === 'project' && current && (
          <ProjectEditor
            key={current.id}
            project={current}
            pricebook={pricebooks.find((pb) => pb.meta.id === current.pricebookId) ?? activePricebook}
            onChange={updateProject}
            onBack={() => setView({ kind: 'dashboard' })}
            onDuplicate={() => duplicateProject(current.id)}
            onDelete={() => deleteProject(current.id)}
            templates={templates}
            onSaveModuleTemplate={(name, module) => {
              persistTemplates([{ id: uid('tpl'), name, comment: 'Шаблон модуля', lines: [], modules: [JSON.parse(JSON.stringify(module))], createdAt: new Date().toISOString() }, ...templates]);
            }}
            onSaveTemplate={(name) => {
              persistTemplates([{ id: uid('tpl'), name, comment: '', lines: JSON.parse(JSON.stringify(current.lines)), modules: JSON.parse(JSON.stringify(current.modules ?? [])), moduleDefaults: JSON.parse(JSON.stringify(current.moduleDefaults ?? {})), createdAt: new Date().toISOString() }, ...templates]);
            }}
          />
        )}
        {view.kind === 'project' && !current && <div className="empty">Проект не найден.</div>}
        {view.kind === 'quick' && (
          <QuickCalc
            pricebook={activePricebook}
            templates={templates}
            onDeleteTemplate={(id) => persistTemplates(templates.filter((t) => t.id !== id))}
            onCreateProject={createProject}
          />
        )}
        {view.kind === 'settings' && (
          <SettingsPanel
            title="Настройки по умолчанию (для новых проектов)"
            settings={globalSettings}
            onChange={persistSettings}
            standalone
          />
        )}
        {view.kind === 'pricebook' && (
          <PricebookView
            pricebooks={pricebooks}
            activeId={activePricebook.meta.id}
            onActivate={chooseActivePb}
            onUpload={(pb) => persistStoredPricebooks([...stored.filter((s) => s.meta.id !== pb.meta.id), pb])}
            onRemove={(id) => persistStoredPricebooks(stored.filter((s) => s.meta.id !== id))}
            builtinId={builtin?.meta.id ?? null}
          />
        )}
      </main>
    </div>
  );
}
