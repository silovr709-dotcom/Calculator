import { useMemo, useState } from 'react';
import type { KitchenModule, KitchenWall, ModuleDefaults, Pricebook, Project, SlotKey, Template } from '../types';
import { MODULE_TYPES, SLOT_LABELS, SLOT_POOLS, checkModule, moveModule, modulesSummary, moduleToLines, newModule, resolveSlot, setWarningConfirmed, slotNeed } from '../lib/modules';
import { calcTotals } from '../lib/engine';
import { fmtMoney, fmtNum } from '../lib/format';
import { LAYOUT_SHAPES, WALL_LABELS, WALL_SHORT_LABELS, layoutWalls, moduleWall, normalizeLayoutShape } from '../lib/kitchenSketch';
import CatalogPicker from './CatalogPicker';
import KitchenSketch from './KitchenSketch';

const DEFAULT_SLOTS: SlotKey[] = ['facade', 'hinge', 'drawerSys', 'lift', 'handle', 'shelf'];
const ALL_SLOTS: SlotKey[] = ['body', 'facade', 'hinge', 'drawerSys', 'lift', 'handle', 'shelf'];
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
  // Панель монтируется при переходе с вкладки эскиза, поэтому значение focusModuleId
  // можно безопасно использовать как начальное состояние без каскадного эффекта.
  const [selId, setSelId] = useState<string | null>(() => props.focusModuleId ?? null);
  const [showSketch, setShowSketch] = useState(() => Boolean(props.focusModuleId));
  const [addOpen, setAddOpen] = useState(false);
  // выбор в каталоге: для настроек проекта или для слота конкретного модуля
  const [pick, setPick] = useState<{ slot: SlotKey; moduleId: string | null } | null>(null);
  const [pickSurcharge, setPickSurcharge] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean } | null>(null);

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

  const checks = useMemo(() => new Map(mods.map((m) => [m.id, checkModule(m, defaults, pricebook)])), [mods, defaults, pricebook]);
  const costs = useMemo(() => new Map(mods.map((m) => {
    const lines = moduleToLines(m, defaults, pricebook);
    return [m.id, calcTotals(lines, project.settings).totals.cost];
  })), [mods, defaults, pricebook, project.settings]);
  const summary = useMemo(() => modulesSummary(mods), [mods]);

  const addModule = (type: string) => {
    const m = newModule(type);
    setMods([...mods, m]);
    setSelId(m.id);
    setAddOpen(false);
  };

  /** Вставка модулей из шаблона: новые id, слоты и надбавки копируются как есть */
  const insertFromTemplate = (t: Template) => {
    const copies: KitchenModule[] = (t.modules ?? []).map((x) => ({ ...JSON.parse(JSON.stringify(x)), id: newModule(x.type).id }));
    if (!copies.length) return;
    setMods([...mods, ...copies]);
    setSelId(copies[0].id);
    setAddOpen(false);
  };
  const moduleTemplates = (props.templates ?? []).filter((t) => (t.modules?.length ?? 0) > 0);

  const itemName = (id: string | null | undefined) => {
    if (!id) return null;
    const it = pricebook.items.find((i) => i.id === id);
    return it ? `${it.name.slice(0, 48)}${it.attrs?.['толщина'] && !it.name.includes(it.attrs['толщина']) ? ` · ${it.attrs['толщина']}` : ''}` : '⚠ позиция не найдена в прайсе';
  };

  const statusDot = (l: 'ok' | 'warn' | 'error') => l === 'ok' ? <span className="dot ok" title="Готово">●</span> : l === 'warn' ? <span className="dot warn" title="Требует подтверждения">●</span> : <span className="dot err" title="Не хватает обязательных данных">●</span>;

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
            <div className="dropdown-menu static">
              {MODULE_TYPES.map((t) => <button key={t} onClick={() => addModule(t)}>{t}</button>)}
              <button onClick={() => { const t = prompt('Название собственного типа позиции:'); if (t?.trim()) addModule(t.trim()); }}>Свой тип…</button>
              {moduleTemplates.length > 0 && <div className="menu-sep">Из шаблона:</div>}
              {moduleTemplates.map((t) => (
                <button key={t.id} onClick={() => insertFromTemplate(t)}>⧉ {t.name} ({t.modules!.length} мод.)</button>
              ))}
            </div>
          )}
        </div>
        <button className="btn ghost" onClick={() => setShowSketch((value) => !value)}>🎨 {showSketch ? 'Скрыть эскиз ▲' : 'Показать эскиз ▼'}</button>
        {allProblems.some((p) => p.critical) && <span className="warn">⛔ есть позиции с неполными данными — см. проверку внизу</span>}
      </div>

      {showSketch && (
        <KitchenSketch
          mode="compact"
          modules={mods}
          settings={project.sketch}
          onSettingsChange={(sketch) => props.onChange({ ...project, sketch })}
          onSelectModule={setSelId}
          onReorder={(id, direction) => reorder(id, direction)}
        />
      )}

      {/* Таблица позиций */}
      {mods.length === 0 ? (
        <div className="empty">Позиций пока нет. Нажмите «+ Добавить позицию», выберите тип (нижний шкаф, пенал…), затем задайте размеры и комплектацию.</div>
      ) : (
        <>
          <div className="module-order-hint">↕ Порядок позиций задаёт порядок модулей в эскизе</div>
          <table className="table modules">
            <thead>
              <tr><th>№</th><th>Позиция</th><th>Размер, мм</th><th className="num">Кол.</th><th className="num">Фас.</th><th className="num">Ящ.</th><th>Комплектация</th><th className="num">Себест.</th><th>Ст.</th><th /></tr>
            </thead>
            <tbody>
              {mods.map((m, idx) => {
                const c = checks.get(m.id)!;
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
                  <td><b>{m.name}</b><div className="muted small">{m.type}{walls.length > 1 ? ` · ${WALL_SHORT_LABELS[moduleWall(m, shape)].toLocaleLowerCase('ru')} стена` : ''}</div></td>
                  <td className="small dims" onClick={(e) => e.stopPropagation()}>
                    <input className="dim" type="number" placeholder="Ш" value={m.widthMm ?? ''} onChange={(e) => updMod(m.id, { widthMm: Number(e.target.value) || null })} />×
                    <input className="dim" type="number" placeholder="В" value={m.heightMm ?? ''} onChange={(e) => updMod(m.id, { heightMm: Number(e.target.value) || null })} />×
                    <input className="dim" type="number" placeholder="Г" value={m.depthMm ?? ''} onChange={(e) => updMod(m.id, { depthMm: Number(e.target.value) || null })} />
                  </td>
                  <td className="num" onClick={(e) => e.stopPropagation()}>
                    <input className="qty cell" type="number" min={0} value={m.qty} onChange={(e) => updMod(m.id, { qty: Number(e.target.value) || 0 })} />
                  </td>
                  <td className="num" onClick={(e) => e.stopPropagation()}>
                    <input className="qty cell" type="number" min={0} value={m.facades} onChange={(e) => updMod(m.id, { facades: Number(e.target.value) || 0 })} />
                  </td>
                  <td className="num" onClick={(e) => e.stopPropagation()}>
                    <input className="qty cell" type="number" min={0} value={m.drawers} onChange={(e) => updMod(m.id, { drawers: Number(e.target.value) || 0 })} />
                  </td>
                  <td className="small">{chosen.length}/{filled.length} выбрано{c.level === 'error' ? <span className="warn"> · не хватает данных</span> : c.level === 'warn' ? ' · подтвердите' : ''}</td>
                  <td className="num">{fmtMoney(costs.get(m.id) ?? 0)}</td>
                  <td>{statusDot(c.level)}</td>
                  <td>
                    <button className="btn tiny ghost" title="Дублировать" onClick={(e) => { e.stopPropagation(); const cp = { ...JSON.parse(JSON.stringify(m)), id: newModule(m.type).id, name: `${m.name} (копия)` }; setMods([...mods, cp]); }}>⧉</button>
                    <button className="btn tiny danger" title="Удалить" onClick={(e) => { e.stopPropagation(); setMods(mods.filter((x) => x.id !== m.id)); if (selId === m.id) setSelId(null); }}>✕</button>
                  </td>
                </tr>
              );
            })}
            </tbody>
          </table>
        </>
      )}

      {/* Редактор выбранной позиции */}
      {sel && (
        <section className="card mod-editor">
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
            <label>Ширина<input type="number" value={sel.widthMm ?? ''} placeholder="напр. 800" onChange={(e) => updMod(sel.id, { widthMm: Number(e.target.value) || null })} /></label>
            <label>Высота<input type="number" value={sel.heightMm ?? ''} placeholder="напр. 720" onChange={(e) => updMod(sel.id, { heightMm: Number(e.target.value) || null })} /></label>
            <label>Глубина<input type="number" value={sel.depthMm ?? ''} placeholder="напр. 560" onChange={(e) => updMod(sel.id, { depthMm: Number(e.target.value) || null })} /></label>
          </div>
          <h4>Конструкция (на один модуль)</h4>
          <div className="grid4">
            <label>Фасадов, шт<input type="number" min={0} value={sel.facades} onChange={(e) => updMod(sel.id, { facades: Number(e.target.value) || 0 })} /></label>
            <label>Ящиков, шт<input type="number" min={0} value={sel.drawers} onChange={(e) => updMod(sel.id, { drawers: Number(e.target.value) || 0 })} /></label>
            <label>Полок, шт<input type="number" min={0} value={sel.shelves} onChange={(e) => updMod(sel.id, { shelves: Number(e.target.value) || 0 })} /></label>
            <label>Петель, шт<input type="number" min={0} value={sel.hinges} onChange={(e) => updMod(sel.id, { hinges: Number(e.target.value) || 0 })} /></label>
            <label>Ручек, шт<input type="number" min={0} value={sel.handles} onChange={(e) => updMod(sel.id, { handles: Number(e.target.value) || 0 })} /></label>
            <label>Подъёмников, шт<input type="number" min={0} value={sel.lifts} onChange={(e) => updMod(sel.id, { lifts: Number(e.target.value) || 0 })} /></label>
          </div>
          {sel.facades > 0 && (
            <>
              <h4>Размер одного фасада, мм (для площади — материал за м²)</h4>
              <div className="grid3">
                <label>Ширина фасада<input type="number" value={sel.facadeWmm ?? ''} placeholder="напр. 396" onChange={(e) => updMod(sel.id, { facadeWmm: Number(e.target.value) || null })} /></label>
                <label>Высота фасада<input type="number" value={sel.facadeHmm ?? ''} placeholder="напр. 716" onChange={(e) => updMod(sel.id, { facadeHmm: Number(e.target.value) || null })} /></label>
                {sel.widthMm && sel.heightMm ? (
                  <button className="btn tiny add self-end" onClick={() => updMod(sel.id, { facadeWmm: Math.round(sel.widthMm! / sel.facades), facadeHmm: sel.heightMm })}>
                    подставить {Math.round(sel.widthMm / sel.facades)}×{sel.heightMm} (Ш÷{sel.facades} × В модуля)
                  </button>
                ) : <div className="muted small self-end">…или задайте размеры модуля — предложим подстановку</div>}
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
                    <button className="btn tiny danger" onClick={() => updMod(sel.id, { surcharges: (sel.surcharges ?? []).filter((x) => x !== sid) })}>✕</button>
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
              updMod(m.id, { slots: { ...m.slots, [pick.slot]: { mode: 'manual', itemId: item.id } } });
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
