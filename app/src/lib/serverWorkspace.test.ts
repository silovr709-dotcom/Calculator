import { describe, expect, it } from 'vitest';
import { emptyWorkspace, formatWorkspaceSize, mergeWorkspaces, normalizeWorkspace, workspaceSignature, type Workspace } from './serverWorkspace';
import type { ClientProfile, Project } from '../types';

function project(id: string, updatedAt: string, name = id): Project {
  return {
    id,
    name,
    client: '',
    pricebookId: 'visma-2026',
    status: 'draft',
    lines: [],
    settings: { markupBasePct: null, markupByGroup: {}, extraExpenses: [], applyEmalRule: true, assemblyCost: null, deliveryCost: null, clientRounding: 1 },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt,
  } as unknown as Project;
}

function client(id: string, updatedAt: string, name = id): ClientProfile {
  return { id, name, phones: [], emails: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt } as unknown as ClientProfile;
}

describe('рабочая база на сервере', () => {
  it('приводит присланные сервером данные к рабочей базе и отбрасывает мусор', () => {
    const workspace = normalizeWorkspace({
      projects: [project('p1', '2026-02-01T00:00:00.000Z'), { noId: true }, null],
      clients: [client('c1', '2026-02-01T00:00:00.000Z')],
      templates: 'не массив',
      settings: { markupBasePct: 15 },
    });
    expect(workspace.projects.map((item) => item.id)).toEqual(['p1']);
    expect(workspace.clients.map((item) => item.id)).toEqual(['c1']);
    expect(workspace.templates).toEqual([]);
    expect(workspace.settings.markupBasePct).toBe(15);
    expect(workspace.settings.clientRounding).toBe(1); // недостающие поля берутся из значений по умолчанию
  });

  it('пустой и битый ответ не ломают приложение', () => {
    expect(normalizeWorkspace(null).projects).toEqual([]);
    expect(normalizeWorkspace('ерунда').clients).toEqual([]);
    expect(normalizeWorkspace({ settings: [] }).settings.markupByGroup).toEqual({});
  });

  it('при слиянии побеждает более свежая правка проекта', () => {
    const local: Workspace = { ...emptyWorkspace(), projects: [project('p1', '2026-03-10T10:00:00.000Z', 'местная версия')] };
    const remote: Workspace = { ...emptyWorkspace(), projects: [project('p1', '2026-03-10T09:00:00.000Z', 'серверная версия')] };
    expect(mergeWorkspaces(local, remote).projects[0].name).toBe('местная версия');
    expect(mergeWorkspaces(remote, local).projects[0].name).toBe('местная версия');
  });

  it('проекты и клиенты коллег не теряются при слиянии', () => {
    const local: Workspace = {
      ...emptyWorkspace(),
      projects: [project('p1', '2026-03-10T10:00:00.000Z')],
      clients: [client('c1', '2026-03-10T10:00:00.000Z')],
    };
    const remote: Workspace = {
      ...emptyWorkspace(),
      projects: [project('p2', '2026-03-11T10:00:00.000Z')],
      clients: [client('c2', '2026-03-11T10:00:00.000Z')],
    };
    const merged = mergeWorkspaces(local, remote);
    expect(merged.projects.map((item) => item.id).sort()).toEqual(['p1', 'p2']);
    expect(merged.clients.map((item) => item.id).sort()).toEqual(['c1', 'c2']);
  });

  it('подпись базы меняется только при реальном изменении', () => {
    const base: Workspace = { ...emptyWorkspace(), projects: [project('p1', '2026-03-10T10:00:00.000Z')] };
    const same: Workspace = { ...emptyWorkspace(), projects: [project('p1', '2026-03-10T10:00:00.000Z', 'другое имя без новой даты')] };
    const changed: Workspace = { ...emptyWorkspace(), projects: [project('p1', '2026-03-10T11:00:00.000Z')] };
    expect(workspaceSignature(base)).toBe(workspaceSignature(same));
    expect(workspaceSignature(base)).not.toBe(workspaceSignature(changed));
  });

  it('размер базы показывается по-человечески', () => {
    expect(formatWorkspaceSize(0)).toBe('—');
    expect(formatWorkspaceSize(2048)).toBe('2 КБ');
    expect(formatWorkspaceSize(5 * 1048576)).toBe('5.0 МБ');
  });
});
