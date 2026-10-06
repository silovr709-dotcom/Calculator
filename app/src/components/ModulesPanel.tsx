import { useEffect, useMemo, useRef, useState } from 'react';
import type { ExtraFacadePart, KitchenModule, KitchenWall, ModuleDefaults, Pricebook, PriceItem, Project, SlotKey, Template } from '../types';
import { MODULE_PRESETS, MODULE_TYPES, SLOT_LABELS, SLOT_POOLS, checkModule, moduleFromPreset, moveModule, modulesSummary, moduleToLines, newModule, resolveSlot, setWarningConfirmed, slotNeed } from '../lib/modules';
import { calcTotals } from '../lib/engine';
import { applyTechnicalFacadeSpec, inferFacadeSpec, inferHingeSpec, isTechnicalFacadeSpecOutdated, isTechnicalHingeSpecOutdated } from '../lib/facades';
import { applyDimensionSurcharges, inferDimensionSurcharges } from '../lib/surcharges';
import { fmtMoney, fmtNum } from '../lib/format';
import { LAYOUT_SHAPES, WALL_LABELS, WALL_SHORT_LABELS, layoutWalls, moduleWall, normalizeLayoutShape } from '../lib/kitchenSketch';
import CatalogPicker from './CatalogPicker';
import WallPlanner from './WallPlanner';
import BulkEditPanel from './BulkEditPanel';
import { fillFromAbove } from '../lib/bulkEdit';
import { KITCHEN_SETS, modulesFromKitchenSet } from '../lib/kitchenSets';
import { stripModuleNote } from '../lib/clientOffer';

const DEFAULT_SLOTS: SlotKey[] = ['facade', 'frame', 'hinge', 'drawerSys', 'lift', 'handle', 'shelf', 'legs'];
/** Предупреждение → слот, который можно сразу открыть кнопкой-действием. */
const WARNING_SLOT: Partial<Record<string, { slot: SlotKey; label: string }>> = {
  legs: { slot: 'legs', label: 'Выбрать опору…' },
  handles: { slot: 'handle', label: 'Выбрать ручку…' },
  shelves: { slot: 'shelf', label: 'Выбрать полку…' },
};
const ALL_SLOTS: SlotKey[] = ['body', 'facade', 'frame', 'hinge', 'drawerSys', 'lift', 'handle', 'shelf', 'legs'];
const EMPTY_MODULES: KitchenModule[] = [];
const EMPTY_DEFAULTS: ModuleDefaults = {};

