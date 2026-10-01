import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { EskizCommunicationAnchorKind, EskizCommunicationDistance, EskizCommunicationKind, EskizCommunicationMarker, EskizProIntegration, ExtraFacadePart, FacadePart, KitchenModule, Pricebook, PriceItem, Project, SlotKey } from '../types';
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
import { MODULE_TYPES, SLOT_LABELS, SLOT_POOLS, checkModule, moduleToLines, resolveSlot, setWarningConfirmed, slotNeed } from '../lib/modules';
import { applyTechnicalFacadeSpec, inferFacadeSpec, inferHingeSpec, isTechnicalFacadeSpecOutdated, isTechnicalHingeSpecOutdated } from '../lib/facades';
import { applyDimensionSurcharges, inferDimensionSurcharges } from '../lib/surcharges';
import { calcLines } from '../lib/engine';
import { fmtMoney, fmtNum } from '../lib/format';
import { COMMUNICATION_ANCHOR_LABELS, COMMUNICATION_KIND_META, COMMUNICATION_KINDS, communicationDistanceText, communicationSizeText } from '../lib/eskizCommunications';
import CatalogPicker from './CatalogPicker';
import EskizProjectPreview, { type EskizModulePreviewStatus } from './EskizProjectPreview';

const EMPTY_LINKS: string[] = [];
const EMPTY_SNAPSHOTS: NonNullable<EskizProIntegration['snapshots']> = [];
const EMPTY_BINDINGS: NonNullable<EskizProIntegration['moduleBindings']> = {};
const EMPTY_COMMUNICATIONS: NonNullable<EskizProIntegration['communications']> = [];
const EMPTY_ESKIZ_PRO: EskizProIntegration = {};
const QUICK_SLOTS: SlotKey[] = ['body', 'facade', 'frame', 'hinge', 'drawerSys', 'lift', 'handle', 'shelf', 'legs'];

function unique(items: string[]): string[] {
  return Array.from(new Set(items.filter(Boolean)));
}

function uid(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
}

function sameGithubPagesOrigin() {
  return typeof window !== 'undefined' && window.location.hostname === 'silovr709-dotcom.github.io';
}

