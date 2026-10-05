import { useEffect, useMemo, useState } from 'react';
import type { KbArticle, KbCategory, Pricebook, PriceItem } from '../types';
import { createKbArticle, filterKbArticles, KB_CATEGORIES, kbCategoryLabel, removeKbArticle, seedKbArticles, upsertKbArticle } from '../lib/knowledge';
import { loadKnowledgeDocs, normalize, searchDocs, tokenize, tokenMatches, type DocHit, type KnowledgeDocs } from '../lib/knowledgeDocs';
import { loadFactoryDicts, millingsOf, type FactoryDicts } from '../lib/factoryDicts';
import { millingPriceFrom, millingPrices, searchMillings, MILLING_CATEGORIES, type Milling } from '../lib/millings';
import { hardwareCounts, hardwareEntries, HARDWARE_GROUPS, searchHardware } from '../lib/hardware';
import { fmtMoney } from '../lib/format';

/**
 * База знаний РЕцепта: рабочий центр знаний.
 *  🏠 Обзор — состояние базы, быстрые переходы и критичные правила.
 *  🔎 Всё сразу — единый поиск по статьям, PDF-документам, разбивкам, фрезеровкам, фурнитуре и прайсу.
 *  📄 Документы — свои статьи + полные тексты инструкций и техничек фабрики.
 *  🎨 Разбивки  — ЛДСП, толщины, кромки, плёнки ПВХ, пластики, компакт Slotex, с фильтрами.
 *  🪚 Фрезеровки — каталог 2026 с картинками, размерами и ценой м² из прайса.
 *  🔩 Фурнитура — справочник из актуального прайса по группам.
 *  💰 Прайс — быстрый каталог всех позиций Висма с фильтрами.
 *  ⚡ Шпаргалки — короткие рабочие инструкции без поиска по PDF.
 */

type Tab = 'overview' | 'search' | 'docs' | 'colors' | 'millings' | 'hardware' | 'pricebook' | 'cheatsheets';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: '🏠 Обзор' },
  { id: 'search', label: '🔎 Всё сразу' },
  { id: 'docs', label: '📄 Документы' },
  { id: 'colors', label: '🎨 Разбивки' },
  { id: 'millings', label: '🪚 Фрезеровки' },
  { id: 'hardware', label: '🔩 Фурнитура' },
  { id: 'pricebook', label: '💰 Прайс' },
  { id: 'cheatsheets', label: '⚡ Шпаргалки' },
];

const QUICK_SEARCHES = ['бланк кухни', 'столешница', 'эмаль 1 м2', 'петля 110', 'фрезеровка мыло', 'кромка ЛДСП', 'GOLA', 'Эскиз PRO'];

const CRITICAL_RULES = [
  { title: 'Корпус в бланке', text: 'Размеры корпуса указываются по каркасу, без фасадов и накладных деталей. Цвет ЛДСП берём из разбивки.' },
  { title: 'Эмаль меньше 1 м²', text: 'Если площадь фасадов эмали меньше 1 м² — включается правило прайса +30%.' },
  { title: 'Фрезеровка 2026', text: 'Категория фрезеровки определяет цену м²: ПВХ и эмаль ищутся разными строками прайса.' },
  { title: 'Маркер Эскиз PRO', text: 'Модуль на скрине — это точка/сноска. Нажмите её в snapshot и выберите корпус/фурнитуру из прайса.' },
  { title: 'Текстура «!»', text: 'Для позиций разбивки с восклицательным знаком текстуру обязательно переносим в бланк.' },
];

