import { useMemo, useState } from 'react';
import type { KitchenModule, KitchenWall, Project } from '../types';
import { buildKitchenLayout, layoutWalls, moduleWall, WALL_LABELS } from '../lib/kitchenSketch';
import { MODULE_TYPES, newModule } from '../lib/modules';

interface SketchDraftPreset {
  id: string;
  label: string;
  type: string;
  name: string;
  widthMm: number;
  heightMm: number;
  depthMm: number;
  facades: number;
  drawers: number;
  shelves: number;
  hinges: number;
  handles: number;
  lifts: number;
}

const EMPTY_MODULES: KitchenModule[] = [];

const SKETCH_PRESETS: SketchDraftPreset[] = [
  { id: 'base-600', label: 'Низ 600', type: 'Нижний шкаф', name: 'Низ 600', widthMm: 600, heightMm: 720, depthMm: 560, facades: 1, drawers: 0, shelves: 1, hinges: 2, handles: 1, lifts: 0 },
  { id: 'base-800', label: 'Низ 800 · 2 двери', type: 'Нижний шкаф', name: 'Низ 800 · 2 двери', widthMm: 800, heightMm: 720, depthMm: 560, facades: 2, drawers: 0, shelves: 1, hinges: 4, handles: 2, lifts: 0 },
  { id: 'drawers-600', label: 'Низ 600 · 3 ящика', type: 'Нижний шкаф', name: 'Низ 600 · 3 ящика', widthMm: 600, heightMm: 720, depthMm: 560, facades: 3, drawers: 3, shelves: 0, hinges: 0, handles: 3, lifts: 0 },
  { id: 'sink-800', label: 'Мойка 800', type: 'Шкаф под мойку', name: 'Шкаф под мойку 800', widthMm: 800, heightMm: 720, depthMm: 560, facades: 2, drawers: 0, shelves: 0, hinges: 4, handles: 2, lifts: 0 },
  { id: 'oven-600', label: 'ДШ 600', type: 'Шкаф под духовой шкаф', name: 'Шкаф под ДШ 600', widthMm: 600, heightMm: 720, depthMm: 560, facades: 1, drawers: 1, shelves: 0, hinges: 0, handles: 1, lifts: 0 },
  { id: 'wall-600', label: 'Верх 600', type: 'Верхний шкаф', name: 'Верх 600', widthMm: 600, heightMm: 720, depthMm: 320, facades: 1, drawers: 0, shelves: 1, hinges: 2, handles: 1, lifts: 0 },
  { id: 'wall-800', label: 'Верх 800 · 2 двери', type: 'Верхний шкаф', name: 'Верх 800 · 2 двери', widthMm: 800, heightMm: 720, depthMm: 320, facades: 2, drawers: 0, shelves: 1, hinges: 4, handles: 2, lifts: 0 },
  { id: 'tall-600', label: 'Пенал 600', type: 'Пенал', name: 'Пенал 600', widthMm: 600, heightMm: 2140, depthMm: 560, facades: 2, drawers: 0, shelves: 4, hinges: 4, handles: 2, lifts: 0 },
];

function draftFromPreset(preset: SketchDraftPreset) {
  return { ...preset, qty: 1 };
}

function n(value: string, fallback = 0): number {
  return Number(value) || fallback;
}

function moduleWidth(module: KitchenModule): number {
  return module.widthMm && module.widthMm > 0 ? module.widthMm * Math.max(1, module.qty) : 0;
}

