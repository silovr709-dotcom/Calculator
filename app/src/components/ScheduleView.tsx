// График работ: замеры, доставки и монтажи по всем заказам в одном календаре.
// Даты и бригада правятся прямо здесь — отдельной таблицы вести не нужно.

import { useEffect, useMemo, useState } from 'react';
import type { CalendarEvent, CalendarEventKind, Project, ProjectSchedule, ScheduleStatus } from '../types';
import {
  SCHEDULE_STATUSES, addDays, collectEvents, isoDay, monthGrid,
  scheduleWarnings, teamLoad, weekGrid,
} from '../lib/schedule';
import { fmtDate } from '../lib/format';
import {
  CALENDAR_KINDS, agendaByDay, buildAgenda, calendarKindMeta, filterAgenda, makeEvent,
  patchEvent, peopleFromAgenda, remindersFor, removeEvent, type AgendaItem,
} from '../lib/calendar';
import { askNotifyPermission, notifyPermission, pushReminderNotifications, type NotifyPermission } from '../lib/notify';
import { listWorkOrders, publishWorkOrder, serverFileUrl, workOrderUrl, type WorkOrderPayload, type WorkOrderSummary } from '../lib/serverApi';
import { dehydrate, fileRefId, isFileRef } from '../lib/photoStore';
import { REMINDER_OPTIONS, formatOffset } from '../lib/reminders';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

