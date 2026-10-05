import type { ClientHistoryEntry, ClientProfile, ClientProjectDocuments, ClientProjectPayment, ClientTag, Project } from '../types';
import { normalizeClientName } from './crm';

const DEFAULT_TAGS: Array<{ id: ClientTag; label: string }> = [
  { id: 'hot', label: 'горячий' },
  { id: 'discount', label: 'ждёт скидку' },
  { id: 'repeat', label: 'повторный' },
  { id: 'install', label: 'монтаж' },
  { id: 'problem', label: 'проблемный' },
  { id: 'designer', label: 'дизайнер' },
];

export const CLIENT_TAGS = DEFAULT_TAGS;

export function splitContactList(value: string | undefined): string[] {
  return (value ?? '')
    .split(/[;,\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, arr) => arr.findIndex((x) => x.toLocaleLowerCase('ru-RU') === item.toLocaleLowerCase('ru-RU')) === index);
}

export function normalizePhone(value: string | undefined): string {
  if (!value) return '';
  const cleaned = value.replace(/[^\d+]+/g, '');
  if (cleaned.startsWith('+')) return `+${cleaned.slice(1).replace(/\D+/g, '')}`;
  return cleaned.replace(/\D+/g, '');
}

export function phoneKey(value: string | undefined): string {
  const normalized = normalizePhone(value);
  return normalized.replace(/^\+/, '').replace(/^8(?=\d{10}$)/, '7');
}

function first<T>(items: T[] | undefined): T | undefined {
  return items && items.length > 0 ? items[0] : undefined;
}

function uniq(values: string[]): string[] {
  const result: string[] = [];
  for (const value of values.map((item) => item.trim()).filter(Boolean)) {
    if (!result.some((item) => item.toLocaleLowerCase('ru-RU') === value.toLocaleLowerCase('ru-RU'))) result.push(value);
  }
  return result;
}

export function projectClientPhones(project: Project): string[] {
  return uniq([...splitContactList(project.clientOffer?.clientPhone), ...splitContactList(project.clientOffer?.clientContacts).filter((item) => /\d/.test(item))]
    .map((item) => normalizePhone(item))
    .filter(Boolean));
}

export function projectClientEmails(project: Project): string[] {
  return uniq([...splitContactList(project.clientOffer?.clientEmail), ...splitContactList(project.clientOffer?.clientContacts).filter((item) => item.includes('@'))]);
}

export function createClientProfileFromProject(project: Project, id: string, now = new Date().toISOString()): ClientProfile {
  const name = project.client?.trim() || project.clientOffer?.clientContacts?.trim() || 'Без клиента';
  return {
    id,
    name,
    phones: projectClientPhones(project),
    emails: projectClientEmails(project),
    objectAddress: project.clientOffer?.clientAddress || undefined,
    deliveryAddress: project.clientOffer?.delivery || undefined,
    passport: project.clientOffer?.clientPassport || undefined,
    contractDetails: project.clientOffer?.sellerDetails || undefined,
    managerComment: project.orderWorkflow?.managerComment || project.comment || undefined,
    source: undefined,
    tags: [],
    paymentsByProject: {},
    documentsByProject: {},
    history: [{ id: `${id}_hist_${now}`, createdAt: now, kind: 'project', title: `Создана карточка клиента из проекта «${project.name}»`, projectId: project.id }],
    createdAt: now,
    updatedAt: now,
  };
}

export function enrichClientFromProject(client: ClientProfile, project: Project, now = new Date().toISOString()): ClientProfile {
  const phones = uniq([...(client.phones ?? []), ...projectClientPhones(project)]);
  const emails = uniq([...(client.emails ?? []), ...projectClientEmails(project)]);
  const next: ClientProfile = {
    ...client,
    name: client.name?.trim() || project.client?.trim() || 'Без клиента',
    phones,
    emails,
    objectAddress: client.objectAddress || project.clientOffer?.clientAddress || undefined,
    deliveryAddress: client.deliveryAddress || project.clientOffer?.delivery || undefined,
    passport: client.passport || project.clientOffer?.clientPassport || undefined,
    managerComment: client.managerComment || project.orderWorkflow?.managerComment || undefined,
    updatedAt: client.updatedAt,
  };
  const changed = JSON.stringify({ ...client, history: [] }) !== JSON.stringify({ ...next, history: [] });
  return changed ? { ...next, updatedAt: now } : client;
}