export default function SketchProPanel(props: {
  project: Project;
  onChange: (project: Project) => void;
  selectedModuleId?: string | null;
  onSelectCreated?: (id: string) => void;
  onOpenModule?: (id: string) => void;
  onReorder?: (moduleId: string, direction: -1 | 1) => void;
}) {
  const walls = layoutWalls(props.project.sketch?.shape);
  const [wall, setWall] = useState<KitchenWall>(walls[0] ?? 'back');
  const [draft, setDraft] = useState(() => draftFromPreset(SKETCH_PRESETS[0]));
  const modules = props.project.modules ?? EMPTY_MODULES;
  const currentWall = walls.includes(wall) ? wall : (walls[0] ?? 'back');
  const selected = modules.find((module) => module.id === props.selectedModuleId) ?? null;
  const selectedIndex = selected ? modules.findIndex((module) => module.id === selected.id) : -1;
  const layout = useMemo(() => buildKitchenLayout(modules, props.project.sketch?.shape), [modules, props.project.sketch?.shape]);

  const setPreset = (preset: SketchDraftPreset) => {
    setDraft(draftFromPreset(preset));
    if (preset.type === 'Верхний шкаф') setWall((props.project.sketch?.shape === 'straight' ? 'back' : currentWall));
  };
  const patch = (next: Partial<typeof draft>) => setDraft((current) => ({ ...current, ...next }));
  const setModules = (next: KitchenModule[]) => props.onChange({ ...props.project, modules: next });
  const updateSelected = (patchValue: Partial<KitchenModule>) => {
    if (!selected) return;
    setModules(modules.map((module) => (module.id === selected.id ? { ...module, ...patchValue } : module)));
  };
  const setWallLength = (targetWall: KitchenWall, value: number | null) => {
    props.onChange({
      ...props.project,
      sketch: {
        ...props.project.sketch,
        wallLengthsMm: { ...(props.project.sketch?.wallLengthsMm ?? {}), [targetWall]: value },
      },
    });
  };
  const add = () => {
    if (draft.widthMm <= 0 || draft.heightMm <= 0 || draft.depthMm <= 0 || draft.qty <= 0) return;
    const module = {
      ...newModule(draft.type),
      name: draft.name.trim() || draft.type,
      qty: draft.qty,
      widthMm: draft.widthMm,
      heightMm: draft.heightMm,
      depthMm: draft.depthMm,
      facades: draft.facades,
      drawers: draft.drawers,
      shelves: draft.shelves,
      hinges: draft.hinges,
      handles: draft.handles,
      lifts: draft.lifts,
      wall: currentWall,
    };
    props.onChange({ ...props.project, modules: [...modules, module] });
    props.onSelectCreated?.(module.id);
  };
  const duplicateSelected = () => {
    if (!selected) return;
    const copy = { ...JSON.parse(JSON.stringify(selected)), id: newModule(selected.type).id, name: `${selected.name} (копия)` } as KitchenModule;
    setModules([...modules, copy]);
    props.onSelectCreated?.(copy.id);
  };
  const deleteSelected = () => {
    if (!selected) return;
    if (!confirm(`Удалить модуль «${selected.name}» из эскиза и расчёта?`)) return;
    setModules(modules.filter((module) => module.id !== selected.id));
  };

  return (
    <section className="card sketch-pro-panel no-print">
      <div className="sketch-pro-head">
        <div>
          <h3>Эскиз PRO → расчёт</h3>
          <p className="muted small">Добавляйте и правьте шкафы прямо из эскиза: все изменения сразу попадают в расчёт, КП, проверку и бланк фабрики.</p>
        </div>
        <span className="sketch-pro-badge">единая модель проекта</span>
      </div>

      <div className="sketch-pro-wall-status">
        {walls.map((item) => {
          const run = layout.walls.find((candidate) => candidate.wall === item);
          const used = run?.runWidth ?? modules.filter((module) => moduleWall(module, props.project.sketch?.shape) === item).reduce((sum, module) => sum + moduleWidth(module), 0);
          const length = props.project.sketch?.wallLengthsMm?.[item] ?? null;
          const free = length == null ? null : length - used;
          return (
            <div className={`sketch-wall-card ${free != null && free < 0 ? 'over' : ''}`} key={item}>
              <div><b>{WALL_LABELS[item]}</b><span>{used > 0 ? `занято ${Math.round(used)} мм` : 'модулей нет'}</span></div>
              <label>Длина стены<input type="number" min={0} value={length ?? ''} placeholder="мм" onChange={(event) => setWallLength(item, event.target.value ? Number(event.target.value) : null)} /></label>
              <em>{free == null ? 'задайте длину' : free >= 0 ? `остаток ${Math.round(free)} мм` : `переполнение ${Math.abs(Math.round(free))} мм`}</em>
              {used > 0 && <button className="btn tiny ghost" onClick={() => setWallLength(item, Math.round(used))}>по модулям</button>}
            </div>
          );
        })}
      </div>

      {selected && (
        <div className="sketch-pro-selected">
          <div className="sketch-pro-selected-head">
            <div><b>Выбран на эскизе: {selected.name}</b><span className="muted small">Правки ниже сразу меняют расчёт и КП.</span></div>
            <div className="actions">
              {props.onReorder && <button className="btn tiny ghost" disabled={selectedIndex <= 0} onClick={() => props.onReorder?.(selected.id, -1)}>◀</button>}
              {props.onReorder && <button className="btn tiny ghost" disabled={selectedIndex < 0 || selectedIndex >= modules.length - 1} onClick={() => props.onReorder?.(selected.id, 1)}>▶</button>}
              <button className="btn tiny ghost" onClick={() => props.onOpenModule?.(selected.id)}>Открыть карточку</button>
              <button className="btn tiny ghost" onClick={duplicateSelected}>Дублировать</button>
              <button className="btn tiny danger" onClick={deleteSelected}>Удалить</button>
            </div>
          </div>
          <div className="sketch-pro-edit-grid">
            <label>Название<input value={selected.name} onChange={(event) => updateSelected({ name: event.target.value })} /></label>
            <label>Стена<select value={moduleWall(selected, props.project.sketch?.shape)} onChange={(event) => updateSelected({ wall: event.target.value as KitchenWall })}>{walls.map((item) => <option key={item} value={item}>{WALL_LABELS[item]}</option>)}</select></label>
            <label>Кол-во<input type="number" min={1} value={selected.qty} onChange={(event) => updateSelected({ qty: n(event.target.value, 1) })} /></label>
            <label>Ширина<input type="number" min={1} value={selected.widthMm ?? ''} onChange={(event) => updateSelected({ widthMm: event.target.value ? Number(event.target.value) : null })} /></label>
            <label>Высота<input type="number" min={1} value={selected.heightMm ?? ''} onChange={(event) => updateSelected({ heightMm: event.target.value ? Number(event.target.value) : null })} /></label>
            <label>Глубина<input type="number" min={1} value={selected.depthMm ?? ''} onChange={(event) => updateSelected({ depthMm: event.target.value ? Number(event.target.value) : null })} /></label>
            <label>Фасады<input type="number" min={0} value={selected.facades} onChange={(event) => updateSelected({ facades: n(event.target.value) })} /></label>
            <label>Ящики<input type="number" min={0} value={selected.drawers} onChange={(event) => updateSelected({ drawers: n(event.target.value) })} /></label>
          </div>
        </div>
      )}

      <div className="sketch-pro-presets">
        {SKETCH_PRESETS.map((preset) => (
          <button key={preset.id} className={draft.id === preset.id ? 'chip active' : 'chip'} onClick={() => setPreset(preset)}>{preset.label}</button>
        ))}
      </div>
      <div className="sketch-pro-grid">
        <label>Название<input value={draft.name} onChange={(event) => patch({ name: event.target.value })} /></label>
        <label>Тип<input list="sketch-pro-types" value={draft.type} onChange={(event) => patch({ type: event.target.value })} />
          <datalist id="sketch-pro-types">{MODULE_TYPES.map((type) => <option key={type} value={type} />)}</datalist>
        </label>
        <label>Стена<select value={currentWall} onChange={(event) => setWall(event.target.value as KitchenWall)}>{walls.map((item) => <option key={item} value={item}>{WALL_LABELS[item]}</option>)}</select></label>
        <label>Кол-во<input type="number" min={1} value={draft.qty} onChange={(event) => patch({ qty: Number(event.target.value) || 1 })} /></label>
        <label>Ширина, мм<input type="number" min={1} value={draft.widthMm} onChange={(event) => patch({ widthMm: Number(event.target.value) || 0 })} /></label>
        <label>Высота, мм<input type="number" min={1} value={draft.heightMm} onChange={(event) => patch({ heightMm: Number(event.target.value) || 0 })} /></label>
        <label>Глубина, мм<input type="number" min={1} value={draft.depthMm} onChange={(event) => patch({ depthMm: Number(event.target.value) || 0 })} /></label>
        <label>Фасады<input type="number" min={0} value={draft.facades} onChange={(event) => patch({ facades: Number(event.target.value) || 0 })} /></label>
        <label>Ящики<input type="number" min={0} value={draft.drawers} onChange={(event) => patch({ drawers: Number(event.target.value) || 0 })} /></label>
        <label>Полки<input type="number" min={0} value={draft.shelves} onChange={(event) => patch({ shelves: Number(event.target.value) || 0 })} /></label>
        <label>Петли<input type="number" min={0} value={draft.hinges} onChange={(event) => patch({ hinges: Number(event.target.value) || 0 })} /></label>
        <label>Ручки<input type="number" min={0} value={draft.handles} onChange={(event) => patch({ handles: Number(event.target.value) || 0 })} /></label>
      </div>
      <div className="sketch-pro-foot">
        <span className="muted small">Материалы и корпус выбираются в карточке позиции; фасады/петли можно уточнить рекомендациями по техничке.</span>
        <button className="btn primary" onClick={add}>+ Добавить на эскиз и в расчёт</button>
      </div>
    </section>
  );
}
