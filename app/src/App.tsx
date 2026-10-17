import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import type { CalendarEvent, NotifySettings, ClientProfile, OrderWorkflow, Pricebook, Project, ProjectSettings, Template, KbArticle } from './types';
import {
  loadGlobalSettings, saveGlobalSettings,
  loadProjects, saveProjects, loadTemplates, saveTemplates,
  loadClientProfiles, saveClientProfiles,
  loadStoredPricebooks, saveStoredPricebooks, uid, loadKbArticles, saveKbArticles,
  loadCalendarEvents, saveCalendarEvents, loadNotifySettings, saveNotifySettings,
  isStorageServerBacked, setStorageServerBacked } from './lib/storage';
import {
  loadSyncConfig, saveSyncConfig, performFullSync, parseIncomingHash,
  pushToCloud, loadProjectShare, loadCompressedProjectShare, loadJsonStorageProjectShare, loadServerProjectShare,
} from './lib/sync';
import type { SyncConfig, SyncStatus } from './lib/sync';
import { ProjectHistory } from './lib/history';
import { todayISO } from './lib/format';
import { projectStatusForWorkflow, workflowForProject } from './lib/crm';
import { appendClientHistory, applyClientProfileToProject, applyClientProfilesToProjects, createClientProfileFromProject, ensureClientProfiles, findClientForProject, mergeClientProfiles, mergeClientPatch } from './lib/clientProfiles';
import Dashboard from './components/Dashboard';
import ProjectEditor, { type ProjectTab } from './components/ProjectEditor';
import SettingsPanel from './components/SettingsPanel';
import QuickCalc from './components/QuickCalc';
import { useAppVersion } from './lib/useAppVersion';
import ServerSaveChip from './components/ServerSaveChip';
import InstallAppCard from './components/InstallAppCard';
import ToastHost from './components/ToastHost';
import { toast } from './lib/toast';
import NotifySettingsCard from './components/NotifySettingsCard';
import { useReminders } from './lib/useReminders';
import { normalizeNotifySettings } from './lib/reminders';
import { capabilitiesFor } from './lib/permissions';
import { dehydrateKnown } from './lib/photoStore';
import NumberFieldCalculator from './components/NumberFieldCalculator';
import CommandPalette from './components/CommandPalette';
import { WORK_MODE_LABELS, type WorkMode } from './lib/workflow';
import ServerLogin from './components/ServerLogin';
import { useServerSync } from './lib/useServerSync';
import type { Workspace } from './lib/serverWorkspace';

type View =
  | { kind: 'dashboard' }
  | { kind: 'crm' }
  | { kind: 'project'; id: string; tab?: ProjectTab }
  | { kind: 'quick' }
  | { kind: 'factory'; id?: string }
  | { kind: 'kb' }
  | { kind: 'settings' }
  | { kind: 'pricebook' }
  | { kind: 'server' }
  | { kind: 'analytics' }
  | { kind: 'schedule' }
  | { kind: 'audit'; id?: string }
  | { kind: 'sync' };



// Тяжёлые разделы подгружаются по мере открытия: первый экран появляется быстрее.
const CrmView = lazy(() => import('./components/CrmView'));
const ScheduleView = lazy(() => import('./components/ScheduleView'));
const AnalyticsView = lazy(() => import('./components/AnalyticsView'));
const PriceAuditView = lazy(() => import('./components/PriceAuditView'));
const KnowledgeView = lazy(() => import('./components/KnowledgeView'));
const PricebookView = lazy(() => import('./components/PricebookView'));
const ServerPanel = lazy(() => import('./components/ServerPanel'));
const SyncPanel = lazy(() => import('./components/SyncPanel'));
const FactoryBlankView = lazy(() => import('./components/FactoryBlankView'));
const PublicOfferPage = lazy(() => import('./components/PublicOfferPage'));
const WorkOrderPage = lazy(() => import('./components/WorkOrderPage'));
const TelegramNotifyCard = lazy(() => import('./components/TelegramNotifyCard'));

/** Где пользователь был в прошлый раз: экран и открытый проект. */
const VIEW_STORE = 'recept.nav.view.v1';
const WORK_STORE = 'recept.nav.work.v1';

function restoreView(): View {
  try {
    const raw = localStorage.getItem(VIEW_STORE);
    if (!raw) return { kind: 'dashboard' };
    const parsed = JSON.parse(raw) as View;
    const known = ['dashboard', 'crm', 'project', 'quick', 'factory', 'kb', 'settings', 'pricebook', 'server', 'analytics', 'schedule', 'audit', 'sync'];
    if (parsed && typeof parsed === 'object' && known.includes(parsed.kind)) return parsed;
  } catch {
    /* испорченные настройки — просто начинаем с проектов */
  }
  return { kind: 'dashboard' };
}