export default function ScheduleView(props: {
  projects: Project[];
  events: CalendarEvent[];
  me: string;
  onEventsChange: (events: CalendarEvent[]) => void;
  onOpen: (id: string) => void;
  onProjectChange: (project: Project) => void;
}) {
  const [mode, setMode] = useState<'month' | 'week'>('month');
  const [anchor, setAnchor] = useState(() => new Date());
  const [person, setPerson] = useState('');
  const [onlyMine, setOnlyMine] = useState(false);
  const [selectedDay, setSelectedDay] = useState(() => isoDay(new Date()));
  const [editProjectId, setEditProjectId] = useState<string | null>(null);
  const [editEventId, setEditEventId] = useState<string | null>(null);
  const [permission, setPermission] = useState<NotifyPermission>(() => notifyPermission());
  const [orders, setOrders] = useState<WorkOrderSummary[]>([]);
  const [orderBusy, setOrderBusy] = useState(false);
  const [orderCopied, setOrderCopied] = useState('');
  // Черновик наряда: позиции и пометки можно править перед отправкой мастеру.
  const [orderDraft, setOrderDraft] = useState<WorkOrderPayload | null>(null);

  const today = isoDay(new Date());
  const agendaAll = useMemo(() => buildAgenda(props.projects, props.events), [props.projects, props.events]);
  const activePerson = onlyMine ? props.me : person;
  const agenda = useMemo(() => filterAgenda(agendaAll, { assignee: activePerson }), [agendaAll, activePerson]);
  const byDay = useMemo(() => agendaByDay(agenda), [agenda]);
  const days = useMemo(() => (mode === 'month' ? monthGrid(anchor) : weekGrid(anchor)), [mode, anchor]);
  const warnings = useMemo(() => scheduleWarnings(props.projects), [props.projects]);
  const load = useMemo(() => teamLoad(collectEvents(props.projects)), [props.projects]);
  const people = useMemo(() => peopleFromAgenda(agendaAll), [agendaAll]);
  const reminders = useMemo(() => remindersFor(agendaAll, props.me || activePerson, today), [agendaAll, props.me, activePerson, today]);
  const upcoming = useMemo(
    () => agenda.filter((item) => item.date >= today && item.date <= addDays(today, 14)),
    [agenda, today],
  );

  // Пока приложение открыто, напоминаем о сегодняшних и просроченных делах.
  useEffect(() => {
    if (permission !== 'granted') return;
    const run = () => pushReminderNotifications(reminders, today);
    const timer = window.setTimeout(run, 1500);
    const interval = window.setInterval(run, 5 * 60 * 1000);
    return () => { window.clearTimeout(timer); window.clearInterval(interval); };
  }, [permission, reminders, today]);

  // Наряды мастерам: статус «в пути / идёт / готово / нужна помощь» виден прямо в графике.
  useEffect(() => {
    let alive = true;
    listWorkOrders().then((list) => { if (alive) setOrders(list); }).catch(() => { /* без сервера блок скрыт */ });
    return () => { alive = false; };
  }, []);

  const ORDER_STATUS_LABELS: Record<string, string> = {
    sent: 'наряд выдан', onway: 'мастер в пути', started: 'монтаж идёт', done: 'завершено', problem: 'нужна помощь',
  };

  /** Собираем наряд из данных проекта: позиции, адрес, заметки и эскизы. */
  const buildOrderDraft = async (project: Project): Promise<WorkOrderPayload> => {
    const schedule = project.schedule ?? {};
    // Эскизы Эскиз PRO кладём в файлы сервера — мастер увидит их картинками.
    const snapshots = (project.eskizPro?.snapshots ?? []).slice(0, 3);
    const sketchUrls = snapshots
      .map((snapshot) => (snapshot.project as { image?: { dataUrl?: string } } | undefined)?.image?.dataUrl)
      .filter((value): value is string => typeof value === 'string' && value.length > 0);
    const packed = await dehydrate(sketchUrls);
    const images = (packed as string[]).filter(isFileRef).map(fileRefId);
    return {
      title: project.name,
      client: project.client || 'Клиент',
      phone: project.clientOffer?.clientPhone,
      address: schedule.address,
      date: schedule.installAt ?? '',
      time: schedule.note?.match(/\d{1,2}:\d{2}/)?.[0],
      team: schedule.team,
      note: schedule.note,
      manager: project.clientOffer?.sellerName,
      items: (project.modules ?? []).map((module) => `${module.name}${module.widthMm ? ` · ${module.widthMm}×${module.heightMm ?? '—'}${module.depthMm ? `×${module.depthMm}` : ''} мм` : ''}${module.qty > 1 ? ` · ${module.qty} шт` : ''}`),
      images,
    };
  };

  const prepareOrder = async (project: Project) => {
    setOrderBusy(true);
    try {
      setOrderDraft(await buildOrderDraft(project));
    } finally {
      setOrderBusy(false);
    }
  };

  const sendWorkOrder = async (project: Project) => {
    const draft = orderDraft ?? await buildOrderDraft(project);
    if (!draft.date) { alert('Сначала поставьте дату монтажа.'); return; }
    const existing = orders.find((item) => item.projectId === project.id);
    setOrderBusy(true);
    try {
      const result = await publishWorkOrder({ id: existing?.id, projectId: project.id, payload: draft });
      setOrders((current) => [...current.filter((item) => item.id !== result.id), result.order]);
      await navigator.clipboard.writeText(result.url).catch(() => {});
      setOrderCopied(result.id);
      window.setTimeout(() => setOrderCopied(''), 2500);
    } catch (error) {
      alert(`Не получилось выдать наряд: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setOrderBusy(false);
    }
  };

  const editProject = props.projects.find((project) => project.id === editProjectId) ?? null;
  const editEvent = props.events.find((event) => event.id === editEventId) ?? null;
  const dayEvents = byDay.get(selectedDay) ?? [];
  const monthTitle = `${MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}`;

  const createEvent = (date: string) => {
    const event = makeEvent({ title: 'Новое дело', date, kind: 'measure', assignees: props.me ? [props.me] : [] }, props.me);
    props.onEventsChange([...props.events, event]);
    setEditEventId(event.id);
    setSelectedDay(date);
  };

  const updateEvent = (id: string, patch: Partial<CalendarEvent>) => props.onEventsChange(patchEvent(props.events, id, patch));
  const deleteEvent = (id: string) => {
    if (!confirm('Удалить это дело из календаря?')) return;
    props.onEventsChange(removeEvent(props.events, id));
    setEditEventId(null);
  };

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

  const openItem = (item: AgendaItem) => {
    setSelectedDay(item.date);
    if (item.source === 'event' && item.eventId) { setEditEventId(item.eventId); setEditProjectId(null); }
    else if (item.projectId) { setEditProjectId(item.projectId); setEditEventId(null); }
  };

  const eventChip = (item: AgendaItem) => (
    <button key={item.id} type="button"
      className={`schedule-chip kind-${item.kind} status-${item.status}${item.done ? ' done' : ''}`}
      title={`${calendarKindMeta(item.kind).label}: ${item.title}${item.assignees.length ? ` · ${item.assignees.join(', ')}` : ''}${item.address ? ` · ${item.address}` : ''}`}
      onClick={(mouse) => { mouse.stopPropagation(); openItem(item); }}>
      <b>{calendarKindMeta(item.kind).short}</b>
      <span>{item.timeStart ? `${item.timeStart} ` : ''}{item.client || item.title}</span>
      {item.dayCount && item.dayCount > 1 && <small>{item.dayIndex}/{item.dayCount}</small>}
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
          <label className="schedule-team-filter">Сотрудник
            <select value={person} disabled={onlyMine} onChange={(event) => setPerson(event.target.value)}>
              <option value="">все</option>
              {people.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          {props.me && (
            <label className="schedule-mine">
              <input type="checkbox" checked={onlyMine} onChange={(event) => setOnlyMine(event.target.checked)} />
              Только мои ({props.me})
            </label>
          )}
          <button type="button" className="btn primary" onClick={() => createEvent(selectedDay)}>+ Новое дело</button>
        </div>
      </header>

      <section className="schedule-legend">
        {CALENDAR_KINDS.map((kind) => (
          <span key={kind.id} className={`schedule-legend-item kind-${kind.id}`}><b>{kind.short}</b>{kind.label}</span>
        ))}
        {load.length > 0 && (
          <span className="schedule-load">
            Загрузка бригад: {load.map((item) => `${item.team} — ${item.days} дн.`).join(' · ')}
          </span>
        )}
      </section>

      <section className={`schedule-reminders${reminders.some((item) => item.tone === 'overdue') ? ' alert' : ''}`}>
        <div className="schedule-reminders-main">
          <b>Напоминания{reminders.length > 0 ? ` · ${reminders.length}` : ''}</b>
          {reminders.length === 0
            ? <span className="muted small">На сегодня и завтра дел нет.</span>
            : <ul>
                {reminders.slice(0, 5).map((reminder) => (
                  <li key={reminder.id} className={`tone-${reminder.tone}`}>
                    <b>{reminder.tone === 'overdue' ? 'просрочено' : reminder.tone === 'today' ? 'сегодня' : 'завтра'}</b>
                    <span>{reminder.title}</span>
                    {reminder.detail && <small>{reminder.detail}</small>}
                  </li>
                ))}
              </ul>}
        </div>
        {permission !== 'granted' && (
          <button type="button" className="btn tiny ghost" disabled={permission === 'denied' || permission === 'unsupported'}
            onClick={() => { void askNotifyPermission().then(setPermission); }}>
            {permission === 'denied' ? 'Уведомления запрещены в браузере'
              : permission === 'unsupported' ? 'Браузер не умеет уведомления'
              : 'Включить уведомления'}
          </button>
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
                  <span className="schedule-day-number">
                    {Number(day.slice(8))}
                    <i className="schedule-day-add" title="Добавить дело"
                      onClick={(mouse) => { mouse.stopPropagation(); createEvent(day); }}>+</i>
                  </span>
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
                  {dayEvents.map((item) => (
                    <li key={item.id} className={`kind-${item.kind}${item.done ? ' done' : ''}`}>
                      <div>
                        <b>{calendarKindMeta(item.kind).label}: {item.client || item.title}</b>
                        <small>
                          {[item.timeStart && `${item.timeStart}${item.timeEnd ? `–${item.timeEnd}` : ''}`,
                            item.source === 'project' ? item.title : null,
                            item.assignees.join(', '),
                            item.address].filter(Boolean).join(' · ')}
                        </small>
                      </div>
                      <div className="schedule-day-list-actions">
                        {item.source === 'event' && item.eventId && (
                          <button type="button" className="btn tiny ghost" title="Отметить выполненным"
                            onClick={() => updateEvent(item.eventId!, { done: !item.done, status: item.done ? 'planned' : 'done' })}>
                            {item.done ? '↺' : '✓'}
                          </button>
                        )}
                        <button type="button" className="btn tiny ghost" onClick={() => openItem(item)}>Изменить</button>
                        {item.projectId && <button type="button" className="btn tiny" onClick={() => props.onOpen(item.projectId!)}>Проект</button>}
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
                  {upcoming.slice(0, 12).map((item) => (
                    <li key={item.id}>
                      <span className={`schedule-dot kind-${item.kind}`} aria-hidden="true" />
                      <b>{fmtDate(item.date)}</b>
                      <span>{calendarKindMeta(item.kind).label} · {item.client || item.title}</span>
                      <button type="button" onClick={() => openItem(item)}>→</button>
                    </li>
                  ))}
                </ul>}
          </section>
        </aside>
      </div>

      {editEvent && (
        <section className="card schedule-editor">
          <div className="section-head">
            <div>
              <h3>Дело в календаре</h3>
              <p className="muted small">Своё дело без заказа: замер, выезд, встреча, сервис. Можно поручить сотруднику.</p>
            </div>
            <button type="button" className="btn tiny ghost" onClick={() => setEditEventId(null)}>Свернуть</button>
          </div>
          <div className="schedule-form">
            <label className="span-2">Что сделать
              <input value={editEvent.title} onChange={(event) => updateEvent(editEvent.id, { title: event.target.value })} />
            </label>
            <label>Тип
              <select value={editEvent.kind} onChange={(event) => updateEvent(editEvent.id, { kind: event.target.value as CalendarEventKind })}>
                {CALENDAR_KINDS.map((kind) => <option key={kind.id} value={kind.id}>{kind.label}</option>)}
              </select>
            </label>
            <label>Дата
              <input type="date" value={editEvent.date} onChange={(event) => updateEvent(editEvent.id, { date: event.target.value })} />
            </label>
            <label>Дней
              <input type="number" min={1} max={30} value={editEvent.days ?? 1}
                onChange={(event) => updateEvent(editEvent.id, { days: Math.max(1, Number(event.target.value) || 1) })} />
            </label>
            <label>Время с
              <input type="time" value={editEvent.timeStart ?? ''} onChange={(event) => updateEvent(editEvent.id, { timeStart: event.target.value || undefined })} />
            </label>
            <label>до
              <input type="time" value={editEvent.timeEnd ?? ''} onChange={(event) => updateEvent(editEvent.id, { timeEnd: event.target.value || undefined })} />
            </label>
            <label>Кому поручено
              <input list="schedule-people" value={editEvent.assignees.join(', ')} placeholder="через запятую"
                onChange={(event) => updateEvent(editEvent.id, { assignees: event.target.value.split(',').map((name) => name.trim()).filter(Boolean) })} />
              <datalist id="schedule-people">{people.map((name) => <option key={name} value={name} />)}</datalist>
            </label>
            <label>Клиент
              <input value={editEvent.clientName ?? ''} placeholder="кто заказчик" onChange={(event) => updateEvent(editEvent.id, { clientName: event.target.value })} />
            </label>
            <label>Статус
              <select value={editEvent.status} onChange={(event) => updateEvent(editEvent.id, { status: event.target.value as ScheduleStatus })}>
                {SCHEDULE_STATUSES.map((status) => <option key={status.id} value={status.id}>{status.label}</option>)}
              </select>
            </label>
            <label className="span-2">Адрес
              <input value={editEvent.address ?? ''} placeholder="куда ехать" onChange={(event) => updateEvent(editEvent.id, { address: event.target.value })} />
            </label>
            <label className="span-3">Заметка
              <input value={editEvent.note ?? ''} placeholder="этаж, домофон, что взять с собой" onChange={(event) => updateEvent(editEvent.id, { note: event.target.value })} />
            </label>
            <div className="span-3 schedule-reminder-picker">
              <b>Напомнить</b>
              <div className="notify-chips">
                <button type="button" className={(editEvent.reminders ?? []).length === 0 ? 'active' : ''}
                  onClick={() => updateEvent(editEvent.id, { reminders: [] })}>
                  Как в настройках
                </button>
                {REMINDER_OPTIONS.map((option) => {
                  const list = editEvent.reminders ?? [];
                  const active = list.includes(option.minutes);
                  return (
                    <button key={option.minutes} type="button" className={active ? 'active' : ''}
                      onClick={() => updateEvent(editEvent.id, {
                        reminders: active
                          ? list.filter((item) => item !== option.minutes)
                          : [...list, option.minutes].sort((a, b) => a - b),
                      })}>
                      {option.short}
                    </button>
                  );
                })}
              </div>
              <small className="muted">
                {(editEvent.reminders ?? []).length === 0
                  ? 'Сработают интервалы по умолчанию из раздела «Настройки».'
                  : `Напомним: ${(editEvent.reminders ?? []).map(formatOffset).join(', ').toLowerCase()}.`}
              </small>
            </div>
            <label>Связать с заказом
              <select value={editEvent.projectId ?? ''} onChange={(event) => updateEvent(editEvent.id, { projectId: event.target.value || undefined })}>
                <option value="">без заказа</option>
                {props.projects.map((project) => <option key={project.id} value={project.id}>{project.client ? `${project.client} · ` : ''}{project.name}</option>)}
              </select>
            </label>
            <div className="schedule-form-actions">
              <button type="button" className="btn ghost"
                onClick={() => updateEvent(editEvent.id, { done: !editEvent.done, status: editEvent.done ? 'planned' : 'done' })}>
                {editEvent.done ? 'Вернуть в работу' : 'Отметить выполненным'}
              </button>
              {editEvent.projectId && <button type="button" className="btn ghost" onClick={() => props.onOpen(editEvent.projectId!)}>Открыть заказ</button>}
              <button type="button" className="btn ghost danger" onClick={() => deleteEvent(editEvent.id)}>Удалить дело</button>
            </div>
          </div>
        </section>
      )}

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
              <datalist id="schedule-teams">{people.map((name) => <option key={name} value={name} />)}</datalist>
            </label>
            <label className="span-2">Адрес<input value={editProject.schedule?.address ?? ''} placeholder="куда ехать" onChange={(event) => patchSchedule(editProject, { address: event.target.value })} /></label>
            <label>Статус
              <select value={editProject.schedule?.status ?? 'planned'} onChange={(event) => patchSchedule(editProject, { status: event.target.value as ScheduleStatus })}>
                {SCHEDULE_STATUSES.map((status) => <option key={status.id} value={status.id}>{status.label}</option>)}
              </select>
            </label>
            <label className="span-3">Заметка для монтажников<input value={editProject.schedule?.note ?? ''} placeholder="этаж, лифт, время, контакты на объекте" onChange={(event) => patchSchedule(editProject, { note: event.target.value })} /></label>
            <div className="span-3 schedule-order">
              {(() => {
                const order = orders.find((item) => item.projectId === editProject.id);
                return (
                  <>
                    <div className="schedule-order-main">
                      <b>Наряд мастеру</b>
                      {order
                        ? <>
                            <span className={`schedule-order-status status-${order.status}`}>{ORDER_STATUS_LABELS[order.status] ?? order.status}</span>
                            {order.lastComment && <small>«{order.lastComment}»{order.lastBy ? ` — ${order.lastBy}` : ''}</small>}
                            <input readOnly value={workOrderUrl(order.id)} onFocus={(event) => event.target.select()} />
                          </>
                        : <span className="muted small">Ссылка для монтажника: адрес, список модулей, маршрут и кнопки «выехал / начал / завершил / нужна помощь».</span>}
                    </div>
                    <div className="schedule-order-actions">
                      <button type="button" className="btn ghost" disabled={orderBusy} onClick={() => void prepareOrder(editProject)}>
                        {orderDraft ? 'Пересобрать' : 'Подготовить наряд'}
                      </button>
                      <button type="button" className="btn primary" disabled={orderBusy} onClick={() => void sendWorkOrder(editProject)}>
                        {orderBusy ? 'Готовлю…' : orderCopied === order?.id ? 'Ссылка скопирована ✓' : order ? 'Обновить наряд' : 'Выдать наряд и скопировать'}
                      </button>
                      {order && <a className="btn ghost" href={workOrderUrl(order.id)} target="_blank" rel="noreferrer">Открыть как мастер</a>}
                    </div>

                    {orderDraft && (
                      <div className="schedule-order-draft">
                        <b>Что увидит мастер</b>
                        <div className="schedule-order-draft-grid">
                          <label>Дата<input type="date" value={orderDraft.date} onChange={(event) => setOrderDraft({ ...orderDraft, date: event.target.value })} /></label>
                          <label>Время<input value={orderDraft.time ?? ''} placeholder="10:00" onChange={(event) => setOrderDraft({ ...orderDraft, time: event.target.value })} /></label>
                          <label>Бригада<input value={orderDraft.team ?? ''} onChange={(event) => setOrderDraft({ ...orderDraft, team: event.target.value })} /></label>
                          <label>Телефон клиента<input value={orderDraft.phone ?? ''} onChange={(event) => setOrderDraft({ ...orderDraft, phone: event.target.value })} /></label>
                          <label className="span-2">Адрес<input value={orderDraft.address ?? ''} onChange={(event) => setOrderDraft({ ...orderDraft, address: event.target.value })} /></label>
                          <label className="span-2">Пометки для мастера<textarea rows={2} value={orderDraft.note ?? ''} placeholder="этаж, лифт, домофон, что взять с собой" onChange={(event) => setOrderDraft({ ...orderDraft, note: event.target.value })} /></label>
                        </div>

                        <div className="schedule-order-items">
                          <b>Позиции ({orderDraft.items.length})</b>
                          {orderDraft.items.map((item, index) => (
                            <div className="schedule-order-item" key={index}>
                              <input value={item} onChange={(event) => setOrderDraft({
                                ...orderDraft,
                                items: orderDraft.items.map((value, position) => (position === index ? event.target.value : value)),
                              })} />
                              <button type="button" aria-label="Убрать позицию" onClick={() => setOrderDraft({
                                ...orderDraft,
                                items: orderDraft.items.filter((_, position) => position !== index),
                              })}>✕</button>
                            </div>
                          ))}
                          <button type="button" className="btn tiny ghost" onClick={() => setOrderDraft({ ...orderDraft, items: [...orderDraft.items, ''] })}>+ Добавить позицию</button>
                        </div>

                        {(orderDraft.images ?? []).length > 0 && (
                          <div className="schedule-order-images">
                            <b>Эскизы в наряде ({(orderDraft.images ?? []).length})</b>
                            <div>
                              {(orderDraft.images ?? []).map((fileId) => (
                                <span key={fileId}>
                                  <img src={serverFileUrl(fileId)} alt="Эскиз" />
                                  <button type="button" aria-label="Убрать эскиз" onClick={() => setOrderDraft({
                                    ...orderDraft,
                                    images: (orderDraft.images ?? []).filter((value) => value !== fileId),
                                  })}>✕</button>
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
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
