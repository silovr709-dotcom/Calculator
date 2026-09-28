import { useState } from 'react';
import type { KitchenWall, Pricebook, Project, SlotKey, WizardStepId } from '../types';
import { SLOT_LABELS, SLOT_POOLS } from '../lib/modules';
import { LAYOUT_SHAPES, WALL_LABELS, layoutWalls, normalizeLayoutShape } from '../lib/kitchenSketch';
import { fmtMoney } from '../lib/format';
import { validateProject } from '../lib/validation';
import CatalogPicker from './CatalogPicker';
import ModulesPanel from './ModulesPanel';

const STEPS: { id: WizardStepId; label: string; hint: string }[] = [
  { id: 'data', label: 'Данные проекта', hint: 'Клиент и сроки' },
  { id: 'shape', label: 'Форма и стены', hint: 'Планировка помещения' },
  { id: 'materials', label: 'Материалы', hint: 'Фасады и фурнитура' },
  { id: 'modules', label: 'Модули', hint: 'Позиции кухни' },
  { id: 'review', label: 'Проверка', hint: 'Ошибки и предупреждения' },
  { id: 'total', label: 'Итог', hint: 'Стоимость и следующий шаг' },
];

const MATERIAL_SLOTS: SlotKey[] = ['facade', 'frame', 'hinge', 'drawerSys', 'lift', 'handle', 'shelf'];

