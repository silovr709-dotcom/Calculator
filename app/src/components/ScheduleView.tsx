// График работ: замеры, доставки и монтажи по всем заказам в одном календаре.
// Даты и бригада правятся прямо здесь — отдельной таблицы вести не нужно.

import { useEffect, useMemo, useState } from 'react';
import type { CalendarEvent, CalendarEventKind, Project, ProjectSchedule } from '../types';
import { addDays, collectEvents, isoDay, monthGrid, scheduleFieldForKind, scheduleWarnings, teamLoad, weekGrid } from '../lib/schedule';
import { addressBook, dayRoute, mapPointUrl, mapRouteUrl } from '../lib/maps';
import { isWeekend } from '../lib/viewPrefs';
import { fmtDate } from '../lib/format';
import {
  CALENDAR_KINDS, agendaByDay, buildAgenda, calendarKindMeta, filterAgenda, makeEvent,
  patchEvent, peopleFromAgenda, remindersFor, removeEvent, type AgendaItem,
} from '../lib/calendar';
import { askNotifyPermission, notifyPermission, pushReminderNotifications, type NotifyPermission } from '../lib/notify';
import { listWorkOrders, publishWorkOrder, type WorkOrderPayload, type WorkOrderSummary } from '../lib/serverApi';
import { dehydrate, fileRefId, isFileRef } from '../lib/photoStore';
import ScheduleDialog from './ScheduleDialog';

