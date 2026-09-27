import { useMemo, useState } from 'react';
import type { Pricebook, PriceItem, ProjectLine, Template } from '../types';
import { lineFromItem, calcTotals, sheetsFromLength, sheetLengthOf, unitIsHalfSheetAllowed } from '../lib/engine';
import { defaultSettings } from '../lib/storage';
import { fmtMoney, todayISO } from '../lib/format';

/**
 * Быстрый расчёт. Два инструмента:
 * 1) Конструктор — собирает кухню из РЕАЛЬНЫХ позиций прайса по прозрачным правилам
 *    комплектации (все правила видимы и редактируемы, цены только из прайса).
 * 2) Шаблоны — сохранённые наборы позиций из прошлых проектов.
 */

/** Кнопка-фильтр по типу материала (напр. «Плёнка ПВХ», «Эмаль») */
type Chip = { label: string; pred: (i: PriceItem) => boolean };

function ItemSelect(props: {
  items: PriceItem[];
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder: string;
  /** Кнопки-типы над списком: сначала выбираешь тип материала, потом позицию */
  chips?: Chip[];
}) {
  const [q, setQ] = useState('');
  const [chip, setChip] = useState(-1); // -1 = все типы
  const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');

  const filtered = useMemo(() => {
    let list = props.items;
    if (props.chips && chip >= 0) list = list.filter(props.chips[chip].pred);
    const terms = norm(q).split(/\s+/).filter(Boolean);
    if (terms.length) list = list.filter((i) => terms.every((t) => norm(`${i.name} ${i.article ?? ''} ${i.subcategory ?? ''} ${i.category}`).includes(t)));
    return list.slice(0, 300);
  }, [props.items, props.chips, chip, q]);

  // группировка списка: «Категория → Подкатегория» как заголовки внутри выпадашки
  const grouped = useMemo(() => {
    const m = new Map<string, PriceItem[]>();
    for (const i of filtered) {
      const key = i.subcategory ? `${shortCat(i.category)} — ${i.subcategory}` : shortCat(i.category);
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(i);
    }
    return [...m.entries()];
  }, [filtered]);

  const selected = props.items.find((i) => i.id === props.value) ?? null;
  const selectedVisible = selected && filtered.some((i) => i.id === selected.id);

  const optLabel = (i: PriceItem) => {
    const th = i.attrs?.['толщина'];
    const bits = [i.name.slice(0, 70)];
    if (th && !i.name.includes(th)) bits.push(th);
    bits.push(i.price != null ? `${i.price} ₽${i.unit ? `/${i.unit}` : ''}` : 'нет цены');
    return bits.join(' · ');
  };

  return (
    <div className="item-select">
      {props.chips && (
        <div className="chips">
          <button type="button" className={chip === -1 ? 'chip active' : 'chip'} onClick={() => setChip(-1)}>Все</button>
          {props.chips.map((c, idx) => (
            <button type="button" key={c.label} className={chip === idx ? 'chip active' : 'chip'} onClick={() => setChip(idx)}>
              {c.label}
            </button>
          ))}
        </div>
      )}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`поиск: ${props.placeholder}`} />
      <select value={props.value ?? ''} onChange={(e) => props.onChange(e.target.value || null)}>
        <option value="">— не добавлять —</option>
        {selected && !selectedVisible && (
          <optgroup label="Выбрано сейчас">
            <option value={selected.id}>{optLabel(selected)}</option>
          </optgroup>
        )}
        {grouped.map(([g, items]) => (
          <optgroup key={g} label={g}>
            {items.map((i) => (
              <option key={i.id} value={i.id}>{optLabel(i)}</option>
            ))}
          </optgroup>
        ))}
      </select>
      {selected && (
        <div className="muted small sel-info">
          ✓ {selected.subcategory ? `${shortCat(selected.category)} — ${selected.subcategory}: ` : ''}{selected.name.slice(0, 60)}
          {selected.attrs?.['толщина'] && !selected.name.includes(selected.attrs['толщина']) ? ` · ${selected.attrs['толщина']}` : ''}
        </div>
      )}
    </div>
  );
}

/** Убирает служебный префикс категории для компактных заголовков групп */
function shortCat(c: string): string {
  return c
    .replace('Фасады: ', '')
    .replace('Столешницы: ', '')
    .replace('Фурнитура BLUM (доп. лист)', 'BLUM (доп. лист)')
    .replace('Корпуса: ', '');
}

