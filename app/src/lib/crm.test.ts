import { describe, expect, it } from 'vitest';
import type { Project } from '../types';
import {
  dateInputToIso,
  dateInputValue,
  defaultNextAction,
  isClosedWorkflowStatus,
  nextContactTone,
  projectStatusForWorkflow,
  scheduleDate,
  workflowForProject,
} from './crm';

function project(status: Project['status'], orderWorkflow?: Project['orderWorkflow']): Project {
  return {
    id: 'p1',
    name: 'Кухня',
    client: 'Иванов',
    date: '2026-10-05',
    comment: '',
    status,
    pricebookId: 'pb',
    pricebookName: 'Прайс',
    lines: [],
    settings: {
      markupBasePct: 0,
      markupByGroup: {},
      extraExpenses: [],
      applyEmalRule: false,
      assemblyCost: null,
      deliveryCost: null,
    },
    orderWorkflow,
    createdAt: '2026-10-05T09:00:00.000Z',
    updatedAt: '2026-10-05T09:00:00.000Z',
  };
}

describe('crm workflow helpers', () => {
  it('maps legacy project statuses to CRM workflow stages', () => {
    expect(workflowForProject(project('draft')).status).toBe('draft');
    expect(workflowForProject(project('sent')).status).toBe('offerSent');
    expect(workflowForProject(project('approved')).status).toBe('approved');
    expect(workflowForProject(project('archived')).status).toBe('rejected');
    expect(workflowForProject(project('draft', { status: 'production' })).status).toBe('production');
  });

  it('keeps project status in sync with CRM workflow stage', () => {
    expect(projectStatusForWorkflow('clientThinking', 'draft')).toBe('sent');
    expect(projectStatusForWorkflow('techCheck', 'sent')).toBe('approved');
    expect(projectStatusForWorkflow('delivered', 'draft')).toBe('approved');
    expect(projectStatusForWorkflow('rejected', 'approved')).toBe('archived');
    expect(projectStatusForWorkflow('draft', 'sent')).toBe('draft');
    expect(projectStatusForWorkflow('calculating', 'archived')).toBe('draft');
  });

  it('classifies follow-up dates by urgency', () => {
    const now = new Date('2026-10-05T10:00:00.000Z');
    expect(nextContactTone(undefined, now)).toBe('none');
    expect(nextContactTone('2026-10-04T12:00:00.000Z', now)).toBe('overdue');
    expect(nextContactTone('2026-10-05T12:00:00.000Z', now)).toBe('today');
    expect(nextContactTone('2026-10-07T12:00:00.000Z', now)).toBe('soon');
    expect(nextContactTone('2026-10-12T12:00:00.000Z', now)).toBe('planned');
  });

  it('normalizes CRM dates for date inputs and quick scheduling', () => {
    expect(dateInputValue('2026-10-05T12:00:00.000Z')).toBe('2026-10-05');
    expect(dateInputToIso('')).toBeUndefined();
    expect(dateInputToIso('2026-10-06')).toContain('2026-10-06');
    expect(dateInputValue(scheduleDate(2, new Date('2026-10-05T10:00:00.000Z')))).toBe('2026-10-07');
  });

  it('knows closed statuses and default next actions', () => {
    expect(isClosedWorkflowStatus('delivered')).toBe(true);
    expect(isClosedWorkflowStatus('rejected')).toBe(true);
    expect(isClosedWorkflowStatus('production')).toBe(false);
    expect(defaultNextAction('offerSent')).toContain('КП');
    expect(defaultNextAction('ready')).toContain('выдачу');
  });
});
