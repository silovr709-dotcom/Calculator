import { useEffect, useMemo, useState } from 'react';
import type { Pricebook, Project, ProjectLine, PriceItem, LineParams } from '../types';
import { SUMMARY_GROUPS } from '../types';
import { calcTotals, lineFromItem } from '../lib/engine';
import { fmtMoney, fmtNum, fmtDate } from '../lib/format';
import CatalogPicker from './CatalogPicker';
import ModulesPanel from './ModulesPanel';
import PhotosPanel from './PhotosPanel';
import { checkModule, moduleToLines } from '../lib/modules';
import SettingsPanel from './SettingsPanel';
import ClientView from './ClientView';
import { exportInternalXlsx, exportClientXlsx, exportInternalCsv, exportProjectJson } from '../lib/exporters';

export default function ProjectEditor(props: {
  project: Project;
  pricebook: Pricebook;
  onChange: (p: Project) => void;
  onBack: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onSaveTemplate: (name: string) => void;
}) {
  const { project, pricebook } = props;
  const [tab, setTab] = useState<'modules' | 'lines' | 'photos' | 'settings' | 'client'>(
    () => ((project.modules?.length ?? 0) > 0 || project.lines.length === 0 ? 'modules' : 'lines'),
  );
  const [showPicker, setShowPicker] = useState(false);
  const [editMeta, setEditMeta] = useState(false);

  // строки из модулей («Позиции кухни») + ручные строки — единый расчёт
  const moduleLines = useMemo(
    () => (project.modules ?? []).flatMap((m) => moduleToLines(m, project.moduleDefaults ?? {}, pricebook)),
    [project.modules, project.moduleDefaults, pricebook],
  );
  const combinedLines = useMemo(() => [...moduleLines, ...project.lines], [moduleLines, project.lines]);
  const { lineCalcs, totals } = useMemo(() => calcTotals(combinedLines, project.settings), [combinedLines, project.settings]);
  const moduleCriticals = useMemo(
    () => (project.modules ?? []).reduce((n, m) => n + checkModule(m, project.moduleDefaults ?? {}, pricebook).errors.length, 0),
    [project.modules, project.moduleDefaults, pricebook],
  );
  const outProject = useMemo(() => ({ ...project, lines: combinedLines }), [project, combinedLines]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setShowPicker(true); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); props.onChange({ ...project }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [project, props]);

  const addItem = (item: PriceItem, qty: number, params: LineParams) => {
    const line = lineFromItem(item, pricebook.meta.id, qty, params);
    props.onChange({ ...project, lines: [...project.lines, line] });
  };

  const updLine = (id: string, patch: Partial<ProjectLine>) => {
    props.onChange({ ...project, lines: project.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  };
  const delLine = (id: string) => {
    props.onChange({ ...project, lines: project.lines.filter((l) => l.id !== id).map((l) => (l.baseLineId === id ? { ...l, baseLineId: null } : l)) });
  };

  const groupsInUse = SUMMARY_GROUPS.filter((g) => project.lines.some((l) => l.group === g));

  return (
    <div className="page project">
      <header className="page-head">
        <div>
          <button className="btn ghost small" onClick={props.onBack}>← Проекты</button>
          <h1>{project.name}</h1>
          <div className="muted">
            {project.client && <>Клиент: <b>{project.client}</b> · </>}
            {fmtDate(project.date)} · Прайс: {project.pricebookName}
            <button className="btn tiny ghost" onClick={() => setEditMeta(true)}>изменить</button>
          </div>
        </div>
        <div className="actions">
          <select
            value={project.status}
            onChange={(e) => props.onChange({ ...project, status: e.target.value as Project['status'] })}
            className="status-select"
          >
            <option value="draft">Черновик</option>
            <option value="sent">Отправлен</option>
            <option value="approved">Согласован</option>
            <option value="archived">Архив</option>
          </select>
          <div className="dropdown">
            <button className="btn ghost">Экспорт ▾</button>
            <div className="dropdown-menu">
              <button onClick={() => exportInternalXlsx(outProject)}>Excel — внутренний расчёт</button>
              <button onClick={() => exportClientXlsx(outProject)}>Excel — коммерческое предложение</button>
              <button onClick={() => exportInternalCsv(outProject)}>CSV — внутренний расчёт</button>
              <button onClick={() => exportProjectJson(project)}>Файл проекта (.json)</button>
            </div>
          </div>
          <button className="btn ghost" onClick={props.onDuplicate}>Дублировать</button>
          <button className="btn ghost" onClick={() => { const n = prompt('Название шаблона:', project.name); if (n) props.onSaveTemplate(n); }}>В шаблон</button>
          <button className="btn danger ghost" onClick={props.onDelete}>Удалить</button>
        </div>
      </header>

      {editMeta && (
        <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) setEditMeta(false); }}>
          <div className="modal narrow">
            <h2>Данные проекта</h2>
            <label>Название<input value={project.name} onChange={(e) => props.onChange({ ...project, name: e.target.value })} /></label>
            <label>Клиент<input value={project.client} onChange={(e) => props.onChange({ ...project, client: e.target.value })} /></label>
            <label>Дата<input type="date" value={project.date} onChange={(e) => props.onChange({ ...project, date: e.target.value })} /></label>
            <label>Комментарий<textarea rows={2} value={project.comment} onChange={(e) => props.onChange({ ...project, comment: e.target.value })} /></label>
            <div className="modal-actions"><button className="btn primary" onClick={() => setEditMeta(false)}>Готово</button></div>
          </div>
        </div>
      )}

      <div className="tabs">
        <button className={tab === 'modules' ? 'active' : ''} onClick={() => setTab('modules')}>
          Позиции кухни{(project.modules?.length ?? 0) > 0 ? ` (${project.modules!.length})` : ''}{moduleCriticals > 0 ? ' ⛔' : ''}
        </button>
        <button className={tab === 'lines' ? 'active' : ''} onClick={() => setTab('lines')}>Доп. позиции и строки</button>
        <button className={tab === 'photos' ? 'active' : ''} onClick={() => setTab('photos')}>Фото{(project.photos?.length ?? 0) > 0 ? ` (${project.photos!.length})` : ''}</button>
        <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>Настройки проекта</button>
        <button className={tab === 'client' ? 'active' : ''} onClick={() => setTab('client')}>Клиентская версия</button>
      </div>

      {tab === 'photos' && <PhotosPanel project={project} onChange={props.onChange} />}

      {tab === 'settings' && (
        <SettingsPanel
          title="Наценка и расходы этого проекта (не меняют цены Висмы)"
          settings={project.settings}
          onChange={(s) => props.onChange({ ...project, settings: s })}
        />
      )}

      {tab === 'client' && (
        <>
          {moduleCriticals > 0 && <div className="warn-box">⛔ Расчёт неполный: в «Позициях кухни» есть {moduleCriticals} незаполненных обязательных параметров — эти строки не входят в цену.</div>}
          <ClientView project={outProject} />
        </>
      )}

      {tab === 'modules' && (
        <div className="editor-grid">
          <div className="lines-col">
            <ModulesPanel project={project} pricebook={pricebook} onChange={props.onChange} />
          </div>
          <TotalsAside totals={totals} project={project} />
        </div>
      )}

      {tab === 'lines' && (
        <div className="editor-grid">
          <div className="lines-col">
            <div className="lines-toolbar">
              <button className="btn primary" onClick={() => setShowPicker(true)}>+ Добавить элемент (Ctrl+K)</button>
              {totals.unpricedCount > 0 && <span className="warn">⚠ строк без цены: {totals.unpricedCount}</span>}
            </div>
            {moduleLines.length > 0 && (
              <div className="note">В итог также входят {moduleLines.length} строк из «Позиций кухни» (модулей). Здесь — дополнительные позиции: столешницы, мойки, цоколь, электрика и любые другие элементы прайса.</div>
            )}
            {project.lines.length === 0 ? (
              <div className="empty">Позиции ещё не добавлены. Нажмите «Добавить элемент» — откроется каталог с поиском по {pricebook.meta.itemCount} позициям прайса.</div>
            ) : (
              <table className="table lines">
                <thead>
                  <tr>
                    <th>Категория</th><th>Позиция</th><th>Арт.</th><th className="num">Кол-во</th><th>Ед.</th>
                    <th className="num">Цена</th><th className="num">Сумма</th><th />
                  </tr>
                </thead>
                <tbody>
                  {groupsInUse.map((g) => (
                    <GroupRows
                      key={g}
                      group={g}
                      lines={project.lines.filter((l) => l.group === g)}
                      allLines={project.lines}
                      lineCalcs={lineCalcs}
                      groupTotal={totals.byGroup[g]}
                      updLine={updLine}
                      delLine={delLine}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <TotalsAside totals={totals} project={project} />
        </div>
      )}

      {showPicker && (
        <CatalogPicker pricebook={pricebook} onAdd={addItem} onClose={() => setShowPicker(false)} />
      )}
    </div>
  );
}

function GroupRows(props: {
  group: string;
  lines: ProjectLine[];
  allLines: ProjectLine[];
  lineCalcs: ReturnType<typeof calcTotals>['lineCalcs'];
  groupTotal: { cost: number; client: number };
  updLine: (id: string, patch: Partial<ProjectLine>) => void;
  delLine: (id: string) => void;
}) {
  return (
    <>
      <tr className="group-row"><td colSpan={6}>{props.group}</td><td className="num"><b>{fmtMoney(props.groupTotal.cost)}</b></td><td /></tr>
      {props.lines.map((l) => {
        const c = props.lineCalcs.get(l.id);
        return (
          <tr key={l.id} className={c?.warning ? 'has-warn' : ''}>
            <td className="muted small">{l.category}</td>
            <td>
              <div>{l.name}</div>
              {l.priceKind === 'percent' && (
                <select
                  className="base-select"
                  value={l.baseLineId ?? ''}
                  onChange={(e) => props.updLine(l.id, { baseLineId: e.target.value || null })}
                >
                  <option value="">— выберите базовую позицию —</option>
                  {props.allLines.filter((x) => x.id !== l.id && x.priceKind !== 'percent').map((x) => (
                    <option key={x.id} value={x.id}>{x.name.slice(0, 60)}</option>
                  ))}
                </select>
              )}
              {(l.params.widthMm || l.params.areaM2 || l.params.lengthMm) && (
                <div className="muted small">
                  {l.params.widthMm && `${l.params.widthMm}×${l.params.heightMm} мм`}
                  {l.params.areaM2 != null && `${l.params.areaM2} м²`}
                  {l.params.lengthMm != null && `L=${l.params.lengthMm} мм`}
                  {c && <> → {fmtNum(c.qtyEffective, 4)} {l.unit ?? ''}</>}
                </div>
              )}
              {c?.warning && <div className="warn small">⚠ {c.warning}</div>}
              <input
                className="note-input"
                placeholder="заметка…"
                value={l.note ?? ''}
                onChange={(e) => props.updLine(l.id, { note: e.target.value })}
              />
            </td>
            <td className="muted small">{l.article ?? '—'}</td>
            <td className="num">
              <input
                className="qty"
                type="number"
                step={l.priceBasis === 'sheet' ? 0.5 : 1}
                min={0}
                value={l.qty}
                onChange={(e) => props.updLine(l.id, { qty: Number(e.target.value) || 0 })}
              />
            </td>
            <td className="small">{l.unit ?? '—'}</td>
            <td className="num">{l.priceKind === 'percent' ? `+${l.price}%` : fmtMoney(l.price)}</td>
            <td className="num"><b>{c?.sum != null ? fmtMoney(c.sum) : '—'}</b></td>
            <td><button className="btn tiny danger" title="Удалить строку" onClick={() => props.delLine(l.id)}>✕</button></td>
          </tr>
        );
      })}
    </>
  );
}

function TotalsAside(props: { totals: ReturnType<typeof calcTotals>['totals']; project: Project }) {
  const { totals, project } = props;
  return (
    <aside className="totals-col">
      <div className="totals-card">
        <h3>Итог</h3>
        {SUMMARY_GROUPS.filter((g) => totals.byGroup[g].cost !== 0).map((g) => (
          <div className="t-row" key={g}><span>{g}</span><span>{fmtMoney(totals.byGroup[g].cost)}</span></div>
        ))}
        {totals.emalAdjustment?.applied && (
          <div className="t-row warn"><span>Эмаль &lt; 1 м² (+30%, правило прайса, {fmtNum(totals.emalAdjustment.area)} м²)</span><span>{fmtMoney(totals.emalAdjustment.amount)}</span></div>
        )}
        {totals.extraTotal !== 0 && (
          <div className="t-row"><span>Доп. расходы (сборка/доставка/прочее)</span><span>{fmtMoney(totals.extraTotal)}</span></div>
        )}
        <div className="t-row total"><span>ИТОГО СЕБЕСТОИМОСТЬ</span><span>{fmtMoney(totals.cost)}</span></div>
        <div className="t-row"><span>Наценка</span><span>{fmtMoney(totals.markupRub)}{totals.markupPct != null && <em> ({fmtNum(totals.markupPct, 1)}%)</em>}</span></div>
        <div className="t-row client"><span>ЦЕНА ДЛЯ КЛИЕНТА</span><span>{fmtMoney(totals.client)}</span></div>
        <div className="t-row"><span>Маржинальность</span><span>{totals.marginPct != null ? `${fmtNum(totals.marginPct, 1)}%` : '—'}</span></div>
        {project.settings.markupBasePct == null && Object.keys(project.settings.markupByGroup).length === 0 && (
          <div className="note">Наценка не задана — цена клиента равна себестоимости. Задайте её во вкладке «Настройки проекта».</div>
        )}
      </div>
    </aside>
  );
}