const CHEATSHEETS = [
  {
    group: 'Оформление заказа',
    title: 'Кухня: что проверить перед отправкой бланка',
    tags: ['бланк', 'заказ', 'висма'],
    steps: ['Шапка проекта: клиент, дата, салон, комментарий.', 'Корпус: цвет ЛДСП, размеры, кромка, цоколь/опоры.', 'Фасады: материал, фрезеровка, размеры, открывание, ручки/GOLA.', 'Столешница и стеновая панель: длины, кромки, еврозапилы, вырезы.', 'Фурнитура: петли, системы ящиков, подъёмники, сушки, карго, подсветка.'],
  },
  {
    group: 'Расчёт',
    title: 'Как модуль превращается в строки расчёта',
    tags: ['модули', 'просчет', 'прайс'],
    steps: ['Выбранный корпус идёт одной строкой на количество модулей.', 'Фасады считаются по площади: размер фасада × количество.', 'Петли, ручки, опоры, подъёмники и ящики считаются по штукам.', 'Процентные надбавки применяются только к корпусу, если выбрана база.', 'Предупреждения не блокируют работу, ошибки — блокируют корректный расчёт модуля.'],
  },
  {
    group: 'Эскиз PRO',
    title: 'Скрин → маркеры → модули → КП',
    tags: ['эскиз', 'модули', 'КП'],
    steps: ['В Эскиз PRO загрузите скрин проекта и вручную нанесите размеры.', 'Поставьте объект «Модуль» как точку/сноску на нужном месте.', 'В Calculator привяжите snapshot и нажмите маркер на preview.', 'Выберите корпус и комплектующие из прайса.', 'Модуль попадёт в просчёт, проверку, КП и бланк.'],
  },
  {
    group: 'Фасады',
    title: 'Фасады, фрезеровки и эмаль',
    tags: ['фасады', 'эмаль', 'фрезеровка'],
    steps: ['Уточните материал фасада: ПВХ, эмаль, пластик, стекло/рамка.', 'Проверьте категорию фрезеровки по каталогу 2026.', 'Для эмали контролируйте правило заказа меньше 1 м².', 'Для рамочных/витринных фасадов проверьте рамку и стекло.', 'Если есть боковины/накладки — добавьте их как отдельные фасадные детали.'],
  },
  {
    group: 'Замер',
    title: 'Минимальный чек-лист замера',
    tags: ['замер', 'размеры', 'коммуникации'],
    steps: ['Длины стен, высота помещения, диагонали/углы.', 'Окна, двери, подоконники: отступ, ширина, высота.', 'Вода, канализация, газ, вентиляция, электрика: отступ и высота.', 'Фото помещения и проблемных мест.', 'Отдельно зафиксировать ограничения доставки и монтажа.'],
  },
];

function priceText(item: PriceItem) {
  if (item.price != null) return fmtMoney(item.price);
  return item.priceRaw || '—';
}

function itemSearchText(item: PriceItem) {
  return `${item.name} ${item.article ?? ''} ${item.category} ${item.subcategory ?? ''} ${item.unit ?? ''} ${item.priceRaw ?? ''} ${Object.values(item.attrs).join(' ')}`;
}

function matchesQuery(text: string, query: string) {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return true;
  const hay = normalize(text);
  const tokens = hay.split(' ').filter(Boolean);
  return qTokens.every((q) => hay.includes(q) || tokens.some((t) => tokenMatches(q, t)));
}

function scoreText(text: string, query: string, boost = 1) {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return 0;
  const hay = normalize(text);
  const tokens = hay.split(' ').filter(Boolean);
  let score = 0;
  let matched = 0;
  for (const q of qTokens) {
    if (hay.includes(q)) { score += 6; matched += 1; }
    else if (tokens.some((t) => tokenMatches(q, t))) { score += 2; matched += 1; }
  }
  return matched === qTokens.length ? score * boost : 0;
}

