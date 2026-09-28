import { useState } from 'react';
import type { CalculationVariant, Pricebook, Project, SlotKey } from '../types';
import { SLOT_LABELS, SLOT_POOLS } from '../lib/modules';
import { checklistPool, lineMatchesChecklistKey } from '../lib/checklist';
import { calculateVariant, createVariant, VARIANT_PRESETS } from '../lib/variants';
import { fmtMoney } from '../lib/format';
import CatalogPicker from './CatalogPicker';

const VARIANT_SLOTS: SlotKey[] = ['facade', 'frame', 'hinge', 'drawerSys', 'handle'];

export default function VariantsPanel(props: { project: Project; pricebook: Pricebook; onChange: (project: Project) => void }) {
  const { project, pricebook } = props;
  const variants = project.variants ?? [];
  const [pick, setPick] = useState<{ variantId: string; slot: SlotKey } | null>(null);
  const [surfacePick, setSurfacePick] = useState<{ variantId: string; key: 'worktop' | 'wallPanel' } | null>(null);

  const createPresets = () => {
    const next = VARIANT_PRESETS.map((preset) => createVariant(preset.name, preset.description, project.settings));
    props.onChange({ ...project, variants: next, selectedVariantId: next[1].id });
  };
  const updateVariant = (id: string, patch: Partial<CalculationVariant>) => props.onChange({ ...project, variants: variants.map((variant) => variant.id === id ? { ...variant, ...patch } : variant) });
  const removeVariant = (id: string) => {
    const next = variants.filter((variant) => variant.id !== id);
    props.onChange({ ...project, variants: next, selectedVariantId: project.selectedVariantId === id ? next[0]?.id : project.selectedVariantId });
  };
  const addVariant = () => {
    const variant = createVariant(`Вариант ${variants.length + 1}`, 'Новый состав для сравнения', project.settings);
    props.onChange({ ...project, variants: [...variants, variant] });
  };

  const prices = new Map(variants.map((variant) => [variant.id, calculateVariant(project, pricebook, variant)]));
  if (variants.length === 0) return <section className="card variants-empty"><h3>Варианты расчёта</h3><p className="muted">Сравните «Эконом», «Стандарт» и «Премиум», не меняя основной состав проекта.</p><button className="btn primary" onClick={createPresets}>Создать 3 варианта</button></section>;

  return (
    <div className="variants-panel">
      <div className="variants-toolbar"><div><h2>Варианты расчёта</h2><p className="muted small">Значения варианта используются только для сравнения. Основной проект не меняется, пока вы не выберете вариант для КП.</p></div><button className="btn ghost" onClick={addVariant}>+ Добавить вариант</button></div>
      <div className="variant-grid">{variants.map((variant) => {
        const calculated = prices.get(variant.id)!;
        const selected = project.selectedVariantId === variant.id;
        return <section className={`card variant-card ${selected ? 'selected' : ''}`} key={variant.id}>
          <div className="variant-card-head"><div><input className="variant-name" value={variant.name} onChange={(event) => updateVariant(variant.id, { name: event.target.value })} /><input className="variant-description" value={variant.description} placeholder="Описание для клиента" onChange={(event) => updateVariant(variant.id, { description: event.target.value })} /></div><button className="btn tiny danger" onClick={() => removeVariant(variant.id)}>Удалить</button></div>
          <div className="variant-prices"><div><span>Себестоимость</span><b>{fmtMoney(calculated.totals.cost)}</b></div><div><span>Цена клиента</span><b>{fmtMoney(calculated.totals.client)}</b></div></div>
          <div className="variant-composition"><b>Состав: {calculated.lines.length} строк</b><span>{(project.modules ?? []).length} модулей · {project.lines.length} доп. позиций</span></div>
          <h4>Фасады и фурнитура</h4>
          <div className="variant-slots">{VARIANT_SLOTS.map((slot) => { const item = pricebook.items.find((candidate) => candidate.id === variant.slotOverrides[slot]); return <div className="variant-slot" key={slot}><span>{SLOT_LABELS[slot]}</span><b className={item ? '' : 'muted'}>{item?.name ?? 'Без переопределения'}</b><button className="btn tiny" onClick={() => setPick({ variantId: variant.id, slot })}>Выбрать</button>{item && <button className="btn tiny ghost" onClick={() => updateVariant(variant.id, { slotOverrides: { ...variant.slotOverrides, [slot]: null } })}>✕</button>}</div>; })}</div>
          <h4>Столешница и стеновая панель</h4>
          <div className="variant-slots">{(['worktop', 'wallPanel'] as const).map((surfaceKey) => {
            const overrideId = variant.surfaceOverrides?.[surfaceKey];
            const item = pricebook.items.find((candidate) => candidate.id === overrideId);
            const projectLine = (project.lines ?? []).find((line) => lineMatchesChecklistKey(surfaceKey, line));
            return <div className="variant-slot" key={surfaceKey}>
              <span>{surfaceKey === 'worktop' ? 'Столешница' : 'Стеновая панель'}</span>
              <b className={item ? '' : 'muted'}>{item?.name ?? (projectLine ? `Как в проекте: ${projectLine.name.slice(0, 42)}` : 'Как в проекте (позиции нет)')}</b>
              <button className="btn tiny" onClick={() => setSurfacePick({ variantId: variant.id, key: surfaceKey })}>Выбрать</button>
              {item && <button className="btn tiny ghost" title="Вернуть позицию проекта" onClick={() => updateVariant(variant.id, { surfaceOverrides: { ...variant.surfaceOverrides, [surfaceKey]: null } })}>✕</button>}
            </div>;
          })}</div>
          <label className="chk variant-visible"><input type="checkbox" checked={variant.clientVisible} onChange={(event) => updateVariant(variant.id, { clientVisible: event.target.checked })} /> показывать в клиентской версии</label>
          <button className={`btn ${selected ? 'primary' : 'ghost'} variant-select`} onClick={() => props.onChange({ ...project, selectedVariantId: variant.id })}>{selected ? '✓ Выбран для КП' : 'Выбрать для клиентского КП'}</button>
        </section>;
      })}</div>
      <div className="note">В КП попадут варианты с флажком «показывать». Выбранный вариант отмечен как основной и используется для итоговой цены.</div>
      {pick && <CatalogPicker pricebook={pricebook} pickOnly poolFilter={SLOT_POOLS[pick.slot]} title={`Переопределение: ${SLOT_LABELS[pick.slot]}`} onAdd={(item) => { const variant = variants.find((candidate) => candidate.id === pick.variantId); if (variant) updateVariant(variant.id, { slotOverrides: { ...variant.slotOverrides, [pick.slot]: item.id } }); setPick(null); }} onClose={() => setPick(null)} />}
      {surfacePick && <CatalogPicker pricebook={pricebook} pickOnly poolFilter={(i) => checklistPool(surfacePick.key, i.category, i.name)} title={`Переопределение: ${surfacePick.key === 'worktop' ? 'Столешница' : 'Стеновая панель'} — длина/листы берутся из позиции проекта`} onAdd={(item) => { const variant = variants.find((candidate) => candidate.id === surfacePick.variantId); if (variant) updateVariant(variant.id, { surfaceOverrides: { ...variant.surfaceOverrides, [surfacePick.key]: item.id } }); setSurfacePick(null); }} onClose={() => setSurfacePick(null)} />}
    </div>
  );
}