export default function KitchenWizard(props: {
  project: Project;
  pricebook: Pricebook;
  onChange: (project: Project) => void;
  onSelectModule: (id: string) => void;
  onOpenAdvanced: () => void;
}) {
  const { project, pricebook } = props;
  const step = project.wizardStep ?? 'data';
  const [pickSlot, setPickSlot] = useState<SlotKey | null>(null);
  const modules = project.modules ?? [];
  const defaults = project.moduleDefaults ?? {};
  const walls = layoutWalls(project.sketch?.shape);
  const validation = validateProject(project, pricebook);
  const moduleLines = modules.filter((module) => module.widthMm);
  const checklistIssues = validation.issues.filter((issue) => issue.group === 'Обязательный состав кухни');

  const setStep = (next: WizardStepId) => props.onChange({ ...project, wizardStep: next, wizardMode: 'wizard' });
  const setSketch = (patch: NonNullable<Project['sketch']>) => props.onChange({ ...project, sketch: patch });
  const setDefault = (slot: SlotKey, itemId: string | null) => props.onChange({
    ...project,
    moduleDefaults: { ...defaults, [slot]: itemId },
  });

  return (
    <div className="wizard">
      <div className="wizard-head">
        <div>
          <span className="eyebrow">ПОШАГОВАЯ СБОРКА</span>
          <h2>Соберём кухню без пропущенных данных</h2>
          <p className="muted">На каждом шаге можно вернуться назад. Расчёт и эскиз остаются теми же, что в продвинутом режиме.</p>
        </div>
        <button className="btn ghost" onClick={props.onOpenAdvanced}>Открыть продвинутый режим</button>
      </div>
      <div className="wizard-steps" role="tablist" aria-label="Шаги сборки кухни">
        {STEPS.map((item, index) => {
          const active = item.id === step;
          const passed = STEPS.findIndex((candidate) => candidate.id === step) > index;
          return (
            <button className={`wizard-step ${active ? 'active' : ''} ${passed ? 'passed' : ''}`} key={item.id} onClick={() => setStep(item.id)} role="tab" aria-selected={active}>
              <span className="wizard-step-number">{passed ? '✓' : index + 1}</span>
              <span><b>{item.label}</b><small>{item.hint}</small></span>
            </button>
          );
        })}
      </div>

      {step === 'data' && (
        <section className="card wizard-card">
          <h3>1. Данные проекта</h3>
          <p className="muted small">Эти данные попадут в проект и клиентское предложение. Их можно изменить позже.</p>
          <div className="grid2">
            <label>Название проекта<input value={project.name} onChange={(event) => props.onChange({ ...project, name: event.target.value })} /></label>
            <label>Клиент<input value={project.client} onChange={(event) => props.onChange({ ...project, client: event.target.value })} /></label>
            <label>Дата расчёта<input type="date" value={project.date} onChange={(event) => props.onChange({ ...project, date: event.target.value })} /></label>
            <label>Комментарий<textarea rows={3} value={project.comment} onChange={(event) => props.onChange({ ...project, comment: event.target.value })} /></label>
          </div>
          <div className="wizard-nav"><span /><button className="btn primary" onClick={() => setStep('shape')}>Далее: форма кухни →</button></div>
        </section>
      )}

      {step === 'shape' && (
        <section className="card wizard-card">
          <h3>2. Форма кухни и стены</h3>
          <p className="muted small">Длины стен используются для подсказок и раскладки. Калькулятор не добавляет позиции без вашего подтверждения.</p>
          <div className="shape-choices">
            {LAYOUT_SHAPES.map((item) => (
              <button key={item.id} className={`shape-choice ${normalizeLayoutShape(project.sketch?.shape) === item.id ? 'active' : ''}`} onClick={() => setSketch({ ...project.sketch, shape: item.id })}>
                <b>{item.name}</b><span>{item.hint}</span>
              </button>
            ))}
          </div>
          <div className="grid3 wizard-wall-grid">
            {walls.map((wall: KitchenWall) => (
              <label key={wall}>{WALL_LABELS[wall]}, мм
                <input type="number" min={0} placeholder="не измерено" value={project.sketch?.wallLengthsMm?.[wall] ?? ''} onChange={(event) => setSketch({ ...project.sketch, shape: normalizeLayoutShape(project.sketch?.shape), wallLengthsMm: { ...project.sketch?.wallLengthsMm, [wall]: event.target.value ? Number(event.target.value) : null } })} />
              </label>
            ))}
            <label>Высота помещения, мм
              <input type="number" min={0} placeholder="не измерено" value={project.sketch?.roomHeightMm ?? ''} onChange={(event) => setSketch({ ...project.sketch, roomHeightMm: event.target.value ? Number(event.target.value) : null })} />
            </label>
          </div>
          <div className="wizard-nav"><button className="btn ghost" onClick={() => setStep('data')}>← Назад</button><button className="btn primary" onClick={() => setStep('materials')}>Далее: материалы →</button></div>
        </section>
      )}

      {step === 'materials' && (
        <section className="card wizard-card">
          <h3>3. Материалы и фурнитура</h3>
          <p className="muted small">Выберите общие значения проекта. Они применяются только к модулям, где нет ручного выбора. Пустое поле остаётся пустым — ничего не подставляется автоматически.</p>
          <div className="wizard-material-list">
            {MATERIAL_SLOTS.map((slot) => {
              const item = pricebook.items.find((candidate) => candidate.id === defaults[slot]);
              return <div className="wizard-material-row" key={slot}>
                <div><b>{SLOT_LABELS[slot]}</b><div className="muted small">{item?.name ?? 'Не выбрано'}</div></div>
                <button className="btn tiny" onClick={() => setPickSlot(slot)}>Выбрать из прайса…</button>
                {defaults[slot] && <button className="btn tiny ghost" onClick={() => setDefault(slot, null)}>Очистить</button>}
              </div>;
            })}
          </div>
          <div className="note">Корпус выбирается отдельно для каждой позиции: у разных шкафов могут быть разные ширины и конструкции.</div>
          <div className="wizard-nav"><button className="btn ghost" onClick={() => setStep('shape')}>← Назад</button><button className="btn primary" onClick={() => setStep('modules')}>Далее: добавить модули →</button></div>
        </section>
      )}

      {step === 'modules' && (
        <section className="wizard-card">
          <div className="wizard-section-title"><div><h3>4. Добавление модулей</h3><p className="muted small">Добавьте позиции и заполните их размеры. Для подробного редактирования можно открыть продвинутый режим.</p></div><span className="wizard-counter">{modules.length} поз.</span></div>
          <ModulesPanel project={project} pricebook={pricebook} onChange={props.onChange} />
          <div className="wizard-nav"><button className="btn ghost" onClick={() => setStep('materials')}>← Назад</button><button className="btn primary" onClick={() => setStep('review')}>Перейти к проверке →</button></div>
        </section>
      )}

      {step === 'review' && (
        <section className="card wizard-card">
          <h3>5. Проверка проекта</h3>
          {modules.length === 0 && <div className="warn-box">Добавьте хотя бы одну позицию кухни, иначе итог будет только по дополнительным строкам.</div>}
          <div className="wizard-review-grid">
            <div className="wizard-review-status">{modules.length > 0 && validation.errors.length === 0 ? '✅' : '⚠️'}<b>{modules.length > 0 ? 'Позиции добавлены' : 'Позиции не добавлены'}</b><span>{moduleLines.length > 0 ? `Размеры указаны у ${moduleLines.length} поз. · ошибок: ${validation.errors.length}` : 'Проверьте размеры и комплектацию модулей'}</span></div>
            <div className="wizard-review-status">{walls.some((wall) => (project.sketch?.wallLengthsMm?.[wall] ?? 0) > 0) ? '✅' : 'ℹ️'}<b>Стены</b><span>{walls.map((wall) => `${WALL_LABELS[wall]}: ${project.sketch?.wallLengthsMm?.[wall] ?? '—'}`).join(' · ')}</span></div>
            <div className="wizard-review-status">{checklistIssues.length === 0 ? '✅' : '⚠️'}<b>Обязательный состав кухни</b><span>{checklistIssues.length === 0 ? 'Цоколь, плинтус, столешница и стеновая панель добавлены' : `Не хватает позиций: ${checklistIssues.length}`}</span></div>
          </div>
          <div className="note">{validation.ready ? 'Проверка пройдена. Подробный центр проверки доступен в продвинутом режиме.' : `Нужно исправить ошибок: ${validation.errors.length}, предупреждений: ${validation.warnings.length}. Подробный центр проверки доступен в продвинутом режиме.`}</div>
          <div className="wizard-nav"><button className="btn ghost" onClick={() => setStep('modules')}>← К модулям</button><button className="btn primary" onClick={() => setStep('total')}>Посмотреть итог →</button></div>
        </section>
      )}

      {step === 'total' && (
        <section className="card wizard-card">
          <h3>6. Итог расчёта</h3>
          <div className="wizard-total"><span>Себестоимость</span><b>{fmtMoney(validation.cost)}</b></div>
          <div className="wizard-total client"><span>Цена для клиента</span><b>{fmtMoney(validation.client)}</b></div>
          {validation.unpricedLines > 0 && <div className="warn-box">{validation.unpricedLines} строк без цены не включены в итог. Исправьте их в продвинутом режиме.</div>}
          <div className="wizard-nav"><button className="btn ghost" onClick={() => setStep('review')}>← К проверке</button><button className="btn primary" disabled={!validation.ready} onClick={props.onOpenAdvanced}>{validation.ready ? 'Открыть расчёт и КП →' : 'Сначала исправить проверку'}</button></div>
        </section>
      )}

      {pickSlot && <CatalogPicker pricebook={pricebook} pickOnly poolFilter={SLOT_POOLS[pickSlot]} title={`Выберите: ${SLOT_LABELS[pickSlot]}`} onAdd={(item) => { setDefault(pickSlot, item.id); setPickSlot(null); }} onClose={() => setPickSlot(null)} />}
    </div>
  );
}
