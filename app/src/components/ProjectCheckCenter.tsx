import { useMemo, useState } from 'react';
import type { Pricebook, Project } from '../types';
import { fmtMoney } from '../lib/format';
import { groupValidationIssues, validateProject, type ValidationIssue } from '../lib/validation';

export default function ProjectCheckCenter(props: { project: Project; pricebook: Pricebook; onSelectModule: (id: string) => void; onSelectLine: (id: string) => void }) {
  const result = useMemo(() => validateProject(props.project, props.pricebook), [props.project, props.pricebook]);
  const [onlyProblems, setOnlyProblems] = useState(true);
  const visible = onlyProblems ? result.issues.filter((issue) => issue.severity !== 'info') : result.issues;
  const grouped = groupValidationIssues(visible);
  const navigate = (issue: ValidationIssue) => {
    if (issue.entity === 'module' && issue.entityId) props.onSelectModule(issue.entityId);
    if (issue.entity === 'line' && issue.entityId) props.onSelectLine(issue.entityId);
  };

  return (
    <div className="check-center">
      <div className={`readiness-card ${result.ready ? 'ready' : 'not-ready'}`}>
        <div><span className="eyebrow">ГОТОВНОСТЬ ПРОЕКТА</span><h2>{result.ready ? 'Проект готов к предложению' : 'Нужно проверить данные'}</h2><p>{result.ready ? 'Критических ошибок и неподтверждённых предупреждений нет.' : 'Исправьте ошибки или подтвердите предупреждения, чтобы итог не оказался занижен.'}</p></div>
        <div className="readiness-score"><b>{result.ready ? '✓' : result.errors.length + result.warnings.length}</b><span>{result.ready ? 'готово' : 'проблем'}</span></div>
      </div>
      <div className="check-summary-grid">
        <div><span>Модулей проверено</span><b>{result.checkedModules}</b></div><div><span>Строк проверено</span><b>{result.checkedLines}</b></div><div><span>Ошибки</span><b className="check-error-number">{result.errors.length}</b></div><div><span>Предупреждения</span><b className="check-warning-number">{result.warnings.length}</b></div><div><span>Себестоимость</span><b>{fmtMoney(result.cost)}</b></div><div><span>Цена клиента</span><b>{fmtMoney(result.client)}</b></div>
      </div>
      <div className="check-toolbar"><label className="chk"><input type="checkbox" checked={onlyProblems} onChange={(event) => setOnlyProblems(event.target.checked)} /> Только проблемные позиции</label><span className="muted small">Ошибки сгруппированы по месту возникновения. Переход откроет нужную позицию.</span></div>
      {grouped.length === 0 ? <div className="ok-box">✅ Проблем не найдено. Можно переходить к итогам и КП.</div> : <div className="check-groups">{grouped.map(([group, issues]) => <section className="card check-group" key={group}><h3>{group}<span className="badge-count">{issues.length}</span></h3>{issues.map((issue) => <div className={`check-issue ${issue.severity}`} key={issue.id}><div className="check-icon">{issue.severity === 'error' ? '⛔' : issue.severity === 'warning' ? '⚠' : 'ℹ'}</div><div className="check-issue-content"><b>{issue.title}</b><span>{issue.message}</span><small><strong>Влияние на итог:</strong> {issue.impact}</small></div>{issue.entityId && <button className="btn tiny ghost" onClick={() => navigate(issue)}>Перейти к позиции</button>}</div>)}</section>)}</div>}
    </div>
  );
}
