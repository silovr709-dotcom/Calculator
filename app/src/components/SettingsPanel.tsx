import type { ExtraExpenseDetail, ProjectSettings, SummaryGroup } from '../types';
import { SUMMARY_GROUPS } from '../types';
import { uid } from '../lib/storage';
import { fmtMoney } from '../lib/format';

function NumInput(props: { value: number | null; onChange: (v: number | null) => void; placeholder?: string; step?: number }) {
  return (
    <input
      type="number"
      step={props.step ?? 1}
      value={props.value ?? ''}
      placeholder={props.placeholder ?? 'не задано'}
      onChange={(e) => props.onChange(e.target.value === '' ? null : Number(e.target.value))}
      onFocus={(e) => e.currentTarget.select()}
    />
  );
}

export default function SettingsPanel(props: {
  title: string;
  settings: ProjectSettings;
  onChange: (s: ProjectSettings) => void;
  standalone?: boolean;
  /** Рассчитанные суммы расходов из текущих итогов проекта (для показа «10% = 12 400 ₽»). */
  extraDetails?: ExtraExpenseDetail[];
}) {
  const s = props.settings;
  const set = (patch: Partial<ProjectSettings>) => props.onChange({ ...s, ...patch });
  const updExpense = (id: string, patch: Partial<ProjectSettings['extraExpenses'][number]>) =>
    set({ extraExpenses: s.extraExpenses.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
  const detailFor = (id: string) => props.extraDetails?.find((d) => d.id === id);
  const addPreset = (name: string, patch: Partial<ProjectSettings['extraExpenses'][number]> = {}) =>
    set({ extraExpenses: [...s.extraExpenses, { id: uid('exp'), name, amount: null, percent: null, toClient: true, ...patch }] });

  return (
    <div className={props.standalone ? 'page' : ''}>
      {props.standalone && <header className="page-head"><h1>Настройки</h1></header>}
      <div className="settings">
        <section className="card">
          <h3>{props.title}</h3>
          <p className="muted small">
            Значения по умолчанию пустые — калькулятор ничего не придумывает. Пока наценка не задана,
            «цена для клиента» равна себестоимости. Настройки хранятся отдельно от прайса Висмы и не меняют его цены.
          </p>
          <div className="grid2">
            <label>Базовая наценка, %<NumInput value={s.markupBasePct} onChange={(v) => set({ markupBasePct: v })} placeholder="напр. 100" /></label>
            <label>Сборка, ₽<NumInput value={s.assemblyCost} onChange={(v) => set({ assemblyCost: v })} /></label>
            <label>Доставка, ₽<NumInput value={s.deliveryCost} onChange={(v) => set({ deliveryCost: v })} /></label>
            <label>Округление цены клиента
              <select value={s.clientRounding ?? 1} onChange={(e) => set({ clientRounding: Number(e.target.value) as ProjectSettings['clientRounding'] })}>
                <option value={1}>Без округления</option><option value={10}>До 10 ₽</option><option value={100}>До 100 ₽</option><option value={1000}>До 1 000 ₽</option>
              </select>
            </label>
            <label className="chk-row">
              <input type="checkbox" checked={s.applyEmalRule} onChange={(e) => set({ applyEmalRule: e.target.checked })} />
              Правило прайса: эмаль &lt; 1 кв.м на проект — +30% (лист «Эмаль»)
            </label>
          </div>
        </section>

        <section className="card">
          <h3>Наценка по категориям (переопределяет базовую)</h3>
          <div className="grid3">
            {SUMMARY_GROUPS.map((g) => (
              <label key={g}>{g}, %
                <NumInput
                  value={s.markupByGroup[g as SummaryGroup] ?? null}
                  onChange={(v) => set({ markupByGroup: { ...s.markupByGroup, [g]: v } })}
                  placeholder={s.markupBasePct != null ? `базовая ${s.markupBasePct}%` : 'не задано'}
                />
              </label>
            ))}
          </div>
        </section>

        <section className="card">
          <h3>Дополнительные расходы</h3>
          <p className="muted small">
            Каждый расход — фиксированная сумма в ₽ либо <b>% от суммы проекта по материалам</b> (например, «Сборка 10%» или «% дизайнеру»).
            Процент считается от клиентской суммы с учётом наценки, без самих расходов. Расходы попадают в себестоимость;
            отмеченные «в цену клиента» дополнительно добавляются к цене для клиента.
          </p>
          {s.extraExpenses.length === 0 && <p className="muted small">Нет дополнительных расходов. Быстро добавьте типовые кнопками ниже или свой расход.</p>}
          {s.extraExpenses.map((e) => {
            const isPercent = e.percent != null;
            const detail = detailFor(e.id);
            return (
              <div className="expense-row" key={e.id}>
                <input value={e.name} placeholder="Название (напр. Сборка)" onChange={(ev) => updExpense(e.id, { name: ev.target.value })} />
                <select
                  aria-label={`Тип расхода ${e.name || e.id}`}
                  value={isPercent ? 'percent' : 'fixed'}
                  onChange={(ev) => updExpense(e.id, ev.target.value === 'percent' ? { percent: e.percent ?? 10, amount: null } : { amount: e.amount, percent: null })}
                >
                  <option value="fixed">₽ фикс</option>
                  <option value="percent">% от суммы</option>
                </select>
                <NumInput
                  value={isPercent ? e.percent! : e.amount}
                  step={isPercent ? 0.5 : 1}
                  onChange={(v) => (isPercent ? updExpense(e.id, { percent: v }) : updExpense(e.id, { amount: v }))}
                  placeholder={isPercent ? '%' : '₽'}
                />
                <label className="chk"><input type="checkbox" checked={e.toClient} onChange={(ev) => updExpense(e.id, { toClient: ev.target.checked })} /> в цену клиента</label>
                {isPercent && <span className="expense-computed muted small">{detail ? `= ${fmtMoney(detail.amount)}` : 'сумма появится в итогах'}</span>}
                <button className="btn tiny danger" onClick={() => set({ extraExpenses: s.extraExpenses.filter((x) => x.id !== e.id) })}>✕</button>
              </div>
            );
          })}
          <div className="expense-presets system-action-strip">
            <button className="btn primary" onClick={() => addPreset('')}>+ Свой расход</button>
            <div className="dropdown action-dropdown wide">
              <button className="btn ghost" type="button">Типовые расходы ▾</button>
              <div className="dropdown-menu">
                <button type="button" onClick={() => addPreset('Сборка', { percent: 10 })}>Сборка 10%</button>
                <button type="button" onClick={() => addPreset('Доставка', { amount: null })}>Доставка</button>
                <button type="button" onClick={() => addPreset('Дизайнеру', { percent: 10, toClient: false })}>Дизайнеру 10%</button>
                <button type="button" onClick={() => addPreset('Подъём на этаж', { amount: null })}>Подъём на этаж</button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