export default function KnowledgeView(props: {
  articles: KbArticle[];
  pricebooks: Pricebook[];
  onChange: (articles: KbArticle[]) => void;
}) {
  const [tab, setTab] = useState<Tab>('overview');
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [docs, setDocs] = useState<KnowledgeDocs | null>(null);
  const [dicts, setDicts] = useState<FactoryDicts | null>(null);

  useEffect(() => {
    loadKnowledgeDocs(import.meta.env.BASE_URL).then(setDocs);
    loadFactoryDicts(import.meta.env.BASE_URL).then(setDicts);
  }, []);

  const openGlobalSearch = (query = '') => {
    setGlobalSearchQuery(query);
    setTab('search');
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>База знаний PRO</h1>
          <div className="muted">Единый центр: документы, инструкции, прайс, разбивки, фрезеровки, фурнитура и рабочие шпаргалки.</div>
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
      <div className="kb-mobile-switcher no-print">
        <label>Раздел базы знаний
          <select value={tab} onChange={(event) => setTab(event.target.value as Tab)}>
            {TABS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
      </div>

      {tab === 'overview' && <OverviewTab articles={props.articles} docs={docs} dicts={dicts} pricebooks={props.pricebooks} onOpenTab={setTab} onQuickSearch={openGlobalSearch} onSeed={() => props.onChange(seedKbArticles())} />}
      {tab === 'search' && <AllSearchTab key={globalSearchQuery} articles={props.articles} docs={docs} dicts={dicts} pricebooks={props.pricebooks} initialQuery={globalSearchQuery} onOpenTab={setTab} />}
      {tab === 'docs' && <DocsTab articles={props.articles} onChange={props.onChange} docs={docs} />}
      {tab === 'colors' && <ColorsTab dicts={dicts} />}
      {tab === 'millings' && <MillingsTab dicts={dicts} pricebooks={props.pricebooks} />}
      {tab === 'hardware' && <HardwareTab pricebooks={props.pricebooks} />}
      {tab === 'pricebook' && <PricebookTab pricebooks={props.pricebooks} />}
      {tab === 'cheatsheets' && <CheatsheetsTab />}
    </div>
  );
}

// ---------------------------------------------------------------- Обзор и единый поиск

function OverviewTab(props: {
  articles: KbArticle[];
  docs: KnowledgeDocs | null;
  dicts: FactoryDicts | null;
  pricebooks: Pricebook[];
  onOpenTab: (tab: Tab) => void;
  onQuickSearch: (query?: string) => void;
  onSeed: () => void;
}) {
  const pricebook = props.pricebooks[0];
  const docsCount = props.docs?.docs.length ?? 0;
  const sectionsCount = props.docs?.docs.reduce((sum, doc) => sum + doc.sections.length, 0) ?? 0;
  const colorsCount = props.dicts ? COLOR_GROUP_ORDER.reduce((sum, key) => sum + colorGroup(props.dicts!, key).items.length, 0) : 0;
  const millingsCount = millingsOf(props.dicts).length;
  const hardwareCount = hardwareEntries(pricebook).length;
  const priceCount = pricebook?.items.length ?? 0;
  return (
    <>
      <section className="kb-hero card">
        <div>
          <span className="eyebrow">MAX база знаний</span>
          <h2>Ищем не по памяти, а по единому источнику: PDF, прайс, справочники и свои статьи</h2>
          <p>Начинайте с «Всё сразу», если не знаете, где лежит ответ. Для точной работы используйте отдельные разделы: прайс, фрезеровки, разбивки, фурнитуру и документы.</p>
        </div>
        <div className="kb-hero-actions">
          <button className="btn primary" onClick={() => props.onQuickSearch()}>🔎 Искать везде</button>
          <button className="btn ghost" onClick={() => props.onOpenTab('cheatsheets')}>⚡ Шпаргалки</button>
          {props.articles.length === 0 && <button className="btn ghost" onClick={props.onSeed}>Загрузить стартовые статьи</button>}
        </div>
      </section>

      <section className="kb-metrics">
        <button onClick={() => props.onOpenTab('docs')}><b>{docsCount}</b><span>PDF-документов</span><em>{sectionsCount} разделов</em></button>
        <button onClick={() => props.onOpenTab('docs')}><b>{props.articles.length}</b><span>своих статей</span><em>редактируются вручную</em></button>
        <button onClick={() => props.onOpenTab('colors')}><b>{colorsCount}</b><span>разбивок материалов</span><em>ЛДСП, ПВХ, HPL, компакт, кромки</em></button>
        <button onClick={() => props.onOpenTab('millings')}><b>{millingsCount}</b><span>фрезеровок</span><em>каталог 2026</em></button>
        <button onClick={() => props.onOpenTab('hardware')}><b>{hardwareCount}</b><span>позиций фурнитуры</span><em>из прайса</em></button>
        <button onClick={() => props.onOpenTab('pricebook')}><b>{priceCount}</b><span>строк прайса</span><em>{pricebook?.meta.name ?? 'прайс не загружен'}</em></button>
      </section>

      <section className="card kb-section">
        <h3>Быстрый поиск</h3>
        <div className="kb-quick-searches">
          {QUICK_SEARCHES.map((q) => <button key={q} className="chip" onClick={() => props.onQuickSearch(q)}>{q}</button>)}
        </div>
      </section>

      <section className="kb-overview-grid">
        <div className="card kb-section">
          <h3>Критичные правила</h3>
          <div className="kb-rule-list">
            {CRITICAL_RULES.map((rule) => <div key={rule.title}><b>{rule.title}</b><span>{rule.text}</span></div>)}
          </div>
        </div>
        <div className="card kb-section">
          <h3>Куда идти за ответом</h3>
          <div className="kb-route-list">
            <button onClick={() => props.onOpenTab('docs')}><b>Инструкции / техничка</b><span>формулировки из PDF, страницы и разделы</span></button>
            <button onClick={() => props.onOpenTab('pricebook')}><b>Цена / артикул</b><span>любая строка прайса, категория, единица, источник</span></button>
            <button onClick={() => props.onOpenTab('colors')}><b>Цвет / разбивка</b><span>ЛДСП, толщины, кромки, плёнки, пластики, компакт Slotex, текстуры «!»</span></button>
            <button onClick={() => props.onOpenTab('millings')}><b>Фрезеровка</b><span>картинка, категория, размеры, цена м²</span></button>
            <button onClick={() => props.onOpenTab('hardware')}><b>Фурнитура</b><span>петли, ручки, ящики, подъёмники, GOLA</span></button>
          </div>
        </div>
      </section>
    </>
  );
}

interface GlobalHit {
  id: string;
  kind: string;
  title: string;
  meta: string;
  text: string;
  score: number;
  tab: Tab;
}

function AllSearchTab(props: { articles: KbArticle[]; docs: KnowledgeDocs | null; dicts: FactoryDicts | null; pricebooks: Pricebook[]; initialQuery: string; onOpenTab: (tab: Tab) => void }) {
  const [query, setQuery] = useState(props.initialQuery);
  const [kind, setKind] = useState<string>('all');
  const pricebook = props.pricebooks[0];
  const millings = useMemo(() => millingsOf(props.dicts), [props.dicts]);
  const hardware = useMemo(() => hardwareEntries(pricebook), [pricebook]);
  const colorRows = useMemo(() => {
    if (!props.dicts) return [] as { group: string; row: Record<string, unknown> }[];
    return COLOR_GROUP_ORDER.flatMap((key) => {
      const group = colorGroup(props.dicts!, key);
      return group.items.map((row) => ({ group: group.label, row: row as unknown as Record<string, unknown> }));
    });
  }, [props.dicts]);

  const hits = useMemo(() => {
    const q = query.trim();
    if (q.length < 2) return [] as GlobalHit[];
    const out: GlobalHit[] = [];
    for (const article of props.articles) {
      const score = scoreText(`${article.title} ${article.tags.join(' ')} ${article.body}`, q, 1.4);
      if (score) out.push({ id: article.id, kind: 'Статья', title: article.title, meta: kbCategoryLabel(article.category), text: article.body.slice(0, 220), score, tab: 'docs' });
    }
    if (props.docs) {
      for (const h of searchDocs(props.docs.docs, q, 18)) {
        out.push({ id: h.section.id, kind: 'PDF', title: h.section.heading, meta: `${h.doc.title} · стр. ${h.section.page}`, text: h.snippet, score: h.score, tab: 'docs' });
      }
    }
    for (const m of searchMillings(millings, q).slice(0, 12)) {
      out.push({ id: m.slug, kind: 'Фрезеровка', title: m.name, meta: `${m.categoryLabel} · ${m.coatings.join(', ')}`, text: [m.faska, m.note, `МДФ ${m.mdfThicknessMm} мм`].filter(Boolean).join(' · '), score: scoreText(`${m.name} ${m.categoryLabel} ${m.coatings.join(' ')} ${m.note ?? ''}`, q, 1.1) || 4, tab: 'millings' });
    }
    for (const entry of searchHardware(hardware, q, null, 18)) {
      out.push({ id: entry.item.id, kind: 'Фурнитура', title: entry.item.name, meta: `${entry.group.label} · ${entry.item.article ?? 'без артикула'} · ${priceText(entry.item)}`, text: `${entry.item.category}${entry.item.subcategory ? ` · ${entry.item.subcategory}` : ''}`, score: scoreText(itemSearchText(entry.item), q, 1.05) || 3, tab: 'hardware' });
    }
    for (const { group, row } of colorRows) {
      const text = JSON.stringify(row);
      const score = scoreText(text, q, 1);
      if (score) out.push({ id: `${group}-${row.code ?? row.article ?? row.name}`, kind: 'Разбивка', title: String(row.name ?? row.code ?? row.article ?? 'Цвет'), meta: `${group} · ${row.brand ?? 'бренд не указан'}`, text: `${row.category ?? ''}${row.collection ? ` · ${row.collection}` : ''}${row.texture ? ' · текстура «!»' : ''}${row.status ? ` · ${row.status}` : ''}`, score, tab: 'colors' });
    }
    for (const item of (pricebook?.items ?? [])) {
      const score = scoreText(itemSearchText(item), q, .9);
      if (score) out.push({ id: item.id, kind: 'Прайс', title: item.name, meta: `${item.category} · ${item.article ?? 'без артикула'} · ${priceText(item)}`, text: `${item.subcategory ?? ''}${item.unit ? ` · ${item.unit}` : ''}${item.source ? ` · ${item.source.sheet} строка ${item.source.row}` : ''}`, score, tab: 'pricebook' });
    }
    return out
      .filter((hit) => kind === 'all' || hit.kind === kind)
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'ru'))
      .slice(0, 80);
  }, [query, kind, props.articles, props.docs, millings, hardware, colorRows, pricebook]);

  const counts = hits.reduce<Record<string, number>>((acc, hit) => ({ ...acc, [hit.kind]: (acc[hit.kind] ?? 0) + 1 }), {});

  return (
    <>
      <div className="card kb-command">
        <label className="dashboard-search">Искать во всей базе знаний
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Например: петля 110, эмаль меньше 1 м2, цвет дуб, столешница 4100…" />
        </label>
        <div className="kb-quick-searches">
          {QUICK_SEARCHES.map((q) => <button key={q} className="chip" onClick={() => setQuery(q)}>{q}</button>)}
        </div>
      </div>
      <div className="kb-subtabs">
        {['all', 'PDF', 'Статья', 'Прайс', 'Разбивка', 'Фрезеровка', 'Фурнитура'].map((item) => (
          <button key={item} className={`chip${kind === item ? ' active' : ''}`} onClick={() => setKind(item)}>
            {item === 'all' ? 'Все' : item} <b>{item === 'all' ? hits.length : counts[item] ?? 0}</b>
          </button>
        ))}
      </div>
      {query.trim().length < 2 ? (
        <div className="empty">Введите минимум 2 символа — поиск пройдёт по документам, статьям, прайсу, разбивкам, фрезеровкам и фурнитуре.</div>
      ) : hits.length === 0 ? (
        <div className="empty">Ничего не найдено. Попробуйте другое слово или более короткий запрос.</div>
      ) : (
        <div className="kb-global-results">
          {hits.map((hit) => (
            <article className="card kb-global-hit" key={`${hit.kind}-${hit.id}`}>
              <div className="kb-hit-head"><span className="kb-chip">{hit.kind}</span><b>{hit.title}</b></div>
              <div className="muted small">{hit.meta}</div>
              <p>{hit.text}</p>
              <button className="btn tiny ghost" onClick={() => props.onOpenTab(hit.tab)}>Открыть раздел</button>
            </article>
          ))}
        </div>
      )}
    </>
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

// ------------------------------------------------------------ Разбивки цветов

type ColorKind = 'ldspColors' | 'ldspThickness' | 'ldspEdges' | 'rehauEdges' | 'films' | 'plastics' | 'compactHpl';

const COLOR_GROUP_ORDER: ColorKind[] = ['ldspColors', 'ldspThickness', 'ldspEdges', 'rehauEdges', 'films', 'plastics', 'compactHpl'];

type DictRow = Record<string, unknown>;

function rehauEdgeRows(dicts: FactoryDicts): DictRow[] {
  const fromLdsp = dicts.groups.ldspColors.items
    .filter((item) => /рехау|rehau/i.test(item.edgingArticle ?? ''))
    .map((item) => ({
      article: item.article,
      name: item.name,
      brand: 'Rehau',
      category: item.category,
      edge: item.edgingArticle,
      details: `ЛДСП ${item.brand}, формат ${item.format}; кромка из разбивки: ${item.edgingArticle}`,
      sources: item.sources,
    }));
  return [
    {
      article: 'Rehau 1,3мм',
      name: 'Кромка Rehau 1,3мм для пластиков/HPL',
      brand: 'Rehau',
      category: 'пластики/HPL · AGT/ARPA/FENIX/Rexay',
      edge: 'Rehau 1,3мм',
      details: 'Источник: !разбивка 2026 ARPA, FENIX, AGT, Rexay.xlsx · колонка «Кромка Rehau 1,3мм»',
      sources: [{ file: '!разбивка 2026 ARPA, FENIX, AGT, Rexay.xlsx', sheet: 'AGT', row: 2 }],
    },
    ...fromLdsp,
  ];
}

function colorGroup(dicts: FactoryDicts, kind: ColorKind): { label: string; legend?: Record<string, string>; items: DictRow[] } {
  if (kind === 'rehauEdges') {
    return {
      label: 'Кромки Rehau',
      legend: { 'Rehau 1,3мм': 'есть отдельной колонкой в разбивке пластиков/HPL', 'ЛДСП': 'отдельные цвета Увадрев имеют кромку Рехау в разбивке' },
      items: rehauEdgeRows(dicts),
    };
  }
  const group = (dicts.groups as unknown as Record<string, { label: string; legend?: Record<string, string>; items: DictRow[] } | undefined>)[kind];
  return group ?? { label: kind, items: [] };
}

function val(row: DictRow, key: string) {
  const value = row[key];
  if (value == null || value === '') return '';
  return String(value);
}

function objEntries(row: DictRow, key: string) {
  const value = row[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [] as [string, string][];
  return Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => [k, String(v)] as [string, string]);
}

function sourceText(row: DictRow) {
  const sources = Array.isArray(row.sources) ? row.sources as Array<Record<string, unknown>> : [];
  if (!sources.length) return '';
  return sources
    .slice(0, 3)
    .map((s) => `${s.file ?? 'источник'}${s.sheet ? ` · ${s.sheet}` : ''}${s.row ? `:${s.row}` : ''}${s.pdfPage ? ` · стр. PDF ${s.pdfPage}` : ''}`)
    .join(' / ') + (sources.length > 3 ? ` / ещё ${sources.length - 3}` : '');
}

function rowPrimary(row: DictRow, kind: ColorKind) {
  if (kind === 'films') return val(row, 'code') || '—';
  if (kind === 'compactHpl') return val(row, 'code') || '—';
  if (kind === 'rehauEdges') return val(row, 'article') || val(row, 'edge') || 'Rehau';
  return val(row, 'article') || val(row, 'code') || '—';
}

function rowCategory(row: DictRow) {
  return [val(row, 'category'), val(row, 'status'), val(row, 'collection')].filter(Boolean).join(' · ');
}

function DetailPill(props: { label: string; value: string }) {
  return <span className="kb-detail-pill"><b>{props.label}:</b> {props.value}</span>;
}

function DetailMap(props: { title: string; entries: [string, string][] }) {
  if (!props.entries.length) return null;
  return (
    <div className="kb-detail-map">
      <b>{props.title}</b>
      <div>{props.entries.map(([k, v]) => <span key={`${props.title}-${k}`}>{k}: {v}</span>)}</div>
    </div>
  );
}

function RowDetails(props: { row: DictRow; kind: ColorKind }) {
  const { row, kind } = props;
  const pills: Array<{ label: string; value: string }> = [];
  const push = (label: string, key: string) => {
    const value = val(row, key);
    if (value) pills.push({ label, value });
  };
  push('Формат', 'format');
  push('Серия', 'series');
  push('Коллекция', 'collection');
  push('Тиснение', 'textureCode');
  push('Поверхность', 'surfaceType');
  push('Кромка GP', 'edgingArticle');
  push('Кромка произв. 0,4', 'manufacturerEdge04');
  push('Кромка произв. 1/2', 'manufacturerEdge1or2');
  push('Кромка', 'edge');
  push('Доплата', 'sheetSurcharge');
  push('Перерасход', 'overuseRule');
  push('Детали', 'details');
  if (row.onlyMillingMilo) pills.push({ label: 'Правило', value: 'только фрезеровка «Мыло»' });
  if (row.onlyMdf16) pills.push({ label: 'Правило', value: 'только МДФ 16 мм' });
  if (row.texture && kind !== 'ldspThickness') pills.push({ label: 'Текстура', value: 'нужен знак «!» в бланке' });
  const source = sourceText(row);
  return (
    <div className="kb-row-details">
      {pills.map((pill) => <DetailPill key={`${pill.label}-${pill.value}`} label={pill.label} value={pill.value} />)}
      <DetailMap title="Толщины" entries={objEntries(row, 'thicknesses')} />
      <DetailMap title="Наличие кромок" entries={objEntries(row, 'edgeAvailability')} />
      <DetailMap title="Кратность/наличие" entries={objEntries(row, 'availability')} />
      {source && <small className="muted">Источник: {source}</small>}
    </div>
  );
}

function ColorsTab(props: { dicts: FactoryDicts | null }) {
  const [kind, setKind] = useState<ColorKind>('ldspColors');
  const [query, setQuery] = useState('');
  const [brand, setBrand] = useState('');
  const [category, setCategory] = useState('');
  const [onlyTexture, setOnlyTexture] = useState(false);
  const [hideRetired, setHideRetired] = useState(true);

  const d = props.dicts;
  const availableKinds = useMemo(() => {
    if (!d) return [] as ColorKind[];
    return COLOR_GROUP_ORDER.filter((k) => colorGroup(d, k).items.length > 0);
  }, [d]);
  const rows = useMemo(() => {
    if (!d) return [] as DictRow[];
    return colorGroup(d, kind).items;
  }, [d, kind]);

  const brands = useMemo(() => [...new Set(rows.map((r) => val(r, 'brand')).filter(Boolean))].sort(), [rows]);
  const categories = useMemo(() => [...new Set(rows.map(rowCategory).filter(Boolean))].sort(), [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/ё/g, 'е').replace(/rehau/g, 'рехау');
    return rows.filter((r) => {
      if (brand && val(r, 'brand') !== brand) return false;
      if (category && rowCategory(r) !== category) return false;
      if (onlyTexture && !r.texture && !val(r, 'textureCode')) return false;
      const status = val(r, 'status');
      if (hideRetired && (status === 'снята' || status === 'выведена')) return false;
      if (!q) return true;
      const rawHay = JSON.stringify(r).toLowerCase().replace(/ё/g, 'е');
      const hay = `${rawHay} ${rawHay.includes('рехау') ? 'rehau' : ''} ${rawHay.includes('rehau') ? 'рехау' : ''}`;
      return hay.includes(q);
    });
  }, [rows, query, brand, category, onlyTexture, hideRetired]);

  if (!d) return <div className="empty">Справочники разбивок загружаются…</div>;

  const group = colorGroup(d, kind);
  const legend = group.legend;
  const totalRows = availableKinds.reduce((sum, k) => sum + colorGroup(d, k).items.length, 0);

  return (
    <>
      <div className="kb-source-summary card">
        <div>
          <b>Полная база разбивок</b>
          <p className="muted small">Загружено {totalRows} строк из {d.sources?.length ?? 0} документов: ЛДСП, толщины, кромки, Rehau, ПВХ-плёнки, пластики ARPA/ABET/AGT/Rexay/FENIX и компакт Slotex.</p>
        </div>
        <span>{filtered.length} показано</span>
      </div>

      <div className="kb-subtabs">
        {availableKinds.map((k) => {
          const g = colorGroup(d, k);
          return (
            <button
              key={k}
              className={`chip${kind === k ? ' active' : ''}`}
              onClick={() => { setKind(k); setBrand(''); setCategory(''); setOnlyTexture(false); }}
            >
              {g.label} <b>{g.items.length}</b>
            </button>
          );
        })}
      </div>

      <div className="card blank-controls">
        <label className="dashboard-search">Поиск
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Название, артикул, код, кромка, толщина, источник…" />
        </label>
        <label>Бренд/поставщик
          <select value={brand} onChange={(e) => setBrand(e.target.value)}>
            <option value="">Все</option>
            {brands.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
        {categories.length > 0 && (
          <label>Категория / статус / коллекция
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Все</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        )}
        <label className="kb-check">
          <input type="checkbox" checked={onlyTexture} onChange={(e) => setOnlyTexture(e.target.checked)} /> только текстурные/с тиснением
        </label>
        <label className="kb-check">
          <input type="checkbox" checked={hideRetired} onChange={(e) => setHideRetired(e.target.checked)} /> скрыть снятые/выведенные
        </label>
        <div className="dashboard-filter-count muted small">Показано: {filtered.length} из {rows.length}</div>
      </div>

      {legend && Object.keys(legend).length > 0 && (
        <div className="card kb-section">
          <b>Обозначения разбивки</b>
          <ul className="kb-legend">
            {Object.entries(legend).map(([key, value]) => <li key={key}><b>{key}</b> — {value}</li>)}
          </ul>
        </div>
      )}

      <table className="table kb-breakdown-table">
        <thead>
          <tr>
            <th>Код / артикул</th>
            <th>Название</th>
            <th>Бренд</th>
            <th>Категория / статус</th>
            <th>Вся разбивка из источника</th>
          </tr>
        </thead>
        <tbody>
          {filtered.slice(0, 700).map((r, i) => (
            <tr key={`${rowPrimary(r, kind)}-${val(r, 'name')}-${i}`}>
              <td>{rowPrimary(r, kind)}</td>
              <td>
                {r.texture ? <span className="kb-bang" title="Текстура: обязательно указывать «!» в бланке">!</span> : null}
                {val(r, 'name') || '—'}
              </td>
              <td>{val(r, 'brand')}</td>
              <td>{rowCategory(r) || '—'}</td>
              <td><RowDetails row={r} kind={kind} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {filtered.length > 700 && <p className="muted small">Показаны первые 700 — уточните поиск или фильтры.</p>}
      {filtered.length === 0 && <div className="empty small">Ничего не найдено. Снимите фильтры или измените запрос.</div>}
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

// ---------------------------------------------------------------- Прайс

function PricebookTab(props: { pricebooks: Pricebook[] }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [subcategory, setSubcategory] = useState('');
  const [kind, setKind] = useState('');
  const [basis, setBasis] = useState('');
  const [onlyPriced, setOnlyPriced] = useState(false);
  const pricebook = props.pricebooks[0];

  const categories = useMemo(() => [...new Set((pricebook?.items ?? []).map((item) => item.category))].sort((a, b) => a.localeCompare(b, 'ru')), [pricebook]);
  const subcategories = useMemo(() => [...new Set((pricebook?.items ?? []).filter((item) => !category || item.category === category).map((item) => item.subcategory ?? '').filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru')), [pricebook, category]);
  const kinds = useMemo(() => [...new Set((pricebook?.items ?? []).map((item) => item.priceKind))].sort(), [pricebook]);
  const bases = useMemo(() => [...new Set((pricebook?.items ?? []).map((item) => item.priceBasis ?? '—'))].sort(), [pricebook]);

  const found = useMemo(() => {
    if (!pricebook) return [] as PriceItem[];
    return pricebook.items.filter((item) => {
      if (category && item.category !== category) return false;
      if (subcategory && item.subcategory !== subcategory) return false;
      if (kind && item.priceKind !== kind) return false;
      if (basis && (item.priceBasis ?? '—') !== basis) return false;
      if (onlyPriced && item.price == null) return false;
      return matchesQuery(itemSearchText(item), query);
    }).slice(0, 800);
  }, [pricebook, query, category, subcategory, kind, basis, onlyPriced]);

  if (!pricebook) return <div className="empty">Прайс пока не загружен.</div>;

  return (
    <>
      <div className="card kb-pricebook-head">
        <div><span className="eyebrow">Прайс</span><h3>{pricebook.meta.name}</h3><p className="muted small">{pricebook.meta.itemCount} позиций · источник: {pricebook.meta.sourceFile} · импорт: {new Date(pricebook.meta.importedAt).toLocaleDateString('ru-RU')}</p></div>
        <div className="kb-pricebook-stats">
          <div><b>{pricebook.meta.categories.length}</b><span>категорий</span></div>
          <div><b>{Object.values(pricebook.meta.stats.byCategory).reduce((sum, stat) => sum + stat.priced, 0)}</b><span>с ценой</span></div>
          <div><b>{pricebook.issues.length}</b><span>замечаний</span></div>
        </div>
      </div>

      <div className="card blank-controls">
        <label className="dashboard-search">Поиск по прайсу
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Название, артикул, категория, размер, материал…" />
        </label>
        <label>Категория<select value={category} onChange={(e) => { setCategory(e.target.value); setSubcategory(''); }}><option value="">Все</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label>Подкатегория<select value={subcategory} onChange={(e) => setSubcategory(e.target.value)}><option value="">Все</option>{subcategories.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label>Тип цены<select value={kind} onChange={(e) => setKind(e.target.value)}><option value="">Все</option>{kinds.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label>База<select value={basis} onChange={(e) => setBasis(e.target.value)}><option value="">Все</option>{bases.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label className="kb-check"><input type="checkbox" checked={onlyPriced} onChange={(e) => setOnlyPriced(e.target.checked)} /> только с числовой ценой</label>
        {(query || category || subcategory || kind || basis || onlyPriced) && <button className="btn tiny ghost" onClick={() => { setQuery(''); setCategory(''); setSubcategory(''); setKind(''); setBasis(''); setOnlyPriced(false); }}>Сбросить</button>}
        <div className="dashboard-filter-count muted small">Показано: {found.length} из {pricebook.items.length}</div>
      </div>

      <div className="kb-subtabs">
        {categories.slice(0, 18).map((item) => (
          <button key={item} className={`chip${category === item ? ' active' : ''}`} onClick={() => { setCategory(category === item ? '' : item); setSubcategory(''); }}>
            {item} <b>{pricebook.meta.stats.byCategory[item]?.count ?? 0}</b>
          </button>
        ))}
      </div>

      <table className="table kb-price-table">
        <thead>
          <tr><th>Категория</th><th>Позиция</th><th>Артикул</th><th>Ед.</th><th>База</th><th className="num">Цена</th><th>Источник</th></tr>
        </thead>
        <tbody>
          {found.map((item) => (
            <tr key={item.id}>
              <td className="small"><b>{item.category}</b>{item.subcategory && <div className="muted">{item.subcategory}</div>}</td>
              <td>{item.name}{item.note && <div className="muted small">{item.note}</div>}</td>
              <td className="small">{item.article ?? '—'}</td>
              <td className="small">{item.unit ?? '—'}</td>
              <td className="small">{item.priceBasis ?? '—'}</td>
              <td className="num">{priceText(item)}</td>
              <td className="small muted">{item.source.sheet}, строка {item.source.row}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {found.length === 0 && <div className="empty small">Ничего не найдено. Попробуйте снять фильтры или изменить запрос.</div>}
      {found.length >= 800 && <p className="muted small">Показаны первые 800 строк — уточните поиск или фильтр.</p>}
    </>
  );
}

// ---------------------------------------------------------------- Шпаргалки

function CheatsheetsTab() {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('');
  const groups = useMemo(() => [...new Set(CHEATSHEETS.map((item) => item.group))], []);
  const found = useMemo(() => CHEATSHEETS.filter((item) => {
    if (group && item.group !== group) return false;
    return matchesQuery(`${item.group} ${item.title} ${item.tags.join(' ')} ${item.steps.join(' ')}`, query);
  }), [query, group]);
  return (
    <>
      <div className="card blank-controls">
        <label className="dashboard-search">Поиск по шпаргалкам
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Например: фасады, бланк, замер, эскиз…" />
        </label>
        <label>Раздел<select value={group} onChange={(e) => setGroup(e.target.value)}><option value="">Все</option>{groups.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        {(query || group) && <button className="btn tiny ghost" onClick={() => { setQuery(''); setGroup(''); }}>Сбросить</button>}
        <div className="dashboard-filter-count muted small">Найдено: {found.length}</div>
      </div>
      <div className="kb-cheatsheet-grid">
        {found.map((sheet) => (
          <article key={sheet.title} className="card kb-cheatsheet">
            <div className="kb-meta"><span className="kb-chip">{sheet.group}</span>{sheet.tags.map((tag) => <span key={tag} className="kb-tag">#{tag}</span>)}</div>
            <h3>{sheet.title}</h3>
            <ol>{sheet.steps.map((step) => <li key={step}>{step}</li>)}</ol>
          </article>
        ))}
      </div>
      {found.length === 0 && <div className="empty small">Ничего не найдено.</div>}
    </>
  );
}
