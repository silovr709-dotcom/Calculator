// График работ: замеры, доставки и монтажи по всем заказам в одном календаре.
// Даты и бригада правятся прямо здесь — отдельной таблицы вести не нужно.

import { useMemo, useState } from 'react';
import type { Project, ProjectSchedule, ScheduleStatus } from '../types';
import {
  SCHEDULE_KINDS, SCHEDULE_STATUSES, collectEvents, eventsByDay, isoDay, monthGrid,
  scheduleWarnings, teamLoad, upcomingEvents, weekGrid, type ScheduleEvent,
} from '../lib/schedule';
import { fmtDate } from '../lib/format';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

export default function ScheduleView(props: {
  projects: Project[];
  onOpen: (id: string) => void;
  onProjectChange: (project: Project) => void;
}) {
  const [mode, setMode] = useState<'month' | 'week'>('month');
  const [anchor, setAnchor] = useState(() => new Date());
  const [team, setTeam] = useState('');
  const [selectedDay, setSelectedDay] = useState(() => isoDay(new Date()));
  const [editProjectId, setEditProjectId] = useState<string | null>(null);

  const today = isoDay(new Date());
  const allEvents = useMemo(() => collectEvents(props.projects), [props.projects]);
  const events = useMemo(() => (team ? allEvents.filter((event) => (event.team?.trim() || 'Без бригады') === team) : allEvents), [allEvents, team]);
  const byDay = useMemo(() => eventsByDay(events), [events]);
  const days = useMemo(() => (mode === 'month' ? monthGrid(anchor) : weekGrid(anchor)), [mode, anchor]);
  const warnings = useMemo(() => scheduleWarnings(props.projects), [props.projects]);
  const load = useMemo(() => teamLoad(allEvents), [allEvents]);
  const upcoming = useMemo(() => upcomingEvents(events, today, 14), [events, today]);
  const teams = useMemo(() => Array.from(new Set(allEvents.map((event) => event.team?.trim() || 'Без бригады'))).sort(), [allEvents]);

  const editProject = props.projects.find((project) => project.id === editProjectId) ?? null;
  const dayEvents = byDay.get(selectedDay) ?? [];
  const monthTitle = `${MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}`;

  const shift = (direction: number) => {
    const next = new Date(anchor);
    if (mode === 'month') next.setMonth(next.getMonth() + direction);
    else next.setDate(next.getDate() + direction * 7);
    setAnchor(next);
  };

  const patchSchedule = (project: Project, patch: Partial<ProjectSchedule>) => {
    props.onProjectChange({
      ...project,
      schedule: { ...(project.schedule ?? {}), ...patch },
      updatedAt: new Date().toISOString(),
    });
  };

  const eventChip = (event: ScheduleEvent) => (
    <button key={event.id} type="button" className={`schedule-chip kind-${event.kind} status-${event.status}`}
      title={`${SCHEDULE_KINDS.find((kind) => kind.id === event.kind)?.label}: ${event.projectName}${event.team ? ` · ${event.team}` : ''}${event.address ? ` · ${event.address}` : ''}`}
      onClick={(mouse) => { mouse.stopPropagation(); setEditProjectId(event.projectId); setSelectedDay(event.date); }}>
      <b>{SCHEDULE_KINDS.find((kind) => kind.id === event.kind)?.short}</b>
      <span>{event.client}</span>
      {event.dayCount && event.dayCount > 1 && <small>{event.dayIndex}/{event.dayCount}</small>}
    </button>
  );

  return (
    <div className="view schedule-view">
      <header className="view-head">
        <div>
          <h1>График работ</h1>
          <p className="view-sub">Замеры, доставки и монтажи всех заказов. Даты и бригаду можно поменять прямо отсюда.</p>
        </div>
        <div className="schedule-head-actions">
          <div className="schedule-mode">
            <button type="button" className={mode === 'month' ? 'active' : ''} onClick={() => setMode('month')}>Месяц</button>
            <button type="button" className={mode === 'week' ? 'active' : ''} onClick={() => setMode('week')}>Неделя</button>
          </div>
          <div className="schedule-nav">
            <button type="button" onClick={() => shift(-1)} aria-label="Назад">←</button>
            <b>{mode === 'month' ? monthTitle : `неделя с ${fmtDate(days[0])}`}</b>
            <button type="button" onClick={() => shift(1)} aria-label="Вперёд">→</button>
            <button type="button" className="btn tiny ghost" onClick={() => { setAnchor(new Date()); setSelectedDay(today); }}>Сегодня</button>
          </div>
          <label className="schedule-team-filter">Бригада
            <select value={team} onChange={(event) => setTeam(event.target.value)}>
              <option value="">все</option>
              {teams.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
        </div>
      </header>

      <section className="schedule-legend">
        {SCHEDULE_KINDS.map((kind) => (
          <span key={kind.id} className={`schedule-legend-item kind-${kind.id}`}><b>{kind.short}</b>{kind.label}</span>
        ))}
        {load.length > 0 && (
          <span className="schedule-load">
            Загрузка бригад: {load.map((item) => `${item.team} — ${item.days} дн.`).join(' · ')}
          </span>
        )}
      </section>

      {warnings.length > 0 && (
        <section className="schedule-warnings">
          <b>Проверьте график ({warnings.length})</b>
          <ul>
            {warnings.slice(0, 6).map((warning) => (
              <li key={`${warning.projectId}-${warning.text}`}>
                {warning.projectId
                  ? <button type="button" onClick={() => setEditProjectId(warning.projectId)}>{warning.text}</button>
                  : warning.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="schedule-layout">
        <section className="card schedule-calendar">
          <div className="schedule-weekdays">{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div>
          <div className={`schedule-grid ${mode}`}>
            {days.map((day) => {
              const list = byDay.get(day) ?? [];
              const otherMonth = mode === 'month' && new Date(`${day}T00:00:00`).getMonth() !== anchor.getMonth();
              return (
                <button type="button" key={day}
                  className={`schedule-day${day === today ? ' today' : ''}${day === selectedDay ? ' selected' : ''}${otherMonth ? ' other-month' : ''}`}
                  onClick={() => setSelectedDay(day)}>
                  <span className="schedule-day-number">{Number(day.slice(8))}</span>
                  <div className="schedule-day-events">{list.slice(0, mode === 'month' ? 3 : 8).map(eventChip)}</div>
                  {list.length > (mode === 'month' ? 3 : 8) && <small>ещё {list.length - (mode === 'month' ? 3 : 8)}</small>}
                </button>
              );
            })}
          </div>
        </section>

        <aside className="schedule-side">
          <section className="card">
            <div className="section-head"><div><h3>{fmtDate(selectedDay)}</h3><p className="muted small">Что запланировано в выбранный день.</p></div><b>{dayEvents.length}</b></div>
            {dayEvents.length === 0
              ? <div className="empty small">На этот день ничего не назначено.</div>
              : <ul className="schedule-day-list">
                  {dayEvents.map((event) => (
                    <li key={event.id} className={`kind-${event.kind}`}>
                      <div>
                        <b>{SCHEDULE_KINDS.find((kind) => kind.id === event.kind)?.label}: {event.client}</b>
                        <small>{event.projectName}{event.team ? ` · ${event.team}` : ''}{event.address ? ` · ${event.address}` : ''}</small>
                      </div>
                      <div className="schedule-day-list-actions">
                        <button type="button" className="btn tiny ghost" onClick={() => setEditProjectId(event.projectId)}>Изменить</button>
                        <button type="button" className="btn tiny" onClick={() => props.onOpen(event.projectId)}>Проект</button>
                      </div>
                    </li>
                  ))}
                </ul>}
          </section>

          <section className="card">
            <div className="section-head"><div><h3>Ближайшие две недели</h3><p className="muted small">Всё, что нужно держать в голове.</p></div><b>{upcoming.length}</b></div>
            {upcoming.length === 0
              ? <div className="empty small">Ближайших работ нет.</div>
              : <ul className="schedule-upcoming">
                  {upcoming.slice(0, 12).map((event) => (
                    <li key={event.id}>
                      <span className={`schedule-dot kind-${event.kind}`} aria-hidden="true" />
                      <b>{fmtDate(event.date)}</b>
                      <span>{SCHEDULE_KINDS.find((kind) => kind.id === event.kind)?.label} · {event.client}</span>
                      <button type="button" onClick={() => setEditProjectId(event.projectId)}>→</button>
                    </li>
                  ))}
                </ul>}
          </section>
        </aside>
      </div>

      <section className="card schedule-editor">
        <div className="section-head">
          <div>
            <h3>Назначить даты</h3>
            <p className="muted small">Выберите заказ — и проставьте замер, готовность, доставку и монтаж. Монтаж длиной в несколько дней займёт их все.</p>
          </div>
        </div>
        <label className="schedule-project-picker">Заказ
          <select value={editProjectId ?? ''} onChange={(event) => setEditProjectId(event.target.value || null)}>
            <option value="">— выберите заказ —</option>
            {props.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.client ? `${project.client} · ` : ''}{project.name}
                {project.schedule?.installAt ? ` (монтаж ${project.schedule.installAt})` : ''}
              </option>
            ))}
          </select>
        </label>

        {editProject && (
          <div className="schedule-form">
            <label>Замер<input type="date" value={editProject.schedule?.measureAt ?? ''} onChange={(event) => patchSchedule(editProject, { measureAt: event.target.value || undefined })} /></label>
            <label>Готовность на фабрике<input type="date" value={editProject.schedule?.readyAt ?? ''} onChange={(event) => patchSchedule(editProject, { readyAt: event.target.value || undefined })} /></label>
            <label>Доставка<input type="date" value={editProject.schedule?.deliveryAt ?? ''} onChange={(event) => patchSchedule(editProject, { deliveryAt: event.target.value || undefined })} /></label>
            <label>Монтаж<input type="date" value={editProject.schedule?.installAt ?? ''} onChange={(event) => patchSchedule(editProject, { installAt: event.target.value || undefined })} /></label>
            <label>Дней монтажа<input type="number" min={1} max={14} value={editProject.schedule?.installDays ?? 1} onChange={(event) => patchSchedule(editProject, { installDays: Math.max(1, Number(event.target.value) || 1) })} /></label>
            <label>Бригада<input list="schedule-teams" value={editProject.schedule?.team ?? ''} placeholder="кто монтирует" onChange={(event) => patchSchedule(editProject, { team: event.target.value })} />
              <datalist id="schedule-teams">{teams.map((name) => <option key={name} value={name} />)}</datalist>
            </label>
            <label className="span-2">Адрес<input value={editProject.schedule?.address ?? ''} placeholder="куда ехать" onChange={(event) => patchSchedule(editProject, { address: event.target.value })} /></label>
            <label>Статус
              <select value={editProject.schedule?.status ?? 'planned'} onChange={(event) => patchSchedule(editProject, { status: event.target.value as ScheduleStatus })}>
                {SCHEDULE_STATUSES.map((status) => <option key={status.id} value={status.id}>{status.label}</option>)}
              </select>
            </label>
            <label className="span-3">Заметка для монтажников<input value={editProject.schedule?.note ?? ''} placeholder="этаж, лифт, время, контакты на объекте" onChange={(event) => patchSchedule(editProject, { note: event.target.value })} /></label>
            <div className="schedule-form-actions">
              <button type="button" className="btn ghost" onClick={() => props.onOpen(editProject.id)}>Открыть проект</button>
              <button type="button" className="btn ghost" onClick={() => patchSchedule(editProject, { measureAt: undefined, readyAt: undefined, deliveryAt: undefined, installAt: undefined })}>Очистить даты</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
