import { useEffect, useMemo, useState } from 'react';
import type { Pricebook, Project, ProjectLine, PriceItem, LineParams, Template, KitchenModule } from '../types';
import { SUMMARY_GROUPS } from '../types';
import { calcTotals, lineFromItem } from '../lib/engine';
import { fmtMoney, fmtNum, fmtDate } from '../lib/format';
import CatalogPicker from './CatalogPicker';
import ModulesPanel from './ModulesPanel';
import KitchenSketch from './KitchenSketch';
import PhotosPanel from './PhotosPanel';
import { checkModule, moduleToLines, moveModule } from '../lib/modules';
import { validateProject } from '../lib/validation';
import SettingsPanel from './SettingsPanel';
import ClientView from './ClientView';
import KitchenWizard from './KitchenWizard';
import ProjectCheckCenter from './ProjectCheckCenter';
import VariantsPanel from './VariantsPanel';
import MeasurementPanel from './MeasurementPanel';
import KitchenChecklistPanel from './KitchenChecklistPanel';
import { exportInternalXlsx, exportClientXlsx, exportInternalCsv, exportProjectJson } from '../lib/exporters';
import QRCode from 'qrcode';
import { makeProjectShareUrl } from '../lib/sync';

export default function ProjectEditor(props: {
  project: Project;
  pricebook: Pricebook;
  onChange: (p: Project) => void;
  onUndo: () => void;
  canUndo: boolean;
  onBack: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onSaveTemplate: (name: string) => void;
  templates?: Template[];
  onSaveModuleTemplate?: (name: string, module: KitchenModule) => void;
  onOpenFactoryBlank?: () => void;
}) {
  const { project, pricebook } = props;
  const [tab, setTab] = useState<'modules' | 'sketch' | 'lines' | 'photos' | 'settings' | 'client' | 'check' | 'variants' | 'measurement'>(
    () => ((project.modules?.length ?? 0) > 0 || project.lines.length === 0 ? 'modules' : 'lines'),
  );
  const [editorMode, setEditorMode] = useState<'wizard' | 'advanced'>(() => project.wizardMode ?? 'advanced');
  const [focusModuleId, setFocusModuleId] = useState<string | null>(null);
  const [focusLineId, setFocusLineId] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [editMeta, setEditMeta] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrUrl, setQrUrl] = useState('');

  useEffect(() => {
    if (showQrModal) {
      const url = makeProjectShareUrl(project);
      QRCode.toDataURL(url, { width: 260, margin: 2, color: { dark: '#10231f', light: '#ffffff' } })
        .then((u) => setQrUrl(u))
        .catch(() => {});
    }
  }, [showQrModal, project]);

  // Горячие клавиши: Ctrl+Z — отмена последнего изменения проекта.
  // Не перехватываем, когда фокус в поле ввода (там собственный undo текста).
  const { onUndo, canUndo } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      e.preventDefault();
      if (!e.shiftKey && canUndo) onUndo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onUndo, canUndo]);

  // строки из модулей («Позиции кухни») + ручные строки — единый расчёт
  const moduleGroups = useMemo(
    () => (project.modules ?? []).map((m) => ({ module: m, lines: moduleToLines(m, project.moduleDefaults ?? {}, pricebook) })),
    [project.modules, project.moduleDefaults, pricebook],
  );
  const moduleLines = useMemo(() => moduleGroups.flatMap((g) => g.lines), [moduleGroups]);
  const combinedLines = useMemo(() => [...moduleLines, ...project.lines], [moduleLines, project.lines]);
  const { lineCalcs, totals } = useMemo(() => calcTotals(combinedLines, project.settings), [combinedLines, project.settings]);
  const moduleCriticals = useMemo(
    () => (project.modules ?? []).reduce((n, m) => n + checkModule(m, project.moduleDefaults ?? {}, pricebook).errors.length, 0),
    [project.modules, project.moduleDefaults, pricebook],
  );
  const projectValidation = useMemo(() => validateProject(project, pricebook), [project, pricebook]);
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
  const reorderModule = (id: string, direction: -1 | 1) => {
    const modules = project.modules ?? [];
    const next = moveModule(modules, id, direction);
    if (next !== modules) props.onChange({ ...project, modules: next });
  };

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
          <button className="btn ghost" disabled={!props.canUndo} title="Отменить последнее изменение проекта (Ctrl+Z)" onClick={props.onUndo}>↶ Отменить</button>
          <div className="dropdown">
            <button className="btn ghost">Экспорт ▾</button>
            <div className="dropdown-menu">
              <button onClick={() => exportInternalXlsx(outProject)}>Excel — внутренний расчёт</button>
              <button onClick={() => exportClientXlsx(outProject)}>Excel — коммерческое предложение</button>
              <button onClick={() => exportInternalCsv(outProject)}>CSV — внутренний расчёт</button>
              <button onClick={() => exportProjectJson(project)}>Файл проекта (.json)</button>
              <button onClick={() => setShowQrModal(true)}>📱 Открыть на телефоне (QR-код)</button>
            </div>
          </div>
          {props.onOpenFactoryBlank && (
            <button className="btn ghost" title="Калькулятор → данные проекта → бланк → проверка → документ" onClick={props.onOpenFactoryBlank}>📋 Бланк на фабрику</button>
          )}
          <button className="btn ghost" title="Открыть этот проект на телефоне" onClick={() => setShowQrModal(true)}>📱 На телефон</button>
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

      {showQrModal && (
        <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowQrModal(false); }}>
          <div className="modal narrow" style={{ textAlign: 'center' }}>
            <h2>📱 Открыть проект на смартфоне</h2>
            <div className="muted small" style={{ marginBottom: 16 }}>
              Наведите камеру смартфона на QR-код — проект «<b>{project.name}</b>» мгновенно откроется в калькуляторе на телефоне.
            </div>
            {qrUrl ? (
              <div className="qr-container">
                <img src={qrUrl} alt="QR-код проекта" className="qr-image" style={{ width: 240, height: 240 }} />
              </div>
            ) : (
              <div className="pad muted">Генерация QR-кода…</div>
            )}
            <div className="modal-actions" style={{ justifyContent: 'center', marginTop: 18 }}>
              <button className="btn primary" onClick={() => setShowQrModal(false)}>Закрыть</button>
            </div>
          </div>
        </div>
      )}

      <div className="editor-mode-bar no-print">
        <div><b>{editorMode === 'wizard' ? 'Мастер сборки' : 'Продвинутый режим'}</b><span className="muted small"> {editorMode === 'wizard' ? ' · шаги проведут по обязательным данным' : ' · все вкладки и быстрый доступ'}</span></div>
        <button className="btn tiny ghost" onClick={() => { const next = editorMode === 'wizard' ? 'advanced' : 'wizard'; setEditorMode(next); props.onChange({ ...project, wizardMode: next }); }}>{editorMode === 'wizard' ? 'Перейти к вкладкам' : 'Открыть мастер'}</button>
      </div>
      <KitchenChecklistPanel project={project} pricebook={pricebook} onChange={props.onChange} />
      {editorMode === 'wizard' ? (
        <KitchenWizard
          project={project}
          pricebook={pricebook}
          onChange={props.onChange}
          onSelectModule={(id) => { setFocusModuleId(id); setEditorMode('advanced'); setTab('modules'); }}
          onOpenAdvanced={() => { setEditorMode('advanced'); props.onChange({ ...project, wizardMode: 'advanced' }); }}
        />
      ) : (<>
      <div className="tabs">
        <button className={tab === 'modules' ? 'active' : ''} onClick={() => setTab('modules')}>
          Позиции кухни{(project.modules?.length ?? 0) > 0 ? ` (${project.modules!.length})` : ''}{moduleCriticals > 0 ? ' ⛔' : ''}
        </button>
        <button className={tab === 'sketch' ? 'active' : ''} onClick={() => setTab('sketch')}>🎨 Эскиз кухни</button>
        <button className={tab === 'check' ? 'active' : ''} onClick={() => setTab('check')}>✓ Проверка</button>
        <button className={tab === 'variants' ? 'active' : ''} onClick={() => setTab('variants')}>Варианты</button>
        <button className={tab === 'measurement' ? 'active' : ''} onClick={() => setTab('measurement')}>📏 Замер</button>
        <button className={tab === 'lines' ? 'active' : ''} onClick={() => setTab('lines')}>Доп. позиции и строки</button>
        <button className={tab === 'photos' ? 'active' : ''} onClick={() => setTab('photos')}>Фото{(project.photos?.length ?? 0) > 0 ? ` (${project.photos!.length})` : ''}</button>
        <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>Настройки проекта</button>
        <button className={tab === 'client' ? 'active' : ''} onClick={() => setTab('client')}>Клиентская версия</button>
      </div>

      {tab === 'photos' && <PhotosPanel project={project} onChange={props.onChange} />}

      {tab === 'sketch' && (
        <KitchenSketch
          modules={project.modules ?? []}
          settings={project.sketch}
          onSettingsChange={(sketch) => props.onChange({ ...project, sketch })}
          onSelectModule={(id) => { setFocusModuleId(id); setTab('modules'); }}
          onReorder={reorderModule}
        />
      )}

      {tab === 'check' && (
        <ProjectCheckCenter
          project={project}
          pricebook={pricebook}
          onChange={props.onChange}
          onSelectModule={(id) => { setFocusModuleId(id); setTab('modules'); }}
          onSelectLine={(id) => { setFocusLineId(id); setTab('lines'); window.setTimeout(() => document.getElementById(`project-line-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0); }}
        />
      )}

      {tab === 'variants' && <VariantsPanel project={project} pricebook={pricebook} onChange={props.onChange} />}
      {tab === 'measurement' && <MeasurementPanel project={project} onChange={props.onChange} />}

      {tab === 'settings' && (
        <SettingsPanel
          title="Наценка и расходы этого проекта (не меняют цены Висмы)"
          settings={project.settings}
          onChange={(s) => props.onChange({ ...project, settings: s })}
          extraDetails={totals.extraDetails}
        />
      )}

      {tab === 'client' && (
        <>
          {!projectValidation.ready && <div className="warn-box">⛔ Проект ещё не готов: ошибок {projectValidation.errors.length}, предупреждений {projectValidation.warnings.length}. Проверьте обязательный состав кухни и центр проверки перед отправкой КП.</div>}
          {moduleCriticals > 0 && <div className="warn-box">⛔ Расчёт неполный: в «Позициях кухни» есть {moduleCriticals} незаполненных обязательных параметров — эти строки не входят в цену.</div>}
          <ClientView
            project={outProject}
            pricebook={pricebook}
            onOfferChange={(clientOffer) => props.onChange({ ...project, clientOffer })}
            onSketchVisibilityChange={(showInClient) => props.onChange({ ...project, sketch: { ...project.sketch, showInClient } })}
            moduleGroups={moduleGroups.map(({ module: m, lines }) => ({
              id: m.id,
              title: m.name,
              sub: m.widthMm && m.heightMm ? `${m.widthMm}×${m.heightMm}${m.depthMm ? `×${m.depthMm}` : ''} мм` : '',
              qty: m.qty,
              lineIds: lines.map((l) => l.id),
              composition: lines.map((l) => `${l.name.slice(0, 40)}${l.qty !== 1 ? ` × ${l.qty}` : ''}`),
            }))}
          />
        </>
      )}

      {tab === 'modules' && (
        <div className="editor-grid">
          <div className="lines-col">
            <ModulesPanel project={project} pricebook={pricebook} onChange={props.onChange} templates={props.templates} onSaveModuleTemplate={props.onSaveModuleTemplate} focusModuleId={focusModuleId} />
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
                      focusLineId={focusLineId}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <TotalsAside totals={totals} project={project} />
        </div>
      )}

      </>)}

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
  focusLineId?: string | null;
}) {
  return (
    <>
      <tr className="group-row"><td colSpan={6}>{props.group}</td><td className="num"><b>{fmtMoney(props.groupTotal.cost)}</b></td><td /></tr>
      {props.lines.map((l) => {
        const c = props.lineCalcs.get(l.id);
        return (
          <tr id={`project-line-${l.id}`} key={l.id} className={`${c?.warning ? 'has-warn' : ''} ${props.focusLineId === l.id ? 'focus-line' : ''}`}>
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
          <>
            <div className="t-row"><span>Доп. расходы (сборка/доставка/прочее)</span><span>{fmtMoney(totals.extraTotal)}</span></div>
            {(totals.extraDetails ?? []).map((d, i) => (
              <div className="t-row sub" key={d.id ?? `${d.name}-${i}`}>
                <span>↳ {d.name || 'Расход'}{d.percent != null ? ` (${fmtNum(d.percent, 1)}% от суммы)` : ''}{!d.toClient ? ' · не в цене клиента' : ''}</span>
                <span>{fmtMoney(d.amount)}</span>
              </div>
            ))}
          </>
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
