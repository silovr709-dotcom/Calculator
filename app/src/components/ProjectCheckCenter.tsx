import { useMemo, useState } from 'react';
import type { Pricebook, Project } from '../types';
import { fmtMoney } from '../lib/format';
import { groupValidationIssues, validateProject, type ValidationIssue } from '../lib/validation';
import { applyTechnicalFacadeSpec, inferFacadeSpec, inferHingeSpec, isTechnicalFacadeSpecOutdated, isTechnicalHingeSpecOutdated } from '../lib/facades';
import { applyDimensionSurcharges, inferDimensionSurcharges } from '../lib/surcharges';
import { resolveSlot } from '../lib/modules';

export default function ProjectCheckCenter(props: { project: Project; pricebook: Pricebook; onChange: (project: Project) => void; onSelectModule: (id: string) => void; onSelectLine: (id: string) => void }) {
  const result = useMemo(() => validateProject(props.project, props.pricebook), [props.project, props.pricebook]);
  const [onlyProblems, setOnlyProblems] = useState(true);
  const modules = props.project.modules ?? [];
  const defaults = props.project.moduleDefaults ?? {};
  const recommendations = useMemo(() => {
    let facades = 0; let hinges = 0; let surcharges = 0;
    const currentModules = props.project.modules ?? [];
    const currentDefaults = props.project.moduleDefaults ?? {};
    for (const module of currentModules) {
      const body = resolveSlot(module, 'body', currentDefaults, props.pricebook).item;
      if (!body) continue;
      const facade = inferFacadeSpec(module, body);
      if (facade && module.facadeSpecStatus !== 'manual') {
        const empty = !module.facadeParts?.length && module.facades === 0;
        const outdated = module.facadeSpecStatus === 'outdated' || isTechnicalFacadeSpecOutdated(module, body);
        if (empty || outdated) facades += 1;
      }
      const hinge = inferHingeSpec(module, body);
      if (hinge && module.hingeSpecStatus !== 'manual' && (module.hingeSpecStatus === 'outdated' || module.hinges !== hinge.hinges || isTechnicalHingeSpecOutdated(module, body))) hinges += 1;
      if (inferDimensionSurcharges(module, body, props.pricebook).some((item) => !(module.surcharges ?? []).includes(item.itemId))) surcharges += 1;
    }
    return { facades, hinges, surcharges };
  }, [props.project.modules, props.project.moduleDefaults, props.pricebook]);
  const applyFacades = () => props.onChange({ ...props.project, modules: modules.map((module) => {
    const body = resolveSlot(module, 'body', defaults, props.pricebook).item;
    if (!body || module.facadeSpecStatus === 'manual') return module;
    const inference = inferFacadeSpec(module, body);
    const pending = Boolean(inference && ((!module.facadeParts?.length && module.facades === 0) || module.facadeSpecStatus === 'outdated' || isTechnicalFacadeSpecOutdated(module, body)));
    return pending ? applyTechnicalFacadeSpec(module, body, module.facadeSpecStatus === 'outdated' || isTechnicalFacadeSpecOutdated(module, body)) : module;
  }) });
  const applyHinges = () => props.onChange({ ...props.project, modules: modules.map((module) => {
    if (module.hingeSpecStatus === 'manual') return module;
    const body = resolveSlot(module, 'body', defaults, props.pricebook).item;
    if (!body) return module;
    const inference = inferHingeSpec(module, body);
    const pending = Boolean(inference && (module.hingeSpecStatus === 'outdated' || module.hinges === 0 || isTechnicalHingeSpecOutdated(module, body)));
    return pending && inference ? { ...module, hinges: inference.hinges, hingeSpecStatus: 'applied' as const } : module;
  }) });
  const applySurcharges = () => props.onChange({ ...props.project, modules: modules.map((module) => {
    const body = resolveSlot(module, 'body', defaults, props.pricebook).item;
    return body ? applyDimensionSurcharges(module, body, props.pricebook) : module;
  }) });
  const visible = onlyProblems ? result.issues.filter((issue) => issue.severity !== 'info') : result.issues;
  const grouped = groupValidationIssues(visible);
  const navigate = (issue: ValidationIssue) => {
    if (issue.entity === 'module' && issue.entityId) props.onSelectModule(issue.entityId);
    if (issue.entity === 'line' && issue.entityId) props.onSelectLine(issue.entityId);
  };

  return (
    <div className="check-center">
      <div className="check-master-detail">
        <aside className="check-side-panel">
      <div className={`readiness-card ${result.ready ? 'ready' : 'not-ready'}`}>
        <div><span className="eyebrow">ГОТОВНОСТЬ ПРОЕКТА</span><h2>{result.ready ? 'Проект готов к предложению' : 'Нужно проверить данные'}</h2><p>{result.ready ? 'Критических ошибок и неподтверждённых предупреждений нет.' : 'Исправьте ошибки или подтвердите предупреждения, чтобы итог не оказался занижен.'}</p></div>
        <div className="readiness-score"><b>{result.ready ? '✓' : result.errors.length + result.warnings.length}</b><span>{result.ready ? 'готово' : 'проблем'}</span></div>
      </div>
      <div className="check-summary-grid">
        <div><span>Модулей проверено</span><b>{result.checkedModules}</b></div><div><span>Строк проверено</span><b>{result.checkedLines}</b></div><div><span>Ошибки</span><b className="check-error-number">{result.errors.length}</b></div><div><span>Предупреждения</span><b className="check-warning-number">{result.warnings.length}</b></div><div><span>Себестоимость</span><b>{fmtMoney(result.cost)}</b></div><div><span>Цена клиента</span><b>{fmtMoney(result.client)}</b></div>
      </div>
      {(recommendations.facades > 0 || recommendations.hinges > 0 || recommendations.surcharges > 0) && <section className="card check-actions"><div><h3>Рекомендации к применению</h3><p className="muted small">Ручные значения не изменяются. Нажатие кнопки применяет только показанные технические рекомендации ко всему проекту.</p></div><div className="check-action-buttons">{recommendations.facades > 0 && <button className="btn ghost" onClick={applyFacades}>Обновить фасады по техничке ({recommendations.facades})</button>}{recommendations.hinges > 0 && <button className="btn ghost" onClick={applyHinges}>Обновить петли по техничке ({recommendations.hinges})</button>}{recommendations.surcharges > 0 && <button className="btn ghost" onClick={applySurcharges}>Добавить наценки по габаритам ({recommendations.surcharges})</button>}</div></section>}
      <div className="check-toolbar"><label className="chk"><input type="checkbox" checked={onlyProblems} onChange={(event) => setOnlyProblems(event.target.checked)} /> Только проблемные позиции</label><span className="muted small">Ошибки сгруппированы по месту возникновения. Переход откроет нужную позицию.</span></div>
        </aside>
        <main className="check-detail-panel">
      {grouped.length === 0 ? <div className="ok-box">✅ Проблем не найдено. Можно переходить к итогам и КП.</div> : <div className="check-groups">{grouped.map(([group, issues]) => <section className="card check-group" key={group}><h3>{group}<span className="badge-count">{issues.length}</span></h3>{issues.map((issue) => <div className={`check-issue ${issue.severity}`} key={issue.id}><div className="check-icon">{issue.severity === 'error' ? '⛔' : issue.severity === 'warning' ? '⚠' : 'ℹ'}</div><div className="check-issue-content"><b>{issue.title}</b><span>{issue.message}</span><small><strong>Влияние на итог:</strong> {issue.impact}</small></div>{issue.entityId && <button className="btn tiny ghost" onClick={() => navigate(issue)}>Перейти к позиции</button>}</div>)}</section>)}</div>}
        </main>
      </div>
    </div>
  );
}
