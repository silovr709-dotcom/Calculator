// Экран «Аналитика»: деньги, конверсия и средний чек по уже имеющейся базе.
// Ничего не считает заново на сервере — всё берётся из проектов и прайса.

import { useMemo } from 'react';
import type { Pricebook, Project } from '../types';
import { calcTotals } from '../lib/engine';
import {
  analyticsByClient, analyticsByMonth, analyticsTopModules, analyticsTotals, projectStatus,
  type ProjectMoney,
} from '../lib/analytics';
import { fmtMoney, fmtNum } from '../lib/format';

export default function AnalyticsView(props: { projects: Project[]; pricebooks: Pricebook[] }) {
  const rows = useMemo<ProjectMoney[]>(() => props.projects.map((project) => {
    const { totals } = calcTotals(project.lines, project.settings);
    return {
      id: project.id,
      name: project.name,
      client: project.client || '',
      date: project.date || '',
      status: projectStatus(project),
      client_total: totals.client,
      cost: totals.cost,
      margin: totals.markupRub,
      marginPct: totals.marginPct,
    };
  }), [props.projects]);

  const totals = useMemo(() => analyticsTotals(rows), [rows]);
  const months = useMemo(() => analyticsByMonth(rows), [rows]);
  const clients = useMemo(() => analyticsByClient(rows), [rows]);
  const modules = useMemo(() => analyticsTopModules(props.projects), [props.projects]);
  const maxRevenue = Math.max(1, ...months.map((month) => Math.max(month.revenue, month.offered)));

  return (
    <div className="view analytics-view">
      <header className="view-head">
        <div>
          <h1>Аналитика</h1>
          <p className="view-sub">Деньги, конверсия и средний чек по всей базе. Считается из ваших проектов, ничего заполнять не нужно.</p>
        </div>
      </header>

      <section className="analytics-cards">
        <div className="analytics-card accent">
          <span>Выручка по выигранным</span>
          <b>{fmtMoney(totals.wonRevenue)}</b>
          <small>{fmtNum(totals.won, 0)} заказов из {fmtNum(totals.projects, 0)} проектов</small>
        </div>
        <div className="analytics-card">
          <span>Средний чек</span>
          <b>{totals.averageCheck == null ? '—' : fmtMoney(totals.averageCheck)}</b>
          <small>по выигранным заказам</small>
        </div>
        <div className="analytics-card">
          <span>Конверсия КП → заказ</span>
          <b>{totals.conversionPct == null ? '—' : `${fmtNum(totals.conversionPct, 1)} %`}</b>
          <small>{fmtNum(totals.won, 0)} из {fmtNum(totals.sent, 0)} отправленных · отказов {fmtNum(totals.lost, 0)}</small>
        </div>
        <div className="analytics-card">
          <span>Маржа по выигранным</span>
          <b>{fmtMoney(totals.wonMargin)}</b>
          <small>{totals.wonMarginPct == null ? 'нет данных' : `${fmtNum(totals.wonMarginPct, 1)} % от выручки`}</small>
        </div>
        <div className="analytics-card">
          <span>В работе сейчас</span>
          <b>{fmtMoney(totals.pipeline)}</b>
          <small>проекты без решения клиента</small>
        </div>
      </section>

      <section className="card">
        <div className="section-head"><div><h3>По месяцам</h3><p className="muted small">Светлая часть — все КП месяца, тёмная — то, что дошло до заказа.</p></div></div>
        {months.length === 0 ? <div className="empty small">Пока нет проектов с датой.</div> : (
          <div className="analytics-months">
            {months.map((month) => (
              <div className="analytics-month" key={month.month}>
                <div className="analytics-bars" title={`КП: ${fmtMoney(month.offered)} · заказы: ${fmtMoney(month.revenue)}`}>
                  <div className="bar offered" style={{ height: `${Math.round((month.offered / maxRevenue) * 100)}%` }} />
                  <div className="bar won" style={{ height: `${Math.round((month.revenue / maxRevenue) * 100)}%` }} />
                </div>
                <b>{fmtMoney(month.revenue)}</b>
                <span>{month.label}</span>
                <small>{month.won} из {month.projects}</small>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="analytics-tables">
        <section className="card">
          <div className="section-head"><div><h3>Клиенты по выручке</h3><p className="muted small">Кто приносит деньги.</p></div></div>
          {clients.length === 0 ? <div className="empty small">Нет данных.</div> : (
            <table className="server-table">
              <thead><tr><th>Клиент</th><th>Проектов</th><th>Выручка</th><th>Маржа</th></tr></thead>
              <tbody>
                {clients.map((client) => (
                  <tr key={client.client}>
                    <td>{client.client}</td>
                    <td>{fmtNum(client.projects, 0)}</td>
                    <td>{fmtMoney(client.revenue)}</td>
                    <td>{fmtMoney(client.margin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card">
          <div className="section-head"><div><h3>Самые частые модули</h3><p className="muted small">Что имеет смысл завести в шаблоны.</p></div></div>
          {modules.length === 0 ? <div className="empty small">В проектах пока нет модулей.</div> : (
            <table className="server-table">
              <thead><tr><th>Модуль</th><th>Штук всего</th><th>В проектах</th></tr></thead>
              <tbody>
                {modules.map((module) => (
                  <tr key={module.name}>
                    <td>{module.name}</td>
                    <td>{fmtNum(module.qty, 0)}</td>
                    <td>{fmtNum(module.projects, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}
