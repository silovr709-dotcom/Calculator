import { useMemo, useState } from 'react';
import type { Pricebook, PriceItem, ProjectLine, Template } from '../types';
import { lineFromItem, calcTotals, sheetsFromLength, sheetLengthOf, unitIsHalfSheetAllowed } from '../lib/engine';
import { defaultSettings, uid } from '../lib/storage';
import { fmtMoney, fmtNum, todayISO } from '../lib/format';

/**
 * Быстрый расчёт. Два инструмента:
 * 1) Конструктор — собирает кухню из РЕАЛЬНЫХ позиций прайса по прозрачным правилам
 *    комплектации (все правила видимы и редактируемы, цены только из прайса).
 * 2) Шаблоны — сохранённые наборы позиций из прошлых проектов.
 * Все разделы — списки: любых позиций можно добавить сколько угодно строк.
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
        <option value="">— не выбрано —</option>
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

/** Строка «позиция + параметры + количество» для мульти-списков */
type ExtraRow = { uid: string; itemId: string | null; qty: number; widthMm?: number; heightMm?: number; lengthMm?: number };
const newRow = (qty = 1): ExtraRow => ({ uid: uid('row'), itemId: null, qty });

/** Построение строки проекта из строки конструктора (учитывает базис цены позиции) */
function rowToLine(r: ExtraRow, item: PriceItem | null, pbId: string): ProjectLine | null {
  if (!item) return null;
  if (item.priceBasis === 'm2') {
    if (r.qty <= 0 || !r.widthMm || !r.heightMm) return null; // без размеров площадь не считаем
    return lineFromItem(item, pbId, r.qty, { widthMm: r.widthMm, heightMm: r.heightMm });
  }
  if (item.priceBasis === 'sheet') {
    if (r.lengthMm && r.lengthMm > 0) {
      const slen = sheetLengthOf(item);
      const qty = sheetsFromLength(r.lengthMm, slen, unitIsHalfSheetAllowed(item.unit));
      return { ...lineFromItem(item, pbId, qty), note: `подбор из длины ${r.lengthMm} мм (хлыст ${slen} мм)` };
    }
    return r.qty > 0 ? lineFromItem(item, pbId, r.qty) : null;
  }
  if (r.qty <= 0) return null;
  return lineFromItem(item, pbId, r.qty);
}