export function findClientForProject(project: Project, clients: ClientProfile[]): ClientProfile | undefined {
  if (project.clientId) {
    const byId = clients.find((client) => client.id === project.clientId);
    if (byId) return byId;
  }
  const phoneKeys = projectClientPhones(project).map(phoneKey).filter(Boolean);
  if (phoneKeys.length) {
    const byPhone = clients.find((client) => (client.phones ?? []).some((phone) => phoneKeys.includes(phoneKey(phone))));
    if (byPhone) return byPhone;
  }
  const nameKey = normalizeClientName(project.client);
  if (nameKey !== 'без клиента') return clients.find((client) => normalizeClientName(client.name) === nameKey);
  return undefined;
}

export function ensureClientProfiles(
  projects: Project[],
  clients: ClientProfile[],
  createId: () => string,
): { projects: Project[]; clients: ClientProfile[]; changed: boolean } {
  let changed = false;
  const now = new Date().toISOString();
  const nextClients = [...clients];
  const nextProjects = projects.map((project) => {
    let client = findClientForProject(project, nextClients);
    if (!client) {
      client = createClientProfileFromProject(project, createId(), now);
      nextClients.unshift(client);
      changed = true;
    } else {
      const currentClient = client;
      const enriched = enrichClientFromProject(currentClient, project, now);
      if (enriched !== currentClient) {
        nextClients[nextClients.findIndex((item) => item.id === currentClient.id)] = enriched;
        client = enriched;
        changed = true;
      }
    }
    const linkedClient = client;
    if (project.clientId !== linkedClient.id) {
      changed = true;
      return { ...project, clientId: linkedClient.id, client: linkedClient.name };
    }
    return project;
  });
  return { projects: nextProjects, clients: nextClients, changed };
}

export function applyClientProfileToProject(project: Project, client: ClientProfile | undefined): Project {
  if (!client) return project;
  const primaryPhone = first(client.phones);
  const primaryEmail = first(client.emails);
  return {
    ...project,
    clientId: client.id,
    client: client.name || project.client,
    clientOffer: {
      ...(project.clientOffer ?? {}),
      clientContacts: project.clientOffer?.clientContacts || primaryPhone || primaryEmail || undefined,
      clientPhone: primaryPhone || project.clientOffer?.clientPhone,
      clientEmail: primaryEmail || project.clientOffer?.clientEmail,
      clientAddress: client.objectAddress || project.clientOffer?.clientAddress,
      clientPassport: client.passport || project.clientOffer?.clientPassport,
      sellerDetails: project.clientOffer?.sellerDetails,
    },
  };
}

export function applyClientProfilesToProjects(projects: Project[], clients: ClientProfile[]): Project[] {
  return projects.map((project) => applyClientProfileToProject(project, findClientForProject(project, clients)));
}

export function mergeClientPatch(client: ClientProfile, patch: Partial<ClientProfile>): ClientProfile {
  return {
    ...client,
    ...patch,
    phones: patch.phones ? uniq(patch.phones.map((phone) => normalizePhone(phone)).filter(Boolean)) : client.phones,
    emails: patch.emails ? uniq(patch.emails) : client.emails,
    tags: patch.tags ? uniq(patch.tags) as ClientTag[] : client.tags,
    updatedAt: new Date().toISOString(),
  };
}

export function appendClientHistory(client: ClientProfile, entry: Omit<ClientHistoryEntry, 'id' | 'createdAt'>, id: string): ClientProfile {
  const createdAt = new Date().toISOString();
  return {
    ...client,
    history: [{ id, createdAt, ...entry }, ...(client.history ?? [])].slice(0, 200),
    updatedAt: createdAt,
  };
}

