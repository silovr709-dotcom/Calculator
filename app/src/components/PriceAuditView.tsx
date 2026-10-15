// Проверка цен: опт и розница рядом, видно наценку, маржу и ошибки расчёта.
// Отдельный модуль — чтобы перед отправкой КП можно было спокойно всё сверить.

import { useMemo, useState } from 'react';
import type { Pricebook, Project } from '../types';
import { calcTotals } from '../lib/engine';
import { moduleToLines } from '../lib/modules';
import { fmtMoney, fmtNum } from '../lib/format';
import {
  AUDIT_FLAG_LABELS, AUDIT_FLAG_TONE, auditSummary, auditToTsv, buildAuditRows, groupAuditRows,
  type AuditRow,
} from '../lib/priceAudit';

type Filter = 'all' | 'problems' | 'no-price' | 'changed';

export default function PriceAuditView(props: {
  projects: Project[];
  pricebooks: Pricebook[];
  initialProjectId?: string;
  onOpen: (id: string) => void;
}) {
  const [projectId, setProjectId] = useState(props.initialProjectId ?? props.projects[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [copied, setCopied] = useState(false);

  const project = props.projects.find((item) => item.id === projectId) ?? null;
  const pricebook = props.pricebooks.find((item) => item.meta.id === project?.pricebookId) ?? props.pricebooks[0];

  const data = useMemo(() => {
    if (!project || !pricebook) return null;
    const moduleLines = (project.modules ?? []).flatMap((module) => moduleToLines(module, project.moduleDefaults ?? {}, pricebook));
    const lines = [...moduleLines, ...project.lines];
    const { lineCalcs, totals } = calcTotals(lines, project.settings);
    const rows = buildAuditRows(lines, lineCalcs, pricebook);
    return { rows, totals, summary: auditSummary(rows, totals) };
  }, [project, pricebook]);

  const visible = useMemo(() => {
    if (!data) return [] as AuditRow[];
    const needle = query.trim().toLocaleLowerCase('ru-RU');
    return data.rows.filter((row) => {
      if (filter === 'problems' && row.flags.length === 0) return false;
      if (filter === 'no-price' && !row.flags.includes('no-price')) return false;
      if (filter === 'changed' && !row.flags.includes('price-changed') && !row.flags.includes('not-in-pricebook')) return false;
      if (!needle) return true;
      return [row.name, row.article, row.group, row.category].filter(Boolean).join(' ').toLocaleLowerCase('ru-RU').includes(needle);
    });
  }, [data, filter, query]);

  const groups = useMemo(() => groupAuditRows(visible), [visible]);

  const copyTable = async () => {
    await navigator.clipboard.writeText(auditToTsv(visible)).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const downloadCsv = () => {
    const blob = new Blob(['\uFEFF' + auditToTsv(visible).replace(/\t/g, ';')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${project?.name ?? 'проект'} — проверка цен.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="view audit-view">
      <header className="view-head">
        <div>
          <h1>Проверка цен</h1>
          <p className="view-sub">Закупка и цена клиента рядом по каждой позиции: видно наценку, маржу и места, где расчёт выглядит подозрительно.</p>
        </div>
        <div className="audit-head-actions">
          <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            {props.projects.map((item) => (
              <option key={item.id} value={item.id}>{item.client ? `${item.client} · ` : ''}{item.name}</option>
            ))}
          </select>
          {project && <button type="button" className="btn ghost" onClick={() => props.onOpen(project.id)}>Открыть проект</button>}
        </div>
      </header>

      {!project || !data ? (
        <div className="empty">Выберите проект — и здесь появится построчная сверка цен.</div>
      ) : (
        <>
          <section className="audit-cards">
            <div className="audit-card">
              <span>Закупка (опт)</span>
              <b>{fmtMoney(data.totals.cost)}</b>
              <small>позиции {fmtMoney(data.totals.costLines)} + расходы {fmtMoney(data.totals.extraTotal)}</small>
            </div>
            <div className="audit-card accent">
              <span>Клиенту (розница)</span>
              <b>{fmtMoney(data.totals.client)}</b>
              <small>наценка {fmtMoney(data.totals.markupRub)}</small>
            </div>
            <div className="audit-card">
              <span>Маржинальность</span>
              <b>{data.totals.marginPct == null ? '—' : `${fmtNum(data.totals.marginPct, 1)} %`}</b>
              <small>средняя наценка {data.totals.markupPct == null ? '—' : `${fmtNum(data.totals.markupPct, 1)} %`}</small>
            </div>
            <div className={`audit-card ${data.summary.problems > 0 ? 'bad' : data.summary.warnings > 0 ? 'warn' : 'ok'}`}>
              <span>Проверка</span>
              <b>{data.summary.problems > 0 ? `${data.summary.problems} ошибк(и)` : data.summary.warnings > 0 ? `${data.summary.warnings} замечани(я)` : 'всё чисто'}</b>
              <small>{fmtNum(data.summary.lines, 0)} позиций в расчёте</small>
            </div>
          </section>

          <section className={`audit-balance ${data.summary.totalsMatch ? 'ok' : 'bad'}`}>
            {data.summary.totalsMatch
              ? <>✓ Сходится: сумма всех строк равна итогу расчёта{data.totals.emalAdjustment?.applied ? ' (с учётом правила эмали)' : ''}.</>
              : <>⚠ Расхождение {fmtMoney(Math.abs(data.summary.difference))}: сумма строк {fmtMoney(data.summary.linesCost)}, а в итоге расчёта {fmtMoney(data.totals.costLines)}. Проверьте позиции с процентами и базой.</>}
            {data.totals.unpricedCount > 0 && <> · Без цены: {data.totals.unpricedCount}</>}
          </section>

          <section className="audit-toolbar">
            <input value={query} placeholder="Поиск по названию, артикулу, группе…" onChange={(event) => setQuery(event.target.value)} />
            <div className="audit-filters">
              {([['all', 'Все'], ['problems', 'С замечаниями'], ['no-price', 'Без цены'], ['changed', 'Цена ≠ прайс']] as Array<[Filter, string]>).map(([id, label]) => (
                <button key={id} type="button" className={filter === id ? 'active' : ''} onClick={() => setFilter(id)}>{label}</button>
              ))}
            </div>
            <div className="audit-export">
              <button type="button" className="btn tiny ghost" onClick={() => void copyTable()}>{copied ? '✓ Скопировано' : 'Скопировать таблицу'}</button>
              <button type="button" className="btn tiny ghost" onClick={downloadCsv}>Выгрузить CSV</button>
            </div>
          </section>

          {groups.length === 0 ? (
            <div className="empty small">По выбранному фильтру позиций нет.</div>
          ) : groups.map((group) => (
            <section className="card audit-group" key={group.group}>
              <div className="audit-group-head">
                <b>{group.group}</b>
                <span>{group.rows.length} поз. · опт {fmtMoney(group.cost)} · клиент {fmtMoney(group.client)} · маржа {fmtMoney(group.marginRub)}{group.marginPct != null ? ` (${fmtNum(group.marginPct, 1)} %)` : ''}</span>
              </div>
              <div className="audit-table-wrap">
                <table className="audit-table">
                  <thead>
                    <tr>
                      <th>Позиция</th>
                      <th>Кол-во</th>
                      <th>Опт за ед.</th>
                      <th>Опт сумма</th>
                      <th>Наценка</th>
                      <th>Розница за ед.</th>
                      <th>Розница сумма</th>
                      <th>Маржа</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.rows.map((row) => (
                      <tr key={row.lineId} className={row.flags.some((flag) => AUDIT_FLAG_TONE[flag] === 'bad') ? 'bad' : row.flags.length > 0 ? 'warn' : ''}>
                        <td>
                          <b>{row.name}</b>
                          <small>
                            {[row.article, row.category].filter(Boolean).join(' · ')}
                            {row.flags.length > 0 && (
                              <span className="audit-flags">
                                {row.flags.map((flag) => (
                                  <i key={flag} className={AUDIT_FLAG_TONE[flag]}>
                                    {AUDIT_FLAG_LABELS[flag]}
                                    {flag === 'price-changed' && row.pricebookPrice != null ? `: в прайсе ${fmtMoney(row.pricebookPrice)}` : ''}
                                  </i>
                                ))}
                              </span>
                            )}
                          </small>
                        </td>
                        <td>{fmtNum(row.qty, 3)}{row.unit ? ` ${row.unit}` : ''}{row.qtyEffective !== row.qty ? <small> расчёт: {fmtNum(row.qtyEffective, 3)}</small> : null}</td>
                        <td>{row.unitCost == null ? '—' : fmtMoney(row.unitCost)}</td>
                        <td>{row.cost == null ? '—' : fmtMoney(row.cost)}</td>
                        <td>{row.markupPct == null ? '—' : `${fmtNum(row.markupPct, 1)} %`}</td>
                        <td>{row.unitClient == null ? '—' : fmtMoney(row.unitClient)}</td>
                        <td><b>{row.client == null ? '—' : fmtMoney(row.client)}</b></td>
                        <td className={row.marginRub != null && row.marginRub < 0 ? 'bad' : ''}>
                          {row.marginRub == null ? '—' : fmtMoney(row.marginRub)}
                          {row.marginPct != null && <small>{fmtNum(row.marginPct, 1)} %</small>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
