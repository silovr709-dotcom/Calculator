import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EskizProIntegration, KitchenModule, Pricebook, PriceItem, Project, SlotKey } from '../types';
import {
  ESKIZ_PRO_URL,
  collectEskizModuleMarkers,
  isEskizProject,
  listEskizProjects,
  loadEskizProject,
  readEskizFile,
  snapshotProject,
  syncEskizModulesToCalculation,
  upsertEskizSnapshot,
  type EskizModuleMarker,
  type EskizModuleObject,
  type EskizProject,
  type EskizProjectSummary,
} from '../lib/eskizPro';
import { MODULE_TYPES, SLOT_LABELS, SLOT_POOLS, checkModule, moduleToLines, slotNeed } from '../lib/modules';
import { calcLines } from '../lib/engine';
import { fmtMoney, fmtNum } from '../lib/format';
import EskizProjectPreview from './EskizProjectPreview';

const EMPTY_LINKS: string[] = [];
const EMPTY_SNAPSHOTS: NonNullable<EskizProIntegration['snapshots']> = [];
const EMPTY_BINDINGS: NonNullable<EskizProIntegration['moduleBindings']> = {};
const EMPTY_ESKIZ_PRO: EskizProIntegration = {};
const QUICK_SLOTS: SlotKey[] = ['body', 'facade', 'frame', 'hinge', 'drawerSys', 'lift', 'handle', 'shelf', 'legs'];

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

function itemTitle(item: PriceItem) {
  return `${item.name}${item.article ? ` · ${item.article}` : ''}${item.price != null ? ` · ${fmtMoney(item.price)}` : ''}`;
}