const VIEW_KEY = 'recept.schedule.view.v1';
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
  // Вид и фильтры запоминаются: при следующем заходе календарь открывается так же.
  const saved = useMemo(() => {
    try {
      const raw = localStorage.getItem(VIEW_KEY);
      return raw ? (JSON.parse(raw) as Partial<{ mode: 'month' | 'week'; person: string; onlyMine: boolean; kinds: CalendarEventKind[] }>) : {};
    } catch {
      return {};
    }
  }, []);

  const [mode, setMode] = useState<'month' | 'week'>(saved.mode === 'week' ? 'week' : 'month');
  const [anchor, setAnchor] = useState(() => new Date());
  const [person, setPerson] = useState(saved.person ?? '');
  const [onlyMine, setOnlyMine] = useState(Boolean(saved.onlyMine));
  const [kinds, setKinds] = useState<CalendarEventKind[]>(saved.kinds ?? []);
  const [undoMove, setUndoMove] = useState<{ text: string; revert: () => void } | null>(null);
  const [selectedDay, setSelectedDay] = useState(() => isoDay(new Date()));
  const [editProjectId, setEditProjectId] = useState<string | null>(null);
  const [editEventId, setEditEventId] = useState<string | null>(null);
  const [permission, setPermission] = useState<NotifyPermission>(() => notifyPermission());
  const [orders, setOrders] = useState<WorkOrderSummary[]>([]);
  const [orderBusy, setOrderBusy] = useState(false);
  const [orderCopied, setOrderCopied] = useState('');
  // Черновик наряда: позиции и пометки можно править перед отправкой мастеру.
  const [orderDraft, setOrderDraft] = useState<WorkOrderPayload | null>(null);
  const [dragItem, setDragItem] = useState<AgendaItem | null>(null);
  const [dragOverDay, setDragOverDay] = useState('');

  const today = isoDay(new Date());
  const agendaAll = useMemo(() => buildAgenda(props.projects, props.events), [props.projects, props.events]);
  const activePerson = onlyMine ? props.me : person;
  const agenda = useMemo(() => filterAgenda(agendaAll, { assignee: activePerson, kinds }), [agendaAll, activePerson, kinds]);
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

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify({ mode, person, onlyMine, kinds }));
    } catch {
      /* память браузера переполнена — не критично */
    }
  }, [mode, person, onlyMine, kinds]);

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

  // Адреса выбранного дня по времени — из них строится маршрут одной ссылкой.
  const routeStops = useMemo(
    () => dayRoute((byDay.get(selectedDay) ?? []).map((item) => ({
      address: item.address ?? '',
      title: `${calendarKindMeta(item.kind).label}: ${item.client || item.title}`,
      time: item.timeStart,
    }))),
    [byDay, selectedDay],
  );
  const addresses = useMemo(() => addressBook(props.projects, [], props.events), [props.projects, props.events]);

  const editProject = props.projects.find((project) => project.id === editProjectId) ?? null;
  const editEvent = props.events.find((event) => event.id === editEventId) ?? null;
  const dayEvents = byDay.get(selectedDay) ?? [];
  const monthTitle = `${MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}`;
  const periodCount = days.reduce((sum, day) => sum + (byDay.get(day)?.length ?? 0), 0);

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

  // Стрелки листают период, «Т» возвращает на сегодня.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (editEventId || editProjectId) return;
      if (event.key === 'ArrowLeft') shift(-1);
      else if (event.key === 'ArrowRight') shift(1);
      else if (event.key === 't' || event.key === 'е' || event.key === 'T' || event.key === 'Е') {
        setAnchor(new Date());
        setSelectedDay(isoDay(new Date()));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });


  const patchSchedule = (project: Project, patch: Partial<ProjectSchedule>) => {
    props.onProjectChange({
      ...project,
      schedule: { ...(project.schedule ?? {}), ...patch },
      updatedAt: new Date().toISOString(),
    });
  };

  /** Перенос мышью: дело получает новую дату, у заказа меняется нужное поле. */
  const moveItemTo = (item: AgendaItem, day: string) => {
    if (!day || day === item.date) return;
    const back = item.dayIndex ? item.dayIndex - 1 : 0;
    const label = `${calendarKindMeta(item.kind).label}: ${item.client || item.title}`;

    if (item.source === 'event' && item.eventId) {
      const eventId = item.eventId;
      const previous = props.events.find((candidate) => candidate.id === eventId)?.date;
      updateEvent(eventId, { date: addDays(day, -back) });
      setUndoMove({
        text: `${label} → ${fmtDate(day)}`,
        revert: () => { if (previous) updateEvent(eventId, { date: previous }); },
      });
      return;
    }

    const project = props.projects.find((candidate) => candidate.id === item.projectId);
    if (!project) return;
    const field = scheduleFieldForKind(
      item.kind === 'measure' || item.kind === 'delivery' || item.kind === 'install' ? item.kind : 'ready',
    );
    const previous = project.schedule?.[field];
    patchSchedule(project, { [field]: addDays(day, -back) });
    setUndoMove({
      text: `${label} → ${fmtDate(day)}`,
      revert: () => patchSchedule(project, { [field]: previous }),
    });
  };

  const openItem = (item: AgendaItem) => {
    setSelectedDay(item.date);
    if (item.source === 'event' && item.eventId) { setEditEventId(item.eventId); setEditProjectId(null); }
    else if (item.projectId) { setEditProjectId(item.projectId); setEditEventId(null); }
  };

  const eventChip = (item: AgendaItem) => (
    <button key={item.id} type="button"
      draggable
      onDragStart={(drag) => { drag.stopPropagation(); setDragItem(item); drag.dataTransfer.effectAllowed = 'move'; }}
      onDragEnd={() => { setDragItem(null); setDragOverDay(''); }}
      className={`schedule-chip kind-${item.kind} status-${item.status}${item.done ? ' done' : ''}${dragItem?.id === item.id ? ' dragging' : ''}`}
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
            <b>
              {mode === 'month' ? monthTitle : `неделя с ${fmtDate(days[0])}`}
              <small>{periodCount > 0 ? `${periodCount} работ` : 'пусто'}</small>
            </b>
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
          <label className="schedule-project-pick">Даты заказа
            <select value="" onChange={(event) => { if (event.target.value) { setEditProjectId(event.target.value); setEditEventId(null); } }}>
              <option value="">выбрать заказ…</option>
              {props.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.client ? `${project.client} · ` : ''}{project.name}{project.schedule?.installAt ? ` (монтаж ${project.schedule.installAt})` : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <section className="schedule-legend" aria-label="Фильтр по типам работ">
        {CALENDAR_KINDS.map((kind) => {
          const active = kinds.length === 0 || kinds.includes(kind.id);
          const count = agendaAll.filter((item) => item.kind === kind.id).length;
          return (
            <button key={kind.id} type="button"
              className={`schedule-legend-item kind-${kind.id}${active ? '' : ' off'}`}
              title={active ? 'Скрыть этот тип' : 'Показать этот тип'}
              onClick={() => setKinds((current) => {
                const base = current.length === 0 ? CALENDAR_KINDS.map((item) => item.id) : current;
                const next = base.includes(kind.id) ? base.filter((item) => item !== kind.id) : [...base, kind.id];
                return next.length === CALENDAR_KINDS.length ? [] : next;
              })}>
              <b>{kind.short}</b>{kind.label}
              {count > 0 && <i>{count}</i>}
            </button>
          );
        })}
        {kinds.length > 0 && (
          <button type="button" className="schedule-legend-reset" onClick={() => setKinds([])}>показать все</button>
        )}
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
                  className={`schedule-day${day === today ? ' today' : ''}${day === selectedDay ? ' selected' : ''}${otherMonth ? ' other-month' : ''}${isWeekend(day) ? ' weekend' : ''}${dragOverDay === day ? ' drag-over' : ''}`}
                  title="Клик — выбрать день, двойной клик — создать дело. Плашку можно перетащить на другой день"
                  onClick={() => setSelectedDay(day)}
                  onDoubleClick={() => createEvent(day)}
                  onDragOver={(drag) => { if (dragItem) { drag.preventDefault(); drag.dataTransfer.dropEffect = 'move'; setDragOverDay(day); } }}
                  onDragLeave={() => setDragOverDay((current) => (current === day ? '' : current))}
                  onDrop={(drag) => {
                    drag.preventDefault();
                    if (dragItem) moveItemTo(dragItem, day);
                    setDragItem(null);
                    setDragOverDay('');
                  }}>
                  <span className="schedule-day-number">
                    {Number(day.slice(8))}
                    <i className="schedule-day-add" title="Добавить дело"
                      onClick={(mouse) => { mouse.stopPropagation(); createEvent(day); }}>+</i>
                  </span>
                  <div className="schedule-day-events">{list.slice(0, mode === 'month' ? 3 : 8).map(eventChip)}</div>
                  {list.length > (mode === 'month' ? 3 : 8) && (
                    <small className="schedule-day-more">ещё {list.length - (mode === 'month' ? 3 : 8)} — открыть день</small>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        <aside className="schedule-side">
          <section className="card">
            <div className="section-head"><div><h3>{fmtDate(selectedDay)}</h3><p className="muted small">Что запланировано в выбранный день.</p></div><b>{dayEvents.length}</b></div>
            {routeStops.length > 1 && (
              <a className="btn tiny primary schedule-route-btn" href={mapRouteUrl(routeStops.map((stop) => stop.address))}
                target="_blank" rel="noreferrer">
                Маршрут на день · {routeStops.length} точки
              </a>
            )}
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
                            item.assignees.join(', ')].filter(Boolean).join(' · ')}
                        </small>
                        {item.address && (
                          <a className="schedule-map-link" href={mapPointUrl(item.address)} target="_blank" rel="noreferrer"
                            onClick={(click) => click.stopPropagation()}>
                            📍 {item.address}
                          </a>
                        )}
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

      {undoMove && (
        <div className="schedule-undo" role="status">
          <span>Перенесено: {undoMove.text}</span>
          <button type="button" onClick={() => { undoMove.revert(); setUndoMove(null); }}>Отменить</button>
          <button type="button" className="schedule-undo-close" aria-label="Скрыть" onClick={() => setUndoMove(null)}>✕</button>
        </div>
      )}

      {/* Правка дела и дат заказа — отдельным окном, как редактор модуля. */}
      {(editEvent || editProject) && (
        <ScheduleDialog
          mode={editEvent ? 'event' : 'project'}
          editEvent={editEvent}
          editProject={editProject}
          projects={props.projects}
          addresses={addresses}
          people={people}
          orders={orders}
          orderDraft={orderDraft}
          orderBusy={orderBusy}
          orderCopied={orderCopied}
          onClose={() => { setEditEventId(null); setEditProjectId(null); setOrderDraft(null); }}
          onOpen={props.onOpen}
          updateEvent={updateEvent}
          deleteEvent={deleteEvent}
          patchSchedule={patchSchedule}
          prepareOrder={(project) => void prepareOrder(project)}
          sendWorkOrder={(project) => void sendWorkOrder(project)}
          setOrderDraft={setOrderDraft}
        />
      )}
    </div>
  );
}