export function updateClientProjectPayment(client: ClientProfile, projectId: string, patch: Partial<ClientProjectPayment>): ClientProfile {
  const current = client.paymentsByProject?.[projectId] ?? {};
  return mergeClientPatch(client, {
    paymentsByProject: {
      ...(client.paymentsByProject ?? {}),
      [projectId]: { ...current, ...patch },
    },
  });
}

export function updateClientProjectDocuments(client: ClientProfile, projectId: string, patch: Partial<ClientProjectDocuments>): ClientProfile {
  const current = client.documentsByProject?.[projectId] ?? {};
  return mergeClientPatch(client, {
    documentsByProject: {
      ...(client.documentsByProject ?? {}),
      [projectId]: { ...current, ...patch, updatedAt: new Date().toISOString() },
    },
  });
}

export function paymentStatusLabel(payment: ClientProjectPayment | undefined, total: number): { label: string; tone: 'muted' | 'warn' | 'ok' | 'bad'; paid: number; remainder: number } {
  const paid = Math.max(0, Number(payment?.paidTotal ?? payment?.prepayment ?? 0) || 0);
  const remainder = Math.max(0, total - paid);
  if (payment?.status === 'paid' || (total > 0 && paid >= total)) return { label: 'оплачен', tone: 'ok', paid, remainder: 0 };
  if (payment?.status === 'prepaid' || paid > 0) return { label: 'предоплата', tone: remainder > 0 ? 'warn' : 'ok', paid, remainder };
  if (payment?.status === 'debt') return { label: 'долг', tone: 'bad', paid, remainder };
  return { label: 'нет оплаты', tone: 'muted', paid, remainder: total };
}

export function findDuplicateClientGroups(clients: ClientProfile[]): Array<{ reason: string; clients: ClientProfile[] }> {
  const groups: Array<{ reason: string; clients: ClientProfile[] }> = [];
  const byPhone = new Map<string, ClientProfile[]>();
  const byName = new Map<string, ClientProfile[]>();
  for (const client of clients) {
    for (const phone of client.phones ?? []) {
      const key = phoneKey(phone);
      if (key.length >= 7) byPhone.set(key, [...(byPhone.get(key) ?? []), client]);
    }
    const name = normalizeClientName(client.name);
    if (name !== 'без клиента') byName.set(name, [...(byName.get(name) ?? []), client]);
  }
  for (const [phone, items] of byPhone) if (items.length > 1) groups.push({ reason: `одинаковый телефон ${phone}`, clients: items });
  for (const [name, items] of byName) if (items.length > 1 && !groups.some((group) => items.every((client) => group.clients.includes(client)))) groups.push({ reason: `похожее имя «${name}»`, clients: items });
  return groups;
}

export function mergeClientProfiles(target: ClientProfile, source: ClientProfile, now = new Date().toISOString()): ClientProfile {
  return {
    ...target,
    name: target.name || source.name,
    phones: uniq([...(target.phones ?? []), ...(source.phones ?? [])]),
    emails: uniq([...(target.emails ?? []), ...(source.emails ?? [])]),
    objectAddress: target.objectAddress || source.objectAddress,
    deliveryAddress: target.deliveryAddress || source.deliveryAddress,
    passport: target.passport || source.passport,
    contractDetails: target.contractDetails || source.contractDetails,
    managerComment: [target.managerComment, source.managerComment].filter(Boolean).join('\n').trim() || undefined,
    source: target.source || source.source,
    tags: uniq([...(target.tags ?? []), ...(source.tags ?? [])]) as ClientTag[],
    paymentsByProject: { ...(source.paymentsByProject ?? {}), ...(target.paymentsByProject ?? {}) },
    documentsByProject: { ...(source.documentsByProject ?? {}), ...(target.documentsByProject ?? {}) },
    history: [...(target.history ?? []), ...(source.history ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200),
    updatedAt: now,
  };
}

export function clientNameForMessage(client: ClientProfile): string {
  return client.name?.trim() || 'клиент';
}