function loadLastWork(): { id: string; tab?: ProjectTab } | null {
  try {
    const raw = localStorage.getItem(WORK_STORE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { id?: string; tab?: ProjectTab };
    return parsed?.id ? { id: parsed.id, tab: parsed.tab } : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [builtin, setBuiltin] = useState<Pricebook | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stored, setStored] = useState<Pricebook[]>(() => loadStoredPricebooks());
  const [projects, setProjects] = useState<Project[]>(() => loadProjects());
  const [clients, setClients] = useState<ClientProfile[]>(() => loadClientProfiles());
  const [templates, setTemplates] = useState<Template[]>(() => loadTemplates());
  const [globalSettings, setGlobalSettings] = useState<ProjectSettings>(() => loadGlobalSettings());
  const [activePricebookId, setActivePricebookId] = useState<string>(() => localStorage.getItem('recept.activePb') ?? 'visma-2026');
  const [view, setView] = useState<View>(() => restoreView());
  // Куда вернуться: последний открытый проект и вкладка внутри него.
  const [lastWork, setLastWork] = useState<{ id: string; tab?: ProjectTab } | null>(() => loadLastWork());
  const [savedFlash, setSavedFlash] = useState(false);
    const [kbArticles, setKbArticles] = useState<KbArticle[]>(() => loadKbArticles());
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>(() => loadCalendarEvents());
  const [notifySettings, setNotifySettings] = useState<NotifySettings>(() => normalizeNotifySettings(loadNotifySettings()));
const [syncConfig, setSyncConfig] = useState<SyncConfig>(() => loadSyncConfig());
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(() => (loadSyncConfig().enabled ? 'synced' : 'idle'));
  const [projectHistory] = useState(() => new ProjectHistory());
  const [commandOpen, setCommandOpen] = useState(false);
  const [workMode, setWorkMode] = useState<WorkMode>(() => {
    const storedMode = localStorage.getItem('recept.workMode') as WorkMode | null;
    return storedMode && storedMode in WORK_MODE_LABELS ? storedMode : 'manager';
  });

  // ——— Общая база на своём сервере ———
  // Если приложение открыто на хостинге с серверной частью, источник правды — сервер,
  // а localStorage работает как быстрый кэш и страховка на случай обрыва связи.
  const applyWorkspace = useCallback((workspace: Workspace) => {
    setProjects(workspace.projects);
    setClients(workspace.clients);
    setTemplates(workspace.templates);
    setGlobalSettings(workspace.settings);
    setStored(workspace.pricebooks);
    setKbArticles(workspace.knowledge);
    setCalendarEvents(workspace.events);
  }, []);
  const server = useServerSync(applyWorkspace);
  const appVersion = useAppVersion();
  // Экран и открытый проект запоминаются: после настроек возвращаемся туда же.
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_STORE, JSON.stringify(view));
      if (view.kind === 'project') {
        const work = { id: view.id, tab: view.tab };
        localStorage.setItem(WORK_STORE, JSON.stringify(work));
        // Обновляем состояние отдельным тиком: иначе React ругается на лишний рендер.
        window.setTimeout(() => setLastWork(work), 0);
      }
    } catch {
      /* память браузера переполнена — просто не запомним */
    }
  }, [view]);
  // Служба напоминаний: показывает уведомления в нужный момент на любом экране.
  useReminders(projects, calendarEvents, notifySettings, server.user?.name || server.user?.login || '');
  // Клиентская ссылка вида …/#offer=abc123 — определяем её до любой загрузки базы.
  // Меню «Ещё» в нижней панели: на телефоне нет наведения, поэтому открываем по нажатию.
  const [moreOpen, setMoreOpen] = useState(false);
  // Закрытие — затемнением фона, Escape и выбором пункта.
  // Слушателя «нажатие мимо» здесь быть не должно: он срабатывает раньше click
  // и снимает меню до того, как нажатие дойдёт до его кнопки (на телефоне это
  // выглядело как «меню не нажимается»).
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMoreOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moreOpen]);

  const [publicOfferId] = useState(() => {
    const byPath = /\/kp\/([a-f0-9]{10,32})/.exec(window.location.pathname);
    if (byPath) return byPath[1];
    const byHash = /[#&]offer=([a-f0-9]{10,32})/.exec(window.location.hash);
    return byHash ? byHash[1] : '';
  });
  // Наряд мастеру: …/mo/abc123 — открывается без входа, как и КП клиенту.
  const [workOrderId] = useState(() => {
    const byPath = /\/mo\/([a-f0-9]{10,32})/.exec(window.location.pathname);
    if (byPath) return byPath[1];
    const byHash = /[#&]order=([a-f0-9]{10,32})/.exec(window.location.hash);
    return byHash ? byHash[1] : '';
  });
  // На своём сервере переполненный localStorage — не беда: база живёт на сервере.
  useEffect(() => { setStorageServerBacked(server.mode === 'server'); }, [server.mode]);
  const serverScheduleSave = server.scheduleSave;
  const serverReady = server.mode === 'server' && Boolean(server.user);
  // Права доступа: на своём сервере зависят от роли сотрудника, локально — полные.
  const can = useMemo(
    () => capabilitiesFor(server.user?.role, server.mode === 'server'),
    [server.user?.role, server.mode],
  );

  // Пункты нижнего меню: один список и для шторки, и для проверки прав.
  const dockMenuItems = useMemo(() => {
    const go = (next: View) => () => {
      setView(next);
      setMoreOpen(false);
      toast.info(`Открываю: ${next.kind === 'schedule' ? 'График работ'
        : next.kind === 'analytics' ? 'Аналитика'
        : next.kind === 'audit' ? 'Проверка цен'
        : next.kind === 'kb' ? 'База знаний'
        : next.kind === 'pricebook' ? 'Прайс и версии'
        : next.kind === 'sync' ? 'Синхронизация'
        : next.kind === 'server' ? 'Сервер'
        : 'Настройки'}`);
    };
    const items: Array<{ key: View['kind']; label: string; hint: string; open: () => void }> = [
      { key: 'schedule', label: 'График работ', hint: 'монтажи', open: go({ kind: 'schedule' }) },
    ];
    if (can.viewCost) {
      items.push({ key: 'analytics', label: 'Аналитика', hint: 'деньги', open: go({ kind: 'analytics' }) });
      items.push({ key: 'audit', label: 'Проверка цен', hint: 'опт/розн.', open: go({ kind: 'audit' }) });
    }
    items.push({ key: 'kb', label: 'База знаний', hint: String(kbArticles.length), open: go({ kind: 'kb' }) });
    if (can.viewPricebook) items.push({ key: 'pricebook', label: 'Прайс и версии', hint: 'версии', open: go({ kind: 'pricebook' }) });
    items.push({ key: 'sync', label: 'Синхронизация', hint: 'устройства', open: go({ kind: 'sync' }) });
    if (server.mode === 'server') items.push({ key: 'server', label: 'Сервер', hint: 'база', open: go({ kind: 'server' }) });
    items.push({ key: 'settings', label: 'Настройки', hint: 'по умолч.', open: go({ kind: 'settings' }) });
    return items;
  }, [can.viewCost, can.viewPricebook, kbArticles.length, server.mode]);

  // Значок у пункта «Синхронизация»: на своём сервере показываем состояние сервера,
  // иначе — старое облако.
  const syncBadgeState = server.mode === 'server'
    ? (server.status === 'saving' || server.status === 'loading' ? 'syncing' : server.status === 'offline' || server.status === 'error' ? 'offline' : 'synced')
    : syncStatus;
  const showSyncBadge = server.mode === 'server' || syncConfig.enabled;

  // Любая правка проектов, клиентов, шаблонов и настроек уходит на сервер пакетом,
  // через небольшую паузу после последнего изменения.
  useEffect(() => {
    if (!serverReady) return;
    serverScheduleSave({ projects, clients, templates, settings: globalSettings, pricebooks: stored, knowledge: kbArticles, events: calendarEvents });
  }, [calendarEvents, clients, globalSettings, kbArticles, projects, serverReady, serverScheduleSave, stored, templates]);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/pricebook-visma-2026.json`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((pb: Pricebook) => setBuiltin(pb))
      .catch((e) => setLoadError(String(e)));
  }, []);

  useEffect(() => {
    localStorage.setItem('recept.workMode', workMode);
  }, [workMode]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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
      window.setTimeout(() => { setSyncConfig(cfg); setSyncStatus('syncing'); }, 0);
      performFullSync(cfg).then((res) => {
        setSyncStatus(res.status);
        if (res.merged) {
          setProjects(res.merged.projects);
          setClients(res.merged.clients ?? []);
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
      saveProjects(dehydrateKnown(next));
      window.setTimeout(() => { setProjects(next); setView({ kind: 'project', id: p.id }); }, 0);
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      alert(`📱 Проект «${p.name}» успешно импортирован на это устройство!`);
    } else if (parsed.type === 'importz') {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      loadCompressedProjectShare(parsed.data).then((project) => {
        const p = { ...project, id: uid('prj'), updatedAt: new Date().toISOString() };
        const next = [p, ...loadProjects()];
        saveProjects(dehydrateKnown(next));
        setProjects(next);
        setView({ kind: 'project', id: p.id });
        alert(`📱 Проект «${p.name}» загружен по QR-коду!`);
      }).catch((error) => {
        alert(`Не удалось открыть сжатый QR проекта: ${(error as Error).message}`);
      });
    } else if (parsed.type === 'share') {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      loadProjectShare(parsed.token).then((project) => {
        const p = { ...project, id: uid('prj'), updatedAt: new Date().toISOString() };
        const next = [p, ...loadProjects()];
        saveProjects(dehydrateKnown(next));
        setProjects(next);
        setView({ kind: 'project', id: p.id });
        alert(`📱 Проект «${p.name}» загружен по QR-коду!`);
      }).catch((error) => {
        alert(`Не удалось открыть проект по QR-коду: ${(error as Error).message}`);
      });
    } else if (parsed.type === 'servershare') {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      loadServerProjectShare(parsed.id).then((project) => {
        const p = { ...project, id: uid('prj'), updatedAt: new Date().toISOString() };
        const next = [p, ...loadProjects()];
        saveProjects(dehydrateKnown(next));
        setProjects(next);
        setView({ kind: 'project', id: p.id });
        alert(`📱 Проект «${p.name}» загружен по QR-коду!`);
      }).catch((error) => {
        alert(`Не удалось открыть проект по QR-коду: ${(error as Error).message}`);
      });
    } else if (parsed.type === 'shareurl') {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      loadJsonStorageProjectShare(parsed.url).then((project) => {
        const p = { ...project, id: uid('prj'), updatedAt: new Date().toISOString() };
        const next = [p, ...loadProjects()];
        saveProjects(dehydrateKnown(next));
        setProjects(next);
        setView({ kind: 'project', id: p.id });
        alert(`📱 Проект «${p.name}» загружен по QR-коду!`);
      }).catch((error) => {
        alert(`Не удалось открыть проект по QR-коду: ${(error as Error).message}`);
      });
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
        setClients(res.merged.clients ?? []);
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
  const projectsForUi = useMemo(() => applyClientProfilesToProjects(projects, clients), [projects, clients]);

  useEffect(() => {
    const normalized = ensureClientProfiles(projects, clients, () => uid('cli'));
    if (!normalized.changed) return;
    saveProjects(dehydrateKnown(normalized.projects));
    saveClientProfiles(dehydrateKnown(normalized.clients));
    window.setTimeout(() => {
      setProjects(normalized.projects);
      setClients(normalized.clients);
    }, 0);
  }, [projects, clients]);

  const persistProjects = useCallback((next: Project[]) => {
    setProjects(next);
    // В браузер кладём лёгкую копию (фото — ссылками). На своём сервере браузерное
    // хранилище — лишь кэш, поэтому его переполнение ничего не значит и не тревожит.
    const storedOk = saveProjects(dehydrateKnown(next));
    if (!storedOk && !isStorageServerBacked()) {
      alert('Не удалось сохранить: закончилось место локального хранилища. Экспортируйте старые проекты в файл и удалите их.');
      return;
    }
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1200);
    if (isStorageServerBacked()) return;   // на сервер данные уходят отдельно
    const cfg = loadSyncConfig();
    if (cfg.enabled) {
      pushToCloud(cfg, { projects: next, clients: loadClientProfiles(), templates: loadTemplates(), settings: loadGlobalSettings() })
        .then((r) => setSyncStatus(r.ok ? 'synced' : 'offline'));
    }
  }, []);

  const persistClients = useCallback((next: ClientProfile[]) => {
    setClients(next);
    const storedOk = saveClientProfiles(dehydrateKnown(next));
    if (!storedOk && !isStorageServerBacked()) {
      alert('Не удалось сохранить базу клиентов: закончилось место локального хранилища.');
      return;
    }
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1200);
    if (isStorageServerBacked()) return;
    const cfg = loadSyncConfig();
    if (cfg.enabled) {
      pushToCloud(cfg, { projects: loadProjects(), clients: next, templates: loadTemplates(), settings: loadGlobalSettings() })
        .then((r) => setSyncStatus(r.ok ? 'synced' : 'offline'));
    }
  }, []);

  const persistNotifySettings = useCallback((next: NotifySettings) => {
    setNotifySettings(next);
    saveNotifySettings(next);
  }, []);

  const persistCalendarEvents = useCallback((next: CalendarEvent[]) => {
    setCalendarEvents(next);
    saveCalendarEvents(next);
  }, []);

    const persistKb = useCallback((next: KbArticle[]) => {
    setKbArticles(next);
    saveKbArticles(next);
  }, []);
const persistTemplates = useCallback((next: Template[]) => {
    setTemplates(next);
    saveTemplates(next);
    const cfg = loadSyncConfig();
    if (cfg.enabled) {
      pushToCloud(cfg, { projects: loadProjects(), clients: loadClientProfiles(), templates: next, settings: loadGlobalSettings() })
        .then((r) => setSyncStatus(r.ok ? 'synced' : 'offline'));
    }
  }, []);

  const persistSettings = useCallback((s: ProjectSettings) => {
    setGlobalSettings(s);
    saveGlobalSettings(s);
    const cfg = loadSyncConfig();
    if (cfg.enabled) {
      pushToCloud(cfg, { projects: loadProjects(), clients: loadClientProfiles(), templates: loadTemplates(), settings: s })
        .then((r) => setSyncStatus(r.ok ? 'synced' : 'offline'));
    }
  }, []);

  const persistStoredPricebooks = useCallback((next: Pricebook[]) => {
    setStored(next);
    if (!saveStoredPricebooks(next) && !isStorageServerBacked()) {
      alert('Прайс слишком большой для локального хранилища браузера. Он будет доступен до перезагрузки страницы; для постоянного использования положите JSON в app/public/data и пересоберите приложение.');
    }
  }, []);

  const chooseActivePb = useCallback((id: string) => {
    setActivePricebookId(id);
    localStorage.setItem('recept.activePb', id);
  }, []);

  const createProject = useCallback((data: { name: string; client: string; date: string; comment: string }, lines: Project['lines'] = [], modules?: Project['modules'], moduleDefaults?: Project['moduleDefaults']) => {
    if (!activePricebook) return;
    const tempProjectForClient = { client: data.client, clientOffer: {}, id: 'new', name: data.name || 'Без названия', comment: data.comment } as Project;
    let client = findClientForProject(tempProjectForClient, clients);
    let nextClients = clients;
    if (!client && data.client.trim()) {
      client = createClientProfileFromProject(tempProjectForClient, uid('cli'));
      nextClients = [client, ...clients];
      persistClients(nextClients);
    }
    const p: Project = {
      id: uid('prj'),
      name: data.name || 'Без названия',
      client: client?.name ?? data.client,
      clientId: client?.id,
      date: data.date || todayISO(),
      comment: data.comment,
      status: 'draft',
      pricebookId: activePricebook.meta.id,
      pricebookName: `${activePricebook.meta.name} (импорт ${activePricebook.meta.importedAt.slice(0, 10)})`,
      lines,
      modules: modules ?? [],
      moduleDefaults: moduleDefaults ?? {},
      wizardMode: 'wizard',
      wizardStep: 'data',
      settings: JSON.parse(JSON.stringify(globalSettings)),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    persistProjects([p, ...projects]);
    setView({ kind: 'project', id: p.id });

  }, [activePricebook, clients, globalSettings, projects, persistClients, persistProjects]);

  const updateProject = useCallback((p: Project) => {
    const current = projects.find((x) => x.id === p.id);
    if (current) projectHistory.push(current);
    let projectToSave = p;
    if (p.clientId) {
      const linkedClient = clients.find((client) => client.id === p.clientId);
      if (linkedClient) {
        const phones = [p.clientOffer?.clientPhone, ...(linkedClient.phones ?? [])].filter(Boolean) as string[];
        const emails = [p.clientOffer?.clientEmail, ...(linkedClient.emails ?? [])].filter(Boolean) as string[];
        const patched = mergeClientPatch(linkedClient, {
          name: p.client?.trim() || linkedClient.name,
          phones,
          emails,
          objectAddress: p.clientOffer?.clientAddress || linkedClient.objectAddress,
          passport: p.clientOffer?.clientPassport || linkedClient.passport,
          managerComment: p.orderWorkflow?.managerComment || linkedClient.managerComment,
        });
        persistClients(clients.map((client) => (client.id === patched.id ? patched : client)));
        projectToSave = applyClientProfileToProject(p, patched);
      }
    }
    persistProjects(projects.map((x) => (x.id === p.id ? { ...projectToSave, updatedAt: new Date().toISOString() } : x)));
  }, [clients, persistClients, projects, persistProjects, projectHistory]);

  const updateProjectWorkflow = useCallback((id: string, patch: Partial<OrderWorkflow>) => {
    const project = projects.find((item) => item.id === id);
    if (!project) return;
    const workflow = workflowForProject(project);
    const nextStatus = patch.status ? projectStatusForWorkflow(patch.status, project.status) : project.status;
    updateProject({
      ...project,
      status: nextStatus,
      orderWorkflow: { ...workflow, ...patch, updatedAt: new Date().toISOString() },
    });
    if (project.clientId) {
      const client = clients.find((item) => item.id === project.clientId);
      if (client && patch.status && patch.status !== workflow.status) {
        persistClients(clients.map((item) => item.id === client.id
          ? appendClientHistory(client, { kind: 'status', title: `Статус заказа: ${patch.status}`, projectId: project.id }, uid('hist'))
          : item));
      }
    }
  }, [clients, persistClients, projects, updateProject]);

  const undoProject = useCallback((id: string) => {
    const previous = projectHistory.undo(id);
    if (!previous) return;
    persistProjects(projects.map((x) => (x.id === id ? { ...previous, updatedAt: new Date().toISOString() } : x)));
  }, [projects, persistProjects, projectHistory]);

  const canUndoProject = useCallback((id: string) => projectHistory.canUndo(id), [projectHistory]);

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
    projectHistory.clear(id);
    persistProjects(projects.filter((p) => p.id !== id));
    setView({ kind: 'dashboard' });
  }, [projects, persistProjects, projectHistory]);

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

  // Ссылка клиенту: КП открывается без входа и без рабочего интерфейса.
  if (publicOfferId) {
    return (
      <>
        <ToastHost />
        <Suspense fallback={<div className="public-offer-state"><h1>Загружаем предложение…</h1></div>}>
          <PublicOfferPage id={publicOfferId} />
        </Suspense>
      </>
    );
  }
  if (workOrderId) {
    return (
      <>
        <ToastHost />
        <Suspense fallback={<div className="public-offer-state"><h1>Загружаем наряд…</h1></div>}>
          <WorkOrderPage id={workOrderId} />
        </Suspense>
      </>
    );
  }

  if (server.mode === 'checking') {
    return <div className="app-fatal app-boot">Подключаемся к серверу…</div>;
  }
  if (server.mode === 'server' && !server.user) {
    return (
      <ServerLogin
        needsSetup={server.needsSetup}
        error={server.error}
        onLogin={server.login}
        onSetup={server.setup}
      />
    );
  }
  if (loadError) {
    return <div className="app-fatal">Не удалось загрузить базу прайса: {loadError}</div>;
  }
  if (!activePricebook) {
    return <div className="app-fatal">Загрузка базы прайса…</div>;
  }

  const currentRaw = view.kind === 'project' ? projects.find((p) => p.id === view.id) : undefined;
  const current = currentRaw ? applyClientProfileToProject(currentRaw, findClientForProject(currentRaw, clients)) : undefined;

  return (
    <div className={`app work-mode-${workMode}`}>
      <ToastHost />
      {lastWork && view.kind !== 'project' && projects.some((item) => item.id === lastWork.id) && (
        <button type="button" className="resume-work no-print"
          title="Вернуться к последнему проекту"
          onClick={() => setView({ kind: 'project', id: lastWork.id, tab: lastWork.tab })}>
          <span>Продолжить</span>
          <b>{projects.find((item) => item.id === lastWork.id)?.name ?? 'проект'}</b>
        </button>
      )}
      <ServerSaveChip sync={server} onOpenServer={() => setView({ kind: 'server' })} />
      <InstallAppCard />
      {appVersion.hasUpdate && (
        <div className="app-update-bar" role="status">
          <span>Вышла новая версия калькулятора</span>
          <button type="button" onClick={appVersion.reload}>Обновить</button>
        </div>
      )}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-name">РЕцепт</div>
          <div className="brand-sub">J.A.R.V.I.S. kitchen operations</div>
          <div className="brand-pro">PRO</div>
        </div>
        <button type="button" className="global-command-button" onClick={() => setCommandOpen(true)} title="Глобальный поиск и действия: Ctrl+K">
          <span>⌘K</span>
          <b>Найти / выполнить</b>
          <small>{WORK_MODE_LABELS[workMode].label}</small>
        </button>
        <nav className="sidebar-nav" aria-label="Главная навигация">
          <div className="sidebar-nav-group">
            <div className="sidebar-nav-title">Работа</div>
            <button className={view.kind === 'dashboard' ? 'active' : ''} onClick={() => setView({ kind: 'dashboard' })}>
              <span className="nav-icon nav-projects" aria-hidden="true" />Проекты<span className="nav-count">{projects.length}</span>
            </button>
            {can.viewCrm && (
              <button className={view.kind === 'crm' ? 'active' : ''} onClick={() => setView({ kind: 'crm' })}>
                <span className="nav-icon nav-crm" aria-hidden="true" />CRM<span className="nav-count">{projects.length}</span>
              </button>
            )}
            {can.viewClientPrices && (
              <button className={view.kind === 'quick' ? 'active' : ''} onClick={() => setView({ kind: 'quick' })}>
                <span className="nav-icon nav-quick" aria-hidden="true" />Быстрый расчёт
              </button>
            )}
            {can.editProjects && (
              <button className={view.kind === 'factory' ? 'active' : ''} onClick={() => setView({ kind: 'factory' })}>
                <span className="nav-icon nav-factory" aria-hidden="true" />Бланк на фабрику
              </button>
            )}
            <button className={view.kind === 'schedule' ? 'active' : ''} onClick={() => setView({ kind: 'schedule' })}>
              <span className="nav-icon nav-schedule" aria-hidden="true" />График работ
            </button>
          </div>
          {(can.editProjects || can.viewPricebook) && (
            <div className="sidebar-nav-group">
              <div className="sidebar-nav-title">Справочники</div>
              <button className={view.kind === 'kb' ? 'active' : ''} onClick={() => setView({ kind: 'kb' })}>
                <span className="nav-icon nav-kb" aria-hidden="true" />База знаний<span className="nav-count">{kbArticles.length}</span>
              </button>
              {can.viewPricebook && (
                <button className={view.kind === 'pricebook' ? 'active' : ''} onClick={() => setView({ kind: 'pricebook' })}>
                  <span className="nav-icon nav-price" aria-hidden="true" />Прайс и версии
                </button>
              )}
            </div>
          )}
          <div className="sidebar-nav-group">
            <div className="sidebar-nav-title">Система</div>
            {can.viewCost && (
              <button className={view.kind === 'analytics' ? 'active' : ''} onClick={() => setView({ kind: 'analytics' })}>
                <span className="nav-icon nav-analytics" aria-hidden="true" />Аналитика
              </button>
            )}
            {can.viewCost && (
              <button className={view.kind === 'audit' ? 'active' : ''} onClick={() => setView({ kind: 'audit', id: current?.id })}>
                <span className="nav-icon nav-price" aria-hidden="true" />Проверка цен
              </button>
            )}
            <button className={view.kind === 'sync' ? 'active' : ''} onClick={() => setView({ kind: 'sync' })}>
              <span className="nav-icon nav-sync" aria-hidden="true" />Синхронизация
              {showSyncBadge && (
                <span className={`nav-sync-badge ${syncBadgeState}`} title={`Синхронизация: ${syncBadgeState === 'synced' ? 'в сети' : syncBadgeState === 'syncing' ? 'обновление...' : 'офлайн'}`} />
              )}
            </button>
            {server.mode === 'server' && (
              <button className={view.kind === 'server' ? 'active' : ''} onClick={() => setView({ kind: 'server' })}>
                <span className="nav-icon nav-sync" aria-hidden="true" />Сервер
                <span className={`nav-sync-badge ${server.status === 'synced' ? 'synced' : server.status === 'saving' || server.status === 'loading' ? 'syncing' : 'offline'}`} title={`Сервер: ${server.status}`} />
              </button>
            )}
            <button className={view.kind === 'settings' ? 'active' : ''} onClick={() => setView({ kind: 'settings' })}>
              <span className="nav-icon nav-settings" aria-hidden="true" />Настройки
            </button>
          </div>
        </nav>
        <div className="sidebar-foot">
          <div className="pb-badge" title={activePricebook.meta.sourceFile}>
            Прайс: <b>{activePricebook.meta.name}</b>
            <span>{activePricebook.meta.itemCount} позиций</span>
          </div>
          {savedFlash && <div className="saved-flash">Сохранено ✓</div>}
        </div>
      </aside>
      <main className="main" id="main-workspace">
        <Suspense fallback={<div className="section-loading">Загружаем раздел…</div>}>
        {view.kind === 'dashboard' && (
          <Dashboard
            pricebooks={pricebooks}
            projects={projectsForUi}
            clients={clients}
            onOpen={(id) => setView({ kind: 'project', id })}
            onCreate={createProject}
            onDuplicate={duplicateProject}
            onDelete={deleteProject}
            onStatusChange={(id, status) => {
              const project = projects.find((item) => item.id === id);
              if (project) updateProject({ ...project, status });
            }}
            onImport={importProject}
            onQuick={() => setView({ kind: 'quick' })}
            onOpenCrm={() => setView({ kind: 'crm' })}
            events={calendarEvents}
            me={server.user?.name || server.user?.login || ''}
            onOpenSchedule={() => setView({ kind: 'schedule' })}
            onOpenSync={() => setView({ kind: 'sync' })}
            pricebookLabel={`${activePricebook.meta.name} · импорт ${activePricebook.meta.importedAt.slice(0, 10)}`}
          />
        )}
        {view.kind === 'crm' && !can.viewCrm && (
          <div className="app-no-access">CRM доступна менеджеру и владельцу.</div>
        )}
        {view.kind === 'crm' && can.viewCrm && (
          <CrmView
            projects={projectsForUi}
            clients={clients}
            pricebooks={pricebooks}
            onOpen={(id) => setView({ kind: 'project', id })}
            onProjectChange={updateProject}
            onWorkflowChange={updateProjectWorkflow}
            onClientChange={(client) => {
              // Новый клиент добавляется, существующий — обновляется.
              const exists = clients.some((item) => item.id === client.id);
              persistClients(exists ? clients.map((item) => (item.id === client.id ? client : item)) : [client, ...clients]);
            }}
            onClientHistory={(clientId, entry) => {
              const client = clients.find((item) => item.id === clientId);
              if (client) persistClients(clients.map((item) => item.id === clientId ? appendClientHistory(client, entry, uid('hist')) : item));
            }}
            onCreateDeal={(clientName) => {
              const name = prompt('Название нового расчёта:', `Кухня ${clientName}`)?.trim();
              if (!name) return;
              createProject({ name, client: clientName, date: todayISO(), comment: '' });
              toast.ok('Сделка создана — открываю список проектов');
              setView({ kind: 'dashboard' });
            }}
            onOpenSchedule={() => setView({ kind: 'schedule' })}
            onMergeClients={(targetId, sourceId) => {
              const target = clients.find((item) => item.id === targetId);
              const source = clients.find((item) => item.id === sourceId);
              if (!target || !source || target.id === source.id) return;
              const merged = mergeClientProfiles(target, source);
              persistClients([merged, ...clients.filter((item) => item.id !== targetId && item.id !== sourceId)]);
              persistProjects(projects.map((project) => project.clientId === sourceId ? { ...project, clientId: targetId, client: merged.name } : project));
            }}
          />
        )}
        {view.kind === 'analytics' && (can.viewCost
          ? <AnalyticsView projects={projectsForUi} pricebooks={pricebooks} />
          : <div className="app-no-access">Аналитика доступна владельцу: в ней видны закупочные цены и маржа.</div>)}
        {view.kind === 'audit' && !can.viewCost && (
          <div className="app-no-access">Проверка цен доступна владельцу: в ней видна закупка и маржа.</div>
        )}
        {view.kind === 'audit' && can.viewCost && (
          <PriceAuditView
            projects={projectsForUi}
            pricebooks={pricebooks}
            initialProjectId={view.id ?? current?.id}
            onOpen={(id) => setView({ kind: 'project', id })}
          />
        )}
        {view.kind === 'schedule' && (
          <ScheduleView
            projects={projectsForUi}
            events={calendarEvents}
            me={server.user?.name || server.user?.login || ''}
            onEventsChange={persistCalendarEvents}
            onOpen={(id) => setView({ kind: 'project', id })}
            onProjectChange={updateProject}
          />
        )}
        {view.kind === 'server' && (
          <ServerPanel
            sync={server}
            workspace={{ projects, clients, templates, settings: globalSettings, pricebooks: stored, knowledge: kbArticles, events: calendarEvents }}
            onRestored={applyWorkspace}
          />
        )}
        {view.kind === 'sync' && (
          <SyncPanel
            server={server}
            projects={projectsForUi}
            clients={clients}
            templates={templates}
            settings={globalSettings}
            syncStatus={syncStatus}
            onSetSyncStatus={setSyncStatus}
            onSyncUpdated={(data) => {
              setProjects(data.projects);
              setClients(data.clients ?? []);
              setTemplates(data.templates);
              setGlobalSettings(data.settings);
              setSyncConfig(loadSyncConfig());
            }}
          />
        )}
        {view.kind === 'project' && current && (
          <ProjectEditor
            key={`${current.id}:${view.tab ?? 'auto'}`}
            project={current}
            pricebook={pricebooks.find((pb) => pb.meta.id === current.pricebookId) ?? activePricebook}
            onChange={updateProject}
            onUndo={() => undoProject(current.id)}
            canUndo={canUndoProject(current.id)}
            onBack={() => setView({ kind: 'dashboard' })}
            onDuplicate={() => duplicateProject(current.id)}
            initialTab={view.tab}
            clientProfile={findClientForProject(currentRaw ?? current, clients) ?? null}
            onOpenCrm={() => setView({ kind: 'crm' })}
            onDelete={() => deleteProject(current.id)}
            templates={templates}
            onOpenFactoryBlank={() => setView({ kind: 'factory', id: current.id })}
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
            settings={globalSettings}
            templates={templates}
            onDeleteTemplate={(id) => persistTemplates(templates.filter((t) => t.id !== id))}
            onCreateProject={createProject}
          />
        )}
        {view.kind === 'factory' && (
          <FactoryBlankView
            projects={projectsForUi}
            pricebooks={pricebooks}
            initialProjectId={view.kind === 'factory' ? view.id : undefined}
            onOpenProject={(id) => setView({ kind: 'project', id })}
            onChangeProject={updateProject}
          />
        )}
        {view.kind === 'kb' && (
          <KnowledgeView articles={kbArticles} pricebooks={pricebooks} onChange={persistKb} />
        )}
        {view.kind === 'settings' && (
          <>
            <NotifySettingsCard value={notifySettings} onChange={persistNotifySettings} />
            {can.manageUsers && server.mode === 'server' && <TelegramNotifyCard />}
            <SettingsPanel
              title="Настройки по умолчанию (для новых проектов)"
              settings={globalSettings}
              onChange={persistSettings}
              standalone
            />
          </>
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
        </Suspense>
      </main>
      {moreOpen && (
        <div className="dock-sheet-layer" onClick={() => setMoreOpen(false)}>
          <div
            className="dock-sheet"
            role="menu"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dock-sheet-grip" aria-hidden="true" />
            {dockMenuItems.map((item) => (
              <button
                key={item.key}
                type="button"
                className={view.kind === item.key ? 'active' : ''}
                // Срабатывает и по pointerup, и по click: на части телефонов
                // click до кнопки не доходит, если палец чуть сместился.
                onPointerUp={(event) => { event.stopPropagation(); item.open(); }}
                onClick={(event) => { event.stopPropagation(); item.open(); }}
              >
                {item.label} <span>{item.hint}</span>
              </button>
            ))}
            <button type="button" className="dock-sheet-close"
              onPointerUp={(event) => { event.stopPropagation(); setMoreOpen(false); }}
              onClick={(event) => { event.stopPropagation(); setMoreOpen(false); }}>
              Закрыть
            </button>
          </div>
        </div>
      )}

      <nav className="mobile-app-dock no-print" aria-label="Быстрый переход по приложению">
        <button type="button" className={view.kind === 'dashboard' || view.kind === 'project' ? 'active' : ''} onClick={() => setView({ kind: 'dashboard' })}>
          <span className="nav-icon nav-projects" aria-hidden="true" />
          <b>Проекты</b>
          <small>{projects.length}</small>
        </button>
        <button type="button" className={view.kind === 'crm' ? 'active' : ''} onClick={() => setView({ kind: 'crm' })}>
          <span className="nav-icon nav-crm" aria-hidden="true" />
          <b>CRM</b>
          <small>клиенты</small>
        </button>
        <button type="button" className={view.kind === 'quick' ? 'active' : ''} onClick={() => setView({ kind: 'quick' })}>
          <span className="nav-icon nav-quick" aria-hidden="true" />
          <b>Быстрый</b>
          <small>оценка</small>
        </button>
        <button type="button" className={view.kind === 'factory' ? 'active' : ''} onClick={() => setView({ kind: 'factory', id: current?.id })}>
          <span className="nav-icon nav-factory" aria-hidden="true" />
          <b>Фабрика</b>
          <small>бланк</small>
        </button>
        <div className="mobile-dock-more">
          <button
            type="button"
            aria-expanded={moreOpen}
            aria-haspopup="menu"
            className={(['kb', 'pricebook', 'sync', 'settings', 'schedule', 'analytics', 'audit', 'server'] as string[]).includes(view.kind) ? 'active' : ''}
            onClick={() => setMoreOpen((open) => !open)}
          >
            <span className="nav-icon nav-settings" aria-hidden="true" />
            <b>Ещё</b>
            <small>{moreOpen ? 'закрыть' : 'меню'}</small>
          </button>
        </div>
      </nav>
      <CommandPalette
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        projects={projectsForUi}
        clients={clients}
        pricebooks={pricebooks}
        activePricebook={activePricebook}
        kbArticles={kbArticles}
        currentProject={current ?? null}
        workMode={workMode}
        onWorkModeChange={setWorkMode}
        onOpenDashboard={() => setView({ kind: 'dashboard' })}
        onOpenCrm={() => setView({ kind: 'crm' })}
        onOpenQuick={() => setView({ kind: 'quick' })}
        onOpenFactory={(projectId) => setView({ kind: 'factory', id: projectId })}
        onOpenKb={() => setView({ kind: 'kb' })}
        onOpenSettings={() => setView({ kind: 'settings' })}
        onOpenPricebook={() => setView({ kind: 'pricebook' })}
        onOpenSync={() => setView({ kind: 'sync' })}
        onOpenProject={(id, tab) => setView({ kind: 'project', id, tab })}
      />
      <NumberFieldCalculator />
    </div>
  );
}
