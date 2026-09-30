import { useState } from 'react';
import type { ExtraFacadePart, KitchenModule, KitchenWall, Pricebook, SlotKey } from '../types';
import { SLOT_LABELS, SLOT_POOLS } from '../lib/modules';
import { applyBulkModuleEdits, copyModuleValues, type BulkModulePatch } from '../lib/bulkEdit';
import CatalogPicker from './CatalogPicker';

const SLOTS: SlotKey[] = ['body', 'facade', 'frame', 'hinge', 'drawerSys', 'lift', 'handle', 'shelf', 'legs'];
type Draft = { widthMm: string; heightMm: string; depthMm: string; wall: KitchenWall; slots: Partial<Record<SlotKey, string | null>>; extraFacadeParts: ExtraFacadePart[]; surcharges: string[] };

export default function BulkEditPanel(props: { modules: KitchenModule[]; selectedIds: string[]; pricebook: Pricebook; onApply: (modules: KitchenModule[]) => void; onClose: () => void }) {
  const { modules, selectedIds, pricebook } = props;
  const [applyDimensions, setApplyDimensions] = useState(true);
  const [applyWall, setApplyWall] = useState(false);
  const [applySlots, setApplySlots] = useState<SlotKey[]>([]);
  const [applyExtras, setApplyExtras] = useState(false);
  const [applySurcharges, setApplySurcharges] = useState(false);
  const [sourceId, setSourceId] = useState(selectedIds[0] ?? '');
  const [pickSlot, setPickSlot] = useState<SlotKey | null>(null);
  const [draft, setDraft] = useState<Draft>({ widthMm: '', heightMm: '', depthMm: '', wall: 'back', slots: {}, extraFacadeParts: [], surcharges: [] });
  const selected = modules.filter((module) => selectedIds.includes(module.id));

  const patchFromDraft = (): BulkModulePatch => {
    const patch: BulkModulePatch = {};
    if (applyDimensions) {
      patch.widthMm = draft.widthMm === '' ? null : Number(draft.widthMm);
      patch.heightMm = draft.heightMm === '' ? null : Number(draft.heightMm);
      patch.depthMm = draft.depthMm === '' ? null : Number(draft.depthMm);
    }
    if (applyWall) patch.wall = draft.wall;
    if (applySlots.length > 0) patch.slots = Object.fromEntries(applySlots.map((slot) => [slot, draft.slots[slot] ?? null])) as Partial<Record<SlotKey, string | null>>;
    if (applyExtras) patch.extraFacadeParts = draft.extraFacadeParts;
    if (applySurcharges) patch.surcharges = draft.surcharges;
    return patch;
  };
  const copyValues = () => {
    const source = modules.find((module) => module.id === sourceId);
    if (!source) return;
    const patch = copyModuleValues(source);
    setDraft({ widthMm: patch.widthMm?.toString() ?? '', heightMm: patch.heightMm?.toString() ?? '', depthMm: patch.depthMm?.toString() ?? '', wall: patch.wall ?? 'back', slots: patch.slots ?? {}, extraFacadeParts: patch.extraFacadeParts ?? [], surcharges: patch.surcharges ?? [] });
    setApplyDimensions(true);
    setApplyWall(Boolean(patch.wall));
    setApplySlots(SLOTS);
    setApplyExtras((patch.extraFacadeParts?.length ?? 0) > 0);
    setApplySurcharges((patch.surcharges?.length ?? 0) > 0);
  };
  const apply = () => {
    const next = applyBulkModuleEdits(modules, selectedIds, patchFromDraft());
    props.onApply(next);
    props.onClose();
  };

  return (
    <section className="card bulk-edit-panel">
      <div className="bulk-head"><div><h3>Массовое редактирование</h3><p className="muted small">Выбрано модулей: {selected.length}. Пустые поля при применении размеров очищают значение — проверьте флажки.</p></div><button className="btn tiny ghost" onClick={props.onClose}>Закрыть</button></div>
      <div className="bulk-copy-row"><label>Источник для копирования<select value={sourceId} onChange={(event) => setSourceId(event.target.value)}>{selected.map((module) => <option key={module.id} value={module.id}>{module.name}</option>)}</select></label><button className="btn ghost" disabled={!sourceId} onClick={copyValues}>Скопировать значения</button><span className="muted small">Скопированные значения появятся в форме ниже.</span></div>
      <div className="bulk-options">
        <label className="chk"><input type="checkbox" checked={applyDimensions} onChange={(event) => setApplyDimensions(event.target.checked)} /> размеры</label>
        <label className="chk"><input type="checkbox" checked={applyWall} onChange={(event) => setApplyWall(event.target.checked)} /> стена</label>
        <label className="chk" title="Отдельные фасадные детали (боковины, накладки) источника заменят списки у выбранных модулей"><input type="checkbox" checked={applyExtras} onChange={(event) => setApplyExtras(event.target.checked)} /> отдельные фасадные детали{applyExtras ? ` (${draft.extraFacadeParts.length})` : ''}</label>
        <label className="chk" title="Процентные надбавки нестандартных габаритов источника заменят списки у выбранных модулей"><input type="checkbox" checked={applySurcharges} onChange={(event) => setApplySurcharges(event.target.checked)} /> нестандартные надбавки{applySurcharges ? ` (${draft.surcharges.length})` : ''}</label>
      </div>
      <div className="grid3 bulk-dimensions">
        <label>Ширина, мм<input disabled={!applyDimensions} type="number" value={draft.widthMm} placeholder="не менять" onChange={(event) => setDraft({ ...draft, widthMm: event.target.value })} /></label>
        <label>Высота, мм<input disabled={!applyDimensions} type="number" value={draft.heightMm} placeholder="не менять" onChange={(event) => setDraft({ ...draft, heightMm: event.target.value })} /></label>
        <label>Глубина, мм<input disabled={!applyDimensions} type="number" value={draft.depthMm} placeholder="не менять" onChange={(event) => setDraft({ ...draft, depthMm: event.target.value })} /></label>
        <label>Стена<select disabled={!applyWall} value={draft.wall} onChange={(event) => setDraft({ ...draft, wall: event.target.value as KitchenWall })}><option value="left">Левая</option><option value="back">Задняя</option><option value="right">Правая</option></select></label>
      </div>
      <h4>Комплектация: применить выбранные значения ко всем модулям</h4>
      <div className="bulk-slots">{SLOTS.map((slot) => { const item = pricebook.items.find((candidate) => candidate.id === draft.slots[slot]); const enabled = applySlots.includes(slot); return <div className="bulk-slot" key={slot}><label className="chk"><input type="checkbox" checked={enabled} onChange={(event) => setApplySlots((current) => event.target.checked ? [...current, slot] : current.filter((value) => value !== slot))} />{SLOT_LABELS[slot]}</label><span className={item ? '' : 'muted'}>{item?.name ?? 'не выбрано'}</span><button className="btn tiny" onClick={() => setPickSlot(slot)}>Выбрать…</button></div>; })}</div>
      <div className="bulk-footer"><span className="muted small">Ручной выбор получает приоритет над настройками проекта. Ничего не применяется до нажатия кнопки.</span><button className="btn primary" onClick={apply}>Применить к выбранным</button></div>
      {pickSlot && <CatalogPicker pricebook={pricebook} pickOnly poolFilter={SLOT_POOLS[pickSlot]} title={`Массовое значение: ${SLOT_LABELS[pickSlot]}`} onAdd={(item) => { setDraft({ ...draft, slots: { ...draft.slots, [pickSlot]: item.id } }); if (!applySlots.includes(pickSlot)) setApplySlots([...applySlots, pickSlot]); setPickSlot(null); }} onClose={() => setPickSlot(null)} />}
    </section>
  );
}
