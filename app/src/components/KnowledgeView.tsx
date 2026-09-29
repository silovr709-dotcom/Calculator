import { useEffect, useMemo, useState } from 'react';
import type { KbArticle, KbCategory, Pricebook } from '../types';
import { createKbArticle, filterKbArticles, KB_CATEGORIES, kbCategoryLabel, removeKbArticle, seedKbArticles, upsertKbArticle } from '../lib/knowledge';
import { loadKnowledgeDocs, searchDocs, type DocHit, type KnowledgeDocs } from '../lib/knowledgeDocs';
import { loadFactoryDicts, millingsOf, type FactoryDicts } from '../lib/factoryDicts';
import { millingPriceFrom, millingPrices, searchMillings, MILLING_CATEGORIES, type Milling } from '../lib/millings';
import { hardwareCounts, hardwareEntries, HARDWARE_GROUPS, searchHardware } from '../lib/hardware';
import { fmtMoney } from '../lib/format';
import { materialCategories, materialEntries, materialPriceText, searchMaterials, MATERIAL_GROUPS, type MaterialEntry } from '../lib/materials';

/**
 * База знаний РЕцепта: три вкладки.
 *  📄 Документы — свои статьи + полные тексты инструкций и техничек фабрики
 *                 (поиск по самим текстам, прощает опечатки, показывает источник).
 *  🎨 Материалы и цвета — каталог материалов с ценами прайса и разбивки цветов.
 *  🪚 Фрезеровки — каталог фрезеровок 2026 с картинками, размерами и ценой м² из прайса.
 *  🔩 Фурнитура — справочник из актуального прайса по группам.
 */

type Tab = 'docs' | 'colors' | 'millings' | 'hardware';

const TABS: { id: Tab; label: string }[] = [
  { id: 'docs', label: '📄 Документы' },
  { id: 'colors', label: '🎨 Материалы и цвета' },
  { id: 'millings', label: '🪚 Фрезеровки' },
  { id: 'hardware', label: '🔩 Фурнитура' },
];

export default function KnowledgeView(props: {
  articles: KbArticle[];
  pricebooks: Pricebook[];
  onChange: (articles: KbArticle[]) => void;
}) {
  const [tab, setTab] = useState<Tab>('docs');
  const [docs, setDocs] = useState<KnowledgeDocs | null>(null);
  const [dicts, setDicts] = useState<FactoryDicts | null>(null);

  useEffect(() => {
    loadKnowledgeDocs(import.meta.env.BASE_URL).then(setDocs);
    loadFactoryDicts(import.meta.env.BASE_URL).then(setDicts);
  }, []);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>База знаний</h1>
          <div className="muted">Документы фабрики, материалы с ценами, цвета и фурнитура — в одном месте, с поиском.</div>
        </div>
      </header>

      <div className="kb-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`kb-tab${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'docs' && <DocsTab articles={props.articles} onChange={props.onChange} docs={docs} />}
      {tab === 'colors' && <ColorsTab dicts={dicts} pricebook={props.pricebooks[0]} />}
      {tab === 'millings' && <MillingsTab dicts={dicts} pricebooks={props.pricebooks} />}
      {tab === 'hardware' && <HardwareTab pricebooks={props.pricebooks} />}
    </div>
  );
}

// ---------------------------------------------------------------- Документы

