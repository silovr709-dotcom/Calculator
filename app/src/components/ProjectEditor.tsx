import { useEffect, useMemo, useState } from 'react';
import type { Pricebook, Project, ProjectLine, PriceItem, LineParams, Template, KitchenModule } from '../types';
import { SUMMARY_GROUPS } from '../types';
import { calcTotals, lineFromItem } from '../lib/engine';
import { fmtMoney, fmtNum, fmtDate } from '../lib/format';
import CatalogPicker from './CatalogPicker';
import ModulesPanel from './ModulesPanel';
import EskizProPanel from './EskizProPanel';
import PhotosPanel from './PhotosPanel';
import { checkModule, moduleToLines } from '../lib/modules';
import { validateProject } from '../lib/validation';
import SettingsPanel from './SettingsPanel';
import ClientView from './ClientView';
import KitchenWizard from './KitchenWizard';
import ProjectCheckCenter from './ProjectCheckCenter';
import VariantsPanel from './VariantsPanel';
import MeasurementPanel from './MeasurementPanel';
import KitchenChecklistPanel from './KitchenChecklistPanel';
import OrderCenterPanel from './OrderCenterPanel';
import { exportInternalXlsx, exportClientXlsx, exportInternalCsv, exportProjectJson } from '../lib/exporters';
import QRCode from 'qrcode';
import { makeProjectQrShare } from '../lib/sync';

type ProjectTab = 'modules' | 'sketch' | 'order' | 'lines' | 'photos' | 'settings' | 'client' | 'check' | 'variants' | 'measurement';
type ProjectStage = 'composition' | 'eskiz' | 'check' | 'client' | 'order';
type ReadinessStatus = 'ready' | 'warning' | 'error' | 'idle';

const PROJECT_STAGE_LABELS: Record<ProjectStage, { label: string; hint: string; step: string }> = {
  composition: { label: 'Состав', hint: 'модули, доп. позиции, варианты и цена', step: '1' },
  eskiz: { label: 'Эскиз / замер', hint: 'Эскиз PRO, замер и фото', step: '2' },
  check: { label: 'Проверка', hint: 'ошибки, предупреждения и рекомендации', step: '3' },
  client: { label: 'Клиент', hint: 'КП, эскиз, договор и чек', step: '4' },
  order: { label: 'Заказ', hint: 'CRM, закупка и фабрика', step: '5' },
};

const PROJECT_STAGE_ORDER: ProjectStage[] = ['composition', 'eskiz', 'check', 'client', 'order'];
const PROJECT_STAGE_DEFAULT_TAB: Record<ProjectStage, ProjectTab> = {
  composition: 'modules',
  eskiz: 'sketch',
  check: 'check',
  client: 'client',
  order: 'order',
};

