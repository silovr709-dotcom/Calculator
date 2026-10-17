// Права доступа по ролям. Одно место, где описано, кто что видит и делает,
// чтобы не раскидывать проверки по экранам.

export type AppRole = 'admin' | 'manager' | 'measurer' | 'installer';

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: 'Владелец',
  manager: 'Менеджер',
  measurer: 'Замерщик',
  installer: 'Монтажник',
};

export const ROLE_HINTS: Record<AppRole, string> = {
  admin: 'видит всё: закупку, маржу, аналитику, сотрудников и резервные копии',
  manager: 'работает с клиентами и КП, но не видит закупочные цены и маржу',
  measurer: 'замеры, эскизы и фото, свои дела в календаре; цены скрыты',
  installer: 'только график работ и наряды на монтаж',
};

export type Capability =
  | 'viewCost'          // закупка, маржа, наценки, аналитика, проверка цен
  | 'viewClientPrices'  // цены для клиента, КП, документы
  | 'editProjects'      // состав, модули, эскизы, замеры
  | 'viewCrm'           // клиенты, сделки, задачи
  | 'viewSchedule'      // график работ
  | 'editSchedule'      // назначать даты и бригады
  | 'manageUsers'       // сотрудники, резервные копии, уборка файлов
  | 'viewPricebook';    // прайс и версии

const MATRIX: Record<AppRole, Capability[]> = {
  admin: ['viewCost', 'viewClientPrices', 'editProjects', 'viewCrm', 'viewSchedule', 'editSchedule', 'manageUsers', 'viewPricebook'],
  manager: ['viewClientPrices', 'editProjects', 'viewCrm', 'viewSchedule', 'editSchedule', 'viewPricebook'],
  measurer: ['editProjects', 'viewSchedule'],
  installer: ['viewSchedule'],
};

/** Старое значение роли user означало обычного сотрудника — это менеджер. */
export function normalizeRole(role: string | null | undefined): AppRole {
  if (role === 'admin' || role === 'manager' || role === 'measurer' || role === 'installer') return role;
  return 'manager';
}

export function can(role: string | null | undefined, capability: Capability): boolean {
  return MATRIX[normalizeRole(role)].includes(capability);
}

/** Без сервера (локальная работа) ограничений нет: это личный компьютер владельца. */
export function capabilitiesFor(role: string | null | undefined, serverMode: boolean): Record<Capability, boolean> {
  const all: Capability[] = ['viewCost', 'viewClientPrices', 'editProjects', 'viewCrm', 'viewSchedule', 'editSchedule', 'manageUsers', 'viewPricebook'];
  const result = {} as Record<Capability, boolean>;
  for (const capability of all) result[capability] = serverMode ? can(role, capability) : true;
  return result;
}
