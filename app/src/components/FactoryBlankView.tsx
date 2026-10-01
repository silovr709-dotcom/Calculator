import { useEffect, useMemo, useState } from 'react';
import type { Pricebook, Project } from '../types';
import { checkFactoryBlank, draftFactoryBlank, FACTORY_BLANK_SPECS, factoryBlankProgress, type BlankIssue } from '../lib/factoryBlank';
import { checkDictRules, factoryDictSuggestionGroups, loadFactoryDicts, type FactoryDicts } from '../lib/factoryDicts';
import { BACK_EDGE_NOTE, checkWorktopPlan, edgeKindLabel, suggestWorktopPlan, WORKTOP_EDGE_KINDS } from '../lib/worktopPlan';
import { lineMatchesChecklistKey } from '../lib/checklist';
import { blankCellRefLabel, blankSketchRangeLabel, exportFactoryBlankXlsx, getBlankSheetMap, type FactoryTechPack } from '../lib/factoryBlankXls';
import { buildFactoryTechCommunicationRows, buildFactoryTechModuleRows, buildFactoryTechReadinessRows, factoryTechReadinessSummary } from '../lib/factoryTechPack';
import { uid } from '../lib/storage';
import type { WorktopEdgeKind, WorktopPiece } from '../types';
import { snapshotProject } from '../lib/eskizPro';
import { renderEskizSketchPng, type EskizSketchModuleMarkerMode } from '../lib/eskizSketchExport';
import EskizProjectPreview from './EskizProjectPreview';

const NO_PIECES: WorktopPiece[] = [];