export default function QuickCalc(props: {
  pricebook: Pricebook;
  templates: Template[];
  onDeleteTemplate: (id: string) => void;
  onCreateProject: (d: { name: string; client: string; date: string; comment: string }, lines: ProjectLine[]) => void;
}) {
  const { pricebook } = props;
  const [tab, setTab] = useState<'ctor' | 'templates'>('ctor');

  // ---- параметры конструктора (правила комплектации — видимые, редактируемые) ----
  const [lowLen, setLowLen] = useState(2400);
  const [lowModW, setLowModW] = useState(600);
  const [upLen, setUpLen] = useState(2400);
  const [upModW, setUpModW] = useState(600);
  const [lowBase, setLowBase] = useState<string | null>(null);
  const [upBase, setUpBase] = useState<string | null>(null);
  const [facade, setFacade] = useState<string | null>(null);
  const [facadeHLow, setFacadeHLow] = useState(716);
  const [facadeHUp, setFacadeHUp] = useState(716);
  const [hinge, setHinge] = useState<string | null>(null);
  const [hingePerDoor, setHingePerDoor] = useState(2);
  const [drawer, setDrawer] = useState<string | null>(null);
  const [drawerQty, setDrawerQty] = useState(0);
  const [worktop, setWorktop] = useState<string | null>(null);
  const [worktopLen, setWorktopLen] = useState(2400);
  const [legs, setLegs] = useState<string | null>(null);
  const [legsPerMod, setLegsPerMod] = useState(4);
  const [plinth, setPlinth] = useState<string | null>(null);
  const [plinthQty, setPlinthQty] = useState(1);
  const [dryer, setDryer] = useState<string | null>(null);
  const [sink, setSink] = useState<string | null>(null);
  const [mixer, setMixer] = useState<string | null>(null);
  const [handle, setHandle] = useState<string | null>(null);
  const [handleQty, setHandleQty] = useState(0);

  const byId = (id: string | null) => pricebook.items.find((i) => i.id === id) ?? null;
  const priced = (pred: (i: PriceItem) => boolean) => pricebook.items.filter((i) => i.priceKind === 'fixed' && pred(i));

  const lowMods = Math.max(0, Math.ceil(lowLen / Math.max(lowModW, 1)));
  const upMods = Math.max(0, Math.ceil(upLen / Math.max(upModW, 1)));
  const doors = lowMods + upMods;

  const lines = useMemo<ProjectLine[]>(() => {
    const out: ProjectLine[] = [];
    const pbId = pricebook.meta.id;
    const lb = byId(lowBase); if (lb && lowMods > 0) out.push(lineFromItem(lb, pbId, lowMods));
    const ub = byId(upBase); if (ub && upMods > 0) out.push(lineFromItem(ub, pbId, upMods));
    const f = byId(facade);
    if (f) {
      if (lowLen > 0) out.push({ ...lineFromItem(f, pbId, 1, { widthMm: lowLen, heightMm: facadeHLow }), note: 'фасады нижнего ряда (площадь: длина × высота)' });
      if (upLen > 0) out.push({ ...lineFromItem(f, pbId, 1, { widthMm: upLen, heightMm: facadeHUp }), note: 'фасады верхнего ряда' });
    }
    const hg = byId(hinge); if (hg && doors > 0 && hingePerDoor > 0) out.push({ ...lineFromItem(hg, pbId, doors * hingePerDoor), note: `${doors} фасадов × ${hingePerDoor} петли` });
    const dr = byId(drawer); if (dr && drawerQty > 0) out.push(lineFromItem(dr, pbId, drawerQty));
    const wt = byId(worktop);
    if (wt && worktopLen > 0) {
      const slen = sheetLengthOf(wt);
      const qty = wt.priceBasis === 'sheet' ? sheetsFromLength(worktopLen, slen, unitIsHalfSheetAllowed(wt.unit)) : 1;
      out.push({ ...lineFromItem(wt, pbId, qty), note: `подбор из длины ${worktopLen} мм (хлыст ${slen} мм)` });
    }
    const lg = byId(legs); if (lg && lowMods > 0 && legsPerMod > 0) out.push({ ...lineFromItem(lg, pbId, lowMods * legsPerMod), note: `${lowMods} модулей × ${legsPerMod} опоры` });
    const pl = byId(plinth); if (pl && plinthQty > 0) out.push(lineFromItem(pl, pbId, plinthQty));
    const dy = byId(dryer); if (dy) out.push(lineFromItem(dy, pbId, 1));
    const sk = byId(sink); if (sk) out.push(lineFromItem(sk, pbId, 1));
    const mx = byId(mixer); if (mx) out.push(lineFromItem(mx, pbId, 1));
    const hd = byId(handle); if (hd && handleQty > 0) out.push(lineFromItem(hd, pbId, handleQty));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pricebook, lowBase, upBase, facade, hinge, drawer, worktop, legs, plinth, dryer, sink, mixer, handle,
      lowLen, upLen, lowModW, upModW, facadeHLow, facadeHUp, hingePerDoor, drawerQty, worktopLen, legsPerMod, plinthQty, handleQty]);

  const { totals } = useMemo(() => calcTotals(lines, defaultSettings()), [lines]);

  const create = (lns: ProjectLine[], name: string) => {
    props.onCreateProject({ name, client: '', date: todayISO(), comment: 'Создано из быстрого расчёта' },
      JSON.parse(JSON.stringify(lns)));
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Быстрый расчёт</h1>
          <div className="muted">Ориентировочная стоимость из реальных позиций прайса. Правила комплектации видимы и редактируемы.</div>
        </div>
      </header>
      <div className="tabs">
        <button className={tab === 'ctor' ? 'active' : ''} onClick={() => setTab('ctor')}>Конструктор</button>
        <button className={tab === 'templates' ? 'active' : ''} onClick={() => setTab('templates')}>Шаблоны ({props.templates.length})</button>
      </div>

      {tab === 'templates' && (
        <div className="card">
          {props.templates.length === 0 && (
            <p className="muted">Шаблонов пока нет. Откройте любой проект и нажмите «В шаблон» — типовая кухня появится здесь, и её можно будет использовать как основу нового расчёта.</p>
          )}
          {props.templates.map((t) => {
            const tt = calcTotals(t.lines, defaultSettings()).totals;
            return (
              <div className="tpl-row" key={t.id}>
                <div><b>{t.name}</b><div className="muted small">{t.lines.length} позиций · себестоимость {fmtMoney(tt.cost)}</div></div>
                <div>
                  <button className="btn primary" onClick={() => create(t.lines, `${t.name} — новый расчёт`)}>Создать проект</button>
                  <button className="btn tiny danger" onClick={() => props.onDeleteTemplate(t.id)}>✕</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'ctor' && (
        <div className="editor-grid">
          <div className="lines-col">
            <section className="card">
              <h3>1. Корпуса</h3>
              <div className="grid2">
                <label>Нижний ряд, длина мм<input type="number" value={lowLen} onChange={(e) => setLowLen(Number(e.target.value) || 0)} /></label>
                <label>Ширина модуля, мм<input type="number" value={lowModW} onChange={(e) => setLowModW(Number(e.target.value) || 1)} /></label>
              </div>
              <div className="muted small">→ {lowMods} нижних модулей</div>
              <ItemSelect items={priced((i) => i.category === 'Корпуса: столы и пеналы')} value={lowBase} onChange={setLowBase} placeholder="напр. 2-х дверный 600" />
              <div className="grid2">
                <label>Верхний ряд, длина мм<input type="number" value={upLen} onChange={(e) => setUpLen(Number(e.target.value) || 0)} /></label>
                <label>Ширина модуля, мм<input type="number" value={upModW} onChange={(e) => setUpModW(Number(e.target.value) || 1)} /></label>
              </div>
              <div className="muted small">→ {upMods} верхних модулей</div>
              <ItemSelect items={priced((i) => i.category === 'Корпуса: шкафы навесные')} value={upBase} onChange={setUpBase} placeholder="напр. 2-х дверный Н=720 600" />
            </section>

            <section className="card">
              <h3>2. Фасады</h3>
              <div className="muted small">Сначала выберите тип материала, затем конкретную позицию (категория декора и толщина видны в списке).</div>
              <ItemSelect
                items={priced((i) => i.category.startsWith('Фасады') && i.priceBasis === 'm2')}
                chips={[
                  { label: 'Плёнка ПВХ (МДФ)', pred: (i) => i.category === 'Фасады: МДФ (ПВХ плёнка)' },
                  { label: 'Эмаль', pred: (i) => i.category === 'Фасады: Эмаль' },
                  { label: 'Пластик (HPL)', pred: (i) => i.category === 'Фасады: Пластик (HPL)' },
                  { label: 'TSS плита', pred: (i) => i.category === 'Фасады: TSS плита' },
                  { label: 'Стекло и зеркала', pred: (i) => i.category === 'Фасады: Стекло и зеркала' },
                ]}
                value={facade} onChange={setFacade} placeholder="категория декора, толщина…" />
              <div className="grid2">
                <label>Высота фасадов низа, мм<input type="number" value={facadeHLow} onChange={(e) => setFacadeHLow(Number(e.target.value) || 0)} /></label>
                <label>Высота фасадов верха, мм<input type="number" value={facadeHUp} onChange={(e) => setFacadeHUp(Number(e.target.value) || 0)} /></label>
              </div>
              <div className="muted small">Площадь = длина ряда × высота фасадов. Для точного расчёта по каждому фасаду используйте «Подробный расчёт».</div>
            </section>

            <section className="card">
              <h3>3. Фурнитура</h3>
              <ItemSelect
                items={priced((i) => i.category === 'Петли' || (i.category.includes('BLUM') && i.subcategory === 'Петли Blum'))}
                chips={[
                  { label: 'Обычные (Боярд и др.)', pred: (i) => i.category === 'Петли' },
                  { label: 'Blum', pred: (i) => i.category.includes('BLUM') },
                ]}
                value={hinge} onChange={setHinge} placeholder="петля" />
              <label className="inline">Петель на фасад <input className="qty" type="number" value={hingePerDoor} onChange={(e) => setHingePerDoor(Number(e.target.value) || 0)} /> (фасадов: {doors})</label>
              <ItemSelect
                items={priced((i) => i.category === 'Системы выдвижения' || (i.category.includes('BLUM') && i.subcategory === 'Ящики и направляющие Blum'))}
                chips={[
                  { label: 'Обычные', pred: (i) => i.category === 'Системы выдвижения' },
                  { label: 'Blum', pred: (i) => i.category.includes('BLUM') },
                ]}
                value={drawer} onChange={setDrawer} placeholder="ящик / направляющие" />
              <label className="inline">Ящиков, шт <input className="qty" type="number" value={drawerQty} onChange={(e) => setDrawerQty(Number(e.target.value) || 0)} /></label>
              <ItemSelect items={priced((i) => i.category === 'Посудосушители')} value={dryer} onChange={setDryer} placeholder="посудосушитель" />
            </section>

            <section className="card">
              <h3>4. Столешница</h3>
              <ItemSelect
                items={priced((i) => i.category.startsWith('Столешницы'))}
                chips={[
                  { label: 'Мир Столешниц', pred: (i) => i.category === 'Столешницы: Мир Столешниц (постформинг)' },
                  { label: 'СОЮЗ', pred: (i) => i.category === 'Столешницы: СОЮЗ (постформинг)' },
                  { label: 'Компакт Slotex', pred: (i) => i.category === 'Столешницы: компакт-плита Slotex' },
                  { label: 'Компакт Arkobaleno', pred: (i) => i.category === 'Столешницы: компакт-плита Arkobaleno' },
                  { label: 'Комплектующие', pred: (i) => i.category === 'Столешницы: комплектующие' },
                ]}
                value={worktop} onChange={setWorktop} placeholder="категория декора, размер…" />
              <label className="inline">Длина столешницы, мм <input className="qty wide" type="number" value={worktopLen} onChange={(e) => setWorktopLen(Number(e.target.value) || 0)} /></label>
            </section>

            <section className="card">
              <h3>5. Опоры, цоколь, ручки, мойка</h3>
              <ItemSelect items={priced((i) => i.category === 'Опоры и ножки')} value={legs} onChange={setLegs} placeholder="опора" />
              <label className="inline">Опор на модуль <input className="qty" type="number" value={legsPerMod} onChange={(e) => setLegsPerMod(Number(e.target.value) || 0)} /></label>
              <ItemSelect items={priced((i) => i.category === 'Цоколь и длинномеры')} value={plinth} onChange={setPlinth} placeholder="цоколь / плинтус" />
              <label className="inline">Кол-во <input className="qty" type="number" value={plinthQty} onChange={(e) => setPlinthQty(Number(e.target.value) || 0)} /></label>
              <ItemSelect items={priced((i) => i.category === 'Ручки')} value={handle} onChange={setHandle} placeholder="ручка" />
              <label className="inline">Ручек, шт <input className="qty" type="number" value={handleQty} onChange={(e) => setHandleQty(Number(e.target.value) || 0)} /></label>
              <ItemSelect items={priced((i) => i.category === 'Мойки')} value={sink} onChange={setSink} placeholder="мойка" />
              <ItemSelect items={priced((i) => i.category === 'Смесители')} value={mixer} onChange={setMixer} placeholder="смеситель" />
            </section>
          </div>

          <aside className="totals-col">
            <div className="totals-card">
              <h3>Ориентировочно</h3>
              {lines.length === 0 ? <div className="muted small">Выберите позиции слева.</div> : (
                <>
                  {lines.map((l) => {
                    const c = calcTotals([l], defaultSettings()).totals.cost;
                    return <div className="t-row small" key={l.id}><span>{l.name.slice(0, 44)}… × {l.qty}</span><span>{fmtMoney(c)}</span></div>;
                  })}
                  <div className="t-row total"><span>Себестоимость (без наценки)</span><span>{fmtMoney(totals.cost)}</span></div>
                  <div className="note">Наценка и цена клиента появятся в проекте согласно вашим настройкам.</div>
                  <button className="btn primary block" onClick={() => create(lines, 'Быстрый расчёт')}>Создать проект из этого расчёта</button>
                </>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
