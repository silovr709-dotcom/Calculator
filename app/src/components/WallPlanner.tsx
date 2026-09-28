import { useState } from 'react';
import type { KitchenWall, Project } from '../types';
import { WALL_LABELS, layoutWalls, moduleWall } from '../lib/kitchenSketch';
import { formatRemainder, suggestWallLayouts, type WallLayoutPlan } from '../lib/layoutPlanner';
import { newModule } from '../lib/modules';

export default function WallPlanner(props: { project: Project; onChange: (project: Project) => void; onClose: () => void }) {
  const { project } = props;
  const modules = project.modules ?? [];
  const walls = layoutWalls(project.sketch?.shape);
  const [wall, setWall] = useState<KitchenWall>(walls[0] ?? 'back');
  const [lengthMm, setLengthMm] = useState<number>(() => project.sketch?.wallLengthsMm?.[wall] ?? 3000);
  const [mandatoryIds, setMandatoryIds] = useState<string[]>([]);
  const [plans, setPlans] = useState<WallLayoutPlan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<number | null>(null);

  const candidates = modules
    .filter((module) => module.widthMm != null && module.widthMm > 0)
    .map((module) => ({ id: module.id, name: module.name, widthMm: module.widthMm, availableQty: Math.max(1, module.qty), wall: moduleWall(module, project.sketch?.shape) }));

  const chooseWall = (next: KitchenWall) => {
    setWall(next);
    setLengthMm(project.sketch?.wallLengthsMm?.[next] ?? 3000);
    setPlans([]);
    setSelectedPlan(null);
  };
  const generate = () => {
    setPlans(suggestWallLayouts(wall, lengthMm, candidates, mandatoryIds));
    setSelectedPlan(null);
  };
  const create = () => {
    if (selectedPlan == null) return;
    const plan = plans[selectedPlan];
    if (!plan) return;
    const message = `Добавить выбранную комбинацию в «Позиции кухни»?\n\n${plan.label}\n${formatRemainder(plan.freeMm)}\n\nСуществующие позиции останутся без изменений.`;
    if (!window.confirm(message)) return;
    const added = plan.items.flatMap((item) => {
      const source = modules.find((module) => module.id === item.candidateId);
      if (!source) return [];
      return Array.from({ length: item.count }, (_, index) => ({
        ...JSON.parse(JSON.stringify(source)),
        id: newModule(source.type).id,
        qty: 1,
        wall,
        name: item.count > 1 ? `${source.name} ${index + 1}` : source.name,
      }));
    });
    if (added.length > 0) props.onChange({ ...project, modules: [...modules, ...added] });
    props.onClose();
  };

  return (
    <section className="card wall-planner">
      <div className="wall-planner-head"><div><h3>Разложить кухню по длине стены</h3><p className="muted small">Показываем предложения из уже созданных модулей. Ничего не добавится без вашего подтверждения.</p></div><button className="btn tiny ghost" onClick={props.onClose}>Закрыть</button></div>
      <div className="grid3">
        <label>Стена<select value={wall} onChange={(event) => chooseWall(event.target.value as KitchenWall)}>{walls.map((item) => <option key={item} value={item}>{WALL_LABELS[item]}</option>)}</select></label>
        <label>Длина стены, мм<input type="number" min={1} value={lengthMm} onChange={(event) => setLengthMm(Number(event.target.value) || 0)} /></label>
        <div className="wall-planner-action"><button className="btn primary" disabled={lengthMm <= 0 || candidates.length === 0} onClick={generate}>Подобрать комбинации</button></div>
      </div>
      <div className="wall-planner-mandatory">
        <b>Обязательные модули</b><span className="muted small">— отметьте позиции, которые должны попасть в каждое предложение</span>
        {candidates.length === 0 ? <div className="muted small">Сначала добавьте модули с указанной шириной.</div> : <div className="mandatory-list">{candidates.map((candidate) => <label className="chk" key={candidate.id}><input type="checkbox" checked={mandatoryIds.includes(candidate.id)} onChange={(event) => setMandatoryIds((ids) => event.target.checked ? [...ids, candidate.id] : ids.filter((id) => id !== candidate.id))} />{candidate.name} · {candidate.widthMm} мм</label>)}</div>}
      </div>
      {plans.length === 0 && candidates.length > 0 && <div className="empty small">Введите длину и нажмите «Подобрать комбинации». Это только предложения — текущие позиции пока не меняются.</div>}
      {plans.length === 0 && candidates.length === 0 && <div className="empty small">Для подбора нужны модули с шириной. Неизмеренные позиции не подставляются автоматически.</div>}
      {plans.length > 0 && <div className="wall-plans"><div className="muted small">Найдено предложений: {plans.length}. Выберите одно:</div>{plans.map((plan, index) => <button key={`${plan.label}-${index}`} className={`wall-plan ${selectedPlan === index ? 'selected' : ''}`} onClick={() => setSelectedPlan(index)}><span className="wall-plan-radio">{selectedPlan === index ? '●' : '○'}</span><span><b>{plan.label}</b><small>Занято {plan.usedWidthMm} из {plan.wallLengthMm} мм · {formatRemainder(plan.freeMm)}</small></span></button>)}</div>}
      <div className="wall-planner-foot"><span className="muted small">Комбинация будет добавлена на стену «{WALL_LABELS[wall]}» отдельными позициями.</span><button className="btn primary" disabled={selectedPlan == null} onClick={create}>Создать выбранную комбинацию</button></div>
    </section>
  );
}
