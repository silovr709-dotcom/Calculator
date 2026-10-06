import type { ClientProfile, Pricebook, Project } from '../types';
import { fmtDate, fmtMoney, fmtNum } from '../lib/format';
import { workflowForProject, workflowStatusMeta, nextContactTone } from '../lib/crm';
import { buildProjectActionAlerts, calcProjectWorkflowTotal, projectDocuments, projectNextStep, projectPayment, type ProjectNextStep, type WorkflowTone } from '../lib/workflow';

type ContextTab = 'modules' | 'sketch' | 'order' | 'lines' | 'photos' | 'settings' | 'client' | 'check' | 'variants' | 'measurement';

function toneText(tone: WorkflowTone): string {
  if (tone === 'danger') return 'критично';
  if (tone === 'warn') return 'важно';
  if (tone === 'good') return 'готово';
  if (tone === 'muted') return 'закрыто';
  return 'в работе';
}

function docLabel(value?: string): string {
  if (!value || value === 'none') return 'нет';
  if (value === 'created') return 'создан';
  if (value === 'sent') return 'отправлен';
  if (value === 'approved') return 'согласован';
  return value;
}

function paymentSummary(project: Project, client: ClientProfile | null | undefined, total: number): { label: string; tone: WorkflowTone } {
  const payment = projectPayment(project, client);
  const paid = payment.paidTotal ?? payment.prepayment ?? 0;
  if (paid <= 0) return { label: 'нет оплаты', tone: 'warn' };
  const remainder = Math.max(0, total - paid);
  return { label: remainder <= 0 ? `оплачено ${fmtMoney(paid)}` : `оплачено ${fmtMoney(paid)}, остаток ${fmtMoney(remainder)}`, tone: remainder <= 0 ? 'good' : 'info' };
}

function goForStep(step: ProjectNextStep, handlers: { onOpenTab: (tab: ContextTab) => void; onOpenFactory?: () => void; onOpenCrm?: () => void }) {
  if (step.target === 'factory') handlers.onOpenFactory?.();
  else if (step.target === 'crm' || step.target === 'payment') handlers.onOpenCrm?.();
  else if (step.target === 'client') handlers.onOpenTab('client');
  else if (step.target === 'check') handlers.onOpenTab('check');
  else if (step.target === 'modules') handlers.onOpenTab('modules');
  else if (step.target === 'sketch') handlers.onOpenTab('sketch');
  else handlers.onOpenTab('order');
}

export default function ProjectContextPanel(props: {
  project: Project;
  pricebook: Pricebook;
  client?: ClientProfile | null;
  onOpenTab: (tab: ContextTab) => void;
  onOpenFactory?: () => void;
  onOpenCrm?: () => void;
}) {
  const { project, pricebook, client } = props;
  const total = calcProjectWorkflowTotal(project, pricebook);
  const workflow = workflowForProject(project);
  const workflowMeta = workflowStatusMeta(workflow.status);
  const next = projectNextStep(project, pricebook, client);
  const alerts = buildProjectActionAlerts(project, pricebook, client).slice(0, 6);
  const docs = projectDocuments(project, client);
  const pay = paymentSummary(project, client, total.client);
  const contactTone = nextContactTone(workflow.nextContactAt);
  const contactLabel = contactTone === 'overdue' ? 'просрочено' : contactTone === 'today' ? 'сегодня' : contactTone === 'none' ? 'нет даты' : workflow.nextContactAt ? fmtDate(workflow.nextContactAt) : 'нет даты';

  return (
    <aside className="project-context-panel no-print" aria-label="Контекст проекта">
      <div className={`project-context-next tone-${next.tone}`}>
        <span>{toneText(next.tone)}</span>
        <h3>{next.title}</h3>
        <p>{next.detail}</p>
        <button type="button" className="btn primary" onClick={() => goForStep(next, props)}>{next.actionLabel}</button>
      </div>

      <div className="project-context-card">
        <div className="context-card-head"><b>Проект</b><button type="button" className="linkish" onClick={() => props.onOpenTab('order')}>заказ</button></div>
        <div className="context-fact"><span>Клиент</span><b>{client?.name || project.client || 'не указан'}</b></div>
        <div className="context-fact"><span>Сумма КП</span><b>{fmtMoney(total.client)}</b></div>
        <div className="context-fact"><span>Маржа</span><b>{total.marginPct == null ? '—' : `${fmtNum(total.marginPct, 1)} %`}</b></div>
        <div className="context-fact"><span>CRM-статус</span><b>{workflowMeta.label}</b></div>
        <div className={`context-fact tone-${contactTone}`}><span>Контакт</span><b>{contactLabel}</b></div>
      </div>

      <div className="project-context-card">
        <div className="context-card-head"><b>Документы и деньги</b><button type="button" className="linkish" onClick={() => props.onOpenTab('client')}>КП</button></div>
        <div className="context-doc-grid">
          <button type="button" onClick={() => props.onOpenTab('client')}><span>КП</span><b>{docLabel(docs.offer)}</b></button>
          <button type="button" onClick={() => props.onOpenTab('client')}><span>Договор</span><b>{docLabel(docs.contract)}</b></button>
          <button type="button" onClick={() => props.onOpenTab('client')}><span>Чек</span><b>{docLabel(docs.receipt)}</b></button>
          <button type="button" onClick={props.onOpenFactory}><span>Фабрика</span><b>{docLabel(docs.factoryBlank)}</b></button>
        </div>
        <div className={`context-payment tone-${pay.tone}`}>{pay.label}</div>
      </div>

      <div className="project-context-card">
        <div className="context-card-head"><b>Подсказки и проверки</b><button type="button" className="linkish" onClick={() => props.onOpenTab('check')}>все</button></div>
        <div className="context-alert-list">
          {alerts.length === 0 ? <div className="context-empty">Критичных подсказок нет. Можно двигаться дальше по маршруту.</div> : alerts.map((alert) => (
            <button type="button" key={`${alert.id}-${alert.projectId}`} className={`context-alert tone-${alert.tone}`} onClick={() => {
              if (alert.target === 'factory') props.onOpenFactory?.();
              else if (alert.target === 'crm' || alert.target === 'payment') props.onOpenCrm?.();
              else if (alert.target === 'client') props.onOpenTab('client');
              else if (alert.target === 'sketch') props.onOpenTab('sketch');
              else props.onOpenTab('check');
            }}>
              <b>{alert.title}</b>
              <span>{alert.detail}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="project-context-actions compact-actions">
        <button type="button" className="btn tiny ghost" onClick={() => props.onOpenTab('modules')}>Состав</button>
        <button type="button" className="btn tiny ghost" onClick={() => props.onOpenTab('client')}>КП</button>
        <button type="button" className="btn tiny ghost" onClick={() => props.onOpenTab('check')}>Проверка</button>
        <button type="button" className="btn tiny ghost" onClick={props.onOpenFactory}>Фабрика</button>
      </div>
    </aside>
  );
}