function numberValue(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function shortLine(text: string, length = 76) {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function normSearch(value: string) {
  return value.toLocaleLowerCase('ru').replace(/ё/g, 'е');
}

function itemHaystack(item: PriceItem) {
  return normSearch(`${item.name} ${item.article ?? ''} ${item.category} ${item.subcategory ?? ''} ${Object.values(item.attrs ?? {}).join(' ')}`);
}

function firstDimensionMm(item: PriceItem): number | null {
  const attr = item.attrs?.['размер'] ?? '';
  const source = `${item.name} ${attr}`;
  const match = source.match(/(?:^|[^\d])(\d{2,4})\s*(?:мм|x|×|$)/iu);
  return match ? Number(match[1]) : null;
}

function recommendedSlotItemIds(slot: SlotKey, module: KitchenModule, pricebook: Pricebook): string[] {
  const moduleText = normSearch(`${module.name} ${module.type} ${module.note ?? ''}`);
  return pricebook.items
    .filter(SLOT_POOLS[slot])
    .filter((item) => item.priceKind === 'fixed')
    .map((item) => {
      let score = 0;
      const hay = itemHaystack(item);
      if (slot === 'body') {
        const width = firstDimensionMm(item);
        if (module.widthMm && width === module.widthMm) score += 60;
        if (module.widthMm && width && Math.abs(width - module.widthMm) <= 50) score += 20;
        if (/ниж|стол|тумб/iu.test(module.type) && /стол|тумб/iu.test(hay)) score += 18;
        if (/верх|навес/iu.test(module.type) && /настенн|верх/iu.test(hay)) score += 18;
        if (/пенал/iu.test(module.type) && /пенал/iu.test(hay)) score += 22;
        if (/мойк/iu.test(moduleText) && /мойк/iu.test(hay)) score += 25;
        if (/дух|дш|духов/iu.test(moduleText) && /дш|дух/iu.test(hay)) score += 25;
        if (/холод/iu.test(moduleText) && /холод/iu.test(hay)) score += 25;
      } else {
        if (module.facades > 0 && slot === 'facade') score += 10;
        if (module.hinges > 0 && slot === 'hinge') score += 10;
        if (module.drawers > 0 && slot === 'drawerSys') score += 10;
        if (module.handles > 0 && slot === 'handle') score += 10;
        if (module.lifts > 0 && slot === 'lift') score += 10;
        if ((module.legs ?? 0) > 0 && slot === 'legs') score += 10;
      }
      return { id: item.id, score, name: item.name };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'ru'))
    .slice(0, 10)
    .map((item) => item.id);
}

function EskizMarkerModuleEditor(props: {
  marker: EskizModuleMarker;
  module: KitchenModule;
  pricebook: Pricebook;
  defaults: Partial<Record<SlotKey, string | null>>;
  modules: KitchenModule[];
  onModuleChange: (moduleId: string, patch: Partial<KitchenModule>) => void;
  onOpenFull?: (moduleId: string) => void;
}) {
  const { marker, module, pricebook, defaults, modules } = props;
  const [pickSlot, setPickSlot] = useState<SlotKey | null>(null);
  const [pickSurcharge, setPickSurcharge] = useState(false);
  const [copySourceId, setCopySourceId] = useState('');
  const check = useMemo(() => checkModule(module, defaults, pricebook), [module, defaults, pricebook]);
  const lines = useMemo(() => moduleToLines(module, defaults, pricebook), [module, defaults, pricebook]);
  const lineCalcs = useMemo(() => calcLines(lines), [lines]);
  const cost = lines.reduce((sum, line) => sum + (lineCalcs.get(line.id)?.sum ?? 0), 0);
  const selectedBody = resolveSlot(module, 'body', defaults, pricebook).item;
  const facadeInference = selectedBody ? inferFacadeSpec(module, selectedBody) : null;
  const hingeInference = selectedBody ? inferHingeSpec(module, selectedBody) : null;
  const facadeNeedsUpdate = Boolean(selectedBody && (module.facadeSpecStatus === 'outdated' || isTechnicalFacadeSpecOutdated(module, selectedBody)));
  const hingeNeedsUpdate = Boolean(selectedBody && (module.hingeSpecStatus === 'outdated' || isTechnicalHingeSpecOutdated(module, selectedBody)));
  const dimensionSurchargeRecommendations = selectedBody ? inferDimensionSurcharges(module, selectedBody, pricebook) : [];
  const pendingDimensionSurcharges = dimensionSurchargeRecommendations.filter((item) => !(module.surcharges ?? []).includes(item.itemId));
  const facadePartsForEditor = module.facadeParts ?? facadeInference?.parts ?? [];
  const recommendedBySlot = useMemo(() => Object.fromEntries(QUICK_SLOTS.map((slot) => [slot, recommendedSlotItemIds(slot, module, pricebook)])) as Record<SlotKey, string[]>, [module, pricebook]);
  const copySources = modules.filter((item) => item.id !== module.id);

  const update = (patch: Partial<KitchenModule>) => props.onModuleChange(module.id, patch);
  const copyKitFrom = (sourceId: string) => {
    const source = modules.find((item) => item.id === sourceId);
    if (!source) return;
    update({
      slots: JSON.parse(JSON.stringify(source.slots)) as KitchenModule['slots'],
      facades: source.facades,
      drawers: source.drawers,
      shelves: source.shelves,
      hinges: source.hinges,
      handles: source.handles,
      lifts: source.lifts,
      legs: source.legs,
      facadeWmm: source.facadeWmm,
      facadeHmm: source.facadeHmm,
      facadeParts: source.facadeParts ? JSON.parse(JSON.stringify(source.facadeParts)) as FacadePart[] : undefined,
      extraFacadeParts: source.extraFacadeParts ? JSON.parse(JSON.stringify(source.extraFacadeParts)) as ExtraFacadePart[] : undefined,
      facadeSpecStatus: source.facadeSpecStatus,
      hingeSpecStatus: source.hingeSpecStatus,
      surcharges: source.surcharges ? [...source.surcharges] : undefined,
      automaticSurcharges: source.automaticSurcharges ? [...source.automaticSurcharges] : undefined,
    });
  };
  const updateDimension = (key: 'widthMm' | 'heightMm' | 'depthMm', value: string) => {
    const patch: Partial<KitchenModule> = { [key]: numberValue(value) };
    if (key !== 'depthMm') {
      patch.facadeSpecStatus = module.facadeSpecStatus === 'applied' ? 'outdated' : module.facadeSpecStatus;
      patch.hingeSpecStatus = module.hingeSpecStatus === 'applied' ? 'outdated' : module.hingeSpecStatus;
    }
    update(patch);
  };
  const updateNum = (key: 'facadeWmm' | 'facadeHmm', value: string) => update({
    [key]: numberValue(value),
    facadeParts: undefined,
    facadeSpecStatus: 'manual',
    hingeSpecStatus: module.hingeSpecStatus === 'applied' ? 'outdated' : module.hingeSpecStatus,
  });
  const updateCount = (key: 'qty' | 'facades' | 'drawers' | 'shelves' | 'hinges' | 'handles' | 'lifts' | 'legs', value: string) => {
    const patch: Partial<KitchenModule> = { [key]: Number(value) || 0 };
    if (key === 'facades' || key === 'drawers') {
      patch.facadeParts = undefined;
      patch.facadeSpecStatus = 'manual';
      patch.hingeSpecStatus = module.hingeSpecStatus === 'applied' ? 'outdated' : module.hingeSpecStatus;
    }
    if (key === 'hinges') patch.hingeSpecStatus = 'manual';
    update(patch);
  };
  const updateSlot = (slot: SlotKey, value: string) => {
    const slots = {
      ...module.slots,
      [slot]: value === '__default__' ? { mode: 'default' as const, itemId: null } : { mode: 'manual' as const, itemId: value || null },
    };
    if (slot === 'body') {
      update({
        slots,
        facadeSpecStatus: module.facadeParts?.length ? 'outdated' : 'recommended',
        hingeSpecStatus: module.hingeSpecStatus === 'applied' ? 'outdated' : module.hingeSpecStatus,
      });
    } else update({ slots });
  };
  const setFacadeParts = (parts: FacadePart[]) => update({
    facadeParts: parts.length ? parts : undefined,
    facades: parts.length,
    drawers: parts.filter((part) => part.kind === 'drawer').length,
    facadeWmm: parts[0]?.widthMm ?? null,
    facadeHmm: parts[0]?.heightMm ?? null,
    facadeSpecStatus: 'manual',
    hingeSpecStatus: module.hingeSpecStatus === 'applied' ? 'outdated' : module.hingeSpecStatus,
  });
  const updateFacadePart = (index: number, patch: Partial<FacadePart>) => {
    const parts = [...(module.facadeParts ?? [])];
    if (!parts[index]) return;
    parts[index] = { ...parts[index], ...patch, source: 'manual' };
    setFacadeParts(parts);
  };
  const addFacadePart = () => {
    const fallbackWidth = module.facadeWmm ?? (module.widthMm && module.facades > 0 ? Math.max(1, Math.round(module.widthMm / module.facades) - 4) : module.widthMm ?? 600);
    setFacadeParts([...(module.facadeParts ?? []), { widthMm: fallbackWidth, heightMm: module.facadeHmm ?? module.heightMm ?? 720, kind: 'door', source: 'manual' }]);
  };
  const updateExtraPart = (index: number, patch: Partial<ExtraFacadePart>) => {
    const parts = [...(module.extraFacadeParts ?? [])];
    if (!parts[index]) return;
    parts[index] = { ...parts[index], ...patch, source: 'manual' };
    update({ extraFacadeParts: parts });
  };
  const addExtraPart = (side = false) => update({
    extraFacadeParts: [
      ...(module.extraFacadeParts ?? []),
      { widthMm: side ? module.depthMm ?? 560 : 596, heightMm: module.heightMm ?? 720, kind: 'panel', qty: 1, label: side ? 'Боковина' : '', source: 'manual' },
    ],
  });
  const priceMeta = (item: PriceItem) => `${item.category}${item.subcategory ? ` · ${item.subcategory}` : ''}${item.article ? ` · арт. ${item.article}` : ''}${item.price != null ? ` · ${fmtMoney(item.price)}` : ''}${item.unit ? `/${item.unit}` : ''}`;
  const dimensionLabel = (dimension: 'width' | 'height' | 'depth') => ({ width: 'ширине', height: 'высоте', depth: 'глубине' }[dimension]);

  return (
    <div className="eskiz-marker-editor">
      <div className="eskiz-marker-editor-head">
        <div><span className="eyebrow">Маркер {marker.number}</span><h4>{module.name}</h4><p className="muted small">Редактируйте модуль прямо рядом с эскизом: корпус, габариты, фасады, фурнитура, надбавки и проверка сразу попадают в просчёт.</p></div>
        {props.onOpenFull && <button className="btn tiny ghost" onClick={() => props.onOpenFull?.(module.id)}>Открыть в общей таблице</button>}
      </div>

      <div className={`eskiz-live-card ${check.level}`}>
        <div><span>Статус</span><b>{check.level === 'ok' ? 'Готов' : check.level === 'warn' ? 'Проверить' : 'Неполный'}</b></div>
        <div><span>Корпус</span><b>{selectedBody ? shortLine(selectedBody.name, 42) : 'не выбран'}</b></div>
        <div><span>Сумма</span><b>{fmtMoney(cost)}</b></div>
      </div>
      {copySources.length > 0 && (
        <div className="eskiz-copy-kit">
          <label>Скопировать комплектацию с модуля<select value={copySourceId} onChange={(event) => setCopySourceId(event.target.value)}><option value="">— выбрать источник —</option>{copySources.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <button className="btn tiny ghost" type="button" disabled={!copySourceId} onClick={() => copyKitFrom(copySourceId)}>Скопировать</button>
        </div>
      )}

      <h4>Основные параметры</h4>
      <div className="eskiz-module-form-grid">
        <label>Название<input value={module.name} onChange={(event) => update({ name: event.target.value })} /></label>
        <label>Тип<input list={`eskiz-mod-types-${module.id}`} value={module.type} onChange={(event) => update({ type: event.target.value })} />
          <datalist id={`eskiz-mod-types-${module.id}`}>{MODULE_TYPES.map((type) => <option key={type} value={type} />)}</datalist>
        </label>
        <label>Кол-во<input type="number" min="0" step="1" value={module.qty} onChange={(event) => updateCount('qty', event.target.value)} /></label>
        <label>Ширина, мм<input type="number" value={module.widthMm ?? ''} onChange={(event) => updateDimension('widthMm', event.target.value)} /></label>
        <label>Высота, мм<input type="number" value={module.heightMm ?? ''} onChange={(event) => updateDimension('heightMm', event.target.value)} /></label>
        <label>Глубина, мм<input type="number" value={module.depthMm ?? ''} onChange={(event) => updateDimension('depthMm', event.target.value)} /></label>
        <label>Фасады<input type="number" min="0" value={module.facades} onChange={(event) => updateCount('facades', event.target.value)} /></label>
        <label>Ящики<input type="number" min="0" value={module.drawers} onChange={(event) => updateCount('drawers', event.target.value)} /></label>
        <label>Полки<input type="number" min="0" value={module.shelves} onChange={(event) => updateCount('shelves', event.target.value)} /></label>
        <label>Петли<input type="number" min="0" value={module.hinges} onChange={(event) => updateCount('hinges', event.target.value)} /></label>
        <label>Подъёмники<input type="number" min="0" value={module.lifts} onChange={(event) => updateCount('lifts', event.target.value)} /></label>
        <label>Ручки<input type="number" min="0" value={module.handles} onChange={(event) => updateCount('handles', event.target.value)} /></label>
        <label>Опоры<input type="number" min="0" value={module.legs ?? 0} onChange={(event) => updateCount('legs', event.target.value)} /></label>
        <label>Фасад Ш, мм<input type="number" value={module.facadeWmm ?? ''} onChange={(event) => updateNum('facadeWmm', event.target.value)} /></label>
        <label>Фасад В, мм<input type="number" value={module.facadeHmm ?? ''} onChange={(event) => updateNum('facadeHmm', event.target.value)} /></label>
        <label className="wide">Заметка<input value={module.note ?? ''} placeholder="что важно учесть в КП / заказе" onChange={(event) => update({ note: event.target.value })} /></label>
      </div>

      <h4>Прайс и комплектующие</h4>
      <div className="eskiz-slot-picker improved">
        {QUICK_SLOTS.map((slot) => {
          const choice = module.slots[slot] ?? { mode: 'default' as const, itemId: null };
          const { item, source } = resolveSlot(module, slot, defaults, pricebook);
          const need = slotNeed(module, slot);
          return (
            <article className={`eskiz-slot-card ${slot === 'body' ? 'primary-slot' : ''}`} key={slot}>
              <div className="eskiz-slot-card-head">
                <span>{SLOT_LABELS[slot]} <em>×{need}</em></span>
                {source && <b>{source === 'manual' ? 'вручную' : 'проект'}</b>}
              </div>
              <button className={item ? 'slot-pick-button selected' : 'slot-pick-button'} type="button" onClick={() => setPickSlot(slot)}>
                {item ? <><strong>{shortLine(item.name, 86)}</strong><small>{priceMeta(item)}</small></> : <><strong>{slot === 'body' ? 'Выбрать корпус из прайса' : 'Выбрать позицию из прайса'}</strong><small>Откроется общий поиск по прайсу, без отдельного поля над выпадающим списком.</small></>}
              </button>
              <div className="eskiz-slot-actions">
                <button className="btn tiny" type="button" onClick={() => setPickSlot(slot)}>{item ? 'Заменить' : 'Выбрать'}</button>
                {slot !== 'body' && choice.mode === 'manual' && <button className="btn tiny ghost" type="button" onClick={() => updateSlot(slot, '__default__')}>К настройкам проекта</button>}
                {choice.mode === 'manual' && choice.itemId && <button className="btn tiny ghost" type="button" onClick={() => updateSlot(slot, '')}>Очистить</button>}
              </div>
            </article>
          );
        })}
      </div>

      {(selectedBody || module.facades > 0 || module.facadeParts?.length || hingeInference) && (
        <section className="eskiz-tech-card">
          <div className="eskiz-tech-head"><h4>Фасады и петли по техничке</h4>{selectedBody && <span className="badge tech-suggest">корпус выбран</span>}</div>
          <div className="eskiz-tech-block">
            <div className="muted small">{facadeInference ? `${facadeInference.source} · ${facadeInference.note}` : 'Можно задать ручную разбивку фасадов даже без выбранного корпуса. После выбора корпуса появятся рекомендации по техничке.'}</div>
            {facadePartsForEditor.length > 0 && (
              <div className="facade-parts-mini">
                {facadePartsForEditor.map((part, index) => (
                  <div className="facade-part-mini" key={`${part.kind}-${index}`}>
                    <select value={part.kind} disabled={!module.facadeParts} onChange={(event) => updateFacadePart(index, { kind: event.target.value as FacadePart['kind'] })}>
                      <option value="door">дверь</option><option value="drawer">ящик</option><option value="panel">панель</option>
                    </select>
                    <input type="number" value={part.widthMm} disabled={!module.facadeParts} onChange={(event) => updateFacadePart(index, { widthMm: Number(event.target.value) || 0 })} />×
                    <input type="number" value={part.heightMm} disabled={!module.facadeParts} onChange={(event) => updateFacadePart(index, { heightMm: Number(event.target.value) || 0 })} /> мм
                    {module.facadeParts && <button className="btn tiny danger" type="button" onClick={() => setFacadeParts(module.facadeParts!.filter((_, i) => i !== index))}>✕</button>}
                  </div>
                ))}
              </div>
            )}
            <div className="eskiz-mini-actions">
              {selectedBody && facadeInference && <button className="btn tiny add" type="button" onClick={() => update(applyTechnicalFacadeSpec(module, selectedBody, true))}>{facadeNeedsUpdate ? 'Обновить фасады по техничке' : module.facadeParts ? 'Заменить рекомендацией' : 'Применить размеры фасадов'}</button>}
              <button className="btn tiny ghost" type="button" onClick={addFacadePart}>＋ Ручной фасад</button>
            </div>
          </div>
          {hingeInference && (
            <div className="eskiz-tech-block">
              <div className="muted small">Петли: рекомендуется {hingeInference.hinges} шт. · {hingeInference.note}</div>
              {(hingeNeedsUpdate || module.hinges !== hingeInference.hinges || module.hingeSpecStatus === 'manual') && (
                <button className="btn tiny add" type="button" onClick={() => update({ hinges: hingeInference.hinges, hingeSpecStatus: 'applied' })}>Подставить количество петель</button>
              )}
            </div>
          )}
        </section>
      )}

      <section className="eskiz-tech-card">
        <div className="eskiz-tech-head"><h4>Отдельные фасадные детали</h4><span className="badge man">вручную</span></div>
        {(module.extraFacadeParts ?? []).length > 0 && (
          <div className="extra-facade-mini-list">
            {(module.extraFacadeParts ?? []).map((part, index) => (
              <div className="extra-facade-mini" key={index}>
                <input value={part.label ?? ''} placeholder="Название детали" onChange={(event) => updateExtraPart(index, { label: event.target.value })} />
                <select value={part.kind} onChange={(event) => updateExtraPart(index, { kind: event.target.value as ExtraFacadePart['kind'] })}><option value="panel">панель</option><option value="door">дверь</option><option value="drawer">ящик</option></select>
                <span><input type="number" value={part.widthMm} onChange={(event) => updateExtraPart(index, { widthMm: Number(event.target.value) || 0 })} />×<input type="number" value={part.heightMm} onChange={(event) => updateExtraPart(index, { heightMm: Number(event.target.value) || 0 })} /> мм × <input type="number" value={part.qty} onChange={(event) => updateExtraPart(index, { qty: Number(event.target.value) || 0 })} /> шт</span>
                <button className="btn tiny danger" type="button" onClick={() => update({ extraFacadeParts: (module.extraFacadeParts ?? []).filter((_, i) => i !== index) })}>✕</button>
              </div>
            ))}
          </div>
        )}
        <div className="eskiz-mini-actions"><button className="btn tiny add" type="button" onClick={() => addExtraPart(true)}>＋ Боковина</button><button className="btn tiny ghost" type="button" onClick={() => addExtraPart(false)}>＋ Любая деталь</button></div>
      </section>

      <section className="eskiz-tech-card">
        <div className="eskiz-tech-head"><h4>Надбавки корпуса</h4><span className="muted small">проценты считаются от корпуса</span></div>
        {dimensionSurchargeRecommendations.length > 0 && (
          <div className="surcharge-mini-list">
            {dimensionSurchargeRecommendations.map((item) => {
              const applied = (module.surcharges ?? []).includes(item.itemId);
              const priceItem = pricebook.items.find((candidate) => candidate.id === item.itemId);
              return <div className="surcharge-mini" key={`${item.dimension}-${item.itemId}`}><span><b>+{item.percent}% по {dimensionLabel(item.dimension)}</b><small>{item.rule}{priceItem ? ` · ${priceItem.name}` : ''}</small></span><em>{applied ? 'применено' : 'рекомендация'}</em></div>;
            })}
          </div>
        )}
        {pendingDimensionSurcharges.length > 0 && selectedBody && <button className="btn tiny add" type="button" onClick={() => update(applyDimensionSurcharges(module, selectedBody, pricebook))}>✓ Применить рекомендации по габаритам</button>}
        {(module.surcharges ?? []).map((id) => {
          const item = pricebook.items.find((candidate) => candidate.id === id);
          return <div className="surcharge-mini manual" key={id}><span><b>{item ? item.name : 'Позиция не найдена'}</b><small>{item ? `+${item.price}% · ${item.category}` : id}</small></span><button className="btn tiny danger" type="button" onClick={() => update({ surcharges: (module.surcharges ?? []).filter((itemId) => itemId !== id), automaticSurcharges: (module.automaticSurcharges ?? []).filter((itemId) => itemId !== id) })}>✕</button></div>;
        })}
        <button className="btn tiny ghost" type="button" onClick={() => setPickSurcharge(true)}>＋ Добавить надбавку из прайса</button>
      </section>

      <div className={`eskiz-module-check ${check.level}`}>
        <b>{check.level === 'ok' ? 'Готово к расчёту' : check.level === 'warn' ? 'Есть предупреждения' : 'Нужно заполнить'}</b>
        {check.errors.map((text) => <span key={text}>⛔ {text}</span>)}
        {check.openWarnings.map((warning) => <span key={warning.code}>⚠ {warning.text} <button className="btn tiny" type="button" onClick={() => update(setWarningConfirmed(module, warning.code, true))}>Подтвердить</button></span>)}
        {check.confirmedWarnings.map((warning) => <span key={warning.code}>✅ {warning.text} <button className="btn tiny ghost" type="button" onClick={() => update(setWarningConfirmed(module, warning.code, false))}>Отменить</button></span>)}
      </div>
      <div className="eskiz-module-lines">
        <b>В состав уйдёт: {lines.length} строк · {fmtMoney(cost)}</b>
        {lines.slice(0, 6).map((line) => <span key={line.id}>{shortLine(line.name, 54)} · {fmtNum(lineCalcs.get(line.id)?.qtyEffective ?? line.qty)} {line.unit ?? ''}</span>)}
        {lines.length > 6 && <span>+ ещё {lines.length - 6} строк</span>}
      </div>

      {pickSlot && (
        <CatalogPicker
          pricebook={pricebook}
          pickOnly
          poolFilter={SLOT_POOLS[pickSlot]}
          title={`${SLOT_LABELS[pickSlot]} — маркер ${marker.number}, «${module.name}»`}
          recommendedIds={recommendedBySlot[pickSlot]}
          recommendedTitle={pickSlot === 'body' ? 'Подходит по типу/ширине' : 'Подходит к модулю'}
          onAdd={(item) => {
            updateSlot(pickSlot, item.id);
            setPickSlot(null);
          }}
          onClose={() => setPickSlot(null)}
        />
      )}
      {pickSurcharge && (
        <CatalogPicker
          pricebook={pricebook}
          pickOnly
          poolFilter={(item) => item.priceKind === 'percent'}
          title={`Процентная надбавка — маркер ${marker.number}, «${module.name}»`}
          onAdd={(item) => {
            update({ surcharges: unique([...(module.surcharges ?? []), item.id]) });
            setPickSurcharge(false);
          }}
          onClose={() => setPickSurcharge(false)}
        />
      )}
    </div>
  );
}

function formatPoint(value: number) {
  return Math.round(value).toString();
}

function CommunicationEditor(props: {
  marker: EskizCommunicationMarker;
  projectTitle?: string;
  onChange: (patch: Partial<EskizCommunicationMarker>) => void;
  onAddDistance: () => void;
  onDistanceChange: (distanceId: string, patch: Partial<EskizCommunicationDistance>) => void;
  onPickDistancePoint: (distanceId: string) => void;
  onDeleteDistance: (distanceId: string) => void;
  onDelete: () => void;
}) {
  const marker = props.marker;
  const meta = COMMUNICATION_KIND_META[marker.kind] ?? COMMUNICATION_KIND_META.other;
  const distances = marker.distances ?? [];
  const updateNum = (key: 'x' | 'y' | 'widthMm' | 'heightMm' | 'diameterMm' | 'depthMm' | 'elevationMm', value: string) => props.onChange({ [key]: numberValue(value) } as Partial<EskizCommunicationMarker>);
  return (
    <div className="eskiz-communication-editor">
      <div className="eskiz-marker-editor-head">
        <div>
          <span className="eyebrow">КОММУНИКАЦИЯ</span>
          <h4>{meta.icon} {marker.name || meta.label}</h4>
          <p className="muted small">{props.projectTitle ? `Эскиз: ${props.projectTitle}` : 'Отметка поверх snapshot'} · точка {formatPoint(marker.x)}×{formatPoint(marker.y)}</p>
        </div>
        <button className="btn tiny danger" onClick={props.onDelete}>Удалить</button>
      </div>
      <div className="eskiz-module-form-grid">
        <label>Тип
          <select value={marker.kind} onChange={(event) => {
            const kind = event.target.value as EskizCommunicationKind;
            const nextMeta = COMMUNICATION_KIND_META[kind];
            props.onChange({ kind, name: marker.name === meta.defaultName ? nextMeta.defaultName : marker.name });
          }}>
            {COMMUNICATION_KINDS.map((kind) => <option key={kind} value={kind}>{COMMUNICATION_KIND_META[kind].label}</option>)}
          </select>
        </label>
        <label>Название<input value={marker.name} onChange={(event) => props.onChange({ name: event.target.value })} /></label>
        <label><input type="checkbox" checked={marker.showInClient !== false} onChange={(event) => props.onChange({ showInClient: event.target.checked })} /> в КП</label>
        <label>X на эскизе<input type="number" value={marker.x} onChange={(event) => updateNum('x', event.target.value)} /></label>
        <label>Y на эскизе<input type="number" value={marker.y} onChange={(event) => updateNum('y', event.target.value)} /></label>
        <label>Высота от пола, мм<input type="number" value={marker.elevationMm ?? ''} onChange={(event) => updateNum('elevationMm', event.target.value)} placeholder="например 1050" /></label>
        <label>Ширина, мм<input type="number" value={marker.widthMm ?? ''} onChange={(event) => updateNum('widthMm', event.target.value)} placeholder="например 80" /></label>
        <label>Высота, мм<input type="number" value={marker.heightMm ?? ''} onChange={(event) => updateNum('heightMm', event.target.value)} placeholder="например 80" /></label>
        <label>Диаметр, мм<input type="number" value={marker.diameterMm ?? ''} onChange={(event) => updateNum('diameterMm', event.target.value)} placeholder="для трубы/канала" /></label>
        <label>Глубина/вынос, мм<input type="number" value={marker.depthMm ?? ''} onChange={(event) => updateNum('depthMm', event.target.value)} /></label>
        <label className="wide">Примечание<textarea rows={2} value={marker.note ?? ''} onChange={(event) => props.onChange({ note: event.target.value })} placeholder="Например: двойная розетка, вывод под ПММ, смещение от чистового пола" /></label>
      </div>
      <div className="eskiz-communication-summary">
        <b>{communicationSizeText(marker) || 'Размер коммуникации не задан'}</b>
        <span>{distances.length ? `${distances.length} расстояний` : 'Добавьте расстояния до стены, пола или любой точки'}</span>
      </div>
      <div className="section-head compact"><div><h4>Расстояния до точек</h4><p className="muted small">Можно указать расстояние до края эскиза/пола/потолка или выбрать произвольную точку кликом по preview.</p></div><button className="btn tiny ghost" onClick={props.onAddDistance}>+ расстояние</button></div>
      {distances.length === 0 ? <div className="empty small">Расстояния ещё не добавлены.</div> : (
        <div className="eskiz-distance-list">
          {distances.map((distance) => <div className="eskiz-distance-row" key={distance.id}>
            <label>Подпись<input value={distance.label} onChange={(event) => props.onDistanceChange(distance.id, { label: event.target.value })} placeholder="например от угла мойки" /></label>
            <label>Откуда
              <select value={distance.anchor} onChange={(event) => props.onDistanceChange(distance.id, { anchor: event.target.value as EskizCommunicationAnchorKind })}>
                {Object.entries(COMMUNICATION_ANCHOR_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>
            <label>Расстояние, мм<input type="number" value={distance.valueMm ?? ''} onChange={(event) => props.onDistanceChange(distance.id, { valueMm: numberValue(event.target.value) })} placeholder="например 650" /></label>
            {distance.anchor === 'custom' && <button className="btn tiny ghost" onClick={() => props.onPickDistancePoint(distance.id)}>Выбрать точку на эскизе</button>}
            <span className="muted small">{communicationDistanceText(distance.valueMm)}{distance.anchor === 'custom' && distance.anchorX != null && distance.anchorY != null ? ` · точка ${formatPoint(distance.anchorX)}×${formatPoint(distance.anchorY)}` : ''}</span>
            <button className="btn tiny danger" onClick={() => props.onDeleteDistance(distance.id)}>✕</button>
          </div>)}
        </div>
      )}
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
  const [communicationAddKind, setCommunicationAddKind] = useState<EskizCommunicationKind | null>(null);
  const [activeCommunicationId, setActiveCommunicationId] = useState<string | null>(null);
  const [distancePointPick, setDistancePointPick] = useState<{ communicationId: string; distanceId: string } | null>(null);
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
  const communications = eskizPro.communications ?? EMPTY_COMMUNICATIONS;
  const linkedModuleCount = moduleMarkers.filter((marker) => Boolean(moduleBindings[marker.key])).length;
  const activeMarker = moduleMarkers.find((marker) => marker.key === activeMarkerKey) ?? null;
  const activeModuleId = activeMarker ? moduleBindings[activeMarker.key] : null;
  const activeModule = activeModuleId ? project.modules?.find((module) => module.id === activeModuleId) ?? null : null;
  const activeCommunication = communications.find((marker) => marker.id === activeCommunicationId) ?? null;
  const activeCommunicationProject = activeCommunication ? linkedProjects.find((item) => item.id === activeCommunication.eskizId) ?? null : null;
  const moduleStatuses = useMemo(() => Object.fromEntries(moduleMarkers.map((marker) => {
    const moduleId = moduleBindings[marker.key];
    const linkedModule = moduleId ? project.modules?.find((module) => module.id === moduleId) ?? null : null;
    if (!linkedModule) return [marker.key, { level: 'new', label: 'новый', summary: 'Модуль ещё не создан в просчёте.' } satisfies EskizModulePreviewStatus];
    const checked = checkModule(linkedModule, project.moduleDefaults ?? {}, pricebook);
    if (checked.level === 'error') return [marker.key, { level: 'error', label: 'нет данных', summary: checked.errors[0] ?? 'Есть обязательные ошибки.' } satisfies EskizModulePreviewStatus];
    if (checked.level === 'warn') return [marker.key, { level: 'warn', label: 'проверить', summary: checked.openWarnings[0]?.text ?? checked.warnings[0] ?? 'Есть предупреждения.' } satisfies EskizModulePreviewStatus];
    return [marker.key, { level: 'ok', label: 'готов', summary: 'Модуль полностью участвует в просчёте.' } satisfies EskizModulePreviewStatus];
  })) as Record<string, EskizModulePreviewStatus>, [moduleMarkers, moduleBindings, project.modules, project.moduleDefaults, pricebook]);

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
      communications: communications.filter((item) => item.eskizId !== id),
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

  const updateCommunications = (next: EskizCommunicationMarker[]) => updateEskizPro({ communications: next });
  const updateCommunication = (id: string, patch: Partial<EskizCommunicationMarker>) => {
    const updatedAt = new Date().toISOString();
    updateCommunications(communications.map((item) => (item.id === id ? { ...item, ...patch, updatedAt } : item)));
  };
  const deleteCommunication = (id: string) => {
    updateCommunications(communications.filter((item) => item.id !== id));
    if (activeCommunicationId === id) setActiveCommunicationId(null);
    if (distancePointPick?.communicationId === id) setDistancePointPick(null);
  };
  const addCommunicationDistance = (communicationId: string) => {
    const marker = communications.find((item) => item.id === communicationId);
    if (!marker) return;
    const distance: EskizCommunicationDistance = {
      id: uid('dist'),
      label: 'Расстояние',
      anchor: 'left',
      valueMm: null,
    };
    updateCommunication(communicationId, { distances: [...(marker.distances ?? []), distance] });
  };
  const updateCommunicationDistance = (communicationId: string, distanceId: string, patch: Partial<EskizCommunicationDistance>) => {
    const marker = communications.find((item) => item.id === communicationId);
    if (!marker) return;
    updateCommunication(communicationId, { distances: (marker.distances ?? []).map((distance) => (distance.id === distanceId ? { ...distance, ...patch } : distance)) });
  };
  const deleteCommunicationDistance = (communicationId: string, distanceId: string) => {
    const marker = communications.find((item) => item.id === communicationId);
    if (!marker) return;
    updateCommunication(communicationId, { distances: (marker.distances ?? []).filter((distance) => distance.id !== distanceId) });
    if (distancePointPick?.distanceId === distanceId) setDistancePointPick(null);
  };
  const handleCommunicationClick = (_eskizId: string, marker: EskizCommunicationMarker) => {
    setActiveCommunicationId(marker.id);
    setCommunicationAddKind(null);
    setDistancePointPick(null);
    setMessage(`Открыта коммуникация «${marker.name}»: можно задать размер и расстояния до точек.`);
  };
  const handlePreviewPointClick = (eskizId: string, x: number, y: number) => {
    if (distancePointPick) {
      updateCommunicationDistance(distancePointPick.communicationId, distancePointPick.distanceId, { anchor: 'custom', anchorX: x, anchorY: y });
      setDistancePointPick(null);
      setMessage('Точка расстояния выбрана на эскизе. Укажите фактическое расстояние в мм.');
      return;
    }
    if (!communicationAddKind) return;
    const meta = COMMUNICATION_KIND_META[communicationAddKind];
    const now = new Date().toISOString();
    const marker: EskizCommunicationMarker = {
      id: uid('comm'),
      eskizId,
      kind: communicationAddKind,
      name: meta.defaultName,
      x,
      y,
      widthMm: communicationAddKind === 'socket' || communicationAddKind === 'switch' ? 80 : null,
      heightMm: communicationAddKind === 'socket' || communicationAddKind === 'switch' ? 80 : null,
      diameterMm: communicationAddKind === 'sewer' || communicationAddKind === 'ventilation' || communicationAddKind === 'hood' ? 110 : null,
      distances: [],
      showInClient: true,
      createdAt: now,
      updatedAt: now,
    };
    updateCommunications([marker, ...communications]);
    setActiveCommunicationId(marker.id);
    setCommunicationAddKind(null);
    setMessage(`Добавлена отметка «${marker.name}». Теперь задайте размеры и расстояния до стены/пола/любой точки.`);
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
          <h3>Внешний инструмент для скрина проекта, размеров, модулей и коммуникаций</h3>
          <p className="muted small">Откройте настоящий Эскиз PRO, загрузите скрин, нанесите размеры/подписи и добавьте объект «Модуль» как точку/сноску. В калькуляторе поверх snapshot можно дополнительно поставить розетки, воду, канализацию, газ и вентиляцию с размерами и расстояниями до точек.</p>
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
            <div><h3>Окно Эскиз PRO</h3><p className="muted small">Загрузите скрин, поставьте объект «Модуль» на нужное место и кликните по нему. Коммуникации добавляются уже поверх сохранённого snapshot в preview справа/ниже, чтобы они попадали в проект и КП.</p></div>
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
                modules={project.modules ?? []}
                onModuleChange={updateModule}
                onOpenFull={props.onOpenModule}
              />
            )}
          </section>

          <section className="card no-print eskiz-communications-card">
            <div className="section-head"><div><h3>Коммуникации на эскизе</h3><p className="muted small">Розетки, выводы воды, канализация, газ, вентиляция. Нажмите тип, затем кликните по preview эскиза ниже.</p></div><b>{communications.length}</b></div>
            <div className="eskiz-communication-kind-grid">
              {COMMUNICATION_KINDS.map((kind) => {
                const meta = COMMUNICATION_KIND_META[kind];
                return <button key={kind} className={communicationAddKind === kind ? 'active' : ''} style={{ '--comm-color': meta.color } as CSSProperties} onClick={() => { setCommunicationAddKind(communicationAddKind === kind ? null : kind); setDistancePointPick(null); }}><span>{meta.icon}</span>{meta.label}</button>;
              })}
            </div>
            {communicationAddKind && <div className="note small">Режим добавления: <b>{COMMUNICATION_KIND_META[communicationAddKind].label}</b>. Кликните на нужное место в preview. Чтобы отменить — нажмите тип ещё раз.</div>}
            {distancePointPick && <div className="note small">Выберите на preview точку, до которой нужно показать расстояние. После клика укажите фактическое значение в мм.</div>}
            {communications.length === 0 ? <div className="empty small">Коммуникаций пока нет. Привяжите эскиз и добавьте первую отметку.</div> : (
              <div className="eskiz-communication-list">
                {communications.slice(0, 12).map((marker) => {
                  const meta = COMMUNICATION_KIND_META[marker.kind] ?? COMMUNICATION_KIND_META.other;
                  const snapshot = snapshots.find((item) => item.id === marker.eskizId);
                  return <button key={marker.id} className={activeCommunicationId === marker.id ? 'active' : ''} onClick={() => handleCommunicationClick(marker.eskizId, marker)}><b style={{ color: meta.color }}>{meta.icon} {marker.name || meta.label}</b><span>{snapshot?.title ?? marker.eskizId} · {communicationSizeText(marker) || 'размер не задан'} · {(marker.distances ?? []).length} расст.</span></button>;
                })}
              </div>
            )}
            {activeCommunication && (
              <CommunicationEditor
                marker={activeCommunication}
                projectTitle={activeCommunicationProject?.title}
                onChange={(patch) => updateCommunication(activeCommunication.id, patch)}
                onAddDistance={() => addCommunicationDistance(activeCommunication.id)}
                onDistanceChange={(distanceId, patch) => updateCommunicationDistance(activeCommunication.id, distanceId, patch)}
                onPickDistancePoint={(distanceId) => { setDistancePointPick({ communicationId: activeCommunication.id, distanceId }); setCommunicationAddKind(null); }}
                onDeleteDistance={(distanceId) => deleteCommunicationDistance(activeCommunication.id, distanceId)}
                onDelete={() => deleteCommunication(activeCommunication.id)}
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
                      {previewProject && <EskizProjectPreview project={previewProject} compact activeModuleKey={activeMarkerKey} moduleBindings={moduleBindings} moduleStatuses={moduleStatuses} communicationMarkers={communications} activeCommunicationId={activeCommunicationId} communicationAddMode={Boolean(communicationAddKind || distancePointPick)} onModuleClick={handlePreviewModuleClick} onCommunicationClick={handleCommunicationClick} onStagePointClick={handlePreviewPointClick} />}
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
          {linkedProjects.map((item) => <EskizProjectPreview key={item.id} project={item} activeModuleKey={activeMarkerKey} moduleBindings={moduleBindings} moduleStatuses={moduleStatuses} communicationMarkers={communications} activeCommunicationId={activeCommunicationId} communicationAddMode={Boolean(communicationAddKind || distancePointPick)} onModuleClick={handlePreviewModuleClick} onCommunicationClick={handleCommunicationClick} onStagePointClick={handlePreviewPointClick} />)}
        </section>
      )}
    </section>
  );
}
