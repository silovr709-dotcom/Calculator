import { useMemo } from 'react';
import type { Project } from '../types';
import { calcTotals } from '../lib/engine';
import { fmtMoney, fmtDate } from '../lib/format';
import { exportClientXlsx } from '../lib/exporters';

/**
 * Клиентская версия: только наименование, количество, стоимость (с наценкой) и итог.
 * Себестоимость, закупочные цены, наценки и служебные данные не выводятся.
 */
export default function ClientView({ project }: { project: Project }) {
  const { lineCalcs, totals } = useMemo(() => calcTotals(project.lines, project.settings), [project]);

  return (
    <div className="client-view">
      <div className="client-toolbar no-print">
        <div className="muted small">
          Клиент видит только этот документ: без себестоимости, наценок и внутренних данных.
        </div>
        <div>
          <button className="btn ghost" onClick={() => exportClientXlsx(project)}>Excel для клиента</button>
          <button className="btn primary" onClick={() => window.print()}>Печать / PDF</button>
        </div>
      </div>

      <div className="client-doc" id="client-doc">
        <div className="cd-head">
          <div>
            <div className="cd-brand">РЕцепт</div>
            <div className="cd-sub">мебельное ателье</div>
          </div>
          <div className="cd-title">
            <h2>Коммерческое предложение</h2>
            <div>{project.name}</div>
            <div className="muted">{project.client && <>Заказчик: {project.client} · </>}{fmtDate(project.date)}</div>
          </div>
        </div>

        {(project.photos ?? []).some((p) => p.showToClient) && (
          <div className="cd-photos">
            {(project.photos ?? []).filter((p) => p.showToClient).map((p) => (
              <figure key={p.id}><img src={p.dataUrl} alt={p.name} /><figcaption>{p.name}</figcaption></figure>
            ))}
          </div>
        )}

        <table className="table client-table">
          <thead>
            <tr><th>№</th><th>Наименование</th><th className="num">Кол-во</th><th>Ед.</th><th className="num">Стоимость</th></tr>
          </thead>
          <tbody>
            {project.lines.map((l, idx) => {
              const c = lineCalcs.get(l.id);
              return (
                <tr key={l.id}>
                  <td>{idx + 1}</td>
                  <td>{l.name}</td>
                  <td className="num">{l.qty}</td>
                  <td>{l.unit ?? ''}</td>
                  <td className="num">{c?.clientSum != null ? fmtMoney(c.clientSum) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="cd-total">
          Итоговая стоимость: <b>{fmtMoney(totals.client)}</b>
        </div>
        {project.comment && <div className="cd-comment">{project.comment}</div>}
      </div>
    </div>
  );
}