function FactoryDictPicker(props: {
  fieldKey: string;
  dicts: FactoryDicts;
  query: string;
  onQuery: (value: string) => void;
  onInsert: (value: string) => void;
}) {
  const collapsedLimit = 7;
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const groups = useMemo(
    () => factoryDictSuggestionGroups(props.fieldKey, props.dicts, props.query, 10000, props.fieldKey === 'facadeColor' ? 64 : 40),
    [props.dicts, props.fieldKey, props.query],
  );
  const isExpanded = (groupKey: string) => Boolean(expandedGroups[groupKey]);
  const toggleGroup = (groupKey: string) => setExpandedGroups((current) => ({ ...current, [groupKey]: !current[groupKey] }));
  const shown = groups.reduce((sum, group) => sum + (isExpanded(`${props.fieldKey}|${group.id}|${group.title}`) ? group.items.length : Math.min(collapsedLimit, group.items.length)), 0);
  const total = groups.reduce((sum, group) => sum + group.total, 0);
  if (total === 0 && !props.query) return null;
  const hint = props.fieldKey === 'facadeColor'
    ? 'ПВХ-плёнки, пластики/HPL (ARPA, FENIX, AGT, Rexay, ABET) и Compact Slotex — с группировкой по производителю и коллекции.'
    : props.fieldKey === 'ldspColor' || props.fieldKey === 'corpusColor'
      ? 'ЛДСП сгруппированы по производителю и категории; текстурные позиции помечены «!». '
      : 'Справочник сгруппирован по типу материала, производителю и категории.';
  return (
    <details className="dict-smart-picker">
      <summary>
        <span>+ справочник разбивок</span>
        <small>{shown} показано{total > shown ? ` · ${total} найдено` : ''}</small>
      </summary>
      <div className="dict-search-row">
        <input
          value={props.query}
          placeholder="поиск: код, цвет, Rehau, AGT, FENIX, категория…"
          onChange={(e) => props.onQuery(e.target.value)}
        />
        {props.query && <button type="button" className="btn tiny ghost" onClick={() => props.onQuery('')}>очистить</button>}
      </div>
      <div className="dict-picker-hint">{hint}</div>
      {shown === 0 ? (
        <div className="empty small">Ничего не найдено. Попробуйте код, производителя или часть названия цвета.</div>
      ) : (
        <div className="dict-group-list">
          {groups.map((group) => {
            const groupKey = `${props.fieldKey}|${group.id}|${group.title}`;
            const expanded = isExpanded(groupKey);
            const visibleItems = expanded ? group.items : group.items.slice(0, collapsedLimit);
            const hiddenCount = Math.max(0, group.items.length - visibleItems.length);
            const canExpand = group.items.length > collapsedLimit;
            return (
              <section key={`${group.id}-${group.title}`} className={`dict-group-block ${expanded ? 'expanded' : ''}`}>
                <header>
                  <button
                    type="button"
                    className={`dict-group-title ${canExpand ? 'expandable' : 'static'}`}
                    aria-expanded={expanded}
                    title={canExpand ? 'Нажмите, чтобы раскрыть/свернуть категорию' : undefined}
                    onClick={() => canExpand && toggleGroup(groupKey)}
                  >
                    <span className="dict-group-chevron">{canExpand ? (expanded ? '▾' : '▸') : '•'}</span>
                    <span>
                      <b>{group.title}</b>
                      {group.subtitle && <span>{group.subtitle}</span>}
                    </span>
                  </button>
                  <em>{group.total}</em>
                </header>
                <div className="dict-card-grid">
                  {visibleItems.map((item) => (
                    <button
                      key={`${group.id}-${item.value}`}
                      type="button"
                      className={`dict-card status-${item.status ?? 'ok'}`}
                      title={item.value}
                      onClick={() => props.onInsert(item.value)}
                    >
                      <span className="dict-card-title">{item.title}</span>
                      {item.subtitle && <span className="dict-card-subtitle">{item.subtitle}</span>}
                      {item.badges.length > 0 && (
                        <span className="dict-badges">
                          {item.badges.slice(0, 4).map((badge) => <i key={badge}>{badge}</i>)}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                {canExpand && (
                  <button type="button" className="dict-more-note" onClick={() => toggleGroup(groupKey)}>
                    {expanded ? 'Свернуть категорию' : `Показать все ${group.items.length}${hiddenCount ? ` · ещё ${hiddenCount}` : ''}`}
                  </button>
                )}
              </section>
            );
          })}
        </div>
      )}
    </details>
  );
}

/**
 * Экран «Бланк на фабрику»: Калькулятор → Автоподстановка → Ручная корректура → Проверка → Печать.
 * Поля и обязательность — из бланков и инструкций фабрики (docs прилагаются к репозиторию).
 * Автоподставленные значения не редактируют исходные данные проекта: ручные правки
 * складываются в черновик бланка (project.factoryBlankDrafts) и всегда можно вернуться к авто.
 */
export default function FactoryBlankView(props: {
  projects: Project[];
  pricebooks: Pricebook[];
  initialProjectId?: string;
  onOpenProject: (id: string) => void;
  onChangeProject: (p: Project) => void;
}) {
  const [projectId, setProjectId] = useState<string | undefined>(props.initialProjectId ?? props.projects[0]?.id);
  const [specId, setSpecId] = useState<string>(FACTORY_BLANK_SPECS[0].id);
  const [dicts, setDicts] = useState<FactoryDicts | null>(null);
  const [dictQueries, setDictQueries] = useState<Record<string, string>>({});
  const [exporting, setExporting] = useState(false);
  const [showOnlyIssues, setShowOnlyIssues] = useState(false);

  useEffect(() => {
    loadFactoryDicts(import.meta.env.BASE_URL).then(setDicts);
  }, []);

  const project = props.projects.find((p) => p.id === projectId) ?? props.projects[0];
  const spec = FACTORY_BLANK_SPECS.find((s) => s.id === specId) ?? FACTORY_BLANK_SPECS[0];
  const pricebook = project
    ? props.pricebooks.find((pb) => pb.meta.id === project.pricebookId) ?? props.pricebooks[0]
    : props.pricebooks[0];

  const draft = useMemo(
    () => (project && pricebook ? draftFactoryBlank(project, pricebook, spec) : []),
    [project, pricebook, spec],
  );
  const hasWorktopPlanSection = spec.fields.some((f) => f.autoFrom === 'worktop');
  const hasWorktopInProject = Boolean(project?.lines.some((l) => lineMatchesChecklistKey('worktop', l)));
  const pieces = project?.worktopPlan ?? NO_PIECES;
  const eskizSnapshots = useMemo(() => (project?.eskizPro?.snapshots ?? []).flatMap((snapshot) => {
    const eskizProject = snapshotProject(snapshot);
    return eskizProject ? [{ snapshot, project: eskizProject }] : [];
  }), [project]);
  const planIssues = useMemo<BlankIssue[]>(() =>
    hasWorktopPlanSection && hasWorktopInProject
      ? checkWorktopPlan(pieces, true).map((i) => ({ fieldKey: 'worktopPlan', label: 'Лист 2', level: i.level, text: i.text }))
      : []
  , [hasWorktopPlanSection, hasWorktopInProject, pieces]);

  const updatePiece = (id: string, patch: Partial<WorktopPiece>) => {
    if (!project) return;
    const next = pieces.map((piece) => (piece.id === id ? { ...piece, ...patch } : piece));
    props.onChangeProject({ ...project, worktopPlan: next });
  };

  const issues = useMemo<BlankIssue[]>(() => {
    if (!project || !pricebook) return [];
    const base = checkFactoryBlank(project, pricebook, spec, draft);
    // Проверки по правилам самих разбивок (текстура «!», выведенные/снятые позиции)
    const dict = dicts ? checkDictRules(draft, dicts) : [];
    return [...base, ...dict, ...planIssues];
  }, [project, pricebook, spec, draft, dicts, planIssues]);
  const progress = useMemo(() => factoryBlankProgress(draft), [draft]);
  const removePiece = (id: string) => {
    if (!project) return;
    props.onChangeProject({ ...project, worktopPlan: pieces.filter((piece) => piece.id !== id) });
  };
  const addPiece = () => {
    if (!project) return;
    props.onChangeProject({ ...project, worktopPlan: [...pieces, { id: uid('wp'), name: `Деталь ${pieces.length + 1}`, lengthMm: null, widthMm: null, front: null, left: null, right: null }] });
  };
  const fillPlanFromProject = () => {
    if (!project) return;
    const suggested = suggestWorktopPlan(project);
    if (suggested.length === 0) { alert('В чек-листе проекта нет столешницы — добавьте её там или нарисуйте деталь вручную.'); return; }
    if (pieces.length > 0 && !confirm('Заменить текущую схему автоподстановкой из проекта?')) return;
    props.onChangeProject({ ...project, worktopPlan: suggested });
  };

  if (!project || !pricebook) {
    return (
      <div className="page">
        <header className="page-head"><div><h1>Бланк на фабрику</h1></div></header>
        <div className="empty">Сначала создайте проект в разделе «Проекты» — бланк заполняется из данных проекта.</div>
      </div>
    );
  }

  const setDraftValue = (key: string, value: string) => {
    const drafts = { ...(project.factoryBlankDrafts ?? {}) };
    const perSpec = { ...(drafts[spec.id] ?? {}) };
    if (value === '') delete perSpec[key];
    else perSpec[key] = value;
    if (Object.keys(perSpec).length === 0) delete drafts[spec.id];
    else drafts[spec.id] = perSpec;
    props.onChangeProject({ ...project, factoryBlankDrafts: drafts });
  };
  const clearDraftValues = () => {
    if (!confirm('Удалить все ручные правки этого бланка и вернуться к автоподстановке из проекта?')) return;
    const drafts = { ...(project.factoryBlankDrafts ?? {}) };
    delete drafts[spec.id];
    props.onChangeProject({ ...project, factoryBlankDrafts: drafts });
  };
  const updateSketchSettings = (patch: NonNullable<Project['factoryBlankSketch']>) => {
    props.onChangeProject({
      ...project,
      factoryBlankSketch: { ...(project.factoryBlankSketch ?? {}), ...patch },
    });
  };
  const scrollToField = (key: string) => {
    const el = document.getElementById(`blank-field-${key}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => el.querySelector('textarea')?.focus(), 250);
  };

  const sections = [...new Set(spec.fields.map((f) => f.section))];
  const errors = issues.filter((i) => i.level === 'error');
  const warns = issues.filter((i) => i.level === 'warn');
  const sheetMap = getBlankSheetMap(spec.id);
  const hasTemplate = Boolean(sheetMap);
  const sketchSettings = project.factoryBlankSketch ?? {};
  const defaultSketchId = project.eskizPro?.activeProjectId && eskizSnapshots.some((item) => item.project.id === project.eskizPro?.activeProjectId)
    ? project.eskizPro.activeProjectId
    : eskizSnapshots[0]?.project.id;
  const selectedSketchId = sketchSettings.snapshotId && eskizSnapshots.some((item) => item.project.id === sketchSettings.snapshotId)
    ? sketchSettings.snapshotId
    : defaultSketchId;
  const selectedSketch = eskizSnapshots.find((item) => item.project.id === selectedSketchId)?.project ?? null;
  const sketchEnabled = sketchSettings.enabled ?? (eskizSnapshots.length > 0);
  const sketchMarkerMode: EskizSketchModuleMarkerMode = sketchSettings.moduleMarkerMode ?? project.eskizPro?.moduleMarkerMode ?? 'compact';
  const showSketchCommunications = sketchSettings.showCommunications ?? true;
  const showSketchCommunicationSizeBadges = project.eskizPro?.showCommunicationSizeBadges !== false && sketchSettings.showCommunicationSizeBadges !== false;
  const includeTechSheet = sketchSettings.includeTechSheet ?? true;
  const canInsertSketch = Boolean(sheetMap?.sketch && selectedSketch && sketchEnabled);
  const techModuleRows = buildFactoryTechModuleRows(project, pricebook, selectedSketch);
  const techCommunicationRows = showSketchCommunications ? buildFactoryTechCommunicationRows(project, selectedSketch, showSketchCommunicationSizeBadges) : [];
  const techReadinessRows = buildFactoryTechReadinessRows({ project, pricebook, eskizProject: selectedSketch, blankIssues: issues, includeCommunications: showSketchCommunications });
  const techSummary = factoryTechReadinessSummary(techReadinessRows);
  const issueKeys = new Set(issues.map((i) => i.fieldKey));
  const fieldKeys = new Set(draft.map((d) => d.field.key));
  const shownSections = sections
    .map((section) => ({
      section,
      fields: draft.filter((d) => d.field.section === section && (!showOnlyIssues || issueKeys.has(d.field.key) || (d.field.required && d.value.trim() === ''))),
    }))
    .filter((section) => section.fields.length > 0);

  /** Заполняет настоящий шаблон фабрики и скачивает его. */
  const downloadXlsx = async () => {
    if (errors.length > 0 && !confirm(`В бланке ${errors.length} незаполненных обязательных пунктов. Всё равно выгрузить в Excel?`)) return;
    setExporting(true);
    try {
      const sketchImage = canInsertSketch && selectedSketch && sheetMap?.sketch
        ? await renderEskizSketchPng(selectedSketch, {
          widthPx: sheetMap.sketch.targetPx.width,
          heightPx: sheetMap.sketch.targetPx.height,
          moduleMarkerMode: sketchMarkerMode,
          communications: showSketchCommunications ? (project.eskizPro?.communications ?? []) : [],
          showCommunicationSizeBadges: showSketchCommunicationSizeBadges,
          title: 'Эскиз PRO для фабрики',
          subtitle: `${selectedSketch.title} · ${selectedSketch.image.name}`,
        })
        : null;
      const techSketchImage = includeTechSheet && selectedSketch
        ? await renderEskizSketchPng(selectedSketch, {
          widthPx: 1500,
          heightPx: 900,
          moduleMarkerMode: sketchMarkerMode,
          communications: showSketchCommunications ? (project.eskizPro?.communications ?? []) : [],
          showCommunicationSizeBadges: showSketchCommunicationSizeBadges,
          title: 'Эскиз PRO — технический лист',
          subtitle: `${project.name}${project.client ? ` · ${project.client}` : ''}`,
        })
        : null;
      const techPack: FactoryTechPack | null = includeTechSheet
        ? {
          projectName: project.name,
          client: project.client,
          generatedAt: new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date()),
          sketchTitle: selectedSketch?.title,
          sketchImage: techSketchImage,
          moduleRows: techModuleRows,
          communicationRows: techCommunicationRows,
          readinessRows: techReadinessRows,
        }
        : null;
      await exportFactoryBlankXlsx({
        baseUrl: import.meta.env.BASE_URL,
        project, spec, draft, pieces,
        sketchImage,
        techPack,
      });
    } catch (e) {
      alert(`Не получилось собрать файл бланка: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="page">
      <header className="page-head no-print">
        <div>
          <h1>Бланк на фабрику</h1>
          <div className="muted">
            Фабрика → тип бланка → правила → шаблон. Поля и обязательность — из бланков и инструкций {spec.factoryName}.
          </div>
        </div>
        <div className="actions">
          <button className="btn ghost" onClick={() => props.onOpenProject(project.id)}>← К проекту</button>
          <button className="btn ghost small" onClick={() => window.print()} title={`${spec.blankName}: печать или сохранение в PDF браузером`}>🖨 Печать / PDF</button>
          <button
            className="btn primary"
            disabled={!hasTemplate || exporting}
            onClick={downloadXlsx}
            title={hasTemplate
              ? `Заполнить настоящий шаблон фабрики («${spec.blankName}») и скачать готовый файл`
              : 'Для этого бланка нет файлового шаблона'}
          >
            {exporting ? 'Собираю файл…' : '⭳ Excel — бланк заказа'}
          </button>
        </div>
      </header>

      <div className="card blank-controls no-print">
        <label>Проект
          <select value={project.id} onChange={(e) => setProjectId(e.target.value)}>
            {props.projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.client ? ` — ${p.client}` : ''}</option>)}
          </select>
        </label>
        <label>Тип бланка
          <select value={spec.id} onChange={(e) => setSpecId(e.target.value)}>
            {FACTORY_BLANK_SPECS.map((s) => <option key={s.id} value={s.id}>{s.blankName}</option>)}
          </select>
        </label>
        <span className="muted small">
          Подставлено из проекта: <b>{progress.auto}</b> · заполнено вручную: <b>{progress.draftCount}</b> · пустых: <b>{progress.empty}</b>
          {progress.requiredEmpty > 0 && <> · <b className="blank-bad">обязательных не заполнено: {progress.requiredEmpty}</b></>}
        </span>
        <div className="blank-control-actions">
          <button className={`btn tiny ${showOnlyIssues ? 'primary' : 'ghost'}`} disabled={issues.length === 0} onClick={() => setShowOnlyIssues(!showOnlyIssues)}>
            {showOnlyIssues ? 'Показать все поля' : `Только проблемные (${issues.length})`}
          </button>
          {progress.draftCount > 0 && <button className="btn tiny ghost" onClick={clearDraftValues}>Сбросить ручные правки</button>}
        </div>
      </div>

      <div className="card blank-export-preview no-print">
        <div><b>Выгрузка в официальный шаблон</b><span>{sheetMap ? `Файл: ${sheetMap.template} · лист: ${sheetMap.sheet}` : 'Для этого бланка нет Excel-шаблона'}</span></div>
        <div><b>{errors.length}</b><span>критичных ошибок</span></div>
        <div><b>{warns.length}</b><span>предупреждений</span></div>
        <div><b>{hasWorktopPlanSection ? pieces.length : '—'}</b><span>деталей столешницы на лист 2</span></div>
        <div><b>{canInsertSketch ? 'да' : '—'}</b><span>Эскиз PRO в {sheetMap ? blankSketchRangeLabel(sheetMap) || 'нет поля' : 'нет шаблона'}</span></div>
        <div><b>{includeTechSheet ? 'да' : '—'}</b><span>отдельный лист: {techModuleRows.length} модулей · {techCommunicationRows.length} коммуникаций</span></div>
      </div>

      {sheetMap?.sketch && (
        <div className="card blank-sketch-card no-print">
          <div className="blank-sketch-main">
            <div className="section-head">
              <div>
                <h3>Эскиз PRO в Excel-бланк фабрики</h3>
                <p className="muted small">Картинка попадёт в левое поле официального шаблона: <b>{blankSketchRangeLabel(sheetMap)}</b>. Можно уменьшить или скрыть маркеры модулей, чтобы ничего не перекрывало размеры.</p>
              </div>
              <label className="toggle small"><input type="checkbox" checked={sketchEnabled} onChange={(e) => updateSketchSettings({ enabled: e.target.checked })} /> вставлять в Excel</label>
            </div>
            {eskizSnapshots.length === 0 ? (
              <div className="empty small">В проекте пока нет snapshot Эскиз PRO. Откройте проект, добавьте/обновите эскиз — после этого он будет вставляться в бланк.</div>
            ) : (
              <div className="blank-sketch-controls">
                <label>Эскиз
                  <select value={selectedSketchId ?? ''} disabled={!sketchEnabled} onChange={(e) => updateSketchSettings({ snapshotId: e.target.value || null })}>
                    {eskizSnapshots.map((item) => <option key={item.project.id} value={item.project.id}>{item.project.title} · {item.project.image.name}</option>)}
                  </select>
                </label>
                <label>Маркеры модулей
                  <select value={sketchMarkerMode} disabled={!sketchEnabled} onChange={(e) => updateSketchSettings({ moduleMarkerMode: e.target.value as EskizSketchModuleMarkerMode })}>
                    <option value="compact">Компактные точки</option>
                    <option value="hidden">Скрыть маркеры</option>
                    <option value="full">Полные плашки</option>
                  </select>
                </label>
                <label className="toggle"><input type="checkbox" checked={showSketchCommunications} onChange={(e) => updateSketchSettings({ showCommunications: e.target.checked })} /> коммуникации и расстояния</label>
                <label className="toggle"><input type="checkbox" checked={showSketchCommunicationSizeBadges} disabled={!sketchEnabled || !showSketchCommunications || project.eskizPro?.showCommunicationSizeBadges === false} onChange={(e) => updateSketchSettings({ showCommunicationSizeBadges: e.target.checked })} /> габариты/высоты рядом с коммуникациями</label>
                <label className="toggle"><input type="checkbox" checked={includeTechSheet} onChange={(e) => updateSketchSettings({ includeTechSheet: e.target.checked })} /> отдельный лист «Эскиз PRO + расшифровка»</label>
              </div>
            )}
            {includeTechSheet && (
              <div className={`blank-tech-summary ${techSummary.errors > 0 ? 'bad' : techSummary.warnings > 0 ? 'warn' : 'ok'}`}>
                <b>{techSummary.errors > 0 ? 'Нужна проверка перед фабрикой' : techSummary.warnings > 0 ? 'Можно выгружать, но есть предупреждения' : 'Техлист готов'}</b>
                <span>{techSummary.errors} ошибок · {techSummary.warnings} предупреждений · {techModuleRows.length} строк модулей · {techCommunicationRows.length} коммуникаций</span>
              </div>
            )}
          </div>
          {selectedSketch && sketchEnabled ? (
            <div className="blank-sketch-preview">
              <EskizProjectPreview
                project={selectedSketch}
                compact
                moduleMarkerMode={sketchMarkerMode}
                communicationMarkers={showSketchCommunications ? (project.eskizPro?.communications ?? []) : []}
                showCommunicationSizeBadges={showSketchCommunicationSizeBadges}
              />
            </div>
          ) : (
            <div className="blank-sketch-placeholder">Эскиз не будет вставлен в Excel.</div>
          )}
        </div>
      )}

      {sheetMap && !sheetMap.sketch && eskizSnapshots.length > 0 && (
        <div className="card blank-sketch-card no-print">
          <div className="blank-sketch-main">
            <b>Эскиз PRO найден, но у выбранного шаблона нет отдельного левого поля под картинку.</b>
            <span className="muted small">Для кухонного бланка Висма картинка вставляется в A14:I47. В этом шаблоне не накладываю её поверх официальных полей, зато могу добавить отдельный лист «Эскиз PRO» с крупным эскизом, модулями, коммуникациями и проверками.</span>
            <label className="toggle"><input type="checkbox" checked={includeTechSheet} onChange={(e) => updateSketchSettings({ includeTechSheet: e.target.checked })} /> добавить отдельный лист «Эскиз PRO + расшифровка»</label>
            {includeTechSheet && <div className={`blank-tech-summary ${techSummary.errors > 0 ? 'bad' : techSummary.warnings > 0 ? 'warn' : 'ok'}`}><b>{techSummary.errors > 0 ? 'Нужна проверка перед фабрикой' : techSummary.warnings > 0 ? 'Есть предупреждения' : 'Техлист готов'}</b><span>{techSummary.errors} ошибок · {techSummary.warnings} предупреждений · {techModuleRows.length} строк модулей · {techCommunicationRows.length} коммуникаций</span></div>}
          </div>
          {selectedSketch && includeTechSheet && <div className="blank-sketch-preview"><EskizProjectPreview project={selectedSketch} compact moduleMarkerMode={sketchMarkerMode} communicationMarkers={showSketchCommunications ? (project.eskizPro?.communications ?? []) : []} showCommunicationSizeBadges={showSketchCommunicationSizeBadges} /></div>}
        </div>
      )}

      {issues.length > 0 && (
        <div className="card blank-issues no-print">
          <h3>Проверка перед отправкой на фабрику</h3>
          <div className="muted small">Мы не исправляем ваши данные молча — проверьте и поправьте сами (в проекте или в полях ниже).</div>
          <ul>
            {errors.map((i) => <li key={`${i.fieldKey}-${i.text}`} className="blank-issue err"><span>🔴 {i.text}</span>{fieldKeys.has(i.fieldKey) && <button className="btn tiny ghost" onClick={() => scrollToField(i.fieldKey)}>к полю</button>}</li>)}
            {warns.map((i) => <li key={`${i.fieldKey}-${i.text}`} className="blank-issue warn"><span>🟡 {i.text}</span>{fieldKeys.has(i.fieldKey) && <button className="btn tiny ghost" onClick={() => scrollToField(i.fieldKey)}>к полю</button>}</li>)}
          </ul>
        </div>
      )}
      {issues.length === 0 && (
        <div className="card blank-issues ok no-print">
          <span className="blank-issue ok">✅ Обязательные поля заполнены, противоречий с проектом нет. Проверьте бланк глазами перед печатью.</span>
        </div>
      )}

      {/* Редактируемый бланк: каждая секция — как на бумажном бланке фабрики */}
      {shownSections.map(({ section, fields }) => (
        <div className="card blank-section" key={section}>
          <h3>{section}</h3>
          <div className="blank-grid">
            {fields.map((d) => {
              const cellLabel = sheetMap ? blankCellRefLabel(sheetMap, d.field.key) : '';
              const hasIssue = issueKeys.has(d.field.key) || (d.field.required && d.value.trim() === '');
              return (
              <label id={`blank-field-${d.field.key}`} key={d.field.key} className={`blank-field src-${d.source}${d.field.required ? ' required' : ''}${hasIssue ? ' has-issue' : ''}`}>
                <span className="blank-label">
                  {d.field.label}
                  {d.field.required && <span className="blank-req" title="Обязательное поле по инструкции фабрики">*</span>}
                  {cellLabel && <span className="blank-cell" title="Клетка в официальном шаблоне Excel">{cellLabel}</span>}
                  <span className={`blank-src ${d.source}`} title={
                    d.source === 'project' ? 'Подставлено автоматически из проекта'
                      : d.source === 'draft' ? 'Заполнено вручную (черновик бланка)'
                        : 'Не заполнено'
                  }>
                    {d.source === 'project' ? '⚙ авто' : d.source === 'draft' ? '✍ вручную' : '—'}
                  </span>
                  {d.source === 'draft' && <button type="button" className="blank-reset" onClick={() => setDraftValue(d.field.key, '')}>вернуть авто</button>}
                </span>
                <textarea
                  rows={Math.min(3, 1 + Math.floor(d.value.length / 60))}
                  value={d.value}
                  placeholder={d.field.expected === 'dict' ? 'по разбивке/прайсу фабрики…' : 'заполнить…'}
                  onChange={(e) => setDraftValue(d.field.key, e.target.value)}
                />
                {d.field.expected === 'dict' && dicts && (
                  <FactoryDictPicker
                    fieldKey={d.field.key}
                    dicts={dicts}
                    query={dictQueries[d.field.key] ?? ''}
                    onQuery={(value) => setDictQueries((prev) => ({ ...prev, [d.field.key]: value }))}
                    onInsert={(value) => setDraftValue(d.field.key, d.value.trim() === '' ? value : `${d.value.replace(/[;\s]+$/, '')}; ${value}`)}
                  />
                )}
                {d.field.hint && <span className="muted small">{d.field.hint}</span>}
              </label>
              );
            })}
          </div>
        </div>
      ))}

      {hasWorktopPlanSection && (
        <div className="card blank-section no-print">
          <h3>Лист 2 — схема столешницы</h3>
          <div className="muted small">
            Обязателен при столешницах: отметьте обработку видимых кромок. {BACK_EDGE_NOTE}.
          </div>
          <div className="blank-plan-actions">
            <button className="btn tiny ghost" onClick={fillPlanFromProject}>⚙ Заполнить из проекта</button>
            <button className="btn tiny ghost" onClick={addPiece}>+ Деталь</button>
          </div>
          {pieces.length === 0 ? (
            <div className="empty small">Деталей пока нет — добавьте вручную или заполните из проекта.</div>
          ) : (
            <table className="table blank-plan-table">
              <thead>
                <tr><th>Деталь</th><th>Длина, мм</th><th>Ширина, мм</th><th>Перед</th><th>Левый торец</th><th>Правый / стык</th><th /></tr>
              </thead>
              <tbody>
                {pieces.map((piece) => (
                  <tr key={piece.id}>
                    <td><input value={piece.name} onChange={(e) => updatePiece(piece.id, { name: e.target.value })} /></td>
                    <td><input type="number" min={1} value={piece.lengthMm ?? ''} onChange={(e) => updatePiece(piece.id, { lengthMm: e.target.value ? Number(e.target.value) : null })} /></td>
                    <td><input type="number" min={1} value={piece.widthMm ?? ''} onChange={(e) => updatePiece(piece.id, { widthMm: e.target.value ? Number(e.target.value) : null })} /></td>
                    {(['front', 'left', 'right'] as const).map((side) => (
                      <td key={side}>
                        <select value={piece[side] ?? ''} onChange={(e) => updatePiece(piece.id, { [side]: (e.target.value || null) as WorktopEdgeKind | null })}>
                          <option value="">—</option>
                          {WORKTOP_EDGE_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                        </select>
                      </td>
                    ))}
                    <td><button className="btn tiny danger" title="Убрать деталь" onClick={() => removePiece(piece.id)}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Печатная форма: компактная таблица «пункт → значение» как на бланке */}
      <div className="blank-print">
        <h2>{spec.blankName}</h2>
        <div className="muted small">Проект: {project.name}{project.client ? ` · Клиент: ${project.client}` : ''}</div>
        {sections.map((section) => (
          <table key={section} className="blank-print-table">
            <thead><tr><th colSpan={2}>{section}</th></tr></thead>
            <tbody>
              {draft.filter((d) => d.field.section === section).map((d) => (
                <tr key={d.field.key}>
                  <td className="blank-print-label">{d.field.label}{d.field.required ? ' *' : ''}</td>
                  <td>{d.value.trim() === '' ? '—' : d.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
        {hasWorktopPlanSection && pieces.length > 0 && (
          <table className="blank-print-table">
            <thead><tr><th colSpan={7}>Лист 2 — схема столешницы (виды обработки видимых частей)</th></tr>
              <tr><th>Деталь</th><th>Длина, мм</th><th>Ширина, мм</th><th>Перед</th><th>Левый торец</th><th>Правый / стык</th><th>Зад</th></tr></thead>
            <tbody>
              {pieces.map((piece) => (
                <tr key={piece.id}>
                  <td>{piece.name}</td>
                  <td>{piece.lengthMm ?? ''}</td>
                  <td>{piece.widthMm ?? ''}</td>
                  <td>{edgeKindLabel(piece.front)}</td>
                  <td>{edgeKindLabel(piece.left)}</td>
                  <td>{edgeKindLabel(piece.right)}</td>
                  <td>ПВХ 0,4 белая</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="muted small">{BACK_EDGE_NOTE}.</div>
        <div className="muted small">* — обязательные поля по инструкции фабрики. Заказ запускается только по подтверждённому бланку.</div>
      </div>
    </div>
  );
}