function DocsTab(props: { articles: KbArticle[]; onChange: (a: KbArticle[]) => void; docs: KnowledgeDocs | null }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<KbCategory | null>(null);
  const [editing, setEditing] = useState<KbArticle | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [openDoc, setOpenDoc] = useState<string | null>(null);

  const filtered = useMemo(() => filterKbArticles(props.articles, query, category), [props.articles, query, category]);
  const hits = useMemo<DocHit[]>(
    () => (props.docs && query.trim().length > 1 ? searchDocs(props.docs.docs, query) : []),
    [props.docs, query],
  );

  const openNew = () => { setEditing(createKbArticle({ category: category ?? 'instructions' })); setIsNew(true); };
  const saveEditing = () => {
    if (!editing) return;
    if (!editing.title.trim()) { alert('У статьи должен быть заголовок.'); return; }
    props.onChange(upsertKbArticle(props.articles, editing));
    setEditing(null);
  };

  const totalSections = props.docs?.docs.reduce((s, d) => s + d.sections.length, 0) ?? 0;

  return (
    <>
      <div className="card blank-controls">
        <label className="dashboard-search">Поиск по документам и статьям
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Например: кромка столешницы, петли 110, зазоры фасадов…"
          />
        </label>
        <label>Категория статей
          <select value={category ?? ''} onChange={(e) => setCategory((e.target.value || null) as KbCategory | null)}>
            <option value="">Все категории</option>
            {KB_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        {(query || category) && <button className="btn tiny ghost" onClick={() => { setQuery(''); setCategory(null); }}>Сбросить</button>}
        <div className="dashboard-filter-count muted small">
          {props.docs ? `${props.docs.docs.length} документа фабрики · ${totalSections} разделов` : 'Документы загружаются…'}
        </div>
        <div className="actions">
          {props.articles.length === 0 && (
            <button className="btn ghost" onClick={() => props.onChange(seedKbArticles())}>Загрузить стартовые статьи</button>
          )}
          <button className="btn primary" onClick={openNew}>+ Статья</button>
        </div>
      </div>

      {query.trim().length > 1 && (
        <div className="card kb-section">
          <h3>Найдено в документах фабрики: {hits.length}</h3>
          {hits.length === 0 ? (
            <p className="muted small">В текстах инструкций и техничек ничего не нашлось. Попробуйте другое слово.</p>
          ) : (
            <div className="kb-hits">
              {hits.slice(0, 25).map((h) => (
                <div className="kb-hit" key={h.section.id}>
                  <div className="kb-hit-head">
                    <b>{h.section.heading}</b>
                    <span className="kb-chip">{h.doc.title}</span>
                    <span className="muted small">стр. {h.section.page}</span>
                  </div>
                  <p className="kb-hit-text">{h.snippet}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="card kb-section">
        <h3>Документы фабрики</h3>
        {!props.docs ? (
          <p className="muted small">Загрузка…</p>
        ) : (
          <div className="kb-doc-list">
            {props.docs.docs.map((d) => (
              <div className="kb-doc" key={d.id}>
                <button className="kb-doc-head" onClick={() => setOpenDoc(openDoc === d.id ? null : d.id)}>
                  <span className="kb-doc-title">📄 {d.title}</span>
                  <span className="muted small">{d.pages} стр. · {d.sections.length} разделов</span>
                  <span className="kb-doc-toggle">{openDoc === d.id ? '▾' : '▸'}</span>
                </button>
                {openDoc === d.id && (
                  <div className="kb-doc-body">
                    <div className="muted small">Источник: {d.file}</div>
                    {d.sections.map((s) => (
                      <details key={s.id} className="kb-sec">
                        <summary>{s.heading} <span className="muted small">стр. {s.page}</span></summary>
                        <p>{s.text}</p>
                      </details>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card kb-section">
        <h3>Мои статьи: {filtered.length}</h3>
        {filtered.length === 0 ? (
          <p className="muted small">
            {props.articles.length === 0
              ? 'Своих статей пока нет. Нажмите «Загрузить стартовые статьи» или добавьте свою.'
              : 'Ничего не найдено. Попробуйте другие слова или сбросьте фильтры.'}
          </p>
        ) : (
          <div className="kb-list">
            {filtered.map((a) => (
              <div className="card kb-card" key={a.id}>
                <div className="kb-head">
                  <h3>{a.title}</h3>
                  <div className="actions">
                    <button className="btn tiny ghost" onClick={() => { setEditing({ ...a }); setIsNew(false); }}>Изменить</button>
                    <button className="btn tiny danger" onClick={() => { if (confirm(`Удалить статью «${a.title}»?`)) props.onChange(removeKbArticle(props.articles, a.id)); }}>✕</button>
                  </div>
                </div>
                <div className="kb-meta">
                  <span className="kb-chip">{kbCategoryLabel(a.category)}</span>
                  {a.tags.map((t) => <span key={t} className="kb-tag">#{t}</span>)}
                  <span className="muted small">{a.updatedAt.slice(0, 10)}</span>
                </div>
                <p className="kb-body">{a.body}</p>
                {a.attachment && <div className="muted small">📎 Документ: {a.attachment}</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) setEditing(null); }}>
          <div className="modal">
            <h2>{isNew ? 'Новая статья' : 'Редактировать статью'}</h2>
            <label>Заголовок
              <input autoFocus value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} placeholder="Например: Как оформить заказ на фабрику Висма" />
            </label>
            <label>Категория
              <select value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value as KbCategory })}>
                {KB_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
            <label>Теги (через запятую)
              <input value={editing.tags.join(', ')} onChange={(e) => setEditing({ ...editing, tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })} placeholder="бланк, висма, заказ" />
            </label>
            <label>Текст статьи
              <textarea rows={9} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} placeholder="Содержание, шаги, правила…" />
            </label>
            <label>Приложение (имя файла-документа)
              <input value={editing.attachment ?? ''} onChange={(e) => setEditing({ ...editing, attachment: e.target.value || undefined })} placeholder="Инструкция по заполнению бланк а кухни 2025.pdf" />
            </label>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setEditing(null)}>Отмена</button>
              <button className="btn primary" onClick={saveEditing}>Сохранить</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------ Материалы и цвета

function MaterialsCatalog(props: { pricebook?: Pricebook }) {
  const [query, setQuery] = useState('');
  const [groupId, setGroupId] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [onlyPriced, setOnlyPriced] = useState(true);
  const entries = useMemo(() => materialEntries(props.pricebook), [props.pricebook]);
  const categories = useMemo(() => materialCategories(entries, groupId), [entries, groupId]);
  const found = useMemo(() => searchMaterials(entries, query, { groupId, category, onlyPriced, limit: 1200 }), [entries, query, groupId, category, onlyPriced]);

  if (!props.pricebook) return <div className="empty">Прайс не загружен — каталог материалов будет доступен после загрузки прайса.</div>;

  return (
    <>
      <div className="kb-subtabs">
        <button className={`chip${groupId === null ? ' active' : ''}`} onClick={() => { setGroupId(null); setCategory(null); }}>
          Все материалы <b>{entries.length}</b>
        </button>
        {MATERIAL_GROUPS.filter((group) => entries.some((entry) => entry.group.id === group.id)).map((group) => (
          <button key={group.id} className={`chip${groupId === group.id ? ' active' : ''}`} onClick={() => { setGroupId(group.id); setCategory(null); }}>
            {group.icon} {group.label} <b>{entries.filter((entry) => entry.group.id === group.id).length}</b>
          </button>
        ))}
      </div>
      <div className="card blank-controls">
        <label className="dashboard-search">Поиск материала
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Например: FENIX, эмаль 3 кат, 600*3000, стекло…" />
        </label>
        {categories.length > 0 && (
          <label>Категория прайса
            <select value={category ?? ''} onChange={(event) => setCategory(event.target.value || null)}>
              <option value="">Все категории</option>
              {categories.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        )}
        <label className="kb-check">
          <input type="checkbox" checked={onlyPriced} onChange={(event) => setOnlyPriced(event.target.checked)} /> только с числовой ценой
        </label>
        {(query || groupId || category || !onlyPriced) && <button className="btn tiny ghost" onClick={() => { setQuery(''); setGroupId(null); setCategory(null); setOnlyPriced(true); }}>Сбросить</button>}
        <div className="dashboard-filter-count muted small">Показано: {found.length} из {entries.length} · цены из «{props.pricebook.meta.name}»</div>
      </div>
      <table className="table materials-table">
        <thead><tr><th>Группа</th><th>Материал / позиция прайса</th><th>Категория</th><th>Арт.</th><th>Ед.</th><th className="num">Цена</th><th>Источник</th></tr></thead>
        <tbody>
          {found.slice(0, 600).map((entry: MaterialEntry) => (
            <tr key={entry.item.id}>
              <td className="small">{entry.group.icon} {entry.group.label}</td>
              <td><b>{entry.item.name}</b>{entry.item.note && <div className="muted small">{entry.item.note}</div>}</td>
              <td className="small">{entry.item.category}{entry.item.subcategory ? ` · ${entry.item.subcategory}` : ''}</td>
              <td className="small">{entry.item.article ?? '—'}</td>
              <td className="small">{entry.item.unit ?? '—'}</td>
              <td className="num">{materialPriceText(entry.item)}</td>
              <td className="small muted">{entry.item.source.sheet}, стр. {entry.item.source.row}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {found.length > 600 && <p className="muted small">Показаны первые 600 — уточните поиск или фильтры.</p>}
      {found.length === 0 && <div className="empty small">Ничего не найдено. Снимите фильтр или измените запрос.</div>}
    </>
  );
}

type ColorKind = 'materials' | 'ldspColors' | 'films' | 'plastics';

function ColorsTab(props: { dicts: FactoryDicts | null; pricebook?: Pricebook }) {
  const [kind, setKind] = useState<ColorKind>('materials');
  const [query, setQuery] = useState('');
  const [brand, setBrand] = useState('');
  const [category, setCategory] = useState('');
  const [onlyTexture, setOnlyTexture] = useState(false);
  const [hideRetired, setHideRetired] = useState(true);

  const d = props.dicts;
  const rows = useMemo(() => {
    if (!d || kind === 'materials') return [] as Record<string, unknown>[];
    return d.groups[kind].items as unknown as Record<string, unknown>[];
  }, [d, kind]);

  const brands = useMemo(() => [...new Set(rows.map((r) => String(r.brand ?? '')).filter(Boolean))].sort(), [rows]);
  const categories = useMemo(() => [...new Set(rows.map((r) => String(r.category ?? '')).filter(Boolean))].sort(), [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/ё/g, 'е');
    return rows.filter((r) => {
      if (brand && String(r.brand ?? '') !== brand) return false;
      if (category && String(r.category ?? '') !== category) return false;
      if (onlyTexture && !r.texture) return false;
      const status = String(r.status ?? '');
      if (hideRetired && (status === 'снята' || status === 'выведена')) return false;
      if (!q) return true;
      const hay = `${r.name ?? ''} ${r.code ?? ''} ${r.article ?? ''} ${r.brand ?? ''} ${r.category ?? ''}`
        .toLowerCase().replace(/ё/g, 'е');
      return hay.includes(q);
    });
  }, [rows, query, brand, category, onlyTexture, hideRetired]);

  if (!d && kind !== 'materials') return <div className="empty">Справочники разбивок загружаются…</div>;

  const legend = d ? (d.groups.films as unknown as { legend?: Record<string, string> }).legend : undefined;

  return (
    <>
      <div className="kb-subtabs">
        <button
          className={`chip${kind === 'materials' ? ' active' : ''}`}
          onClick={() => { setKind('materials'); setBrand(''); setCategory(''); }}
        >
          🎨 Материалы с ценами <b>{materialEntries(props.pricebook).length}</b>
        </button>
        {(['ldspColors', 'films', 'plastics'] as const).map((k) => (
          <button
            key={k}
            className={`chip${kind === k ? ' active' : ''}`}
            onClick={() => { setKind(k); setBrand(''); setCategory(''); }}
          >
            {d?.groups[k].label ?? 'Загрузка…'} <b>{d?.groups[k].items.length ?? 0}</b>
          </button>
        ))}
      </div>

      {kind === 'materials' ? <MaterialsCatalog pricebook={props.pricebook} /> : <>
      <div className="card blank-controls">
        <label className="dashboard-search">Поиск
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Название, артикул или код цвета…" />
        </label>
        <label>Бренд
          <select value={brand} onChange={(e) => setBrand(e.target.value)}>
            <option value="">Все</option>
            {brands.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
        {categories.length > 0 && (
          <label>Категория
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Все</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        )}
        {kind !== 'plastics' && (
          <label className="kb-check">
            <input type="checkbox" checked={onlyTexture} onChange={(e) => setOnlyTexture(e.target.checked)} /> только с текстурой «!»
          </label>
        )}
        <label className="kb-check">
          <input type="checkbox" checked={hideRetired} onChange={(e) => setHideRetired(e.target.checked)} /> скрыть снятые/выведенные
        </label>
        <div className="dashboard-filter-count muted small">Показано: {filtered.length} из {rows.length}</div>
      </div>

      {kind === 'films' && legend && (
        <div className="card kb-section">
          <b>Обозначения разбивки</b>
          <ul className="kb-legend">
            {Object.values(legend).map((v) => <li key={v}>{v}</li>)}
          </ul>
        </div>
      )}

      <table className="table">
        <thead>
          <tr>
            <th>{kind === 'films' ? 'Код' : 'Артикул'}</th>
            <th>Название</th>
            <th>Бренд</th>
            <th>Категория</th>
            {kind === 'ldspColors' && <th>Формат</th>}
            {kind === 'ldspColors' && <th>Кромка</th>}
            {kind !== 'ldspColors' && <th>Статус</th>}
          </tr>
        </thead>
        <tbody>
          {filtered.slice(0, 500).map((r, i) => (
            <tr key={`${r.code ?? r.article ?? r.name}-${i}`}>
              <td>{String(r.code ?? r.article ?? '—')}</td>
              <td>
                {r.texture ? <span className="kb-bang" title="Текстура: обязательно указывать «!» в бланке">!</span> : null}
                {String(r.name ?? '')}
              </td>
              <td>{String(r.brand ?? '')}</td>
              <td>{String(r.category ?? '')}</td>
              {kind === 'ldspColors' && <td className="small">{String(r.format ?? '')}</td>}
              {kind === 'ldspColors' && <td className="small">{r.edgingArticle ? `0,4мм ${r.edgingArticle} GP` : '—'}</td>}
              {kind !== 'ldspColors' && (
                <td className="small">
                  {String(r.status ?? '')}
                  {r.onlyMillingMilo ? ' · только «Мыло»' : ''}
                  {r.onlyMdf16 ? ' · только МДФ 16' : ''}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {filtered.length > 500 && <p className="muted small">Показаны первые 500 — уточните поиск или фильтры.</p>}
      {filtered.length === 0 && <div className="empty small">Ничего не найдено. Снимите фильтры или измените запрос.</div>}
      </>}
    </>
  );
}

// ---------------------------------------------------------------- Фрезеровки

function MillingsTab(props: { dicts: FactoryDicts | null; pricebooks: Pricebook[] }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<number | null>(null);
  const [coating, setCoating] = useState<string | null>(null);
  const [open, setOpen] = useState<Milling | null>(null);

  const pricebook = props.pricebooks[0];
  const items = useMemo(() => millingsOf(props.dicts), [props.dicts]);
  const found = useMemo(
    () => searchMillings(items, query, { category, coating }),
    [items, query, category, coating],
  );
  const byCategory = useMemo(() => {
    const map = new Map<number, number>();
    for (const m of items) map.set(m.category, (map.get(m.category) ?? 0) + 1);
    return map;
  }, [items]);

  if (!props.dicts) return <div className="empty">Каталог фрезеровок загружается…</div>;
  if (!items.length) return <div className="empty">Каталог фрезеровок не найден в справочниках.</div>;

  const group = props.dicts.groups.millings;

  return (
    <>
      <div className="kb-subtabs">
        <button className={`chip${category === null ? ' active' : ''}`} onClick={() => setCategory(null)}>
          Все категории <b>{items.length}</b>
        </button>
        {MILLING_CATEGORIES.filter((c) => byCategory.get(c)).map((c) => (
          <button key={c} className={`chip${category === c ? ' active' : ''}`} onClick={() => setCategory(c)}>
            {c} категория <b>{byCategory.get(c)}</b>
          </button>
        ))}
      </div>

      <div className="card blank-controls">
        <label className="dashboard-search">Поиск фрезеровки
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Например: пирамида, R3, классика, 19 мм…" />
        </label>
        <label>Покрытие
          <select value={coating ?? ''} onChange={(e) => setCoating(e.target.value || null)}>
            <option value="">Любое</option>
            <option value="ПВХ">ПВХ</option>
            <option value="эмаль">эмаль</option>
          </select>
        </label>
        {(query || category || coating) && (
          <button className="btn tiny ghost" onClick={() => { setQuery(''); setCategory(null); setCoating(null); }}>Сбросить</button>
        )}
        <div className="dashboard-filter-count muted small">
          Найдено: {found.length} из {items.length}
          {pricebook ? ` · цены из «${pricebook.meta.name}»` : ' · прайс не загружен, цены не показываем'}
        </div>
      </div>

      <div className="milling-grid">
        {found.map((m) => {
          const from = millingPriceFrom(m, pricebook);
          return (
            <button key={m.slug} className="milling-card" onClick={() => setOpen(m)} title="Показать размеры и цены">
              <img
                className="milling-thumb"
                src={`${import.meta.env.BASE_URL}${m.image}`}
                alt={`Фрезеровка ${m.name}`}
                loading="lazy"
                width={440}
              />
              <div className="milling-card-body">
                <b>{m.name}</b>
                <div className="muted small">
                  {m.categoryLabel} · {m.mdfThicknessMm} мм · {m.coatings.join(', ')}
                </div>
                {from && <div className="milling-price">от {fmtMoney(from.price)} / м² <span className="muted">({from.coating}, {from.variant})</span></div>}
                {m.note && <div className="milling-note small">⚠️ {m.note}</div>}
              </div>
            </button>
          );
        })}
      </div>
      {found.length === 0 && <div className="empty small">Ничего не найдено — измените запрос или снимите фильтры.</div>}

      {group.issues && group.issues.length > 0 && (
        <div className="card kb-section">
          <b>Замечания к самому каталогу</b>
          <ul className="kb-legend">
            {group.issues.map((i) => <li key={i.text}>{i.text}</li>)}
          </ul>
        </div>
      )}

      {open && <MillingDialog milling={open} pricebook={pricebook} onClose={() => setOpen(null)} />}
    </>
  );
}

const SIZE_LABELS: { key: 'blind' | 'rk' | 'rbk' | 'drawer'; label: string }[] = [
  { key: 'blind', label: 'Глухой' },
  { key: 'rk', label: 'Рамка с крестом (РК)' },
  { key: 'rbk', label: 'Рамка без креста (РБК)' },
  { key: 'drawer', label: 'Ящик' },
];

function MillingDialog(props: { milling: Milling; pricebook: Pricebook | undefined; onClose: () => void }) {
  const m = props.milling;
  const prices = millingPrices(m, props.pricebook);
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div className="modal milling-modal" role="dialog" aria-modal="true" aria-label={`Фрезеровка ${m.name}`}>
        <header className="milling-modal-head">
          <h2>{m.name}</h2>
          <button className="btn tiny ghost" onClick={props.onClose}>Закрыть</button>
        </header>

        <div className="milling-modal-body">
          <img src={`${import.meta.env.BASE_URL}${m.image}`} alt={`Фрезеровка ${m.name}`} className="milling-big" />

          <div>
            <table className="table">
              <tbody>
                <tr><th>Категория</th><td>{m.categoryLabel}</td></tr>
                <tr><th>Возможность изготовления</th><td>{m.coatings.join(', ')}</td></tr>
                <tr><th>Вид фаски</th><td>{m.faska ?? '—'}</td></tr>
                <tr><th>Ширина рамки</th><td>{m.frameWidthMm ? `${m.frameWidthMm} мм` : '—'}</td></tr>
                <tr><th>Толщина МДФ</th><td>{m.mdfThicknessMm} мм</td></tr>
                {m.stepMm && <tr><th>Шаг рисунка</th><td>{m.stepMm} мм</td></tr>}
                {SIZE_LABELS.map((s) => (
                  <tr key={s.key}>
                    <th>{s.label}</th>
                    <td>{m.sizes[s.key] ?? <span className="muted">не изготавливается</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {m.note && <p className="milling-note">⚠️ {m.note}</p>}
            <p className="muted small">
              Источник: «{m.source.file}», стр. {m.source.pdfPage} файла
              {m.source.printedPage !== m.source.pdfPage - 1 && ` (в подвале напечатано ${m.source.printedPage})`}
            </p>
          </div>
        </div>

        <h3>Цена квадратного метра фасада по прайсу</h3>
        {prices.length === 0 ? (
          <p className="muted small">Прайс не загружен или в нём нет строки для этой категории — цену не подставляем.</p>
        ) : (
          <table className="table">
            <thead><tr><th>Покрытие</th><th>Исполнение</th><th>Ед.</th><th className="num">Цена</th><th>Строка прайса</th></tr></thead>
            <tbody>
              {prices.map((p) => (
                <tr key={`${p.coating}-${p.variant}`}>
                  <td>{p.coating}</td>
                  <td>{p.variant}</td>
                  <td className="small">{p.unit}</td>
                  <td className="num">{fmtMoney(p.price)}</td>
                  <td className="small muted">{p.item.source.sheet}, стр. {p.item.source.row}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Фурнитура

function HardwareTab(props: { pricebooks: Pricebook[] }) {
  const [query, setQuery] = useState('');
  const [groupId, setGroupId] = useState<string | null>(null);
  const pricebook = props.pricebooks[0];

  const entries = useMemo(() => hardwareEntries(pricebook), [pricebook]);
  const counts = useMemo(() => hardwareCounts(entries), [entries]);
  const found = useMemo(() => searchHardware(entries, query, groupId), [entries, query, groupId]);

  if (!pricebook) return <div className="empty">Прайс не загружен — справочник фурнитуры собирается из него.</div>;

  return (
    <>
      <div className="kb-subtabs">
        <button className={`chip${groupId === null ? ' active' : ''}`} onClick={() => setGroupId(null)}>
          Все <b>{entries.length}</b>
        </button>
        {HARDWARE_GROUPS.filter((g) => counts[g.id]).map((g) => (
          <button key={g.id} className={`chip${groupId === g.id ? ' active' : ''}`} onClick={() => setGroupId(g.id)}>
            {g.icon} {g.label} <b>{counts[g.id]}</b>
          </button>
        ))}
      </div>

      <div className="card blank-controls">
        <label className="dashboard-search">Поиск по фурнитуре
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Например: петля 110, ручка скоба, опора H100…" />
        </label>
        {(query || groupId) && <button className="btn tiny ghost" onClick={() => { setQuery(''); setGroupId(null); }}>Сбросить</button>}
        <div className="dashboard-filter-count muted small">
          Найдено: {found.length} · прайс «{pricebook.meta.name}»
        </div>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Группа</th><th>Наименование</th><th>Артикул</th><th>Ед.</th><th className="num">Цена</th>
          </tr>
        </thead>
        <tbody>
          {found.slice(0, 400).map((e) => (
            <tr key={e.item.id}>
              <td className="small">{e.group.icon} {e.group.label}</td>
              <td>{e.item.name}</td>
              <td className="small">{e.item.article ?? '—'}</td>
              <td className="small">{e.item.unit ?? '—'}</td>
              <td className="num">{e.item.price == null ? (e.item.priceRaw ?? '—') : fmtMoney(e.item.price)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {found.length > 400 && <p className="muted small">Показаны первые 400 — уточните запрос.</p>}
      {found.length === 0 && <div className="empty small">Ничего не найдено. Попробуйте другое слово — поиск прощает опечатки.</div>}
    </>
  );
}