export default function ModulesPanel(props: {
  project: Project;
  pricebook: Pricebook;
  onChange: (p: Project) => void;
  templates?: Template[];
  onSaveModuleTemplate?: (name: string, module: KitchenModule) => void;
  /** Модуль, который нужно открыть по клику с эскиза. */
  focusModuleId?: string | null;
}) {
  const { project, pricebook } = props;
  const mods = project.modules ?? EMPTY_MODULES;
  const defaults: ModuleDefaults = project.moduleDefaults ?? EMPTY_DEFAULTS;
  // Панель монтируется при переходе из Эскиз PRO, поэтому значение focusModuleId
  // можно безопасно использовать как начальное состояние без каскадного эффекта.
  const [selId, setSelId] = useState<string | null>(() => props.focusModuleId ?? null);
  const [addOpen, setAddOpen] = useState(false);
  // выбор в каталоге: для настроек проекта или для слота конкретного модуля
  const [pick, setPick] = useState<{ slot: SlotKey; moduleId: string | null } | null>(null);
  const [pickSurcharge, setPickSurcharge] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean } | null>(null);
  const [showPlanner, setShowPlanner] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [addQ, setAddQ] = useState('');
  const [toast, setToast] = useState<{ text: string; undo: (() => void) | null } | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);
  const modsRef = useRef(mods);
  useEffect(() => { modsRef.current = mods; }, [mods]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(timer);
  }, [toast]);
  const showToast = (text: string, undo: (() => void) | null = null) => setToast({ text, undo });

  const shape = normalizeLayoutShape(project.sketch?.shape);
  const walls = layoutWalls(shape);
  const shapeName = LAYOUT_SHAPES.find((item) => item.id === shape)?.name ?? 'Прямая';

  const setMods = (m: KitchenModule[]) => props.onChange({ ...project, modules: m });
  const updMod = (id: string, patch: Partial<KitchenModule>) => setMods(mods.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  const reorder = (id: string, target: number) => {
    const next = moveModule(mods, id, target);
    if (next !== mods) setMods(next);
  };
  const confirmWarning = (moduleId: string, code: string, confirmed: boolean) => {
    const module = mods.find((item) => item.id === moduleId);
    if (!module) return;
    const nextModule = setWarningConfirmed(module, code, confirmed);
    if (nextModule !== module) setMods(mods.map((item) => (item.id === moduleId ? nextModule : item)));
  };
  const sel = mods.find((m) => m.id === selId) ?? null;
  const selectedBody = sel ? resolveSlot(sel, 'body', defaults, pricebook).item : null;
  const facadeInference = sel && selectedBody ? inferFacadeSpec(sel, selectedBody) : null;
  const hingeInference = sel && selectedBody ? inferHingeSpec(sel, selectedBody) : null;
  const facadeNeedsUpdate = Boolean(sel && selectedBody && (
    sel.facadeSpecStatus === 'outdated' || isTechnicalFacadeSpecOutdated(sel, selectedBody)
  ));
  const hingeNeedsUpdate = Boolean(sel && selectedBody && (
    sel.hingeSpecStatus === 'outdated' || isTechnicalHingeSpecOutdated(sel, selectedBody)
  ));
  const dimensionSurchargeRecommendations = sel && selectedBody
    ? inferDimensionSurcharges(sel, selectedBody, pricebook)
    : [];
  const pendingDimensionSurcharges = dimensionSurchargeRecommendations.filter((item) => !(sel?.surcharges ?? []).includes(item.itemId));

  const checks = useMemo(() => new Map(mods.map((m) => [m.id, checkModule(m, defaults, pricebook)])), [mods, defaults, pricebook]);
  const costs = useMemo(() => new Map(mods.map((m) => {
    const lines = moduleToLines(m, defaults, pricebook);
    return [m.id, calcTotals(lines, project.settings).totals.cost];
  })), [mods, defaults, pricebook, project.settings]);
  const summary = useMemo(() => modulesSummary(mods), [mods]);
  const pendingDimensionModuleCount = useMemo(() => mods.filter((module) => {
    const body = resolveSlot(module, 'body', defaults, pricebook).item;
    if (!body) return false;
    const recommendations = inferDimensionSurcharges(module, body, pricebook);
    return recommendations.some((item) => !(module.surcharges ?? []).includes(item.itemId));
  }).length, [mods, defaults, pricebook]);
  const selectedModuleLines = sel ? moduleToLines(sel, defaults, pricebook) : [];
  const selectedModuleCalculation = sel ? calcTotals(selectedModuleLines, project.settings) : null;
  const pendingFacadeModuleCount = useMemo(() => mods.filter((module) => {
    const body = resolveSlot(module, 'body', defaults, pricebook).item;
    const inference = body ? inferFacadeSpec(module, body) : null;
    const empty = !module.facadeParts?.length && module.facades === 0;
    const outdated = module.facadeSpecStatus === 'outdated' || (body ? isTechnicalFacadeSpecOutdated(module, body) : false);
    return Boolean(body && inference && (empty || outdated));
  }).length, [mods, defaults, pricebook]);
  const pendingHingeModuleCount = useMemo(() => mods.filter((module) => {
    if (module.hingeSpecStatus === 'manual') return false;
    const body = resolveSlot(module, 'body', defaults, pricebook).item;
    const inference = body ? inferHingeSpec(module, body) : null;
    return Boolean(body && inference && (module.hingeSpecStatus === 'outdated' || module.hinges !== inference.hinges));
  }).length, [mods, defaults, pricebook]);

  const addModule = (type: string) => {
    const m = newModule(type);
    setMods([...mods, m]);
    setSelId(m.id);
  };
  const addPreset = (preset: (typeof MODULE_PRESETS)[number]) => {
    const m = moduleFromPreset(preset);
    setMods([...mods, m]);
    setSelId(m.id);
  };

  /** Вставка модулей из шаблона: новые id, слоты и надбавки копируются как есть */
  const insertFromTemplate = (t: Template) => {
    const copies: KitchenModule[] = (t.modules ?? []).map((x) => ({ ...JSON.parse(JSON.stringify(x)), id: newModule(x.type).id }));
    if (!copies.length) return;
    setMods([...mods, ...copies]);
    setSelId(copies[0].id);
  };
  const moduleTemplates = (props.templates ?? []).filter((t) => (t.modules?.length ?? 0) > 0);

  // Фильтр меню «+ Добавить позицию»: меню остаётся открытым для добавления серии позиций
  const normAdd = (s: string) => s.toLocaleLowerCase('ru').replace(/ё/g, 'е');
  const addTerms = normAdd(addQ).split(/\s+/).filter(Boolean);
  const matchAdd = (label: string) => addTerms.every((term) => normAdd(label).includes(term));
  const filteredPresets = MODULE_PRESETS.filter((preset) => matchAdd(preset.label));
  const filteredTypes = MODULE_TYPES.filter((type) => matchAdd(type));
  const filteredTemplates = moduleTemplates.filter((tpl) => matchAdd(tpl.name));
  const filteredSets = KITCHEN_SETS.filter((set) => matchAdd(set.name));
  const addFirstMatch = () => {
    if (filteredPresets[0]) addPreset(filteredPresets[0]);
    else if (filteredTypes[0]) addModule(filteredTypes[0]);
    else if (filteredSets[0]) applyKitchenSet(filteredSets[0]);
    else if (filteredTemplates[0]) insertFromTemplate(filteredTemplates[0]);
  };

  /** Готовый комплект кухни: добавляет модули и выставляет планировку эскиза. */
  const applyKitchenSet = (set: (typeof KITCHEN_SETS)[number]) => {
    const copies = modulesFromKitchenSet(set);
    if (!copies.length) return;
    props.onChange({
      ...project,
      modules: [...mods, ...copies],
      sketch: { ...(project.sketch ?? {}), shape: set.shape },
    });
    setSelId(copies[0].id);
    setAddOpen(false);
    setAddQ('');
    showToast(`Комплект «${set.name}»: добавлено позиций — ${copies.length}. Корпуса и материалы задайте слотами или «✨ Применить все рекомендации».`);
  };

  /** Ctrl+D: скопировать высоту/глубину/опоры/материалы с позиции НАД первой выбранной. */
  const applyFillFromAbove = () => {
    const { modules: next, changed, sourceName } = fillFromAbove(modsRef.current, selectedIds);
    if (changed === 0 || !sourceName) return;
    setMods(next);
    showToast(`С «${sourceName}» скопированы высота, глубина, опоры и материалы → ${changed} поз.`);
  };

  /** Навигация по таблице как в электронной таблице. */
  const GRID_COLS = 6;
  const focusGridCell = (r: number, col: number) => {
    const el = tableRef.current?.querySelector<HTMLInputElement>(`input[data-grid-r="${r}"][data-grid-c="${col}"]`);
    if (el) { el.focus(); el.select(); }
  };
  const onTableKeyDown = (e: React.KeyboardEvent<HTMLTableElement>) => {
    const el = e.target as HTMLInputElement;
    if (!el || el.tagName !== 'INPUT' || el.dataset.gridR === undefined) return;
    const r = Number(el.dataset.gridR);
    const c = Number(el.dataset.gridC);
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const next = e.shiftKey ? c - 1 : c + 1;
      if (next >= 0 && next < GRID_COLS) focusGridCell(r, next);
      else focusGridCell(e.shiftKey ? r - 1 : r + 1, e.shiftKey ? GRID_COLS - 1 : 0);
    } else if (e.key === 'ArrowDown') { e.preventDefault(); focusGridCell(r + 1, c); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusGridCell(r - 1, c); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); applyFillFromAbove(); }
  };

  /** Удаление позиции с возможностью отмены через тост. */
  const deleteModuleWithUndo = (m: KitchenModule, index: number) => {
    const snapshot = JSON.parse(JSON.stringify(m)) as KitchenModule;
    setMods(modsRef.current.filter((x) => x.id !== m.id));
    if (selId === m.id) setSelId(null);
    showToast(`Позиция «${m.name}» удалена`, () => {
      const arr = [...modsRef.current];
      if (!arr.some((x) => x.id === snapshot.id)) arr.splice(Math.min(index, arr.length), 0, snapshot);
      setMods(arr);
      setToast(null);
    });
  };

  const itemName = (id: string | null | undefined) => {
    if (!id) return null;
    const it = pricebook.items.find((i) => i.id === id);
    return it ? `${it.name.slice(0, 48)}${it.attrs?.['толщина'] && !it.name.includes(it.attrs['толщина']) ? ` · ${it.attrs['толщина']}` : ''}` : '⚠ позиция не найдена в прайсе';
  };

  const statusDot = (l: 'ok' | 'warn' | 'error') => l === 'ok' ? <span className="dot ok" title="Готово">●</span> : l === 'warn' ? <span className="dot warn" title="Требует подтверждения">●</span> : <span className="dot err" title="Не хватает обязательных данных">●</span>;
  const dimensionLabel = (dimension: 'width' | 'height' | 'depth') => ({ width: 'ширине', height: 'высоте', depth: 'глубине' }[dimension]);
  const facadeStatusLabel = (module: KitchenModule, body: PriceItem | null) => {
    const outdated = module.facadeSpecStatus === 'outdated' || Boolean(body && isTechnicalFacadeSpecOutdated(module, body));
    return outdated ? 'фасады: обновить' : module.facadeSpecStatus === 'applied' ? 'фасады: техничка' : module.facadeSpecStatus === 'manual' ? 'фасады: вручную' : module.facadeParts?.length ? 'фасады: заданы' : null;
  };
  const hingeStatusLabel = (module: KitchenModule, body: PriceItem | null) => {
    const outdated = module.hingeSpecStatus === 'outdated' || Boolean(body && isTechnicalHingeSpecOutdated(module, body));
    return outdated ? 'петли: обновить' : module.hingeSpecStatus === 'applied' ? 'петли: техничка' : module.hingeSpecStatus === 'manual' ? 'петли: вручную' : null;
  };

  const allProblems = mods.flatMap((m) => {
    const c = checks.get(m.id)!;
    return [
      ...c.errors.map((text) => ({ mod: m, text, code: null as string | null, critical: true })),
      ...c.openWarnings.map((warning) => ({ mod: m, text: warning.text, code: warning.code, critical: false })),
    ];
  });
  const allConfirmed = mods.flatMap((m) => (checks.get(m.id)?.confirmedWarnings ?? []).map((warning) => ({ mod: m, ...warning })));

  return (
    <>
      {/* Параметры проекта по умолчанию */}
      <section className="card defaults-card">
        <h3>Параметры проекта по умолчанию</h3>
        <div className="muted small">Применяются ко всем позициям, где не задано вручную. Ручной выбор в конкретной позиции всегда сильнее и сохраняется при смене этих настроек.</div>
        <div className="defaults-grid">
          {DEFAULT_SLOTS.map((k) => (
            <div className="def-slot" key={k}>
              <div className="def-label">{SLOT_LABELS[k]}</div>
              <div className={defaults[k] ? 'def-value' : 'def-value none'}>
                {itemName(defaults[k]) ?? 'Не выбрано'}
              </div>
              <div className="def-actions">
                <button className="btn tiny" onClick={() => setPick({ slot: k, moduleId: null })}>Выбрать…</button>
                {defaults[k] && <button className="btn tiny ghost" onClick={() => props.onChange({ ...project, moduleDefaults: { ...defaults, [k]: null } })}>✕</button>}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Добавление позиции */}
      <div className="lines-toolbar">
        <div className="dropdown open-on-click">
          <button className="btn primary" onClick={() => setAddOpen((v) => !v)}>+ Добавить позицию ▾</button>
          {addOpen && (
            <div className="dropdown-menu static add-menu">
              <input
                className="add-filter"
                placeholder="Поиск… Enter — первый, Esc — закрыть"
                value={addQ}
                autoFocus
                onChange={(e) => setAddQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); addFirstMatch(); }
                  if (e.key === 'Escape') { e.preventDefault(); setAddOpen(false); setAddQ(''); }
                }}
              />
              {filteredTypes.length > 0 && <div className="menu-sep">Тип позиции:</div>}
              {filteredTypes.map((tp) => <button key={tp} onClick={() => addModule(tp)}>{tp}</button>)}
              {(addTerms.length === 0 || matchAdd('Свой тип')) && <button onClick={() => { const custom = prompt('Название собственного типа позиции:'); if (custom?.trim()) addModule(custom.trim()); }}>Свой тип…</button>}
              {filteredPresets.length > 0 && <div className="menu-sep">Быстрая конструкция:</div>}
              {filteredPresets.map((preset) => <button key={preset.id} onClick={() => addPreset(preset)}>⚡ {preset.label}</button>)}
              {filteredSets.length > 0 && <div className="menu-sep">Готовые комплекты:</div>}
              {filteredSets.map((set) => (
                <button key={set.id} title={set.description} onClick={() => applyKitchenSet(set)}>🏠 {set.name} ({set.modules.length} поз.)</button>
              ))}
              {filteredTemplates.length > 0 && <div className="menu-sep">Из шаблона:</div>}
              {filteredTemplates.map((tpl) => (
                <button key={tpl.id} onClick={() => insertFromTemplate(tpl)}>⧉ {tpl.name} ({tpl.modules!.length} мод.)</button>
              ))}
              {filteredTypes.length + filteredPresets.length + filteredTemplates.length + filteredSets.length === 0 && <div className="menu-sep">Ничего не найдено по «{addQ}»</div>}
              <div className="menu-sep muted">Меню остаётся открытым — добавляйте позиции серией.</div>
            </div>
          )}
        </div>
        <div className="dropdown action-dropdown wide module-tools-menu">
          <button className="btn ghost" type="button">Инструменты ▾</button>
          <div className="dropdown-menu">
            <button type="button" onClick={() => setShowPlanner((value) => !value)}>{showPlanner ? 'Скрыть раскладку по стене' : '▦ Разложить по стене'}</button>
            <button type="button" disabled={selectedIds.length === 0} onClick={() => setShowBulkEdit((value) => !value)}>✎ Массовое редактирование ({selectedIds.length})</button>
            {(pendingDimensionModuleCount + pendingFacadeModuleCount + pendingHingeModuleCount) > 0 ? (
              <button
                type="button"
                title="Надбавки за нестандартные габариты + фасады и петли по техничке — для всех позиций сразу"
                onClick={() => {
                  const next = mods.map((module) => {
                    const body = resolveSlot(module, 'body', defaults, pricebook).item;
                    if (!body) return module;
                    let m = applyDimensionSurcharges(module, body, pricebook);
                    m = applyTechnicalFacadeSpec(m, body, m.facadeSpecStatus === 'outdated' || isTechnicalFacadeSpecOutdated(m, body));
                    if (m.hingeSpecStatus !== 'manual') {
                      const inference = inferHingeSpec(m, body);
                      if (inference) m = { ...m, hinges: inference.hinges, hingeSpecStatus: 'applied' as const };
                    }
                    return m;
                  });
                  setMods(next);
                  showToast('Рекомендации применены ко всем позициям');
                }}
              >✨ Применить все рекомендации ({pendingDimensionModuleCount + pendingFacadeModuleCount + pendingHingeModuleCount})</button>
            ) : <button type="button" disabled>Рекомендаций сейчас нет</button>}
            <button type="button" disabled={selectedIds.length === 0} title="Скопировать высоту, глубину, опоры и материалы позиции, стоящей НАД первой выбранной" onClick={applyFillFromAbove}>⤓ Заполнить с верхней (Ctrl+D)</button>
          </div>
        </div>
        {selectedIds.length > 0 && <span className="module-toolbar-state">Выбрано: {selectedIds.length}</span>}
        {allProblems.some((p) => p.critical) && <span className="warn">⛔ есть позиции с неполными данными — см. проверку внизу</span>}
      </div>

      <section className="module-workbench-panel no-print" aria-label="Рабочее место модулей кухни">
        <div className="module-workbench-main">
          <span className="eyebrow">Состав кухни</span>
          <h3>{mods.length > 0 ? 'Список модулей → выбранная позиция → проверка' : 'Добавьте первый модуль кухни'}</h3>
          <p>Слева остаётся быстрый список и табличный ввод, справа сразу открывается редактор выбранного модуля: не нужно листать под всей таблицей.</p>
        </div>
        <div className="module-workbench-steps">
          <span className={mods.length > 0 ? 'ready' : ''}><b>{mods.length || '—'}</b><small>модулей</small></span>
          <span className={sel ? 'ready' : ''}><b>{sel ? sel.name.slice(0, 18) : 'выберите'}</b><small>редактор позиции</small></span>
          <span className={summary.facades > 0 ? 'ready' : ''}><b>{summary.facades}</b><small>фасадов</small></span>
          <span className={allProblems.length === 0 ? 'ready' : allProblems.some((p) => p.critical) ? 'bad' : 'warn'}><b>{allProblems.length || 'ок'}</b><small>проверка</small></span>
        </div>
        <aside className="module-workbench-current">
          {sel ? <>
            <b>{sel.name}</b>
            <span>{sel.widthMm || '—'}×{sel.heightMm || '—'}×{sel.depthMm || '—'} мм · {sel.qty} шт</span>
            <span>{selectedBody ? selectedBody.name.slice(0, 48) : 'корпус не выбран'}</span>
            <strong>{selectedModuleCalculation ? fmtMoney(selectedModuleCalculation.totals.cost) : '—'}</strong>
          </> : <><b>Нет выбранной позиции</b><span>Кликните по строке модуля — ниже откроется полный редактор.</span></>}
        </aside>
      </section>

      {showPlanner && <WallPlanner project={project} onChange={props.onChange} onClose={() => setShowPlanner(false)} />}
      {showBulkEdit && <BulkEditPanel modules={mods} selectedIds={selectedIds} pricebook={pricebook} onApply={(next) => props.onChange({ ...project, modules: next })} onClose={() => setShowBulkEdit(false)} />}

      {/* Рабочая область: список модулей + редактор выбранной позиции */}
      {mods.length === 0 ? (
        <div className="empty">Позиций пока нет. Нажмите «+ Добавить позицию», выберите тип (нижний шкаф, пенал…), затем задайте размеры и комплектацию.</div>
      ) : (
        <div className="module-master-detail">
          <section className="card module-list-card">
            <div className="module-list-head">
              <div>
                <span className="eyebrow">Модули проекта</span>
                <h3>Выберите позицию — редактор открыт справа</h3>
              </div>
              <span className="module-list-count">{mods.length} поз.</span>
            </div>
            <div className="module-card-list" aria-label="Быстрый выбор модуля">
              {mods.map((m, idx) => {
                const c = checks.get(m.id)!;
                const body = resolveSlot(m, 'body', defaults, pricebook).item;
                const filled = ALL_SLOTS.filter((k) => slotNeed(m, k) > 0 || k === 'body');
                const chosen = filled.filter((k) => resolveSlot(m, k, defaults, pricebook).item);
                return (
                  <button type="button" key={m.id} className={`module-mini-card ${selId === m.id ? 'active' : ''} ${c.level !== 'ok' ? c.level : ''}`} onClick={() => setSelId(m.id)}>
                    <span className="module-mini-line top"><b>{idx + 1}. {m.name}</b><em>{fmtMoney(costs.get(m.id) ?? 0)}</em></span>
                    <span className="module-mini-line"><small>{m.type}</small><small>{m.widthMm || '—'}×{m.heightMm || '—'}×{m.depthMm || '—'} мм · {m.qty} шт</small></span>
                    <span className="module-mini-line"><small>{body ? body.name.slice(0, 34) : 'корпус не выбран'}</small><small>{chosen.length}/{filled.length} слотов {statusDot(c.level)}</small></span>
                  </button>
                );
              })}
            </div>
            <details className="module-spreadsheet-panel" open>
              <summary>Табличный ввод размеров и количества</summary>
          <div className="module-order-hint">↕ Порядок позиций задаёт порядок модулей в эскизе · ⌨ Enter/Tab — следующее поле · ↑↓ — между строк · Ctrl+D — заполнить с верхней позиции</div>
          <table className="table modules" ref={tableRef} onKeyDown={onTableKeyDown}>
            <thead>
              <tr><th className="bulk-check"><input type="checkbox" aria-label="Выбрать все модули" checked={mods.length > 0 && selectedIds.length === mods.length} onChange={(event) => setSelectedIds(event.target.checked ? mods.map((module) => module.id) : [])} /></th><th>№</th><th>Позиция</th><th>Размер, мм</th><th className="num">Кол.</th><th className="num">Фас.</th><th className="num">Ящ.</th><th>Комплектация</th><th className="num">Себест.</th><th>Ст.</th><th /></tr>
            </thead>
            <tbody>
              {mods.map((m, idx) => {
                const c = checks.get(m.id)!;
                const body = resolveSlot(m, 'body', defaults, pricebook).item;
                const facadeOutdated = m.facadeSpecStatus === 'outdated' || Boolean(body && isTechnicalFacadeSpecOutdated(m, body));
                const hingeOutdated = m.hingeSpecStatus === 'outdated' || Boolean(body && isTechnicalHingeSpecOutdated(m, body));
                const filled = ALL_SLOTS.filter((k) => slotNeed(m, k) > 0 || k === 'body');
                const chosen = filled.filter((k) => resolveSlot(m, k, defaults, pricebook).item);
                const isDropTarget = dropTarget?.id === m.id;
                return (
                  <tr
                    key={m.id}
                    className={`${selId === m.id ? 'sel-row' : ''} ${c.level !== 'ok' ? 'has-warn' : ''} ${isDropTarget ? (dropTarget.after ? 'drop-after' : 'drop-before') : ''}`}
                    onClick={() => setSelId(m.id === selId ? null : m.id)}
                    onDragOver={(e) => {
                      if (!dragId || dragId === m.id) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      setDropTarget({ id: m.id, after: e.clientY >= e.currentTarget.getBoundingClientRect().top + e.currentTarget.getBoundingClientRect().height / 2 });
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const sourceId = dragId ?? e.dataTransfer.getData('text/plain');
                      if (sourceId && sourceId !== m.id) {
                        const targetIndex = idx + (dropTarget?.id === m.id && dropTarget.after ? 1 : 0);
                        reorder(sourceId, targetIndex);
                      }
                      setDragId(null);
                      setDropTarget(null);
                    }}
                  >
                  <td className="bulk-check" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" aria-label={`Выбрать ${m.name}`} checked={selectedIds.includes(m.id)} onChange={(event) => setSelectedIds((ids) => event.target.checked ? [...ids, m.id] : ids.filter((id) => id !== m.id))} />
                  </td>
                  <td className="muted module-order-cell">
                    <span
                      className="module-drag-handle"
                      draggable
                      title="Перетащить позицию"
                      aria-label={`Перетащить позицию ${idx + 1}`}
                      onClick={(e) => e.stopPropagation()}
                      onDragStart={(e) => {
                        e.stopPropagation();
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', m.id);
                        setDragId(m.id);
                      }}
                      onDragEnd={() => { setDragId(null); setDropTarget(null); }}
                    >⠿</span>
                    <span>{idx + 1}</span>
                    <span className="module-order-buttons">
                      <button className="btn tiny ghost" title="Переместить выше" disabled={idx === 0} onClick={(e) => { e.stopPropagation(); reorder(m.id, -1); }}>▲</button>
                      <button className="btn tiny ghost" title="Переместить ниже" disabled={idx === mods.length - 1} onClick={(e) => { e.stopPropagation(); reorder(m.id, 1); }}>▼</button>
                    </span>
                  </td>
                  <td><b>{m.name}</b><div className="muted small">{m.type}{walls.length > 1 ? ` · ${WALL_SHORT_LABELS[moduleWall(m, shape)].toLocaleLowerCase('ru')} стена` : ''}</div>{facadeStatusLabel(m, body) && <span className={`module-facade-status ${facadeOutdated ? 'outdated' : m.facadeSpecStatus ?? 'set'}`}>{facadeStatusLabel(m, body)}</span>}{hingeStatusLabel(m, body) && <span className={`module-facade-status ${hingeOutdated ? 'outdated' : m.hingeSpecStatus ?? 'set'}`}>{hingeStatusLabel(m, body)}</span>}</td>
                  <td className="small dims" onClick={(e) => e.stopPropagation()}>
                    <input className="dim" type="number" placeholder="Ш" data-grid-r={idx} data-grid-c={0} onFocus={(e) => e.currentTarget.select()} value={m.widthMm ?? ''} onChange={(e) => updMod(m.id, { widthMm: Number(e.target.value) || null, facadeSpecStatus: m.facadeSpecStatus === 'applied' ? 'outdated' : m.facadeSpecStatus, hingeSpecStatus: m.hingeSpecStatus === 'applied' ? 'outdated' : m.hingeSpecStatus })} />×
                    <input className="dim" type="number" placeholder="В" data-grid-r={idx} data-grid-c={1} onFocus={(e) => e.currentTarget.select()} value={m.heightMm ?? ''} onChange={(e) => updMod(m.id, { heightMm: Number(e.target.value) || null, facadeSpecStatus: m.facadeSpecStatus === 'applied' ? 'outdated' : m.facadeSpecStatus, hingeSpecStatus: m.hingeSpecStatus === 'applied' ? 'outdated' : m.hingeSpecStatus })} />×
                    <input className="dim" type="number" placeholder="Г" data-grid-r={idx} data-grid-c={2} onFocus={(e) => e.currentTarget.select()} value={m.depthMm ?? ''} onChange={(e) => updMod(m.id, { depthMm: Number(e.target.value) || null })} />
                  </td>
                  <td className="num" onClick={(e) => e.stopPropagation()}>
                    <input className="qty cell" type="number" min={0} data-grid-r={idx} data-grid-c={3} onFocus={(e) => e.currentTarget.select()} value={m.qty} onChange={(e) => updMod(m.id, { qty: Number(e.target.value) || 0 })} />
                  </td>
                  <td className="num" onClick={(e) => e.stopPropagation()}>
                    <input className="qty cell" type="number" min={0} data-grid-r={idx} data-grid-c={4} onFocus={(e) => e.currentTarget.select()} value={m.facades} onChange={(e) => updMod(m.id, { facades: Number(e.target.value) || 0, facadeParts: undefined, facadeSpecStatus: 'manual', hingeSpecStatus: m.hingeSpecStatus === 'applied' ? 'outdated' : m.hingeSpecStatus })} />
                  </td>
                  <td className="num" onClick={(e) => e.stopPropagation()}>
                    <input className="qty cell" type="number" min={0} data-grid-r={idx} data-grid-c={5} onFocus={(e) => e.currentTarget.select()} value={m.drawers} onChange={(e) => updMod(m.id, { drawers: Number(e.target.value) || 0, facadeSpecStatus: m.facadeSpecStatus === 'applied' ? 'outdated' : m.facadeSpecStatus, hingeSpecStatus: m.hingeSpecStatus === 'applied' ? 'outdated' : m.hingeSpecStatus })} />
                  </td>
                  <td className="small">{chosen.length}/{filled.length} выбрано{c.level === 'error' ? <span className="warn"> · не хватает данных</span> : c.level === 'warn' ? ' · подтвердите' : ''}</td>
                  <td className="num">{fmtMoney(costs.get(m.id) ?? 0)}</td>
                  <td>{statusDot(c.level)}</td>
                  <td>
                    <button className="btn tiny ghost" title="Дублировать" onClick={(e) => { e.stopPropagation(); const cp = { ...JSON.parse(JSON.stringify(m)), id: newModule(m.type).id, name: `${m.name} (копия)` }; setMods([...mods, cp]); setSelId(cp.id); }}>⧉</button>
                    <button className="btn tiny danger" title="Удалить" onClick={(e) => { e.stopPropagation(); deleteModuleWithUndo(m, idx); }}>✕</button>
                  </td>
                </tr>
              );
            })}
            </tbody>
          </table>

            </details>
          </section>
          {sel ? (
            <section className="card mod-editor module-editor-panel">
          <h3>Позиция: {sel.name} {statusDot(checks.get(sel.id)!.level)}</h3>
          <div className="grid4">
            <label>Название<input value={sel.name} onChange={(e) => updMod(sel.id, { name: e.target.value })} /></label>
            <label>Тип<input list="mod-types" value={sel.type} onChange={(e) => updMod(sel.id, { type: e.target.value })} />
              <datalist id="mod-types">{MODULE_TYPES.map((t) => <option key={t} value={t} />)}</datalist></label>
            <label>Количество<input type="number" min={1} value={sel.qty} onChange={(e) => updMod(sel.id, { qty: Number(e.target.value) || 0 })} /></label>
            <label>Заметка<input value={sel.note ?? ''} onChange={(e) => updMod(sel.id, { note: e.target.value })} /></label>
            <label>Стена в эскизе
              <select value={moduleWall(sel, shape)} disabled={walls.length < 2}
                onChange={(e) => updMod(sel.id, { wall: e.target.value as KitchenWall })}>
                {walls.map((wall) => <option key={wall} value={wall}>{WALL_LABELS[wall]}</option>)}
              </select>
              <span className="muted small">Планировка: {shapeName}{walls.length < 2 ? ' — доступна только задняя стена' : ''}</span>
            </label>
          </div>
          <h4>Размеры модуля, мм</h4>
          <div className="grid3">
            <label>Ширина<input type="number" value={sel.widthMm ?? ''} placeholder="напр. 800" onChange={(e) => updMod(sel.id, { widthMm: Number(e.target.value) || null, facadeSpecStatus: sel.facadeSpecStatus === 'applied' ? 'outdated' : sel.facadeSpecStatus, hingeSpecStatus: sel.hingeSpecStatus === 'applied' ? 'outdated' : sel.hingeSpecStatus })} /></label>
            <label>Высота<input type="number" value={sel.heightMm ?? ''} placeholder="напр. 720" onChange={(e) => updMod(sel.id, { heightMm: Number(e.target.value) || null, facadeSpecStatus: sel.facadeSpecStatus === 'applied' ? 'outdated' : sel.facadeSpecStatus, hingeSpecStatus: sel.hingeSpecStatus === 'applied' ? 'outdated' : sel.hingeSpecStatus })} /></label>
            <label>Глубина<input type="number" value={sel.depthMm ?? ''} placeholder="напр. 560" onChange={(e) => updMod(sel.id, { depthMm: Number(e.target.value) || null })} /></label>
          </div>
          {selectedModuleCalculation && selectedModuleLines.length > 0 && (
            <section className="module-formula-card">
              <div className="facade-tech-head"><h4>Расшифровка расчёта модуля</h4><b>{fmtMoney(selectedModuleCalculation.totals.cost)}</b></div>
              <div className="muted small">Каждая строка считается отдельно; процентные надбавки привязаны только к строке корпуса.</div>
              <div className="module-formula-list">
                {selectedModuleLines.map((line) => {
                  const calculation = selectedModuleCalculation.lineCalcs.get(line.id);
                  return <div className="module-formula-row" key={line.id}>
                    <span>{line.name.slice(0, 55)}<small>{stripModuleNote(line.note)}</small></span>
                    <b>{calculation?.sum != null ? `${fmtNum(calculation.qtyEffective)} × ${fmtMoney(line.price)} = ${fmtMoney(calculation.sum)}` : 'нет цены'}</b>
                  </div>;
                })}
              </div>
            </section>
          )}
          <h4>Конструкция (на один модуль)</h4>
          <div className="grid4">
            <label>Фасадов, шт<input type="number" min={0} value={sel.facades} onChange={(e) => updMod(sel.id, { facades: Number(e.target.value) || 0, facadeParts: undefined, facadeSpecStatus: 'manual', hingeSpecStatus: sel.hingeSpecStatus === 'applied' ? 'outdated' : sel.hingeSpecStatus })} /></label>
            <label>Ящиков, шт<input type="number" min={0} value={sel.drawers} onChange={(e) => updMod(sel.id, { drawers: Number(e.target.value) || 0, facadeSpecStatus: sel.facadeSpecStatus === 'applied' ? 'outdated' : sel.facadeSpecStatus, hingeSpecStatus: sel.hingeSpecStatus === 'applied' ? 'outdated' : sel.hingeSpecStatus })} /></label>
            <label>Полок, шт<input type="number" min={0} value={sel.shelves} onChange={(e) => updMod(sel.id, { shelves: Number(e.target.value) || 0 })} /></label>
            <label>Петель, шт<input type="number" min={0} value={sel.hinges} onChange={(e) => updMod(sel.id, { hinges: Number(e.target.value) || 0, hingeSpecStatus: 'manual' })} /></label>
            <label>Ручек, шт<input type="number" min={0} value={sel.handles} onChange={(e) => updMod(sel.id, { handles: Number(e.target.value) || 0 })} /></label>
            <label>Подъёмников, шт<input type="number" min={0} value={sel.lifts} onChange={(e) => updMod(sel.id, { lifts: Number(e.target.value) || 0 })} /></label>
            <label title="Опоры модуля: у стоящих модулей по умолчанию 4">Опор, шт<input type="number" min={0} value={sel.legs ?? 0} onChange={(e) => updMod(sel.id, { legs: Number(e.target.value) || 0 })} /></label>
          </div>
          {facadeInference && (
            <section className="facade-tech-card">
              <div className="facade-tech-head">
                <div><h4>Фасады по техничке фабрики</h4><div className="muted small">{facadeInference.source} · корпус: {facadeInference.bodyWidthMm} мм · фасадов: {facadeInference.facades}</div></div>
                <span className={`badge ${facadeInference.confidence === 'exact' ? 'tech-exact' : 'tech-suggest'}`}>{sel.facadeSpecStatus === 'manual' ? 'изменено вручную' : !facadeNeedsUpdate && sel.facadeSpecStatus === 'applied' ? 'применено' : facadeNeedsUpdate ? 'нужно обновить' : facadeInference.confidence === 'exact' ? 'точное правило' : 'нужно проверить'}</span>
              </div>
              <div className="facade-tech-note">{facadeInference.note}</div>
              <div className="facade-parts-list">
                {(sel.facadeParts ?? facadeInference.parts).map((part, index) => (
                  <div className="facade-part-row" key={`${part.kind}-${index}`}>
                    <span><b>{part.kind === 'drawer' ? 'Ящик' : 'Дверь'} {index + 1}</b><small>{part.source === 'manual' ? 'ручной размер' : 'по техничке'}</small></span>
                    {sel.facadeParts ? <><input aria-label={`Ширина фасада ${index + 1}`} type="number" value={part.widthMm} onChange={(e) => { const parts = [...sel.facadeParts!]; parts[index] = { ...parts[index], widthMm: Number(e.target.value) || 0, source: 'manual' }; updMod(sel.id, { facadeParts: parts, facadeWmm: parts[0].widthMm, facadeHmm: parts[0].heightMm, facadeSpecStatus: 'manual', hingeSpecStatus: sel.hingeSpecStatus === 'applied' ? 'outdated' : sel.hingeSpecStatus }); }} />×<input aria-label={`Высота фасада ${index + 1}`} type="number" value={part.heightMm} onChange={(e) => { const parts = [...sel.facadeParts!]; parts[index] = { ...parts[index], heightMm: Number(e.target.value) || 0, source: 'manual' }; updMod(sel.id, { facadeParts: parts, facadeWmm: parts[0].widthMm, facadeHmm: parts[0].heightMm, facadeSpecStatus: 'manual', hingeSpecStatus: sel.hingeSpecStatus === 'applied' ? 'outdated' : sel.hingeSpecStatus }); }} /> мм</> : <b>{part.widthMm}×{part.heightMm} мм</b>}
                  </div>
                ))}
              </div>
              {facadeNeedsUpdate && sel.facadeParts && (
                <div className="warn-box small">Размер модуля или корпуса изменён. Текущие фасады: {sel.facadeParts.map((part) => `${part.widthMm}×${part.heightMm}`).join(', ')} мм. Новая рекомендация: {facadeInference.parts.map((part) => `${part.widthMm}×${part.heightMm}`).join(', ')} мм.</div>
              )}
              {(!sel.facadeParts || sel.facadeSpecStatus === 'manual' || facadeNeedsUpdate) && (
                <button className="btn tiny add" onClick={() => updMod(sel.id, applyTechnicalFacadeSpec(sel, selectedBody!, true))}>
                  {!sel.facadeParts ? 'Подставить размеры и количество' : facadeNeedsUpdate ? 'Обновить по техничке' : 'Заменить ручные размеры рекомендацией'}
                </button>
              )}
              {sel.facadeParts && <div className="muted small">Размеры участвуют в расчёте площади фасадов отдельно для каждой детали.</div>}
            </section>
          )}
          {hingeInference && (
            <section className="hinge-tech-card">
              <div className="facade-tech-head">
                <div><h4>Петли по техничке</h4><div className="muted small">{hingeInference.source} · дверей: {hingeInference.doorCount} · рекомендуется: {hingeInference.hinges} шт.</div></div>
                <span className={`badge ${hingeInference.confidence === 'exact' ? 'tech-exact' : 'tech-suggest'}`}>{sel.hingeSpecStatus === 'manual' ? 'изменено вручную' : !hingeNeedsUpdate && sel.hingeSpecStatus === 'applied' ? 'применено' : hingeNeedsUpdate ? 'нужно обновить' : 'предложение'}</span>
              </div>
              <div className="facade-tech-note">{hingeInference.note}</div>
              {(hingeNeedsUpdate || sel.hinges !== hingeInference.hinges) && <div className="muted small">Сейчас указано: {sel.hinges} шт. Применение изменит только количество петель, не модель петли.</div>}
              {sel.hingeSpecStatus !== 'manual' && (hingeNeedsUpdate || sel.hinges !== hingeInference.hinges) && <button className="btn tiny add" onClick={() => updMod(sel.id, { hinges: hingeInference.hinges, hingeSpecStatus: 'applied' })}>Подставить количество петель</button>}
              {sel.hingeSpecStatus === 'manual' && <button className="btn tiny ghost" onClick={() => updMod(sel.id, { hinges: hingeInference.hinges, hingeSpecStatus: 'applied' })}>Заменить ручное количество рекомендацией</button>}
            </section>
          )}
          <section className="extra-facade-card">
            <div className="facade-tech-head">
              <div>
                <h4>Отдельные фасадные детали</h4>
                <div className="muted small">Боковины, накладки, фасады холодильника и другие детали со своими размерами. Каждая попадает в расчёт отдельной строкой по своей площади.</div>
              </div>
              <span className="badge man">вручную</span>
            </div>
            {(sel.extraFacadeParts ?? []).length > 0 && (
              <div className="extra-facade-list">
                {(sel.extraFacadeParts ?? []).map((part, index) => {
                  const area = (part.widthMm / 1000) * (part.heightMm / 1000) * part.qty * sel.qty;
                  const updPart = (patch: Partial<ExtraFacadePart>) => {
                    const next = [...(sel.extraFacadeParts ?? [])];
                    next[index] = { ...next[index], ...patch };
                    updMod(sel.id, { extraFacadeParts: next });
                  };
                  return (
                    <div className="extra-facade-row" key={index}>
                      <input className="extra-facade-name" aria-label={`Название детали ${index + 1}`} value={part.label ?? ''} placeholder={`Деталь ${index + 1} (напр. Боковина правая)`}
                        onChange={(e) => updPart({ label: e.target.value })} />
                      <select aria-label={`Тип детали ${index + 1}`} value={part.kind} onChange={(e) => updPart({ kind: e.target.value as ExtraFacadePart['kind'] })}>
                        <option value="panel">панель</option>
                        <option value="door">дверь</option>
                        <option value="drawer">ящик</option>
                      </select>
                      <span className="extra-facade-dims">
                        <input aria-label={`Ширина детали ${index + 1}`} type="number" min={0} value={part.widthMm} onChange={(e) => updPart({ widthMm: Number(e.target.value) || 0 })} />×
                        <input aria-label={`Высота детали ${index + 1}`} type="number" min={0} value={part.heightMm} onChange={(e) => updPart({ heightMm: Number(e.target.value) || 0 })} /> мм ×
                        <input aria-label={`Количество детали ${index + 1}`} type="number" min={0} value={part.qty} onChange={(e) => updPart({ qty: Number(e.target.value) || 0 })} /> шт
                      </span>
                      <span className="extra-facade-area muted small">{part.widthMm > 0 && part.heightMm > 0 && part.qty > 0 ? `${fmtNum(area)} м²` : 'заполните размеры'}</span>
                      <button className="btn tiny danger" title="Убрать деталь" onClick={() => updMod(sel.id, { extraFacadeParts: (sel.extraFacadeParts ?? []).filter((_, i) => i !== index) })}>✕</button>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="extra-facade-actions">
              <button className="btn tiny add" onClick={() => updMod(sel.id, { extraFacadeParts: [...(sel.extraFacadeParts ?? []), { widthMm: sel.depthMm ?? 596, heightMm: sel.heightMm ?? 720, kind: 'panel', qty: 1, label: 'Боковина', source: 'manual' }] })}>＋ Боковина (Г×В модуля)</button>
              <button className="btn tiny add" onClick={() => updMod(sel.id, { extraFacadeParts: [...(sel.extraFacadeParts ?? []), { widthMm: 596, heightMm: 720, kind: 'panel', qty: 1, label: '', source: 'manual' }] })}>＋ Добавить деталь</button>
            </div>
            {(sel.extraFacadeParts ?? []).length > 0 && (
              <div className="muted small">Материал берётся из слота «Фасад»; алюминиевая рамка на отдельные детали не начисляется. Площадь считается на один модуль и умножается на его количество.</div>
            )}
          </section>
          {sel.facades > 0 && !sel.facadeParts && (
            <>
              <h4>Размер одного фасада, мм (для старого или ручного расчёта)</h4>
              <div className="grid3">
                <label>Ширина фасада<input type="number" value={sel.facadeWmm ?? ''} placeholder="напр. 396" onChange={(e) => updMod(sel.id, { facadeWmm: Number(e.target.value) || null, facadeParts: undefined, facadeSpecStatus: 'manual', hingeSpecStatus: sel.hingeSpecStatus === 'applied' ? 'outdated' : sel.hingeSpecStatus })} /></label>
                <label>Высота фасада<input type="number" value={sel.facadeHmm ?? ''} placeholder="напр. 716" onChange={(e) => updMod(sel.id, { facadeHmm: Number(e.target.value) || null, facadeParts: undefined, facadeSpecStatus: 'manual', hingeSpecStatus: sel.hingeSpecStatus === 'applied' ? 'outdated' : sel.hingeSpecStatus })} /></label>
                {sel.widthMm && sel.heightMm ? (
                  <button className="btn tiny add self-end" onClick={() => updMod(sel.id, { facadeWmm: Math.round(sel.widthMm! / sel.facades), facadeHmm: sel.heightMm, facadeParts: undefined, facadeSpecStatus: 'manual', hingeSpecStatus: sel.hingeSpecStatus === 'applied' ? 'outdated' : sel.hingeSpecStatus })}>
                    подставить {Math.round(sel.widthMm / sel.facades)}×{sel.heightMm} (Ш÷{sel.facades} × В модуля)
                  </button>
                ) : <div className="muted small self-end">…или выберите корпус — размеры предложит техничка</div>}
              </div>
              {sel.facadeWmm && sel.facadeHmm ? <div className="muted small">Площадь: {sel.facades} × {sel.facadeWmm}×{sel.facadeHmm} = {fmtNum((sel.facadeWmm / 1000) * (sel.facadeHmm / 1000) * sel.facades)} м² на модуль</div> : null}
            </>
          )}
          <h4>Материалы и фурнитура</h4>
          <div className="slot-list">
            {ALL_SLOTS.map((k) => {
              const need = slotNeed(sel, k);
              if (need <= 0 && k !== 'body') return null;
              const { item, source } = resolveSlot(sel, k, defaults, pricebook);
              return (
                <div className="slot-row" key={k}>
                  <div className="slot-label">{SLOT_LABELS[k]}{k !== 'body' && <span className="muted small"> × {need * sel.qty}</span>}</div>
                  <div className={item ? 'slot-value' : 'slot-value none'}>
                    {item ? <>
                      {item.name.slice(0, 60)}{item.attrs?.['толщина'] && !item.name.includes(item.attrs['толщина']) ? ` · ${item.attrs['толщина']}` : ''} — {fmtMoney(item.price)}{item.unit ? `/${item.unit}` : ''}
                      {source === 'default' && <span className="badge def">из настроек проекта</span>}
                      {source === 'manual' && <span className="badge man">изменено вручную</span>}
                    </> : 'Не выбрано'}
                  </div>
                  <div className="slot-actions">
                    <button className="btn tiny" onClick={() => setPick({ slot: k, moduleId: sel.id })}>Выбрать…</button>
                    {sel.slots[k]?.mode === 'manual' && k !== 'body' && (
                      <button className="btn tiny ghost" title="Вернуть к настройке проекта"
                        onClick={() => updMod(sel.id, { slots: { ...sel.slots, [k]: { mode: 'default', itemId: null } } })}>↺ к настройкам</button>
                    )}
                    {sel.slots[k]?.mode === 'manual' && sel.slots[k].itemId && (
                      <button className="btn tiny ghost" onClick={() => updMod(sel.id, { slots: { ...sel.slots, [k]: { mode: 'manual', itemId: null } } })}>✕</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {props.onSaveModuleTemplate && (
            <div className="mod-tpl-row">
              <button className="btn tiny ghost" onClick={() => { const n = prompt('Название шаблона модуля:', sel.name); if (n?.trim()) props.onSaveModuleTemplate!(n.trim(), sel); }}>
                ☆ Сохранить этот модуль как шаблон
              </button>
            </div>
          )}
          {selectedBody && (dimensionSurchargeRecommendations.length > 0 || (sel.automaticSurcharges?.length ?? 0) > 0) && (
            <section className="surcharge-tech-card">
              <div className="facade-tech-head">
                <div>
                  <h4>Нестандартные габариты корпуса</h4>
                  <div className="muted small">Надбавка считается только от строки корпуса. Петли, ящики, фасады и прочая комплектация в базу процента не входят.</div>
                </div>
                {pendingDimensionSurcharges.length > 0 && <span className="badge tech-suggest">есть рекомендация</span>}
              </div>
              <div className="surcharge-tech-list">
                {dimensionSurchargeRecommendations.map((item) => {
                  const applied = (sel.surcharges ?? []).includes(item.itemId);
                  return <div className="surcharge-tech-row" key={`${item.dimension}-${item.itemId}`}>
                    <span><b>+{item.percent}% по {dimensionLabel(item.dimension)}</b><small>{item.rule} · к корпусу {selectedBody.price != null ? `≈ ${fmtMoney(selectedBody.price * item.percent / 100)} ₽/модуль` : 'без цены'}</small></span>
                    <span className={applied ? 'badge tech-exact' : 'badge tech-suggest'}>{applied ? 'применено' : 'предложение'}</span>
                  </div>;
                })}
                {(sel.automaticSurcharges ?? []).filter((id) => !dimensionSurchargeRecommendations.some((item) => item.itemId === id)).map((id) => {
                  const item = pricebook.items.find((candidate) => candidate.id === id);
                  return <div className="surcharge-tech-row stale" key={`stale-${id}`}><span><b>+{item?.price ?? '?'}% устаревшей надбавки</b><small>Размер модуля изменён — проверьте это правило.</small></span><span className="badge tech-suggest">нужно проверить</span></div>;
                })}
              </div>
              {pendingDimensionSurcharges.length > 0 && (
                <button className="btn tiny add" onClick={() => {
                  const nextIds = [...(sel.surcharges ?? [])];
                  const nextAuto = [...(sel.automaticSurcharges ?? [])];
                  for (const item of pendingDimensionSurcharges) {
                    if (!nextIds.includes(item.itemId)) nextIds.push(item.itemId);
                    if (!nextAuto.includes(item.itemId)) nextAuto.push(item.itemId);
                  }
                  updMod(sel.id, { surcharges: nextIds, automaticSurcharges: nextAuto });
                }}>✓ Применить рекомендации к корпусу</button>
              )}
            </section>
          )}
          <h4>Нестандарт / процентные надбавки (от суммы корпуса — правило прайса)</h4>
          <div className="slot-list">
            {(sel.surcharges ?? []).map((sid) => {
              const it = pricebook.items.find((i) => i.id === sid);
              return (
                <div className="slot-row" key={sid}>
                  <div className="slot-label">Надбавка</div>
                  <div className={it ? 'slot-value' : 'slot-value none'}>
                    {it ? <>{it.name.slice(0, 70)} — <b>+{it.price}%</b></> : '⚠ позиция не найдена в прайсе'}
                  </div>
                  <div className="slot-actions">
                    <button className="btn tiny danger" onClick={() => updMod(sel.id, {
                      surcharges: (sel.surcharges ?? []).filter((x) => x !== sid),
                      automaticSurcharges: (sel.automaticSurcharges ?? []).filter((x) => x !== sid),
                    })}>✕</button>
                  </div>
                </div>
              );
            })}
            <button className="btn tiny add" onClick={() => setPickSurcharge(true)}>＋ Добавить надбавку (+10/30/50%…)</button>
          </div>
          {(checks.get(sel.id)!.errors.length > 0 || checks.get(sel.id)!.openWarnings.length > 0 || checks.get(sel.id)!.confirmedWarnings.length > 0) && (
            <div className="module-check-messages">
              {checks.get(sel.id)!.errors.length > 0 && (
                <div className="warn-box">
                  {checks.get(sel.id)!.errors.map((error, i) => <div key={i}>⛔ {error}</div>)}
                </div>
              )}
              {checks.get(sel.id)!.openWarnings.map((warning) => (
                <div className="warning-row" key={warning.code}>
                  <span>⚠ {warning.text}</span>
                  {WARNING_SLOT[warning.code] && (
                    <button className="btn tiny ghost" onClick={() => setPick({ slot: WARNING_SLOT[warning.code]!.slot, moduleId: sel.id })}>{WARNING_SLOT[warning.code]!.label}</button>
                  )}
                  <button className="btn tiny" onClick={() => confirmWarning(sel.id, warning.code, true)}>✓ Подтвердить</button>
                </div>
              ))}
              {checks.get(sel.id)!.confirmedWarnings.length > 0 && (
                <div className="confirmed-warnings">
                  {checks.get(sel.id)!.confirmedWarnings.map((warning) => (
                    <div className="confirmed-row" key={warning.code}>
                      <span>✅ Подтверждено: {warning.text}</span>
                      <button className="btn tiny ghost" onClick={() => confirmWarning(sel.id, warning.code, false)}>↺ Отменить</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
          ) : (
            <section className="card module-editor-empty">
              <span className="eyebrow">Редактор позиции</span>
              <h3>Выберите модуль слева</h3>
              <p className="muted">Редактор больше не прячется под длинным списком модулей: карточка выбранной позиции открывается в правой колонке и остаётся рядом с таблицей.</p>
            </section>
          )}
        </div>
      )}

      {/* Проверка перед расчётом */}
      {mods.length > 0 && (
        <section className="card">
          <h3>Проверка перед расчётом</h3>
          {allProblems.length === 0 && allConfirmed.length === 0
            ? <div className="ok-box">✅ Все позиции укомплектованы. Расчёт полный.</div>
            : (
              <>
                {allProblems.some((p) => p.critical) && <div className="warn-box">⛔ Критические проблемы: строки по недостающим данным НЕ включены в расчёт — итог занижен, пока всё не заполнено.</div>}
                {allProblems.length > 0 && (
                  <ul className="problems">
                    {allProblems.map((p) => (
                      <li key={`${p.mod.id}-${p.code ?? p.text}`} className={p.critical ? 'crit' : ''}>
                        <button className="link" onClick={() => setSelId(p.mod.id)}>{p.mod.name}</button>: {p.text}
                        {p.code && WARNING_SLOT[p.code] && (
                          <button className="btn tiny ghost" onClick={() => setPick({ slot: WARNING_SLOT[p.code!]!.slot, moduleId: p.mod.id })}>{WARNING_SLOT[p.code!]!.label}</button>
                        )}
                        {p.code && <button className="btn tiny" onClick={() => confirmWarning(p.mod.id, p.code!, true)}>✓ Подтвердить</button>}
                      </li>
                    ))}
                  </ul>
                )}
                {allConfirmed.length > 0 && (
                  <div className="confirmed-warnings">
                    {allConfirmed.map((warning) => (
                      <div className="confirmed-row" key={`${warning.mod.id}-${warning.code}`}>
                        <span><button className="link" onClick={() => setSelId(warning.mod.id)}>{warning.mod.name}</button>: ✅ Подтверждено: {warning.text}</span>
                        <button className="btn tiny ghost" onClick={() => confirmWarning(warning.mod.id, warning.code, false)}>↺ Отменить</button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          <div className="muted small">
            Сводка: модулей {summary.modules} · фасадов {summary.facades} · ящиков {summary.drawers} · петель {summary.hinges} · ручек {summary.handles} · подъёмников {summary.lifts}
          </div>
        </section>
      )}

      {pickSurcharge && sel && (
        <CatalogPicker
          pricebook={pricebook}
          pickOnly
          poolFilter={(i) => i.priceKind === 'percent'}
          title={`Процентная надбавка — для позиции «${sel.name}» (считается от суммы корпуса)`}
          onAdd={(item) => {
            updMod(sel.id, { surcharges: [...(sel.surcharges ?? []), item.id] });
            setPickSurcharge(false);
          }}
          onClose={() => setPickSurcharge(false)}
        />
      )}

      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          {toast.undo && <button className="btn tiny" onClick={() => toast.undo?.()}>↶ Отменить</button>}
          <button className="btn tiny ghost" onClick={() => setToast(null)}>✕</button>
        </div>
      )}

      {pick && (
        <CatalogPicker
          pricebook={pricebook}
          pickOnly
          poolFilter={SLOT_POOLS[pick.slot]}
          title={pick.moduleId
            ? `${SLOT_LABELS[pick.slot]} — для позиции «${mods.find((m) => m.id === pick.moduleId)?.name}» (только эта позиция)`
            : `${SLOT_LABELS[pick.slot]} — настройка всего проекта`}
          onAdd={(item) => {
            if (pick.moduleId) {
              const m = mods.find((x) => x.id === pick.moduleId)!;
              const withBody = { ...m, slots: { ...m.slots, [pick.slot]: { mode: 'manual', itemId: item.id } } };
              if (pick.slot === 'body') {
                // Выбор корпуса только обновляет слот. Техническая фасадная схема
                // отображается рядом и применяется отдельной кнопкой.
                updMod(m.id, { slots: withBody.slots, facadeSpecStatus: m.facadeParts?.length ? 'outdated' : 'recommended', hingeSpecStatus: m.hingeSpecStatus === 'applied' ? 'outdated' : m.hingeSpecStatus });
              } else {
                updMod(m.id, { slots: withBody.slots });
              }
            } else {
              props.onChange({ ...project, moduleDefaults: { ...defaults, [pick.slot]: item.id } });
            }
            setPick(null);
          }}
          onClose={() => setPick(null)}
        />
      )}
    </>
  );
}
