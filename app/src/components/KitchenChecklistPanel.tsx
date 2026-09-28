import { useMemo, useState } from 'react';
import type { KitchenChecklistKey, Pricebook, Project } from '../types';
import { checkKitchenChecklist, checklistLengthHint, checklistPool, KITCHEN_CHECKLIST } from '../lib/checklist';
import { lineFromItem } from '../lib/engine';
import CatalogPicker from './CatalogPicker';

export default function KitchenChecklistPanel(props: { project: Project; pricebook: Pricebook; onChange: (project: Project) => void }) {
  const [pickKey, setPickKey] = useState<KitchenChecklistKey | null>(null);
  // подсказка длины из замера стен эскиза: столешница/стеновая/плинтус по периметру кухни
  const lengthHint = checklistLengthHint(props.project.sketch?.wallLengthsMm);
  const result = useMemo(
    () => checkKitchenChecklist(props.project.lines, props.project.checklistConfirmations ?? []),
    [props.project.lines, props.project.checklistConfirmations],
  );
  const setConfirmation = (key: KitchenChecklistKey, confirmed: boolean) => {
    const current = props.project.checklistConfirmations ?? [];
    const next = confirmed ? [...current, key] : current.filter((value) => value !== key);
    props.onChange({ ...props.project, checklistConfirmations: next });
  };

  return (
    <section className="card kitchen-checklist">
      <div className="checklist-head">
        <div>
          <h3>Обязательный состав кухни</h3>
          <p className="muted small">Перед отправкой расчёта проверьте четыре обязательные позиции. Калькулятор не добавляет их молча — выберите конкретную позицию из прайса. Если кухня осознанно без плинтуса или стеновой панели — подтвердите отсутствие, это зафиксируется в проекте.</p>
        </div>
        <span className={`checklist-badge ${result.missing.length === 0 ? 'complete' : 'missing'}`}>
          {result.missing.length === 0 ? '✓ заполнено' : `не хватает: ${result.missing.length}`}
        </span>
      </div>
      <div className="checklist-grid">
        {KITCHEN_CHECKLIST.map((item) => {
          const state = result.items.find((candidate) => candidate.key === item.key)!;
          return <div className={`checklist-item ${state.included ? 'included' : state.confirmed ? 'confirmed' : 'missing'}`} key={item.key}>
            <div className="checklist-item-icon">{state.included ? '✓' : state.confirmed ? '—' : '!'}</div>
            <div><b>{item.label}</b><small>{state.included ? `добавлено позиций: ${state.lineIds.length}` : state.confirmed ? 'в проект не входит (подтверждено)' : item.hint}</small></div>
            <div className="checklist-item-actions">
              <button className="btn tiny" onClick={() => setPickKey(item.key)}>{state.included ? 'Добавить ещё' : 'Добавить из прайса'}</button>
              {!state.included && !state.confirmed && (
                <button className="btn tiny ghost" onClick={() => setConfirmation(item.key, true)}>Не входит</button>
              )}
              {!state.included && state.confirmed && (
                <button className="btn tiny ghost" onClick={() => setConfirmation(item.key, false)}>Отменить подтверждение</button>
              )}
            </div>
          </div>;
        })}
      </div>
      {pickKey && (
        <CatalogPicker
          pricebook={props.pricebook}
          poolFilter={(item) => checklistPool(pickKey, item.category, item.name)}
          initialLengthMm={lengthHint}
          title={`Чек-лист: ${KITCHEN_CHECKLIST.find((item) => item.key === pickKey)?.label ?? ''}${lengthHint ? ` · длина из замера стен: ${lengthHint} мм` : ''} — проверьте количество и параметры`}
          onAdd={(item, qty, params) => {
            const label = KITCHEN_CHECKLIST.find((candidate) => candidate.key === pickKey)?.label ?? 'обязательная позиция';
            const line = lineFromItem(item, props.pricebook.meta.id, qty, params);
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
