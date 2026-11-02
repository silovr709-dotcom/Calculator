import type { ClientProfile, Pricebook, Project } from '../types';
import { fmtMoney, fmtNum } from '../lib/format';
import { buildProjectActionAlerts, calcProjectWorkflowTotal, projectDocuments, projectPayment, type WorkflowTone } from '../lib/workflow';

type ContextTab = 'modules' | 'sketch' | 'order' | 'lines' | 'photos' | 'settings' | 'client' | 'check' | 'variants' | 'measurement';

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

export default function ProjectContextPanel(props: {
  project: Project;
  pricebook: Pricebook;
  client?: ClientProfile | null;
  onOpenTab: (tab: ContextTab) => void;
  onOpenFactory?: () => void;
}) {
  const { project, pricebook, client } = props;
  const total = calcProjectWorkflowTotal(project, pricebook);
  const allAlerts = buildProjectActionAlerts(project, pricebook, client);
  const alerts = allAlerts.slice(0, 3);
  const docs = projectDocuments(project, client);
  const pay = paymentSummary(project, client, total.client);

  return (
    <aside className="project-context-panel no-print" id="project-context" aria-label="Сводка проекта">
      <div className="project-context-card">
        <div className="context-card-head"><b>Проект</b></div>
        <div className="context-fact"><span>Клиент</span><b>{client?.name || project.client || 'не указан'}</b></div>
        <div className="context-fact"><span>Сумма КП</span><b>{fmtMoney(total.client)}</b></div>
        <div className="context-fact"><span>Маржа</span><b>{total.marginPct == null ? '—' : `${fmtNum(total.marginPct, 1)} %`}</b></div>
      </div>

      <div className="project-context-card">
        <div className="context-card-head"><b>Документы и деньги</b></div>
        <div className="context-doc-grid">
          <div><span>КП</span><b>{docLabel(docs.offer)}</b></div>
          <div><span>Договор</span><b>{docLabel(docs.contract)}</b></div>
          <div><span>Чек</span><b>{docLabel(docs.receipt)}</b></div>
          <button type="button" onClick={props.onOpenFactory}><span>Фабрика</span><b>{docLabel(docs.factoryBlank)}</b></button>
        </div>
        <div className={`context-payment tone-${pay.tone}`}>{pay.label}</div>
      </div>

      <div className="project-context-card">
        <div className="context-card-head"><b>Подсказки и проверки</b></div>
        <div className="context-alert-list">
          {alerts.length === 0 ? <div className="context-empty">Критичных подсказок нет. Можно двигаться дальше по маршруту.</div> : alerts.map((alert) => (
            <button type="button" key={`${alert.id}-${alert.projectId}`} className={`context-alert tone-${alert.tone}`} onClick={() => {
              if (alert.target === 'factory') props.onOpenFactory?.();
              else if (alert.target === 'client' || alert.target === 'payment') props.onOpenTab('client');
              else if (alert.target === 'sketch') props.onOpenTab('sketch');
              else props.onOpenTab('check');
            }}>
              <b>{alert.title}</b>
              <span>{alert.detail}</span>
            </button>
          ))}
          {allAlerts.length > alerts.length && (
            <div className="context-more">Ещё {allAlerts.length - alerts.length} подсказок — в проверке проекта.</div>
          )}
        </div>
      </div>
    </aside>
  );
}