function numberValue(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function shortLine(text: string, length = 76) {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function EskizMarkerModuleEditor(props: {
  marker: EskizModuleMarker;
  module: KitchenModule;
  pricebook: Pricebook;
  defaults: Partial<Record<SlotKey, string | null>>;
  onModuleChange: (moduleId: string, patch: Partial<KitchenModule>) => void;
  onOpenFull?: (moduleId: string) => void;
}) {
  const { marker, module, pricebook, defaults } = props;
  const slotOptions = useMemo(() => Object.fromEntries(QUICK_SLOTS.map((slot) => [
    slot,
    pricebook.items
      .filter(SLOT_POOLS[slot])
      .filter((item) => item.priceKind === 'fixed')
      .sort((a, b) => `${a.category} ${a.name}`.localeCompare(`${b.category} ${b.name}`, 'ru')),
  ])) as Record<SlotKey, PriceItem[]>, [pricebook]);
  const [slotQueries, setSlotQueries] = useState<Partial<Record<SlotKey, string>>>({});
  const check = useMemo(() => checkModule(module, defaults, pricebook), [module, defaults, pricebook]);
  const lines = useMemo(() => moduleToLines(module, defaults, pricebook), [module, defaults, pricebook]);
  const lineCalcs = useMemo(() => calcLines(lines), [lines]);
  const cost = lines.reduce((sum, line) => sum + (lineCalcs.get(line.id)?.sum ?? 0), 0);
  const update = (patch: Partial<KitchenModule>) => props.onModuleChange(module.id, patch);
  const updateNum = (key: keyof KitchenModule, value: string) => update({ [key]: numberValue(value) } as Partial<KitchenModule>);
  const updateCount = (key: keyof KitchenModule, value: string) => update({ [key]: Number(value) || 0 } as Partial<KitchenModule>);
  const updateSlot = (slot: SlotKey, value: string) => update({
    slots: {
      ...module.slots,
      [slot]: value === '__default__' ? { mode: 'default', itemId: null } : { mode: 'manual', itemId: value || null },
    },
  });
  const selectedItem = (slot: SlotKey) => {
    const choice = module.slots[slot] ?? { mode: 'default' as const, itemId: null };
    const id = choice.mode === 'manual' ? choice.itemId : (defaults[slot] ?? null);
    return id ? pricebook.items.find((item) => item.id === id) ?? null : null;
  };
  const visibleSlotOptions = (slot: SlotKey) => {
    const query = (slotQueries[slot] ?? '').trim().toLocaleLowerCase('ru').replace(/ё/g, 'е');
    const options = slotOptions[slot];
    if (!query) return options.slice(0, slot === 'body' ? 120 : 180);
    const words = query.split(/\s+/).filter(Boolean);
    return options.filter((item) => {
      const text = `${item.name} ${item.article ?? ''} ${item.category} ${item.subcategory ?? ''}`.toLocaleLowerCase('ru').replace(/ё/g, 'е');
      return words.every((word) => text.includes(word));
    }).slice(0, 160);
  };
  return (
    <div className="eskiz-marker-editor">
      <div className="eskiz-marker-editor-head">
        <div><span className="eyebrow">Маркер {marker.number}</span><h4>{module.name}</h4><p className="muted small">Выберите конкретный корпус и комплектующие из прайса — эти позиции сразу становятся составом модуля и участвуют в просчёте.</p></div>
        {props.onOpenFull && <button className="btn tiny ghost" onClick={() => props.onOpenFull?.(module.id)}>Полная карточка</button>}
      </div>
      <div className="eskiz-module-form-grid">
        <label>Название<input value={module.name} onChange={(event) => update({ name: event.target.value })} /></label>
        <label>Тип<select value={module.type} onChange={(event) => update({ type: event.target.value })}>{MODULE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}{!MODULE_TYPES.some((type) => type === module.type) && <option value={module.type}>{module.type}</option>}</select></label>
        <label>Кол-во<input type="number" min="0" step="1" value={module.qty} onChange={(event) => updateCount('qty', event.target.value)} /></label>
        <label>Ширина, мм<input type="number" value={module.widthMm ?? ''} onChange={(event) => updateNum('widthMm', event.target.value)} /></label>
        <label>Высота, мм<input type="number" value={module.heightMm ?? ''} onChange={(event) => updateNum('heightMm', event.target.value)} /></label>
        <label>Глубина, мм<input type="number" value={module.depthMm ?? ''} onChange={(event) => updateNum('depthMm', event.target.value)} /></label>
        <label>Фасады<input type="number" min="0" value={module.facades} onChange={(event) => updateCount('facades', event.target.value)} /></label>
        <label>Ящики<input type="number" min="0" value={module.drawers} onChange={(event) => updateCount('drawers', event.target.value)} /></label>
        <label>Полки<input type="number" min="0" value={module.shelves} onChange={(event) => updateCount('shelves', event.target.value)} /></label>
        <label>Петли<input type="number" min="0" value={module.hinges} onChange={(event) => updateCount('hinges', event.target.value)} /></label>
        <label>Подъёмники<input type="number" min="0" value={module.lifts} onChange={(event) => updateCount('lifts', event.target.value)} /></label>
        <label>Ручки<input type="number" min="0" value={module.handles} onChange={(event) => updateCount('handles', event.target.value)} /></label>
        <label>Опоры<input type="number" min="0" value={module.legs ?? 0} onChange={(event) => updateCount('legs', event.target.value)} /></label>
        <label>Фасад Ш, мм<input type="number" value={module.facadeWmm ?? ''} onChange={(event) => updateNum('facadeWmm', event.target.value)} /></label>
        <label>Фасад В, мм<input type="number" value={module.facadeHmm ?? ''} onChange={(event) => updateNum('facadeHmm', event.target.value)} /></label>
      </div>
      <div className="eskiz-slot-picker">
        {QUICK_SLOTS.map((slot) => {
          const choice = module.slots[slot] ?? { mode: 'default' as const, itemId: null };
          const current = selectedItem(slot);
          const value = choice.mode === 'default' ? '__default__' : choice.itemId ?? '';
          return (
            <label key={slot} className={slot === 'body' ? 'primary-slot' : ''}>
              <span>{SLOT_LABELS[slot]} <em>×{slotNeed(module, slot)}</em></span>
              <input className="slot-search" value={slotQueries[slot] ?? ''} onChange={(event) => setSlotQueries((current) => ({ ...current, [slot]: event.target.value }))} placeholder={slot === 'body' ? 'Быстрый поиск корпуса: НБ 800, мойка, пенал…' : 'Фильтр по прайсу…'} />
              <select value={value} onChange={(event) => updateSlot(slot, event.target.value)}>
                {slot !== 'body' && <option value="__default__">Из настроек проекта{defaults[slot] ? ` · ${shortLine(pricebook.items.find((item) => item.id === defaults[slot])?.name ?? 'позиция')}` : ' · не задано'}</option>}
                <option value="">— не использовать —</option>
                {visibleSlotOptions(slot).map((item) => <option key={item.id} value={item.id}>{shortLine(itemTitle(item), 118)}</option>)}
              </select>
              {current && <small>{current.category}{current.subcategory ? ` · ${current.subcategory}` : ''}{current.priceBasis ? ` · ${current.priceBasis}` : ''}</small>}
            </label>
          );
        })}
      </div>
      <div className={`eskiz-module-check ${check.level}`}>
        <b>{check.level === 'ok' ? 'Готово к расчёту' : check.level === 'warn' ? 'Есть предупреждения' : 'Нужно заполнить'}</b>
        {[...check.errors, ...check.warnings].slice(0, 5).map((text) => <span key={text}>• {text}</span>)}
      </div>
      <div className="eskiz-module-lines">
        <b>В состав уйдёт: {lines.length} строк · {fmtMoney(cost)}</b>
        {lines.slice(0, 6).map((line) => <span key={line.id}>{shortLine(line.name, 54)} · {fmtNum(lineCalcs.get(line.id)?.qtyEffective ?? line.qty)} {line.unit ?? ''}</span>)}
        {lines.length > 6 && <span>+ ещё {lines.length - 6} строк</span>}
      </div>
    </div>
  );
}

export default function EskizProPanel(props: { project: Project; pricebook: Pricebook; onChange: (project: Project) => void; onOpenModule?: (moduleId: string) => void }) {
  const { project, pricebook, onChange } = props;
  const eskizPro = project.eskizPro ?? EMPTY_ESKIZ_PRO;
  const linkedIds = eskizPro.linkedProjectIds ?? EMPTY_LINKS;
  const snapshots = eskizPro.snapshots ?? EMPTY_SNAPSHOTS;
  const [summaries, setSummaries] = useState<EskizProjectSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [frameKey, setFrameKey] = useState(0);
  const [activeMarkerKey, setActiveMarkerKey] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const liveSyncRef = useRef('');
  const linkedProjects = useMemo(() => linkedIds
    .map((id) => snapshotProject(snapshots.find((item) => item.id === id)))
    .filter((item): item is NonNullable<typeof item> => Boolean(item)), [linkedIds, snapshots]);
  const activeId = eskizPro.activeProjectId && linkedIds.includes(eskizPro.activeProjectId) ? eskizPro.activeProjectId : linkedIds[0] ?? null;
  const showInClient = eskizPro.showInClient !== false;
  const clientMode = eskizPro.clientMode ?? 'active';
  const moduleMarkers = useMemo(() => collectEskizModuleMarkers(linkedProjects), [linkedProjects]);
  const moduleBindings = eskizPro.moduleBindings ?? EMPTY_BINDINGS;
  const linkedModuleCount = moduleMarkers.filter((marker) => Boolean(moduleBindings[marker.key])).length;
  const activeMarker = moduleMarkers.find((marker) => marker.key === activeMarkerKey) ?? null;
  const activeModuleId = activeMarker ? moduleBindings[activeMarker.key] : null;
  const activeModule = activeModuleId ? project.modules?.find((module) => module.id === activeModuleId) ?? null : null;

  const updateEskizPro = useCallback((patch: Partial<EskizProIntegration>) => onChange({ ...project, eskizPro: { ...eskizPro, ...patch } }), [onChange, project, eskizPro]);

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
    onChange(result.project);
    setMessage(result.markers.length
      ? `Модули из Эскиз PRO синхронизированы: создано ${result.created}, обновлено ${result.updated}. Они уже участвуют в просчёте, КП и проверке.`
      : 'В связанных эскизах нет объектов «Модуль». Добавьте в Эскиз PRO модуль как маркер/плашку и заполните его описание.');
  };

  const syncLiveProjectModule = useCallback((eskizProject: EskizProject, objectId?: string) => {
    const liveMarkers = collectEskizModuleMarkers([eskizProject]);
    const marker = liveMarkers.find((item) => item.objectId === objectId) ?? liveMarkers.at(-1);
    if (!marker) {
      setMessage('В живом Эскиз PRO выбран не модуль. Поставьте объект «Модуль» на скрин — он сразу появится в просчёте.');
      return;
    }
    const baseProject: Project = {
      ...project,
      eskizPro: {
        ...eskizPro,
        linkedProjectIds: unique([eskizProject.id, ...linkedIds]),
        activeProjectId: eskizProject.id,
        showInClient,
        clientMode,
        snapshots: upsertEskizSnapshot(snapshots, eskizProject),
      },
    };
    const result = syncEskizModulesToCalculation(baseProject, [eskizProject]);
    onChange(result.project);
    setActiveMarkerKey(marker.key);
    setMessage(`Маркер «${marker.number}» выбран прямо в живом Эскиз PRO. Справа выберите корпус из прайса и комплектующие — модуль уже добавлен в просчёт.`);
  }, [project, eskizPro, linkedIds, showInClient, clientMode, snapshots, onChange]);

  const openMarkerModule = (marker: EskizModuleMarker) => {
    const alreadyLinked = Boolean(moduleBindings[marker.key]);
    if (alreadyLinked) {
      setActiveMarkerKey(marker.key);
      setMessage(`Открыт маркер «${marker.number}»: можно выбрать корпус и комплектующие из прайса.`);
      return;
    }
    const result = syncEskizModulesToCalculation(project, linkedProjects);
    onChange(result.project);
    setActiveMarkerKey(marker.key);
    setMessage(`Для маркера «${marker.number}» создана позиция расчёта. Теперь выберите корпус, фасады и фурнитуру из прайса.`);
  };

  const handlePreviewModuleClick = (eskizId: string, object: EskizModuleObject) => {
    const marker = moduleMarkers.find((item) => item.eskizId === eskizId && item.objectId === object.id);
    if (marker) openMarkerModule(marker);
  };

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const payload = event.data as { source?: string; type?: string; project?: unknown; objectId?: string; object?: { id?: string; type?: string } };
      if (payload?.source !== 'recept-eskiz-pro') return;
      if (payload.type !== 'module-selected' && payload.type !== 'project-saved') return;
      if (!isEskizProject(payload.project)) return;
      if (payload.type === 'project-saved') {
        if (!linkedIds.includes(payload.project.id)) return;
        updateEskizPro({ snapshots: upsertEskizSnapshot(snapshots, payload.project) });
        return;
      }
      const objectId = payload.object?.type === 'module' ? payload.object.id : payload.objectId;
      syncLiveProjectModule(payload.project, objectId);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [linkedIds, snapshots, updateEskizPro, syncLiveProjectModule]);

  useEffect(() => {
    if (!sameGithubPagesOrigin()) return undefined;
    let stopped = false;
    const tick = async () => {
      try {
        const nextSummaries = await listEskizProjects();
        if (stopped) return;
        setSummaries(nextSummaries);
        const candidates = unique([activeId ?? '', ...linkedIds, nextSummaries[0]?.id ?? '']);
        for (const id of candidates) {
          const found = await loadEskizProject(id);
          if (stopped || !found) continue;
          const markers = collectEskizModuleMarkers([found]);
          if (markers.length === 0) continue;
          const unbound = markers.find((marker) => !moduleBindings[marker.key]);
          const marker = unbound ?? markers.at(-1);
          const signature = `${found.id}:${found.updatedAt}:${markers.map((item) => item.objectId).join(',')}:${unbound?.objectId ?? ''}`;
          if (liveSyncRef.current === signature || !marker) return;
          liveSyncRef.current = signature;
          syncLiveProjectModule(found, marker.objectId);
          return;
        }
      } catch {
        // В preview или при запрете IndexedDB живой режим просто молчит — остаётся ручной импорт .eskiz.
      }
    };
    void tick();
    const interval = window.setInterval(() => { void tick(); }, 2500);
    return () => { stopped = true; window.clearInterval(interval); };
  }, [activeId, linkedIds, moduleBindings, syncLiveProjectModule]);

  const updateModule = (moduleId: string, patch: Partial<KitchenModule>) => {
    onChange({
      ...project,
      modules: (project.modules ?? []).map((module) => (module.id === moduleId ? { ...module, ...patch } : module)),
    });
  };

  return (
    <section className="eskiz-pro-workspace">
      <div className="card eskiz-pro-intro no-print">
        <div>
          <span className="eyebrow">ЭСКИЗ PRO</span>
          <h3>Внешний инструмент для скрина проекта, размеров и модулей-маркеров</h3>
          <p className="muted small">Откройте настоящий Эскиз PRO, загрузите скрин, нанесите размеры/подписи и добавьте объект «Модуль» как точку/сноску. Теперь при выборе этого маркера прямо в окне Эскиз PRO калькулятор сразу создаёт модуль в просчёте и открывает выбор корпуса/фурнитуры из прайса.</p>
        </div>
        <div className="actions">
          <a className="btn ghost" href={ESKIZ_PRO_URL} target="_blank" rel="noreferrer">Открыть в новой вкладке</a>
          <button className="btn ghost" onClick={() => setFrameKey((value) => value + 1)}>Перезагрузить окно</button>
          <button className="btn primary" disabled={loading} onClick={refresh}>Обновить список</button>
        </div>
      </div>

      {!sameGithubPagesOrigin() && (
        <div className="note no-print">В live preview Эскиз PRO открыт с другого origin, поэтому браузер может не дать калькулятору читать его IndexedDB. На основной ссылке GitHub Pages оба приложения находятся на <b>silovr709-dotcom.github.io</b>, и живое добавление модулей работает напрямую. Для локальной проверки можно импортировать файл <b>.eskiz</b>.</div>
      )}

      <div className="eskiz-pro-grid">
        <div className="card eskiz-pro-frame-card no-print">
          <div className="section-head">
            <div><h3>Окно Эскиз PRO</h3><p className="muted small">Загрузите скрин, поставьте объект «Модуль» на нужное место и кликните по нему. Справа откроется выбор корпуса из прайса, а позиция сразу уйдёт в просчёт.</p></div>
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
              <div><b>{sameGithubPagesOrigin() ? 'Да' : 'Preview'}</b><span>живой режим</span></div>
            </div>
            <div className="actions eskiz-pro-import-actions">
              <button className="btn ghost" onClick={() => fileRef.current?.click()}>Импорт .eskiz</button>
              <input ref={fileRef} type="file" accept=".eskiz,application/json" hidden onChange={(event) => void importFile(event.target.files?.[0] ?? null)} />
            </div>
            {message && <div className="eskiz-pro-message muted small">{message}</div>}
          </section>

          <section className="card no-print eskiz-pro-module-sync">
            <div className="section-head"><div><h3>Модули с эскиза → просчёт</h3><p className="muted small">Поставьте модуль в живом окне Эскиз PRO и кликните его: здесь сразу откроется карточка с поиском корпуса из прайса. Описание маркера можно оставить коротким — состав выбирается из прайса ниже.</p></div></div>
            <div className="eskiz-pro-module-stats"><div><b>{moduleMarkers.length}</b><span>маркеров</span></div><div><b>{linkedModuleCount}</b><span>уже связаны</span></div><div><b>{Math.max(0, moduleMarkers.length - linkedModuleCount)}</b><span>новые</span></div></div>
            <button className="btn primary block" disabled={moduleMarkers.length === 0} onClick={syncModulesToCalculation}>Создать / обновить модули в расчёте</button>
            {moduleMarkers.length === 0 ? <div className="empty small">В привязанных эскизах пока нет объектов «Модуль».</div> : (
              <div className="eskiz-pro-marker-list">
                {moduleMarkers.slice(0, 8).map((marker) => {
                  const moduleId = moduleBindings[marker.key];
                  const linkedModule = moduleId ? project.modules?.find((module) => module.id === moduleId) : null;
                  return <div className={activeMarkerKey === marker.key ? 'active' : ''} key={marker.key}><b>{marker.number}</b><span>{marker.description || 'без описания'}{linkedModule ? ` → ${linkedModule.name}` : ' → будет создан'}</span><button className="btn tiny ghost" onClick={() => openMarkerModule(marker)}>{linkedModule ? 'Настроить здесь' : 'Создать и настроить'}</button>{linkedModule && props.onOpenModule && <button className="btn tiny ghost" onClick={() => props.onOpenModule?.(linkedModule.id)}>Полная карточка</button>}</div>;
                })}
                {moduleMarkers.length > 8 && <div><b>+{moduleMarkers.length - 8}</b><span>ещё модулей</span></div>}
              </div>
            )}
            {activeMarker && activeModule && (
              <EskizMarkerModuleEditor
                marker={activeMarker}
                module={activeModule}
                pricebook={pricebook}
                defaults={project.moduleDefaults ?? {}}
                onModuleChange={updateModule}
                onOpenFull={props.onOpenModule}
              />
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
                      {previewProject && <EskizProjectPreview project={previewProject} compact activeModuleKey={activeMarkerKey} moduleBindings={moduleBindings} onModuleClick={handlePreviewModuleClick} />}
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
          {linkedProjects.map((item) => <EskizProjectPreview key={item.id} project={item} activeModuleKey={activeMarkerKey} moduleBindings={moduleBindings} onModuleClick={handlePreviewModuleClick} />)}
        </section>
      )}
    </section>
  );
}
