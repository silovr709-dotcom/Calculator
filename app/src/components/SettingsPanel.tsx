import type { ProjectSettings, SummaryGroup } from '../types';
import { SUMMARY_GROUPS } from '../types';
import { uid } from '../lib/storage';

function NumInput(props: { value: number | null; onChange: (v: number | null) => void; placeholder?: string; step?: number }) {
  return (
    <input
      type="number"
      step={props.step ?? 1}
      value={props.value ?? ''}
      placeholder={props.placeholder ?? 'не задано'}
      onChange={(e) => props.onChange(e.target.value === '' ? null : Number(e.target.value))}
    />
  );
}

export default function SettingsPanel(props: {
  title: string;
  settings: ProjectSettings;
  onChange: (s: ProjectSettings) => void;
  standalone?: boolean;
}) {
  const s = props.settings;
  const set = (patch: Partial<ProjectSettings>) => props.onChange({ ...s, ...patch });

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
          {s.extraExpenses.length === 0 && <p className="muted small">Нет дополнительных расходов. Добавьте, например, «Замер», «Подъём на этаж», «Проектирование».</p>}
          {s.extraExpenses.map((e) => (
            <div className="expense-row" key={e.id}>
              <input value={e.name} placeholder="Название" onChange={(ev) => set({ extraExpenses: s.extraExpenses.map((x) => x.id === e.id ? { ...x, name: ev.target.value } : x) })} />
              <NumInput value={e.amount} onChange={(v) => set({ extraExpenses: s.extraExpenses.map((x) => x.id === e.id ? { ...x, amount: v } : x) })} placeholder="₽" />
              <label className="chk"><input type="checkbox" checked={e.toClient} onChange={(ev) => set({ extraExpenses: s.extraExpenses.map((x) => x.id === e.id ? { ...x, toClient: ev.target.checked } : x) })} /> в цену клиента</label>
              <button className="btn tiny danger" onClick={() => set({ extraExpenses: s.extraExpenses.filter((x) => x.id !== e.id) })}>✕</button>
            </div>
          ))}
          <button className="btn ghost" onClick={() => set({ extraExpenses: [...s.extraExpenses, { id: uid('exp'), name: '', amount: null, toClient: true }] })}>+ Добавить расход</button>
        </section>
      </div>
    </div>
  );
}
