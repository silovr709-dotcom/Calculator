import { useMemo, useState } from 'react';
import type { KitchenChecklistKey, Pricebook, Project } from '../types';
import { checkKitchenChecklist, checklistPool, KITCHEN_CHECKLIST } from '../lib/checklist';
import { lineFromItem } from '../lib/engine';
import CatalogPicker from './CatalogPicker';

export default function KitchenChecklistPanel(props: { project: Project; pricebook: Pricebook; onChange: (project: Project) => void }) {
  const [pickKey, setPickKey] = useState<KitchenChecklistKey | null>(null);
  const result = useMemo(() => checkKitchenChecklist(props.project.lines), [props.project.lines]);

  return (
    <section className="card kitchen-checklist">
      <div className="checklist-head">
        <div>
          <h3>Обязательный состав кухни</h3>
          <p className="muted small">Перед отправкой расчёта проверьте четыре обязательные позиции. Калькулятор не добавляет их молча — выберите конкретную позицию из прайса.</p>
        </div>
        <span className={`checklist-badge ${result.missing.length === 0 ? 'complete' : 'missing'}`}>
          {result.missing.length === 0 ? '✓ заполнено' : `не хватает: ${result.missing.length}`}
        </span>
      </div>
      <div className="checklist-grid">
        {KITCHEN_CHECKLIST.map((item) => {
          const state = result.items.find((candidate) => candidate.key === item.key)!;
          return <div className={`checklist-item ${state.included ? 'included' : 'missing'}`} key={item.key}>
            <div className="checklist-item-icon">{state.included ? '✓' : '!'}</div>
            <div><b>{item.label}</b><small>{state.included ? `добавлено позиций: ${state.lineIds.length}` : item.hint}</small></div>
            <button className="btn tiny" onClick={() => setPickKey(item.key)}>{state.included ? 'Добавить ещё' : 'Добавить из прайса'}</button>
          </div>;
        })}
      </div>
      {pickKey && (
        <CatalogPicker
          pricebook={props.pricebook}
          pickOnly
          poolFilter={(item) => checklistPool(pickKey, item.category, item.name)}
          title={`Чек-лист: ${KITCHEN_CHECKLIST.find((item) => item.key === pickKey)?.label ?? ''}`}
          onAdd={(item) => {
            const label = KITCHEN_CHECKLIST.find((candidate) => candidate.key === pickKey)?.label ?? 'обязательная позиция';
            const line = lineFromItem(item, props.pricebook.meta.id, 1);
            line.note = `Чек-лист кухни: ${label}`;
            props.onChange({ ...props.project, lines: [...props.project.lines, line] });
            setPickKey(null);
          }}
          onClose={() => setPickKey(null)}
        />
      )}
    </section>
  );
}
