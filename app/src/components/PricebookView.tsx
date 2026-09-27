import { useRef, useState } from 'react';
import type { Pricebook } from '../types';
import { fmtNum } from '../lib/format';

export default function PricebookView(props: {
  pricebooks: Pricebook[];
  activeId: string;
  builtinId: string | null;
  onActivate: (id: string) => void;
  onUpload: (pb: Pricebook) => void;
  onRemove: (id: string) => void;
}) {
  const [sel, setSel] = useState<string>(props.activeId);
  const fileRef = useRef<HTMLInputElement>(null);
  const pb = props.pricebooks.find((p) => p.meta.id === sel) ?? props.pricebooks[0];
  const [issueFilter, setIssueFilter] = useState('');

  const upload = (f: File) => {
    f.text().then((t) => {
      try {
        const next = JSON.parse(t) as Pricebook;
        if (!next?.meta?.id || !Array.isArray(next.items)) throw new Error('файл не является базой прайса РЕцепта');
        if (props.pricebooks.some((p) => p.meta.id === next.meta.id)) {
          if (!confirm(`Версия «${next.meta.id}» уже загружена. Заменить?`)) return;
        }
        props.onUpload(next);
        setSel(next.meta.id);
        alert(`Прайс «${next.meta.name}» загружен: ${next.items.length} позиций.\nСтарые проекты сохранят свои цены — они хранят снимок цен на момент расчёта.`);
      } catch (e) { alert(`Ошибка загрузки: ${e}`); }
    });
  };

  if (!pb) return null;
  const issues = pb.issues.filter((i) => !issueFilter || i.kind === issueFilter);
  const kinds = [...new Set(pb.issues.map((i) => i.kind))].sort();
  const kindLabel: Record<string, string> = {
    empty_price: 'Пустая цена', text_price: 'Текстовая цена', unavailable: 'Недоступно/выведено',
    zero_price: 'Нулевая цена', no_unit: 'Нет ед. изм.', no_article: 'Нет артикула',
    no_name: 'Нет названия', dup_article: 'Дубль артикула', parse: 'Ошибка разбора', import_error: 'Ошибка импорта',
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Прайс и версии</h1>
          <div className="muted">Каждый проект хранит снимок цен: обновление прайса не меняет старые расчёты.</div>
        </div>
        <div className="actions">
          <button className="btn primary" onClick={() => fileRef.current?.click()}>Загрузить новую версию прайса (.json)</button>
          <input ref={fileRef} hidden type="file" accept=".json" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
        </div>
      </header>

      <div className="card">
        <h3>Как обновить прайс (например, «ВИСМА 2027 КХМ.xlsm»)</h3>
        <ol className="muted small steps">
          <li>Положите новый .xlsm в корень репозитория.</li>
          <li>Выполните: <code>python3 tools/extract_pricebook.py "ВИСМА 2027 КХМ.xlsm" pricebook-visma-2027.json</code> (перед этим поменяйте id/год в meta при необходимости — скрипт возьмёт данные из файла).</li>
          <li>Загрузите полученный JSON кнопкой выше — новая версия появится в списке, старые проекты не изменятся.</li>
        </ol>
      </div>

      <div className="card">
        <h3>Версии</h3>
        <table className="table">
          <thead><tr><th>Прайс</th><th>Поставщик</th><th>Год</th><th>Импортирован</th><th>Позиций</th><th>Проблем</th><th /></tr></thead>
          <tbody>
            {props.pricebooks.map((p) => (
              <tr key={p.meta.id} className={p.meta.id === sel ? 'sel-row' : ''} onClick={() => setSel(p.meta.id)}>
                <td><b>{p.meta.name}</b> {p.meta.id === props.activeId && <span className="status s-approved">активный</span>}</td>
                <td>{p.meta.supplier}</td>
                <td>{p.meta.priceYear}</td>
                <td>{p.meta.importedAt.slice(0, 10)}</td>
                <td>{p.meta.itemCount}</td>
                <td>{p.issues.length}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  {p.meta.id !== props.activeId && <button className="btn tiny ghost" onClick={() => props.onActivate(p.meta.id)}>сделать активным</button>}
                  {p.meta.id !== props.builtinId && <button className="btn tiny danger" onClick={() => props.onRemove(p.meta.id)}>✕</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Статистика «{pb.meta.name}»</h3>
        <div className="stats-grid">
          {Object.entries(pb.meta.stats.byCategory).map(([c, s]) => (
            <div key={c} className="stat"><span>{c}</span><b>{fmtNum(s.count, 0)}</b><em>{s.priced} с ценой</em></div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>Проблемы исходного прайса ({pb.issues.length}) — данные не исправлялись, показаны как есть</h3>
        <div className="filters">
          <select value={issueFilter} onChange={(e) => setIssueFilter(e.target.value)}>
            <option value="">Все типы</option>
            {kinds.map((k) => <option key={k} value={k}>{kindLabel[k] ?? k} ({pb.issues.filter((i) => i.kind === k).length})</option>)}
          </select>
        </div>
        <table className="table small">
          <thead><tr><th>Тип</th><th>Лист</th><th>Строка</th><th>Описание</th></tr></thead>
          <tbody>
            {issues.map((i, idx) => (
              <tr key={idx}><td>{kindLabel[i.kind] ?? i.kind}</td><td>{i.sheet}</td><td>{i.row}</td><td>{i.detail}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      {Object.keys(pb.notes).length > 0 && (
        <div className="card">
          <h3>Примечания и правила из прайса</h3>
          {Object.entries(pb.notes).map(([sheet, list]) => (
            <details key={sheet}>
              <summary>{sheet} ({list.length})</summary>
              <ul className="muted small">{list.map((n, i) => <li key={i}>{n}</li>)}</ul>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
