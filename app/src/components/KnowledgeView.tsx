import { useMemo, useState } from 'react';
import type { KbArticle, KbCategory } from '../types';
import { createKbArticle, filterKbArticles, KB_CATEGORIES, kbCategoryLabel, removeKbArticle, seedKbArticles, upsertKbArticle } from '../lib/knowledge';

/**
 * База знаний РЕцепта. Статьи — самодостаточные записи с категориями, тегами и телом.
 * Структура готова под AI-поиск (каждая статья — будущий чанк с метаданными),
 * AI не подключаем, жизнь базы начинается со стартовых статей со ссылками на
 * реальные документы фабрики из репозитория.
 */
export default function KnowledgeView(props: {
  articles: KbArticle[];
  onChange: (articles: KbArticle[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<KbCategory | null>(null);
  const [editing, setEditing] = useState<KbArticle | null>(null);
  const [isNew, setIsNew] = useState(false);

  const filtered = useMemo(() => filterKbArticles(props.articles, query, category), [props.articles, query, category]);

  const openNew = () => { setEditing(createKbArticle({ category: category ?? 'instructions' })); setIsNew(true); };
  const openEdit = (a: KbArticle) => { setEditing({ ...a }); setIsNew(false); };
  const saveEditing = () => {
    if (!editing) return;
    if (!editing.title.trim()) { alert('У статьи должен быть заголовок.'); return; }
    props.onChange(upsertKbArticle(props.articles, editing));
    setEditing(null);
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>База знаний</h1>
          <div className="muted">Правила, инструкции и регламенты РЕцепта. Статей: {props.articles.length}</div>
        </div>
        <div className="actions">
          {props.articles.length === 0 && (
            <button className="btn ghost" onClick={() => props.onChange(seedKbArticles())}>Загрузить стартовые статьи</button>
          )}
          <button className="btn primary" onClick={openNew}>+ Статья</button>
        </div>
      </header>

      <div className="card blank-controls">
        <label className="dashboard-search">Поиск
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Слова из заголовка, тегов или текста…" />
        </label>
        <label>Категория
          <select value={category ?? ''} onChange={(e) => setCategory((e.target.value || null) as KbCategory | null)}>
            <option value="">Все категории</option>
            {KB_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        {(query || category) && <button className="btn tiny ghost" onClick={() => { setQuery(''); setCategory(null); }}>Сбросить</button>}
      </div>

      {filtered.length === 0 ? (
        <div className="empty">
          {props.articles.length === 0
            ? <>База пока пустая. Нажмите <b>«Загрузить стартовые статьи»</b> — добавятся ссылки на инструкции и техничку фабрики из репозитория.</>
            : 'Ничего не найдено. Попробуйте другие слова или сбросьте фильтры.'}
        </div>
      ) : (
        <div className="kb-list">
          {filtered.map((a) => (
            <div className="card kb-card" key={a.id}>
              <div className="kb-head">
                <h3>{a.title}</h3>
                <div className="actions">
                  <button className="btn tiny ghost" onClick={() => openEdit(a)}>Изменить</button>
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
            <label>Приложение (имя файла-документа, напр. из репозитория)
              <input value={editing.attachment ?? ''} onChange={(e) => setEditing({ ...editing, attachment: e.target.value || undefined })} placeholder="Инструкция по заполнению бланк а кухни 2025.pdf" />
            </label>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setEditing(null)}>Отмена</button>
              <button className="btn primary" onClick={saveEditing}>Сохранить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