function stageForTab(tab: ProjectTab): ProjectStage {
  if (tab === 'modules' || tab === 'lines' || tab === 'variants' || tab === 'settings') return 'composition';
  if (tab === 'sketch' || tab === 'measurement' || tab === 'photos') return 'eskiz';
  if (tab === 'client') return 'client';
  if (tab === 'order') return 'order';
  return 'check';
}

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
  const [tab, setTab] = useState<ProjectTab>(
    () => ((project.modules?.length ?? 0) > 0 || project.lines.length === 0 ? 'modules' : 'lines'),
  );
  const [editorMode, setEditorMode] = useState<'wizard' | 'advanced'>(() => project.wizardMode ?? 'advanced');
  const [focusModuleId, setFocusModuleId] = useState<string | null>(null);
  const [focusLineId, setFocusLineId] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [editMeta, setEditMeta] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrUrl, setQrUrl] = useState('');
  const [qrShareUrl, setQrShareUrl] = useState('');
  const [qrStatus, setQrStatus] = useState('');
  const [qrError, setQrError] = useState('');

  useEffect(() => {
    let alive = true;
    if (!showQrModal) return () => { alive = false; };

    const generate = async () => {
      setQrUrl('');
      setQrShareUrl('');
      setQrError('');
      setQrStatus('Готовим QR-ссылку проекта…');
      try {
        const share = await makeProjectQrShare(project);
        if (!alive) return;
        const url = await QRCode.toDataURL(share.url, {
          width: 320,
          margin: 4,
          errorCorrectionLevel: share.urlLength > 1800 ? 'L' : 'M',
          color: { dark: '#092a55', light: '#ffffff' },
        });
        if (!alive) return;
        setQrUrl(url);
        setQrShareUrl(share.url);
        setQrStatus(share.note);
      } catch (error) {
        if (!alive) return;
        setQrError((error as Error).message || 'Не удалось создать QR-код проекта');
        setQrStatus('');
      }
    };

    generate();
    return () => { alive = false; };
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
  const moduleCount = project.modules?.length ?? 0;
  const sketchCount = project.eskizPro?.snapshots?.length ?? 0;
  const photoCount = project.photos?.length ?? 0;
  const variantCount = project.variants?.length ?? 0;
  const hasMeasurement = Boolean(project.measurement);
  const unresolvedCriticals = projectValidation.errors.length + moduleCriticals;
  const unresolvedWarnings = projectValidation.warnings.length;
  const activeStage = stageForTab(tab);
  const orderStatusLabels: Record<Project['status'], string> = { draft: 'черновик', sent: 'КП отправлено', approved: 'согласован', archived: 'архив' };

  const openProjectTab = (nextTab: ProjectTab) => {
    setTab(nextTab);
    if (editorMode !== 'advanced') setEditorMode('advanced');
    if (project.wizardMode !== 'advanced') props.onChange({ ...project, wizardMode: 'advanced' });
  };
  const openStage = (stage: ProjectStage) => openProjectTab(PROJECT_STAGE_DEFAULT_TAB[stage]);
  const nextAction = moduleCount === 0
    ? { label: 'Добавить модули', tab: 'modules' as ProjectTab, hint: 'Начните с состава кухни: корпуса, фасады, фурнитура.' }
    : moduleCriticals > 0
      ? { label: 'Заполнить модули', tab: 'modules' as ProjectTab, hint: 'Есть обязательные параметры модулей, которые не входят в цену.' }
      : sketchCount === 0
        ? { label: 'Открыть Эскиз PRO', tab: 'sketch' as ProjectTab, hint: 'Добавьте скрин, размеры, маркеры модулей и коммуникации.' }
        : unresolvedCriticals > 0 || unresolvedWarnings > 0
          ? { label: 'Открыть проверку', tab: 'check' as ProjectTab, hint: 'Закройте ошибки и подтвердите предупреждения перед КП/фабрикой.' }
          : project.status === 'draft'
            ? { label: 'Собрать КП клиенту', tab: 'client' as ProjectTab, hint: 'Сформируйте клиентский пакет: эскиз, КП, договор и чек.' }
            : { label: 'Перейти к заказу', tab: 'order' as ProjectTab, hint: 'Контроль статуса, закупки, версий КП и передачи на фабрику.' };
  const readinessItems: { key: ProjectStage; label: string; value: string; status: ReadinessStatus; tab: ProjectTab }[] = [
    {
      key: 'composition',
      label: 'Состав',
      value: moduleCount > 0 ? `${moduleCount} модулей${project.lines.length ? ` + ${project.lines.length} доп.` : ''}` : project.lines.length ? `${project.lines.length} доп. строк` : 'нужно заполнить',
      status: moduleCount === 0 ? 'warning' : moduleCriticals > 0 ? 'error' : 'ready',
      tab: 'modules',
    },
    {
      key: 'eskiz',
      label: 'Эскиз / замер',
      value: [sketchCount ? `${sketchCount} эскизов` : '', hasMeasurement ? 'замер' : '', photoCount ? `${photoCount} фото` : ''].filter(Boolean).join(' · ') || 'ещё пусто',
      status: sketchCount > 0 || hasMeasurement || photoCount > 0 ? 'ready' : 'warning',
      tab: 'sketch',
    },
    {
      key: 'check',
      label: 'Проверка',
      value: unresolvedCriticals > 0 ? `${unresolvedCriticals} критично` : unresolvedWarnings > 0 ? `${unresolvedWarnings} предупрежд.` : 'готово',
      status: unresolvedCriticals > 0 ? 'error' : unresolvedWarnings > 0 ? 'warning' : 'ready',
      tab: 'check',
    },
    {
      key: 'client',
      label: 'Клиент',
      value: project.clientOffer ? 'КП настроено' : 'документы готовы к сборке',
      status: unresolvedCriticals > 0 ? 'idle' : 'ready',
      tab: 'client',
    },
    {
      key: 'order',
      label: 'Заказ',
      value: orderStatusLabels[project.status],
      status: project.status === 'approved' || project.status === 'sent' ? 'ready' : project.status === 'archived' ? 'idle' : 'warning',
      tab: 'order',
    },
  ];
  const subTabs: { tab: ProjectTab; label: string; badge?: string | number; hint?: string }[] = activeStage === 'composition'
    ? [
      { tab: 'modules', label: 'Модули кухни', badge: moduleCount || undefined, hint: 'основной состав' },
      { tab: 'lines', label: 'Доп. позиции', badge: project.lines.length || undefined, hint: 'столешницы, мойки, работы' },
      { tab: 'variants', label: 'Варианты', badge: variantCount || undefined, hint: 'сравнение комплектаций' },
      { tab: 'settings', label: 'Наценка и расходы', hint: 'цена проекта' },
    ]
    : activeStage === 'eskiz'
      ? [
        { tab: 'sketch', label: 'Эскиз PRO', badge: sketchCount || undefined, hint: 'основное полотно' },
        { tab: 'measurement', label: 'Замер', hint: 'данные помещения' },
        { tab: 'photos', label: 'Фото', badge: photoCount || undefined, hint: 'замеры и объект' },
      ]
      : activeStage === 'check'
        ? [{ tab: 'check', label: 'Центр проверки', badge: unresolvedCriticals || unresolvedWarnings || undefined, hint: 'ошибки и рекомендации' }]
        : activeStage === 'client'
          ? [{ tab: 'client', label: 'КП и документы', hint: 'эскиз, КП, договор, чек, ZIP' }]
          : [{ tab: 'order', label: 'Центр заказа', hint: 'статус, закупка, фабрика' }];
  const activeStageMeta = PROJECT_STAGE_LABELS[activeStage];
  const activeSubTab = subTabs.find((item) => item.tab === tab) ?? subTabs[0];
  const activeStageIndex = PROJECT_STAGE_ORDER.indexOf(activeStage);
  const previousStage = activeStageIndex > 0 ? PROJECT_STAGE_ORDER[activeStageIndex - 1] : null;
  const nextStage = activeStageIndex < PROJECT_STAGE_ORDER.length - 1 ? PROJECT_STAGE_ORDER[activeStageIndex + 1] : null;
  const projectPulseItems = [
    { label: 'Клиент', value: project.client || 'не указан' },
    { label: 'Состав', value: moduleCount ? `${moduleCount} мод.` : project.lines.length ? `${project.lines.length} доп.` : 'пусто' },
    { label: 'КП', value: fmtMoney(totals.client) },
    { label: 'Проверка', value: unresolvedCriticals ? `${unresolvedCriticals} ошибок` : unresolvedWarnings ? `${unresolvedWarnings} пред.` : 'OK' },
  ];

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
        <div className="actions project-head-actions">
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
            <button className="btn ghost">Документы / экспорт ▾</button>
            <div className="dropdown-menu">
              <button onClick={() => exportInternalXlsx(outProject)}>Excel — внутренний расчёт</button>
              <button onClick={() => exportClientXlsx(outProject)}>Excel — коммерческое предложение</button>
              <button onClick={() => exportInternalCsv(outProject)}>CSV — внутренний расчёт</button>
              <button onClick={() => exportProjectJson(project)}>Файл проекта (.json)</button>
              <button onClick={() => setShowQrModal(true)}>Открыть на телефоне (QR-код)</button>
            </div>
          </div>
          {props.onOpenFactoryBlank && (
            <button className="btn ghost" title="Калькулятор → данные проекта → бланк → проверка → документ" onClick={props.onOpenFactoryBlank}>Бланк на фабрику</button>
          )}
          <div className="dropdown">
            <button className="btn ghost">Ещё ▾</button>
            <div className="dropdown-menu">
              <button onClick={props.onDuplicate}>Дублировать проект</button>
              <button onClick={() => { const n = prompt('Название шаблона:', project.name); if (n) props.onSaveTemplate(n); }}>Сохранить как шаблон</button>
              <button className="danger-menu-item" onClick={props.onDelete}>Удалить проект</button>
            </div>
          </div>
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
            {qrStatus && <div className="muted small" style={{ marginBottom: 10 }}>{qrStatus}</div>}
            {qrError && <div className="warn-box" style={{ marginBottom: 10, textAlign: 'left' }}>{qrError}</div>}
            {qrUrl ? (
              <div className="qr-container">
                <img src={qrUrl} alt="QR-код проекта" className="qr-image" style={{ width: 300, height: 300 }} />
                <div className="qr-hint">Откройте камеру телефона, наведите на весь белый квадрат и перейдите по ссылке. Проект импортируется автоматически.</div>
                {qrShareUrl && (
                  <div className="sync-url-box" style={{ marginTop: 10 }}>
                    <input readOnly value={qrShareUrl} className="sync-url-input" />
                    <button className="btn small ghost" type="button" onClick={() => navigator.clipboard.writeText(qrShareUrl)}>Копировать</button>
                  </div>
                )}
              </div>
            ) : (
              <div className="pad muted">{qrError ? 'QR-код не создан.' : 'Генерация QR-кода…'}</div>
            )}
            <div className="modal-actions" style={{ justifyContent: 'center', marginTop: 18 }}>
              <button className="btn primary" onClick={() => setShowQrModal(false)}>Закрыть</button>
            </div>
          </div>
        </div>
      )}

      <section className="project-readiness-panel no-print" aria-label="Готовность проекта">
        <div className="project-readiness-main">
          <span className="eyebrow">Маршрут проекта</span>
          <h2>{unresolvedCriticals > 0 ? 'Проект требует доработки' : unresolvedWarnings > 0 ? 'Проект почти готов' : 'Проект готов к следующему шагу'}</h2>
          <p>{nextAction.hint}</p>
        </div>
        <div className="project-readiness-steps">
          {readinessItems.map((item) => (
            <button key={item.key} type="button" className={`project-readiness-step ${item.status} ${activeStage === item.key ? 'active' : ''}`} onClick={() => openProjectTab(item.tab)}>
              <span>{item.label}</span>
              <b>{item.value}</b>
            </button>
          ))}
        </div>
        <button type="button" className="btn primary project-next-action" onClick={() => openProjectTab(nextAction.tab)}>{nextAction.label}</button>
      </section>

      <div className="editor-mode-bar no-print">
        <div><b>{editorMode === 'wizard' ? 'Мастер сборки' : 'Рабочий маршрут'}</b><span className="muted small"> {editorMode === 'wizard' ? ' · шаги проведут по обязательным данным' : ' · Состав → Эскиз/замер → Проверка → Клиент → Заказ'}</span></div>
        <button className="btn tiny ghost" onClick={() => { const next = editorMode === 'wizard' ? 'advanced' : 'wizard'; setEditorMode(next); props.onChange({ ...project, wizardMode: next }); }}>{editorMode === 'wizard' ? 'Перейти к маршруту' : 'Открыть мастер'}</button>
      </div>
      {editorMode === 'wizard' ? (
        <KitchenWizard
          project={project}
          pricebook={pricebook}
          onChange={props.onChange}
          onSelectModule={(id) => { setFocusModuleId(id); setEditorMode('advanced'); setTab('modules'); }}
          onOpenAdvanced={() => { setEditorMode('advanced'); props.onChange({ ...project, wizardMode: 'advanced' }); }}
        />
      ) : (
      <div className="project-workspace-frame">
        <aside className="project-flow-rail no-print" aria-label="Навигация проекта">
          <div className="project-flow-title">
            <span className="eyebrow">Проект</span>
            <b>{activeStageMeta.label}</b>
            <small>{activeSubTab?.label}</small>
          </div>
          <nav className="project-stage-nav compact" aria-label="Этапы проекта">
            {PROJECT_STAGE_ORDER.map((stage) => {
              const meta = PROJECT_STAGE_LABELS[stage];
              const item = readinessItems.find((entry) => entry.key === stage);
              return <button key={stage} type="button" className={`${activeStage === stage ? 'active' : ''} ${item?.status ?? ''}`} onClick={() => openStage(stage)}>
                <i>{meta.step}</i><span>{meta.label}<small>{item?.value ?? meta.hint}</small></span>
              </button>;
            })}
          </nav>
          <div className="project-flow-subtabs" aria-label="Разделы этапа">
            {subTabs.map((item) => <button key={item.tab} type="button" className={tab === item.tab ? 'active' : ''} onClick={() => openProjectTab(item.tab)}>
              <span>{item.label}{item.badge ? <b>{item.badge}</b> : null}</span>{item.hint && <small>{item.hint}</small>}
            </button>)}
          </div>
          <div className="project-flow-actions">
            <button type="button" className="btn primary small" onClick={() => openProjectTab(nextAction.tab)}>{nextAction.label}</button>
            <div>
              {previousStage && <button type="button" className="btn tiny ghost" onClick={() => openStage(previousStage)}>← {PROJECT_STAGE_LABELS[previousStage].label}</button>}
              {nextStage && <button type="button" className="btn tiny ghost" onClick={() => openStage(nextStage)}>{PROJECT_STAGE_LABELS[nextStage].label} →</button>}
            </div>
          </div>
        </aside>
        <section className="project-work-area">
          <div className="project-mobile-switcher no-print">
            <label>Этап<select value={activeStage} onChange={(event) => openStage(event.target.value as ProjectStage)}>{PROJECT_STAGE_ORDER.map((stage) => <option key={stage} value={stage}>{PROJECT_STAGE_LABELS[stage].step}. {PROJECT_STAGE_LABELS[stage].label}</option>)}</select></label>
            <label>Раздел<select value={tab} onChange={(event) => openProjectTab(event.target.value as ProjectTab)}>{subTabs.map((item) => <option key={item.tab} value={item.tab}>{item.label}{item.badge ? ` (${item.badge})` : ''}</option>)}</select></label>
            <button type="button" className="btn primary small" onClick={() => openProjectTab(nextAction.tab)}>{nextAction.label}</button>
          </div>
          <div className="project-section-head no-print">
            <div>
              <span className="eyebrow">{activeStageMeta.step}. {activeStageMeta.label}</span>
              <h2>{activeSubTab?.label ?? activeStageMeta.label}</h2>
              <p>{activeSubTab?.hint ?? activeStageMeta.hint}</p>
            </div>
            <div className="project-pulse-strip">
              {projectPulseItems.map((item) => <span key={item.label}><b>{item.value}</b><small>{item.label}</small></span>)}
            </div>
          </div>

      {tab === 'photos' && <PhotosPanel project={project} onChange={props.onChange} />}

      {tab === 'sketch' && <EskizProPanel project={project} pricebook={pricebook} onChange={props.onChange} onOpenModule={(id) => { setFocusModuleId(id); setTab('modules'); }} />}

      {tab === 'check' && (
        <>
          <KitchenChecklistPanel project={project} pricebook={pricebook} onChange={props.onChange} />
          <ProjectCheckCenter
            project={project}
            pricebook={pricebook}
            onChange={props.onChange}
            onSelectModule={(id) => { setFocusModuleId(id); setTab('modules'); }}
            onSelectLine={(id) => { setFocusLineId(id); setTab('lines'); window.setTimeout(() => document.getElementById(`project-line-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0); }}
          />
        </>
      )}

      {tab === 'order' && (
        <OrderCenterPanel
          project={project}
          pricebook={pricebook}
          onChange={props.onChange}
          onOpenClient={() => setTab('client')}
          onOpenSketch={() => setTab('sketch')}
          onOpenCheck={() => setTab('check')}
          onOpenFactoryBlank={props.onOpenFactoryBlank}
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
            onEskizProChange={(eskizPro) => props.onChange({ ...project, eskizPro })}
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

        </section>
      </div>)}

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
      <tr className="group-row"><td colSpan={6}>{props.group}</td><td className="num" data-label="Итого"><b>{fmtMoney(props.groupTotal.cost)}</b></td><td /></tr>
      {props.lines.map((l) => {
        const c = props.lineCalcs.get(l.id);
        return (
          <tr id={`project-line-${l.id}`} key={l.id} className={`${c?.warning ? 'has-warn' : ''} ${props.focusLineId === l.id ? 'focus-line' : ''}`}>
            <td className="muted small" data-label="Категория">{l.category}</td>
            <td data-label="Позиция">
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
            <td className="muted small" data-label="Арт.">{l.article ?? '—'}</td>
            <td className="num" data-label="Кол-во">
              <input
                className="qty"
                type="number"
                step={l.priceBasis === 'sheet' ? 0.5 : 1}
                min={0}
                value={l.qty}
                onChange={(e) => props.updLine(l.id, { qty: Number(e.target.value) || 0 })}
              />
            </td>
            <td className="small" data-label="Ед.">{l.unit ?? '—'}</td>
            <td className="num" data-label="Цена">{l.priceKind === 'percent' ? `+${l.price}%` : fmtMoney(l.price)}</td>
            <td className="num" data-label="Сумма"><b>{c?.sum != null ? fmtMoney(c.sum) : '—'}</b></td>
            <td data-label="Действия"><button className="btn tiny danger" title="Удалить строку" onClick={() => props.delLine(l.id)}>✕</button></td>
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
