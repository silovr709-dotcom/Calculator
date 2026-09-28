import { useEffect, useMemo, useRef, useState } from 'react';
import type { Pricebook, PriceItem, LineParams } from '../types';
import { fmtMoney } from '../lib/format';
import { loadRecentItems, recordRecentItem } from '../lib/recents';
import { sheetsFromLength, sheetLengthOf, unitIsHalfSheetAllowed, unitIsPerMeterMultiple, effectiveQty } from '../lib/engine';

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');

export default function CatalogPicker(props: {
  pricebook: Pricebook;
  onAdd: (item: PriceItem, qty: number, params: LineParams) => void;
  onClose: () => void;
  /** Режим выбора одной позиции (для слотов модуля): без количества/параметров */
  pickOnly?: boolean;
  /** Ограничение пула (напр. только петли) */
  poolFilter?: (i: PriceItem) => boolean;
  title?: string;
}) {
  const { pricebook } = props;
  const poolItems = useMemo(
    () => (props.poolFilter ? pricebook.items.filter(props.poolFilter) : pricebook.items),
    [pricebook, props.poolFilter],
  );
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string>('');
  const [sub, setSub] = useState<string>('');
  const [unitF, setUnitF] = useState<string>('');
  const [onlyPriced, setOnlyPriced] = useState(true);
  const [sel, setSel] = useState<PriceItem | null>(null);
  const [qty, setQty] = useState(1);
  const [w, setW] = useState<string>(''); const [h, setH] = useState<string>('');
  const [area, setArea] = useState<string>('');
  const [len, setLen] = useState<string>('');
  const [needLen, setNeedLen] = useState<string>(''); // подбор хлыстов
  const [recentIds, setRecentIds] = useState<string[]>(() => loadRecentItems());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props]);

  const cats = useMemo(() => [...new Set(poolItems.map((i) => i.category))].sort(), [poolItems]);
  // категории по разделам, чтобы выпадашка читалась
  const catGroups = useMemo(() => {
    const FURN = new Set(['Петли', 'Фурнитура', 'Фурнитура BLUM (доп. лист)', 'Системы выдвижения', 'Подъёмные механизмы', 'Посудосушители', 'Бутылочницы и карго', 'Внутреннее наполнение']);
    const groupOf = (c: string) =>
      c.startsWith('Корпуса') || c === 'Доп. комплектация каркасов' ? 'Корпуса' :
      c.startsWith('Фасады') ? 'Фасады' :
      c.startsWith('Столешницы') ? 'Столешницы' :
      FURN.has(c) ? 'Фурнитура и механизмы' : 'Прочее';
    const order = ['Корпуса', 'Фасады', 'Столешницы', 'Фурнитура и механизмы', 'Прочее'];
    const m = new Map<string, string[]>(order.map((o) => [o, []]));
    for (const c of cats) m.get(groupOf(c))!.push(c);
    return order.map((o) => [o, m.get(o)!] as const).filter(([, list]) => list.length > 0);
  }, [cats]);
  const subs = useMemo(
    () => cat ? [...new Set(poolItems.filter((i) => i.category === cat).map((i) => i.subcategory ?? ''))].filter(Boolean).sort() : [],
    [poolItems, cat],
  );
  const units = useMemo(() => [...new Set(poolItems.map((i) => i.unit ?? ''))].filter(Boolean).sort(), [poolItems]);

  const results = useMemo(() => {
    const terms = norm(q).split(/\s+/).filter(Boolean);
    let list = poolItems;
    if (cat) list = list.filter((i) => i.category === cat);
    if (sub) list = list.filter((i) => (i.subcategory ?? '') === sub);
    if (unitF) list = list.filter((i) => (i.unit ?? '') === unitF);
    if (onlyPriced) list = list.filter((i) => i.priceKind === 'fixed' || i.priceKind === 'percent' || i.priceKind === 'surcharge');
    if (terms.length) {
      list = list.filter((i) => {
        const hay = norm(`${i.name} ${i.article ?? ''} ${i.category} ${i.subcategory ?? ''} ${Object.values(i.attrs).join(' ')}`);
        return terms.every((t) => hay.includes(t));
      });
    }
    return list;
  }, [poolItems, q, cat, sub, unitF, onlyPriced]);

  // группировка результатов заголовками «Категория — Подкатегория», чтобы не теряться в списке
  const grouped = useMemo(() => {
    const sorted = [...results].sort((a, b) =>
      a.category === b.category
        ? (a.subcategory ?? '').localeCompare(b.subcategory ?? '', 'ru')
        : a.category.localeCompare(b.category, 'ru'));
    const out: { header: string; items: PriceItem[] }[] = [];
    for (const it of sorted) {
      const header = it.subcategory ? `${it.category} — ${it.subcategory}` : it.category;
      const last = out[out.length - 1];
      if (last && last.header === header) last.items.push(it);
      else out.push({ header, items: [it] });
    }
    return out;
  }, [results]);

  const select = (it: PriceItem) => {
    setSel(it); setQty(1); setW(''); setH(''); setArea(''); setLen(''); setNeedLen('');
  };

  const params: LineParams = useMemo(() => {
    const p: LineParams = {};
    if (sel?.priceBasis === 'm2') {
      if (w && h) { p.widthMm = Number(w); p.heightMm = Number(h); }
      else if (area) p.areaM2 = Number(area);
    }
    if (sel?.priceBasis === 'lm' && len) p.lengthMm = Number(len);
    return p;
  }, [sel, w, h, area, len]);

  const preview = useMemo(() => {
    if (!sel) return null;
    const qtyEff = effectiveQty({ priceBasis: sel.priceBasis, unit: sel.unit, qty, params });
    const sum = sel.price != null && (sel.priceKind === 'fixed' || sel.priceKind === 'surcharge')
      ? qtyEff * sel.price : null;
    return { qtyEff, sum };
  }, [sel, qty, params]);

  const isSheet = sel?.priceBasis === 'sheet';
  const halfAllowed = sel ? unitIsHalfSheetAllowed(sel.unit) : false;
  const sheetLen = sel ? sheetLengthOf(sel) : 3000;

  const doAdd = (keepOpen = false) => {
    if (!sel) return;
    props.onAdd(sel, qty, params);
    setRecentIds(recordRecentItem(sel.id));
    if (keepOpen) {
      setSel(null);
      setQ('');
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      props.onClose();
    }
  };

  /** Enter в поиске: первая позиция результатов (в pickOnly — сразу выбирается). */
  const selectFirstFromSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || results.length === 0) return;
    e.preventDefault();
    const first = results[0];
    if (props.pickOnly) {
      props.onAdd(first, 1, {});
      setRecentIds(recordRecentItem(first.id));
      if (e.ctrlKey || e.metaKey) {
        setQ('');
      } else {
        props.onClose();
      }
      return;
    }
    select(first);
  };

  // «Недавние» из текущего пула — только когда поиск пуст
  const recentItems = useMemo(() => {
    if (q.trim()) return [];
    const inPool = new Map(poolItems.map((i) => [i.id, i]));
    return recentIds.map((id) => inPool.get(id)).filter((i): i is PriceItem => Boolean(i));
  }, [q, poolItems, recentIds]);

  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div className="modal wide">
        {props.title && <div className="picker-title">{props.title}</div>}
        <div className="picker">
          <div className="picker-left">
            <input
              ref={inputRef}
              className="search"
              placeholder="Поиск: название, артикул, материал, категория…  (Enter — первая позиция)"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={selectFirstFromSearch}
            />
            {recentItems.length > 0 && (
              <div className="recent-chips">
                <span className="muted small">Недавние:</span>
                {recentItems.map((it) => (
                  <button key={it.id} className="chip" title={it.name} onClick={() => select(it)}>{it.name.slice(0, 38)}{it.name.length > 38 ? '…' : ''}</button>
                ))}
              </div>
            )}
            <div className="filters">
              <select value={cat} onChange={(e) => { setCat(e.target.value); setSub(''); }}>
                <option value="">Все категории</option>
                {catGroups.map(([g, list]) => (
                  <optgroup key={g} label={g}>
                    {list.map((c) => <option key={c} value={c}>{c}</option>)}
                  </optgroup>
                ))}
              </select>
              {subs.length > 0 && (
                <select value={sub} onChange={(e) => setSub(e.target.value)}>
                  <option value="">Все подкатегории</option>
                  {subs.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              )}
              <select value={unitF} onChange={(e) => setUnitF(e.target.value)}>
                <option value="">Любая ед. изм.</option>
                {units.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
              <label className="chk"><input type="checkbox" checked={onlyPriced} onChange={(e) => setOnlyPriced(e.target.checked)} /> только с ценой</label>
            </div>
            <div className="results">
              {grouped.map((g) => (
                <div key={g.header}>
                  <div className="r-group">{g.header} <span className="r-count">{g.items.length}</span></div>
                  {g.items.map((it) => {
                    const th = it.attrs?.['толщина'];
                    return (
                      <div key={it.id} className={`result ${sel?.id === it.id ? 'sel' : ''}`} onClick={() => select(it)} onDoubleClick={() => { select(it); }}>
                        <div className="r-name">{it.name}{th && !it.name.includes(th) ? <span className="r-attr"> · {th}</span> : null}</div>
                        <div className="r-meta">
                          {it.article && <span className="r-art">{it.article}</span>}
                          {Object.entries(it.attrs ?? {}).filter(([k]) => k !== 'толщина' && k !== 'изделие').slice(0, 2).map(([k, v]) => (
                            <span key={k}>{k}: {String(v).slice(0, 30)}</span>
                          ))}
                        </div>
                        <div className="r-price">
                          {it.priceKind === 'fixed' && <b>{fmtMoney(it.price)}</b>}
                          {it.priceKind === 'percent' && <b>+{it.price}%</b>}
                          {it.priceKind === 'surcharge' && <b>+{fmtMoney(it.price)}</b>}
                          {it.priceKind === 'unavailable' && <span className="warn">недоступно</span>}
                          {(it.priceKind === 'text' || it.priceKind === 'empty') && <span className="warn">нет цены</span>}
                          <span className="r-unit">{it.unit ?? ''}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
              {results.length === 0 && <div className="empty small">Ничего не найдено. Уточните запрос или снимите фильтры.</div>}
              {results.length > 500 && <div className="muted small pad">Найдено много позиций ({results.length}). Используйте поиск и фильтры, чтобы быстрее найти нужную.</div>}
            </div>
          </div>
          <div className="picker-right">
            {!sel ? (
              <div className="muted">Выберите позицию слева.<br /><br />Подсказки:<br />· «BLUM» — фурнитура Blum<br />· «петля» — все петли<br />· «эмаль глянец» — фасады эмаль<br />· «600*3000» — столешницы</div>
            ) : (
              <>
                <h3>{sel.name}</h3>
                <div className="muted small">
                  {sel.category}{sel.subcategory ? ` · ${sel.subcategory}` : ''}
                  {sel.article ? ` · арт. ${sel.article}` : ''} · источник: лист «{sel.source.sheet}», стр. {sel.source.row}
                </div>
                {sel.note && <div className="note">{sel.note}</div>}
                {sel.priceKind === 'text' && <div className="warn-box">В прайсе указана текстовая цена: «{sel.priceRaw}». Сумма не будет рассчитана автоматически.</div>}
                {sel.priceKind === 'unavailable' && <div className="warn-box">Позиция помечена в прайсе как временно недоступная / выведенная.</div>}
                {sel.priceKind === 'percent' && <div className="note">Процентная надбавка: после добавления укажите в таблице базовую позицию, к которой она применяется.</div>}

                {!props.pickOnly && <div className="param-grid">
                  {sel.priceBasis === 'm2' && (
                    <>
                      <label>Ширина, мм<input type="number" value={w} onChange={(e) => setW(e.target.value)} placeholder="напр. 396" /></label>
                      <label>Высота, мм<input type="number" value={h} onChange={(e) => setH(e.target.value)} placeholder="напр. 716" /></label>
                      <div className="or">или</div>
                      <label>Площадь, м²<input type="number" step="0.01" value={area} onChange={(e) => setArea(e.target.value)} placeholder="напр. 1.25" disabled={!!(w && h)} /></label>
                      <label>Кол-во, шт<input type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value) || 1)} /></label>
                    </>
                  )}
                  {sel.priceBasis === 'lm' && (
                    <>
                      <label>Длина детали, мм<input type="number" value={len} onChange={(e) => setLen(e.target.value)} placeholder="напр. 1750" /></label>
                      <label>Кол-во, шт<input type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value) || 1)} /></label>
                      {unitIsPerMeterMultiple(sel.unit) && <div className="note">Единица «{sel.unit}»: длина каждой детали округляется вверх до целого метра (правило прайса).</div>}
                    </>
                  )}
                  {isSheet && (
                    <>
                      <label>Нужная длина, мм
                        <input type="number" value={needLen} onChange={(e) => {
                          setNeedLen(e.target.value);
                          const v = Number(e.target.value);
                          if (v > 0) setQty(sheetsFromLength(v, sheetLen, halfAllowed));
                        }} placeholder={`хлыст ${sheetLen} мм`} />
                      </label>
                      <label>Хлыстов / листов{halfAllowed ? ' (шаг 0,5)' : ''}
                        <input type="number" step={halfAllowed ? 0.5 : 1} min={halfAllowed ? 0.5 : 1} value={qty} onChange={(e) => setQty(Number(e.target.value) || 1)} />
                      </label>
                      <div className="note">{halfAllowed ? 'Продаётся целым хлыстом или полхлыста — подобранное количество можно поправить.' : 'Продаётся только целыми хлыстами/листами (правило прайса).'}</div>
                    </>
                  )}
                  {(sel.priceBasis === 'unit' || sel.priceBasis === 'percent_of_base' || sel.priceBasis == null) && (
                    <label>Количество ({sel.unit ?? 'шт'})<input autoFocus type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value) || 1)} onKeyDown={(e) => { if (e.key === 'Enter') doAdd(e.ctrlKey || e.metaKey); }} /></label>
                  )}
                </div>}

                {!props.pickOnly && <div className="preview">
                  {preview && (
                    <>
                      <div>Расчётное кол-во: <b>{new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 4 }).format(preview.qtyEff)}</b> {sel.unit ?? ''}</div>
                      <div>Цена: <b>{sel.priceKind === 'percent' ? `+${sel.price}%` : fmtMoney(sel.price)}</b></div>
                      <div className="preview-sum">Сумма: <b>{preview.sum != null ? fmtMoney(Math.round(preview.sum * 100) / 100) : '—'}</b></div>
                    </>
                  )}
                </div>}
                <div className="modal-actions">
                  <button className="btn ghost" onClick={props.onClose}>Отмена (Esc)</button>
                  {!props.pickOnly && <button className="btn ghost" onClick={() => doAdd(true)}>Добавить и продолжить (Ctrl+Enter)</button>}
                  <button className="btn primary" onClick={() => doAdd(false)}>{props.pickOnly ? 'Выбрать эту позицию' : 'Добавить в расчёт (Enter)'}</button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
