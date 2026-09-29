import { useEffect, useMemo, useState } from 'react';
import type { Pricebook, Project } from '../types';
import { checkFactoryBlank, draftFactoryBlank, FACTORY_BLANK_SPECS, factoryBlankProgress, type BlankIssue } from '../lib/factoryBlank';
import { checkDictRules, dictSuggestions, loadFactoryDicts, type FactoryDicts } from '../lib/factoryDicts';
import { BACK_EDGE_NOTE, checkWorktopPlan, edgeKindLabel, suggestWorktopPlan, WORKTOP_EDGE_KINDS } from '../lib/worktopPlan';
import { lineMatchesChecklistKey } from '../lib/checklist';
import { exportFactoryBlankXlsx, getBlankSheetMap } from '../lib/factoryBlankXls';
import { uid } from '../lib/storage';
import type { WorktopEdgeKind, WorktopPiece } from '../types';

const NO_PIECES: WorktopPiece[] = [];

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
  const [exporting, setExporting] = useState(false);

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

  const sections = [...new Set(spec.fields.map((f) => f.section))];
  const errors = issues.filter((i) => i.level === 'error');
  const warns = issues.filter((i) => i.level === 'warn');
  const hasTemplate = Boolean(getBlankSheetMap(spec.id));

  /** Заполняет настоящий шаблон фабрики и скачивает его. */
  const downloadXlsx = async () => {
    if (errors.length > 0 && !confirm(`В бланке ${errors.length} незаполненных обязательных пунктов. Всё равно выгрузить в Excel?`)) return;
    setExporting(true);
    try {
      await exportFactoryBlankXlsx({
        baseUrl: import.meta.env.BASE_URL,
        project, spec, draft, pieces,
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
      </div>

      {issues.length > 0 && (
        <div className="card blank-issues no-print">
          <h3>Проверка перед отправкой на фабрику</h3>
          <div className="muted small">Мы не исправляем ваши данные молча — проверьте и поправьте сами (в проекте или в полях ниже).</div>
          <ul>
            {errors.map((i) => <li key={`${i.fieldKey}-${i.text}`} className="blank-issue err">🔴 {i.text}</li>)}
            {warns.map((i) => <li key={`${i.fieldKey}-${i.text}`} className="blank-issue warn">🟡 {i.text}</li>)}
          </ul>
        </div>
      )}
      {issues.length === 0 && (
        <div className="card blank-issues ok no-print">
          <span className="blank-issue ok">✅ Обязательные поля заполнены, противоречий с проектом нет. Проверьте бланк глазами перед печатью.</span>
        </div>
      )}

      {/* Редактируемый бланк: каждая секция — как на бумажном бланке фабрики */}
      {sections.map((section) => (
        <div className="card blank-section" key={section}>
          <h3>{section}</h3>
          <div className="blank-grid">
            {draft.filter((d) => d.field.section === section).map((d) => (
              <label key={d.field.key} className={`blank-field src-${d.source}${d.field.required ? ' required' : ''}`}>
                <span className="blank-label">
                  {d.field.label}
                  {d.field.required && <span className="blank-req" title="Обязательное поле по инструкции фабрики">*</span>}
                  <span className={`blank-src ${d.source}`} title={
                    d.source === 'project' ? 'Подставлено автоматически из проекта'
                      : d.source === 'draft' ? 'Заполнено вручную (черновик бланка)'
                        : 'Не заполнено'
                  }>
                    {d.source === 'project' ? '⚙ авто' : d.source === 'draft' ? '✍ вручную' : '—'}
                  </span>
                </span>
                <textarea
                  rows={Math.min(3, 1 + Math.floor(d.value.length / 60))}
                  value={d.value}
                  placeholder={d.field.expected === 'dict' ? 'по разбивке/прайсу фабрики…' : 'заполнить…'}
                  onChange={(e) => setDraftValue(d.field.key, e.target.value)}
                />
                {d.field.expected === 'dict' && dicts && dictSuggestions(d.field.key, dicts, 60).length > 0 && (
                  <select
                    className="dict-picker"
                    value=""
                    title="Вставить позицию из справочника разбивок Висма (можно несколько)"
                    onChange={(e) => {
                      if (!e.target.value) return;
                      setDraftValue(d.field.key, d.value.trim() === '' ? e.target.value : `${d.value.replace(/[;\s]+$/, '')}; ${e.target.value}`);
                      e.target.value = '';
                    }}
                  >
                    <option value="">+ вставить из справочника…</option>
                    {dictSuggestions(d.field.key, dicts, 60).map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                )}
                {d.field.hint && <span className="muted small">{d.field.hint}</span>}
              </label>
            ))}
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
