// Окно правки дела и дат заказа. Экран графика остаётся календарём,
// а все подробности открываются отдельным окном — как редактор модуля.

import { useEffect } from 'react';
import type { CalendarEvent, CalendarEventKind, Project, ProjectSchedule, ScheduleStatus } from '../types';
import { Overlay } from './Portal';
import { SCHEDULE_STATUSES } from '../lib/schedule';
import { CALENDAR_KINDS } from '../lib/calendar';
import { fmtDateLong } from '../lib/format';
import ReminderPicker from './ReminderPicker';
import { serverFileUrl, workOrderUrl, type WorkOrderPayload, type WorkOrderSummary } from '../lib/serverApi';

const ORDER_STATUS_LABELS: Record<string, string> = {
  sent: 'наряд выдан',
  onway: 'мастер в пути',
  started: 'монтаж идёт',
  done: 'завершено',
  problem: 'нужна помощь',
};

export default function ScheduleDialog(props: {
  mode: 'event' | 'project';
  editEvent: CalendarEvent | null;
  editProject: Project | null;
  projects: Project[];
  people: string[];
  orders: WorkOrderSummary[];
  orderDraft: WorkOrderPayload | null;
  orderBusy: boolean;
  orderCopied: string;
  onClose: () => void;
  onOpen: (id: string) => void;
  updateEvent: (id: string, patch: Partial<CalendarEvent>) => void;
  deleteEvent: (id: string) => void;
  patchSchedule: (project: Project, patch: Partial<ProjectSchedule>) => void;
  prepareOrder: (project: Project) => void;
  sendWorkOrder: (project: Project) => void;
  setOrderDraft: (draft: WorkOrderPayload | null) => void;
}) {
  const { editEvent, editProject, people, orders, orderDraft, orderBusy, orderCopied } = props;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') props.onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props]);

  const title = props.mode === 'event'
    ? (editEvent?.title || 'Дело в календаре')
    : `${editProject?.client ? `${editProject.client} · ` : ''}${editProject?.name ?? 'Заказ'}`;
  const subtitle = props.mode === 'event'
    ? (editEvent?.date ? fmtDateLong(editEvent.date) : 'без даты')
    : (editProject?.schedule?.installAt ? `монтаж ${fmtDateLong(editProject.schedule.installAt)}` : 'даты ещё не назначены');

  const order = editProject ? orders.find((item) => item.projectId === editProject.id) : undefined;

  return (
    <Overlay className="crm-dialog-backdrop" onClick={props.onClose}>
      <div className="crm-dialog schedule-dialog" role="dialog" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <header className="crm-dialog-head">
          <div>
            <span className="eyebrow">{props.mode === 'event' ? 'Дело в календаре' : 'Даты заказа'}</span>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <div className="crm-dialog-head-actions">
            {props.mode === 'project' && editProject && (
              <button type="button" className="btn primary" onClick={() => props.onOpen(editProject.id)}>Открыть проект</button>
            )}
            <button type="button" className="btn ghost" onClick={props.onClose} aria-label="Закрыть">✕</button>
          </div>
        </header>

        <div className="crm-dialog-body">
          {props.mode === 'event' && editEvent && (
            <div className="schedule-form">
              <label className="span-2">Что сделать
                <input value={editEvent.title} onChange={(event) => props.updateEvent(editEvent.id, { title: event.target.value })} />
              </label>
              <label>Тип
                <select value={editEvent.kind} onChange={(event) => props.updateEvent(editEvent.id, { kind: event.target.value as CalendarEventKind })}>
                  {CALENDAR_KINDS.map((kind) => <option key={kind.id} value={kind.id}>{kind.label}</option>)}
                </select>
              </label>
              <label>Дата
                <input type="date" value={editEvent.date} onChange={(event) => props.updateEvent(editEvent.id, { date: event.target.value })} />
              </label>
              <label>Дней
                <input type="number" min={1} max={30} value={editEvent.days ?? 1}
                  onChange={(event) => props.updateEvent(editEvent.id, { days: Math.max(1, Number(event.target.value) || 1) })} />
              </label>
              <label>Время с
                <input type="time" value={editEvent.timeStart ?? ''} onChange={(event) => props.updateEvent(editEvent.id, { timeStart: event.target.value || undefined })} />
              </label>
              <label>до
                <input type="time" value={editEvent.timeEnd ?? ''} onChange={(event) => props.updateEvent(editEvent.id, { timeEnd: event.target.value || undefined })} />
              </label>
              <label>Статус
                <select value={editEvent.status} onChange={(event) => props.updateEvent(editEvent.id, { status: event.target.value as ScheduleStatus })}>
                  {SCHEDULE_STATUSES.map((status) => <option key={status.id} value={status.id}>{status.label}</option>)}
                </select>
              </label>
              <label className="span-2">Кому поручено
                <input list="schedule-people" value={editEvent.assignees.join(', ')} placeholder="через запятую"
                  onChange={(event) => props.updateEvent(editEvent.id, { assignees: event.target.value.split(',').map((name) => name.trim()).filter(Boolean) })} />
                <datalist id="schedule-people">{people.map((name) => <option key={name} value={name} />)}</datalist>
              </label>
              <label>Клиент
                <input value={editEvent.clientName ?? ''} placeholder="кто заказчик"
                  onChange={(event) => props.updateEvent(editEvent.id, { clientName: event.target.value })} />
              </label>
              <label className="span-2">Адрес
                <input value={editEvent.address ?? ''} placeholder="куда ехать"
                  onChange={(event) => props.updateEvent(editEvent.id, { address: event.target.value })} />
              </label>
              <label className="span-3">Заметка
                <input value={editEvent.note ?? ''} placeholder="этаж, домофон, что взять с собой"
                  onChange={(event) => props.updateEvent(editEvent.id, { note: event.target.value })} />
              </label>
              <label>Связать с заказом
                <select value={editEvent.projectId ?? ''} onChange={(event) => props.updateEvent(editEvent.id, { projectId: event.target.value || undefined })}>
                  <option value="">без заказа</option>
                  {props.projects.map((project) => (
                    <option key={project.id} value={project.id}>{project.client ? `${project.client} · ` : ''}{project.name}</option>
                  ))}
                </select>
              </label>
              <div className="span-3 schedule-reminder-picker">
                <b>Напомнить</b>
                <ReminderPicker
                  compact
                  inheritLabel="Как в настройках"
                  value={editEvent.reminders ?? []}
                  onChange={(reminders) => props.updateEvent(editEvent.id, { reminders })}
                />
              </div>
              <div className="schedule-form-actions">
                <button type="button" className="btn ghost"
                  onClick={() => props.updateEvent(editEvent.id, { done: !editEvent.done, status: editEvent.done ? 'planned' : 'done' })}>
                  {editEvent.done ? 'Вернуть в работу' : 'Отметить выполненным'}
                </button>
                {editEvent.projectId && (
                  <button type="button" className="btn ghost" onClick={() => props.onOpen(editEvent.projectId as string)}>Открыть заказ</button>
                )}
                <button type="button" className="btn ghost danger" onClick={() => props.deleteEvent(editEvent.id)}>Удалить дело</button>
              </div>
            </div>
          )}

          {props.mode === 'project' && editProject && (
            <>
              <div className="schedule-form">
                <label>Замер
                  <input type="date" value={editProject.schedule?.measureAt ?? ''}
                    onChange={(event) => props.patchSchedule(editProject, { measureAt: event.target.value || undefined })} />
                </label>
                <label>Готовность на фабрике
                  <input type="date" value={editProject.schedule?.readyAt ?? ''}
                    onChange={(event) => props.patchSchedule(editProject, { readyAt: event.target.value || undefined })} />
                </label>
                <label>Доставка
                  <input type="date" value={editProject.schedule?.deliveryAt ?? ''}
                    onChange={(event) => props.patchSchedule(editProject, { deliveryAt: event.target.value || undefined })} />
                </label>
                <label>Монтаж
                  <input type="date" value={editProject.schedule?.installAt ?? ''}
                    onChange={(event) => props.patchSchedule(editProject, { installAt: event.target.value || undefined })} />
                </label>
                <label>Дней монтажа
                  <input type="number" min={1} max={14} value={editProject.schedule?.installDays ?? 1}
                    onChange={(event) => props.patchSchedule(editProject, { installDays: Math.max(1, Number(event.target.value) || 1) })} />
                </label>
                <label>Бригада
                  <input list="schedule-people" value={editProject.schedule?.team ?? ''} placeholder="кто монтирует"
                    onChange={(event) => props.patchSchedule(editProject, { team: event.target.value })} />
                  <datalist id="schedule-people">{people.map((name) => <option key={name} value={name} />)}</datalist>
                </label>
                <label className="span-2">Адрес
                  <input value={editProject.schedule?.address ?? ''} placeholder="куда ехать"
                    onChange={(event) => props.patchSchedule(editProject, { address: event.target.value })} />
                </label>
                <label>Статус
                  <select value={editProject.schedule?.status ?? 'planned'}
                    onChange={(event) => props.patchSchedule(editProject, { status: event.target.value as ScheduleStatus })}>
                    {SCHEDULE_STATUSES.map((status) => <option key={status.id} value={status.id}>{status.label}</option>)}
                  </select>
                </label>
                <label className="span-3">Заметка для монтажников
                  <input value={editProject.schedule?.note ?? ''} placeholder="этаж, лифт, время, контакты на объекте"
                    onChange={(event) => props.patchSchedule(editProject, { note: event.target.value })} />
                </label>
                <div className="schedule-form-actions">
                  <button type="button" className="btn ghost"
                    onClick={() => props.patchSchedule(editProject, { measureAt: undefined, readyAt: undefined, deliveryAt: undefined, installAt: undefined })}>
                    Очистить даты
                  </button>
                </div>
              </div>

              <div className="schedule-order">
                <div className="schedule-order-main">
                  <b>Наряд мастеру</b>
                  {order ? (
                    <>
                      <span className={`schedule-order-status status-${order.status}`}>{ORDER_STATUS_LABELS[order.status] ?? order.status}</span>
                      {order.lastComment && <small>«{order.lastComment}»{order.lastBy ? ` — ${order.lastBy}` : ''}</small>}
                      <input readOnly value={workOrderUrl(order.id)} onFocus={(event) => event.target.select()} />
                    </>
                  ) : (
                    <span className="muted small">Ссылка монтажнику: адрес, маршрут, список позиций, эскиз и кнопки «выехал / начал / завершил / нужна помощь».</span>
                  )}
                </div>
                <div className="schedule-order-actions">
                  <button type="button" className="btn ghost" disabled={orderBusy} onClick={() => props.prepareOrder(editProject)}>
                    {orderDraft ? 'Пересобрать' : 'Подготовить наряд'}
                  </button>
                  <button type="button" className="btn primary" disabled={orderBusy} onClick={() => props.sendWorkOrder(editProject)}>
                    {orderBusy ? 'Готовлю…' : orderCopied === order?.id ? 'Ссылка скопирована ✓' : order ? 'Обновить наряд' : 'Выдать наряд'}
                  </button>
                  {order && <a className="btn ghost" href={workOrderUrl(order.id)} target="_blank" rel="noreferrer">Как видит мастер</a>}
                </div>

                {orderDraft && (
                  <div className="schedule-order-draft">
                    <b>Что увидит мастер</b>
                    <div className="schedule-order-draft-grid">
                      <label>Дата<input type="date" value={orderDraft.date} onChange={(event) => props.setOrderDraft({ ...orderDraft, date: event.target.value })} /></label>
                      <label>Время<input value={orderDraft.time ?? ''} placeholder="10:00" onChange={(event) => props.setOrderDraft({ ...orderDraft, time: event.target.value })} /></label>
                      <label>Бригада<input value={orderDraft.team ?? ''} onChange={(event) => props.setOrderDraft({ ...orderDraft, team: event.target.value })} /></label>
                      <label>Телефон клиента<input value={orderDraft.phone ?? ''} onChange={(event) => props.setOrderDraft({ ...orderDraft, phone: event.target.value })} /></label>
                      <label className="span-2">Адрес<input value={orderDraft.address ?? ''} onChange={(event) => props.setOrderDraft({ ...orderDraft, address: event.target.value })} /></label>
                      <label className="span-2">Пометки для мастера
                        <textarea rows={2} value={orderDraft.note ?? ''} placeholder="этаж, лифт, домофон, что взять с собой"
                          onChange={(event) => props.setOrderDraft({ ...orderDraft, note: event.target.value })} />
                      </label>
                    </div>

                    <div className="schedule-order-items">
                      <b>Позиции ({orderDraft.items.length})</b>
                      {orderDraft.items.map((item, index) => (
                        <div className="schedule-order-item" key={index}>
                          <input value={item} onChange={(event) => props.setOrderDraft({
                            ...orderDraft,
                            items: orderDraft.items.map((value, position) => (position === index ? event.target.value : value)),
                          })} />
                          <button type="button" aria-label="Убрать позицию" onClick={() => props.setOrderDraft({
                            ...orderDraft,
                            items: orderDraft.items.filter((_, position) => position !== index),
                          })}>✕</button>
                        </div>
                      ))}
                      <button type="button" className="btn tiny ghost"
                        onClick={() => props.setOrderDraft({ ...orderDraft, items: [...orderDraft.items, ''] })}>
                        + Добавить позицию
                      </button>
                    </div>

                    {(orderDraft.images ?? []).length > 0 && (
                      <div className="schedule-order-images">
                        <b>Эскизы в наряде ({(orderDraft.images ?? []).length})</b>
                        <div>
                          {(orderDraft.images ?? []).map((fileId) => (
                            <span key={fileId}>
                              <img src={serverFileUrl(fileId)} alt="Эскиз" />
                              <button type="button" aria-label="Убрать эскиз" onClick={() => props.setOrderDraft({
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
              </div>
            </>
          )}
        </div>
      </div>
    </Overlay>
  );
}
