import { useMemo, useState } from 'react';
import type { Pricebook, Project } from '../types';
import { checkFactoryBlank, draftFactoryBlank, FACTORY_BLANK_SPECS, factoryBlankProgress } from '../lib/factoryBlank';

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

  const project = props.projects.find((p) => p.id === projectId) ?? props.projects[0];
  const spec = FACTORY_BLANK_SPECS.find((s) => s.id === specId) ?? FACTORY_BLANK_SPECS[0];
  const pricebook = project
    ? props.pricebooks.find((pb) => pb.meta.id === project.pricebookId) ?? props.pricebooks[0]
    : props.pricebooks[0];

  const draft = useMemo(
    () => (project && pricebook ? draftFactoryBlank(project, pricebook, spec) : []),
    [project, pricebook, spec],
  );
  const issues = useMemo(
    () => (project && pricebook ? checkFactoryBlank(project, pricebook, spec, draft) : []),
    [project, pricebook, spec, draft],
  );
  const progress = useMemo(() => factoryBlankProgress(draft), [draft]);

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
          <button className="btn primary" onClick={() => window.print()} title={`${spec.blankName}: печать или сохранение в PDF браузером`}>🖨 Печать / PDF</button>
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
                {d.field.hint && <span className="muted small">{d.field.hint}</span>}
              </label>
            ))}
          </div>
        </div>
      ))}

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
        <div className="muted small">* — обязательные поля по инструкции фабрики. Заказ запускается только по подтверждённому бланку.</div>
      </div>
    </div>
  );
}