function MultiRows(props: {
  pool: PriceItem[];
  chips?: Chip[];
  placeholder: string;
  addLabel: string;
  qtyLabel?: string;
  defaultQty?: number;
  rows: ExtraRow[];
  onChange: (rows: ExtraRow[]) => void;
}) {
  const upd = (u: string, patch: Partial<ExtraRow>) =>
    props.onChange(props.rows.map((r) => (r.uid === u ? { ...r, ...patch } : r)));
  const byId = (id: string | null) => props.pool.find((i) => i.id === id) ?? null;

  return (
    <div className="multi-rows">
      {props.rows.map((r, idx) => {
        const it = byId(r.itemId);
        const basis = it?.priceBasis;
        const slen = it && basis === 'sheet' ? sheetLengthOf(it) : 0;
        const sheets = it && basis === 'sheet' && r.lengthMm ? sheetsFromLength(r.lengthMm, slen, unitIsHalfSheetAllowed(it.unit)) : 0;
        const area = basis === 'm2' && r.widthMm && r.heightMm ? (r.widthMm / 1000) * (r.heightMm / 1000) * r.qty : 0;
        return (
          <div className="extra-row" key={r.uid}>
            <div className="extra-row-head">
              <span className="muted small">{props.placeholder} #{idx + 1}</span>
              <button type="button" className="btn tiny danger" title="Убрать строку"
                onClick={() => props.onChange(props.rows.filter((x) => x.uid !== r.uid))}>✕</button>
            </div>
            <ItemSelect items={props.pool} chips={props.chips} value={r.itemId}
              onChange={(id) => upd(r.uid, { itemId: id })} placeholder={props.placeholder} />

            {basis === 'm2' && (
              <>
                <div className="grid3">
                  <label>Ширина, мм<input type="number" min={0} value={r.widthMm ?? ''} placeholder="напр. 596"
                    onChange={(e) => upd(r.uid, { widthMm: Number(e.target.value) || undefined })} /></label>
                  <label>Высота, мм<input type="number" min={0} value={r.heightMm ?? ''} placeholder="напр. 716"
                    onChange={(e) => upd(r.uid, { heightMm: Number(e.target.value) || undefined })} /></label>
                  <label>Кол-во, шт<input type="number" min={0} value={r.qty}
                    onChange={(e) => upd(r.uid, { qty: Number(e.target.value) || 0 })} /></label>
                </div>
                {area > 0
                  ? <div className="muted small">→ площадь {fmtNum(area)} м²</div>
                  : <div className="warn small">Укажите ширину и высоту — цена этой позиции за м²</div>}
              </>
            )}

            {basis === 'sheet' && (
              <>
                <label className="inline">Нужная длина, мм{' '}
                  <input className="qty wide" type="number" min={0} value={r.lengthMm ?? ''} placeholder={`хлыст ${slen}`}
                    onChange={(e) => upd(r.uid, { lengthMm: Number(e.target.value) || undefined })} />
                </label>
                {r.lengthMm
                  ? <div className="muted small">→ {fmtNum(sheets)} хлыста ({slen} мм{unitIsHalfSheetAllowed(it!.unit) ? ', можно по 0,5' : ', только целиком'})</div>
                  : <label className="inline">или хлыстов вручную{' '}
                      <input className="qty" type="number" min={0} step="0.5" value={r.qty}
                        onChange={(e) => upd(r.uid, { qty: Number(e.target.value) || 0 })} /></label>}
              </>
            )}

            {basis !== 'm2' && basis !== 'sheet' && (
              <label className="inline">{props.qtyLabel ?? 'Кол-во'}{it?.unit ? ` (${it.unit})` : ''}{' '}
                <input className="qty" type="number" min={0} step="any" value={r.qty}
                  onChange={(e) => upd(r.uid, { qty: Number(e.target.value) || 0 })} />
              </label>
            )}
          </div>
        );
      })}
      <button type="button" className="btn tiny add" onClick={() => props.onChange([...props.rows, newRow(props.defaultQty ?? 1)])}>
        ＋ {props.addLabel}
      </button>
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

const FACADE_CHIPS: Chip[] = [
  { label: 'Плёнка ПВХ (МДФ)', pred: (i) => i.category === 'Фасады: МДФ (ПВХ плёнка)' },
  { label: 'Эмаль', pred: (i) => i.category === 'Фасады: Эмаль' },
  { label: 'Пластик (HPL)', pred: (i) => i.category === 'Фасады: Пластик (HPL)' },
  { label: 'TSS плита', pred: (i) => i.category === 'Фасады: TSS плита' },
  { label: 'Стекло и зеркала', pred: (i) => i.category === 'Фасады: Стекло и зеркала' },
];
const WORKTOP_CHIPS: Chip[] = [
  { label: 'Мир Столешниц', pred: (i) => i.category === 'Столешницы: Мир Столешниц (постформинг)' },
  { label: 'СОЮЗ', pred: (i) => i.category === 'Столешницы: СОЮЗ (постформинг)' },
  { label: 'Компакт Slotex', pred: (i) => i.category === 'Столешницы: компакт-плита Slotex' },
  { label: 'Компакт Arkobaleno', pred: (i) => i.category === 'Столешницы: компакт-плита Arkobaleno' },
  { label: 'Комплектующие', pred: (i) => i.category === 'Столешницы: комплектующие' },
];
const BLUM_CHIPS = (sub: string, plain: string): Chip[] => [
  { label: plain, pred: (i) => !i.category.includes('BLUM') },
  { label: 'Blum', pred: (i) => i.category.includes('BLUM') && i.subcategory === sub },
];

export default function QuickCalc(props: {
  pricebook: Pricebook;
  templates: Template[];
  onDeleteTemplate: (id: string) => void;
  onCreateProject: (d: { name: string; client: string; date: string; comment: string }, lines: ProjectLine[], modules?: Template['modules'], moduleDefaults?: Template['moduleDefaults']) => void;
}) {
  const { pricebook } = props;
  const [tab, setTab] = useState<'ctor' | 'templates'>('ctor');

  // ---- подсказка по количеству модулей (не ограничивает выбор) ----
  const [lowLen, setLowLen] = useState(2400);
  const [lowModW, setLowModW] = useState(600);
  const [upLen, setUpLen] = useState(2400);
  const [upModW, setUpModW] = useState(600);
  const lowModsHint = Math.max(0, Math.ceil(lowLen / Math.max(lowModW, 1)));
  const upModsHint = Math.max(0, Math.ceil(upLen / Math.max(upModW, 1)));

  // ---- мульти-списки всех разделов ----
  const [lowRows, setLowRows] = useState<ExtraRow[]>([]);
  const [upRows, setUpRows] = useState<ExtraRow[]>([]);
  const [facadeRows, setFacadeRows] = useState<ExtraRow[]>([]);
  const [hingeRows, setHingeRows] = useState<ExtraRow[]>([]);
  const [drawerRows, setDrawerRows] = useState<ExtraRow[]>([]);
  const [dryerRows, setDryerRows] = useState<ExtraRow[]>([]);
  const [worktopRows, setWorktopRows] = useState<ExtraRow[]>([]);
  const [legRows, setLegRows] = useState<ExtraRow[]>([]);
  const [plinthRows, setPlinthRows] = useState<ExtraRow[]>([]);
  const [handleRows, setHandleRows] = useState<ExtraRow[]>([]);
  const [sinkRows, setSinkRows] = useState<ExtraRow[]>([]);
  const [extraRows, setExtraRows] = useState<ExtraRow[]>([]);

  const byId = (id: string | null) => pricebook.items.find((i) => i.id === id) ?? null;
  const priced = (pred: (i: PriceItem) => boolean) => pricebook.items.filter((i) => i.priceKind === 'fixed' && pred(i));

  // число модулей/фасадов из реально добавленных строк (для подсказок по петлям и ручкам)
  const modulesTotal = [...lowRows, ...upRows].reduce((s, r) => s + (r.itemId && r.qty > 0 ? r.qty : 0), 0);
  const facadesTotal = facadeRows.reduce((s, r) => s + (r.itemId && r.qty > 0 ? r.qty : 0), 0);

  const allRowGroups = [lowRows, upRows, facadeRows, hingeRows, drawerRows, dryerRows, worktopRows, legRows, plinthRows, handleRows, sinkRows, extraRows];

  const lines = useMemo<ProjectLine[]>(() => {
    const out: ProjectLine[] = [];
    const pbId = pricebook.meta.id;
    for (const rows of allRowGroups) {
      for (const r of rows) {
        const line = rowToLine(r, byId(r.itemId), pbId);
        if (line) out.push(line);
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pricebook, lowRows, upRows, facadeRows, hingeRows, drawerRows, dryerRows, worktopRows, legRows, plinthRows, handleRows, sinkRows, extraRows]);

  const { totals } = useMemo(() => calcTotals(lines, defaultSettings()), [lines]);

  const create = (lns: ProjectLine[], name: string, modules?: Template['modules'], moduleDefaults?: Template['moduleDefaults']) => {
    props.onCreateProject({ name, client: '', date: todayISO(), comment: 'Создано из быстрого расчёта' },
      JSON.parse(JSON.stringify(lns)), modules ? JSON.parse(JSON.stringify(modules)) : undefined, moduleDefaults ? JSON.parse(JSON.stringify(moduleDefaults)) : undefined);
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Быстрый расчёт</h1>
          <div className="muted">Ориентировочная стоимость из реальных позиций прайса. В каждом разделе можно добавить сколько угодно разных позиций.</div>
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
                <div><b>{t.name}</b><div className="muted small">{(t.modules?.length ?? 0) > 0 ? `${t.modules!.length} модулей + ` : ''}{t.lines.length} строк · себестоимость строк {fmtMoney(tt.cost)}</div></div>
                <div>
                  <button className="btn primary" onClick={() => create(t.lines, `${t.name} — новый расчёт`, t.modules, t.moduleDefaults)}>Создать проект</button>
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
              <div className="muted small">Подсказка по количеству (не ограничивает выбор):</div>
              <div className="grid4">
                <label>Низ: длина, мм<input type="number" value={lowLen} onChange={(e) => setLowLen(Number(e.target.value) || 0)} /></label>
                <label>ширина модуля<input type="number" value={lowModW} onChange={(e) => setLowModW(Number(e.target.value) || 1)} /></label>
                <label>Верх: длина, мм<input type="number" value={upLen} onChange={(e) => setUpLen(Number(e.target.value) || 0)} /></label>
                <label>ширина модуля<input type="number" value={upModW} onChange={(e) => setUpModW(Number(e.target.value) || 1)} /></label>
              </div>
              <div className="muted small">→ примерно {lowModsHint} нижних и {upModsHint} верхних модулей</div>
              <h4>Нижний ряд (столы, пеналы)</h4>
              <MultiRows pool={priced((i) => i.category === 'Корпуса: столы и пеналы')}
                placeholder="стол / пенал" addLabel="Добавить корпус (низ)" qtyLabel="Модулей, шт"
                rows={lowRows} onChange={setLowRows} />
              <h4>Верхний ряд (навесные)</h4>
              <MultiRows pool={priced((i) => i.category === 'Корпуса: шкафы навесные')}
                placeholder="шкаф навесной" addLabel="Добавить корпус (верх)" qtyLabel="Модулей, шт"
                rows={upRows} onChange={setUpRows} />
            </section>

            <section className="card">
              <h3>2. Фасады</h3>
              <div className="muted small">Каждая строка — свой материал и размер: например, низ в плёнке 716×596 × 4 шт, верх в эмали 916×446 × 3 шт. Цена за м², площадь считается из размеров.</div>
              <MultiRows pool={priced((i) => i.category.startsWith('Фасады') && i.priceBasis === 'm2')}
                chips={FACADE_CHIPS}
                placeholder="фасад (тип материала → категория декора, толщина)" addLabel="Добавить фасады"
                rows={facadeRows} onChange={setFacadeRows} />
            </section>

            <section className="card">
              <h3>3. Фурнитура</h3>
              <div className="muted small">Фасадов добавлено: {facadesTotal || '—'} {facadesTotal ? `(обычно 2 петли на распашной фасад → ${facadesTotal * 2} петель)` : ''}</div>
              <MultiRows pool={priced((i) => i.category === 'Петли' || (i.category.includes('BLUM') && i.subcategory === 'Петли Blum'))}
                chips={BLUM_CHIPS('Петли Blum', 'Обычные (Боярд и др.)')}
                placeholder="петля" addLabel="Добавить петли" qtyLabel="Петель, шт" defaultQty={facadesTotal * 2 || 2}
                rows={hingeRows} onChange={setHingeRows} />
              <MultiRows pool={priced((i) => i.category === 'Системы выдвижения' || (i.category.includes('BLUM') && i.subcategory === 'Ящики и направляющие Blum'))}
                chips={BLUM_CHIPS('Ящики и направляющие Blum', 'Обычные')}
                placeholder="ящик / направляющие" addLabel="Добавить ящики" qtyLabel="Ящиков, шт"
                rows={drawerRows} onChange={setDrawerRows} />
              <MultiRows pool={priced((i) => i.category === 'Посудосушители')}
                placeholder="посудосушитель" addLabel="Добавить посудосушитель"
                rows={dryerRows} onChange={setDryerRows} />
            </section>

            <section className="card">
              <h3>4. Столешницы</h3>
              <div className="muted small">Можно несколько строк — например, разные декоры на разные участки. Хлысты подбираются из нужной длины по правилам прайса.</div>
              <MultiRows pool={priced((i) => i.category.startsWith('Столешницы'))}
                chips={WORKTOP_CHIPS}
                placeholder="столешница / комплектующие" addLabel="Добавить столешницу"
                rows={worktopRows} onChange={setWorktopRows} />
            </section>

            <section className="card">
              <h3>5. Опоры, цоколь, ручки, мойка</h3>
              <div className="muted small">Подсказка: модулей {modulesTotal || '—'}{modulesTotal ? `, обычно 4 опоры на модуль → ${modulesTotal * 4} опор` : ''}.</div>
              <MultiRows pool={priced((i) => i.category === 'Опоры и ножки')}
                placeholder="опора / ножка" addLabel="Добавить опоры" qtyLabel="Опор, шт" defaultQty={modulesTotal * 4 || 4}
                rows={legRows} onChange={setLegRows} />
              <MultiRows pool={priced((i) => i.category === 'Цоколь и длинномеры')}
                placeholder="цоколь / плинтус / профиль" addLabel="Добавить цоколь или плинтус"
                rows={plinthRows} onChange={setPlinthRows} />
              <MultiRows pool={priced((i) => i.category === 'Ручки')}
                placeholder="ручка" addLabel="Добавить ручки" qtyLabel="Ручек, шт" defaultQty={facadesTotal || 1}
                rows={handleRows} onChange={setHandleRows} />
              <MultiRows pool={priced((i) => i.category === 'Мойки' || i.category === 'Смесители')}
                chips={[
                  { label: 'Мойки', pred: (i) => i.category === 'Мойки' },
                  { label: 'Смесители', pred: (i) => i.category === 'Смесители' },
                ]}
                placeholder="мойка / смеситель" addLabel="Добавить мойку или смеситель"
                rows={sinkRows} onChange={setSinkRows} />
            </section>

            <section className="card">
              <h3>6. Дополнительно — любые позиции прайса</h3>
              <div className="muted small">Всё, чего нет в разделах выше: подъёмники, бутылочницы, карго, внутреннее наполнение, электрика, GOLA и т.д.</div>
              <MultiRows pool={priced(() => true)}
                chips={[
                  { label: 'Подъёмники', pred: (i) => i.category === 'Подъёмные механизмы' || (i.category.includes('BLUM') && i.subcategory === 'Aventos') },
                  { label: 'Бутылочницы и карго', pred: (i) => i.category === 'Бутылочницы и карго' },
                  { label: 'Наполнение', pred: (i) => i.category === 'Внутреннее наполнение' },
                  { label: 'Электрика и свет', pred: (i) => i.category === 'Электрика и свет' },
                  { label: 'GOLA / профили', pred: (i) => i.category === 'GOLA / профили' },
                  { label: 'Фурнитура', pred: (i) => i.category === 'Фурнитура' || i.category.includes('BLUM') },
                ]}
                placeholder="любая позиция (название или артикул)" addLabel="Добавить позицию"
                rows={extraRows} onChange={setExtraRows} />
            </section>
          </div>

          <aside className="totals-col">
            <div className="totals-card">
              <h3>Ориентировочно</h3>
              {lines.length === 0 ? <div className="muted small">Добавьте позиции слева.</div> : (
                <>
                  {lines.map((l) => {
                    const c = calcTotals([l], defaultSettings()).totals.cost;
                    return <div className="t-row small" key={l.id}><span>{l.name.slice(0, 44)}… × {fmtNum(l.qty)}</span><span>{fmtMoney(c)}</span></div>;
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
