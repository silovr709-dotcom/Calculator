import type { ProjectTab } from '../components/ProjectEditor';

/** Куда ведёт адрес приложения. */
export type View =
  | { kind: 'dashboard' }
  | { kind: 'project'; id: string; tab?: ProjectTab }
  | { kind: 'quick' }
  | { kind: 'factory'; id?: string }
  | { kind: 'kb' }
  | { kind: 'settings' }
  | { kind: 'pricebook' }
  | { kind: 'server' }
  | { kind: 'analytics' }
  | { kind: 'audit'; id?: string }
  | { kind: 'sync' };

export const PROJECT_TABS: ProjectTab[] = [
  'modules', 'sketch', 'order', 'lines', 'photos', 'settings', 'client', 'check', 'variants', 'measurement',
];

export function isProjectTab(value: string): value is ProjectTab {
  return (PROJECT_TABS as string[]).includes(value);
}

/** Служебные хэши (QR, импорт, клиентская ссылка) не трогаем маршрутами. */
export function isSpecialHash(hash: string): boolean {
  return /^(#?)(offer=|sync=|srv=|share=|shareurl=|importz=|import=)/.test(hash);
}

/** Человекочитаемый маршрут: #/project/<id>/<tab>, #/reference, #/analytics… */
export function viewFromHash(hash: string): View | null {
  const clean = hash.replace(/^#\/?/, '').split('?')[0];
  const parts = clean.split('/').filter(Boolean).map((part) => {
    try { return decodeURIComponent(part); } catch { return part; }
  });
  if (parts.length === 0) return { kind: 'dashboard' };
  switch (parts[0]) {
    case 'projects': return { kind: 'dashboard' };
    case 'project':
      if (!parts[1]) return null;
      return { kind: 'project', id: parts[1], tab: parts[2] && isProjectTab(parts[2]) ? parts[2] : undefined };
    case 'quick': return { kind: 'quick' };
    case 'factory': return { kind: 'factory', id: parts[1] };
    case 'reference': return { kind: 'kb' };
    case 'pricebook': return { kind: 'pricebook' };
    case 'analytics': return { kind: 'analytics' };
    case 'audit': return { kind: 'audit', id: parts[1] };
    case 'settings': return { kind: 'settings' };
    case 'sync': return { kind: 'sync' };
    case 'server': return { kind: 'server' };
    default: return null;
  }
}

export function viewToHash(view: View): string {
  switch (view.kind) {
    case 'dashboard': return '#/projects';
    case 'project': return `#/project/${encodeURIComponent(view.id)}${view.tab ? `/${view.tab}` : ''}`;
    case 'quick': return '#/quick';
    case 'factory': return view.id ? `#/factory/${encodeURIComponent(view.id)}` : '#/factory';
    case 'kb': return '#/reference';
    case 'pricebook': return '#/pricebook';
    case 'analytics': return '#/analytics';
    case 'audit': return view.id ? `#/audit/${encodeURIComponent(view.id)}` : '#/audit';
    case 'settings': return '#/settings';
    case 'sync': return '#/sync';
    case 'server': return '#/server';
    default: return '#/projects';
  }
}

export function sameView(a: View, b: View): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
