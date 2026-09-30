import type { KitchenModule, ModuleDefaults, Pricebook, PriceItem, ProjectLine, SlotChoice, SlotKey } from '../types';
import { lineFromItem } from './engine';
import { moduleLinePrefix } from './clientOffer';
import { inferDimensionSurcharges } from './surcharges';
import { uid } from './storage';

/** Типовые виды позиций (пользователь может ввести и собственный тип) */
export const MODULE_TYPES = [
  'Нижний шкаф',
  'Верхний шкаф',
  'Пенал',
  'Шкаф под мойку',
  'Шкаф под духовой шкаф',
  'Шкаф под холодильник',
  'Открытая секция',
  'Декоративная панель',
  'Другой элемент',
] as const;

/** Типы модулей, которые стоят на полу на опорах. Остальные — навесные/декоративные. */
export function moduleStandsOnFloor(type: string): boolean {
  return ['Нижний шкаф', 'Пенал', 'Шкаф под мойку', 'Шкаф под духовой шкаф'].includes(type);
}

/** Быстрые заготовки конструкции без скрытого выбора корпуса и материалов. */
export interface ModulePreset {
  id: string;
  label: string;
  type: string;
  name: string;
  facades: number;
  drawers: number;
  shelves: number;
}

export const MODULE_PRESETS: ModulePreset[] = [
  { id: 'base-2-doors', label: 'Нижний шкаф · 2 двери', type: 'Нижний шкаф', name: 'Нижний шкаф · 2 двери', facades: 2, drawers: 0, shelves: 1 },
  { id: 'base-1-door-drawer', label: 'Нижний шкаф · ящик + дверь', type: 'Нижний шкаф', name: 'Нижний шкаф · ящик + дверь', facades: 2, drawers: 1, shelves: 0 },
  { id: 'base-2-drawers', label: 'Нижний шкаф · 2 ящика', type: 'Нижний шкаф', name: 'Нижний шкаф · 2 ящика', facades: 2, drawers: 2, shelves: 0 },
  { id: 'base-3-drawers', label: 'Нижний шкаф · 3 ящика', type: 'Нижний шкаф', name: 'Нижний шкаф · 3 ящика', facades: 3, drawers: 3, shelves: 0 },
  { id: 'wall-2-doors', label: 'Верхний шкаф · 2 двери', type: 'Верхний шкаф', name: 'Верхний шкаф · 2 двери', facades: 2, drawers: 0, shelves: 1 },
  { id: 'sink', label: 'Шкаф под мойку', type: 'Шкаф под мойку', name: 'Шкаф под мойку', facades: 2, drawers: 0, shelves: 0 },
  { id: 'oven', label: 'Шкаф под духовой шкаф', type: 'Шкаф под духовой шкаф', name: 'Шкаф под духовой шкаф', facades: 1, drawers: 1, shelves: 0 },
  { id: 'tall', label: 'Пенал', type: 'Пенал', name: 'Пенал', facades: 2, drawers: 0, shelves: 4 },
];

export const SLOT_LABELS: Record<SlotKey, string> = {
  body: 'Корпус (каркас из прайса)',
  facade: 'Фасады (материал, цена за м²)',
  frame: 'Алюминиевая рамка фасада (доплата за м²)',
  hinge: 'Петли (модель)',
  drawerSys: 'Система ящиков',
  lift: 'Подъёмный механизм',
  handle: 'Ручки',
  shelf: 'Полка дополнительная',
  legs: 'Опоры / ножки (модель)',
};

/** Пулы слотов — ТОЛЬКО реальные категории базы Висма */
export const SLOT_POOLS: Record<SlotKey, (i: PriceItem) => boolean> = {
  body: (i) => i.category.startsWith('Корпуса'),
  facade: (i) => i.category.startsWith('Фасады') && i.priceBasis === 'm2',
  frame: (i) => i.category === 'Фасады: Стекло и зеркала' && Boolean(i.subcategory?.startsWith('Алюм. рамка')) && i.priceBasis === 'm2',
  hinge: (i) => i.category === 'Петли' || (i.category.includes('BLUM') && i.subcategory === 'Петли Blum'),
  drawerSys: (i) => i.category === 'Системы выдвижения' || (i.category.includes('BLUM') && i.subcategory === 'Ящики и направляющие Blum'),
  lift: (i) => i.category === 'Подъёмные механизмы' || (i.category.includes('BLUM') && i.subcategory === 'Aventos'),
  handle: (i) => i.category === 'Ручки',
  shelf: (i) => i.category === 'Доп. комплектация каркасов' || i.category.startsWith('Корпуса'),
  legs: (i) => i.category === 'Опоры и ножки',
};

const defaultSlots = (): Record<SlotKey, SlotChoice> => ({
  body: { mode: 'manual', itemId: null }, // корпус всегда индивидуален — из настроек не наследуется
  facade: { mode: 'default', itemId: null },
  frame: { mode: 'default', itemId: null },
  hinge: { mode: 'default', itemId: null },
  drawerSys: { mode: 'default', itemId: null },
  lift: { mode: 'default', itemId: null },
  handle: { mode: 'default', itemId: null },
  shelf: { mode: 'default', itemId: null },
  legs: { mode: 'default', itemId: null },
});

export function newModule(type: string): KitchenModule {
  return {
    id: uid('mod'),
    type,
    name: type,
    qty: 1,
    widthMm: null, heightMm: null, depthMm: null,
    facades: 0, drawers: 0, shelves: 0, hinges: 0, handles: 0, lifts: 0,
    // стоящие модули сразу получают стандартные 4 опоры; навесные — без опор
    legs: moduleStandsOnFloor(type) ? 4 : 0,
    facadeWmm: null, facadeHmm: null,
    slots: defaultSlots(),
  };
}

/** Создаёт заготовку конструкции; корпус, фасады и фурнитура всё ещё выбираются явно. */
export function moduleFromPreset(preset: ModulePreset): KitchenModule {
  return {
    ...newModule(preset.type),
    name: preset.name,
    facades: preset.facades,
    drawers: preset.drawers,
    shelves: preset.shelves,
  };
}

/** Итем, действующий в слоте: ручной выбор ИЛИ настройка проекта. Ничего не угадывается. */
export function resolveSlot(
  m: KitchenModule,
  key: SlotKey,
  defaults: ModuleDefaults,
  pricebook: Pricebook,
): { item: PriceItem | null; source: 'manual' | 'default' | null } {
  const slot = m.slots[key] ?? { mode: 'default', itemId: null };
  const id = slot.mode === 'manual' ? slot.itemId : (defaults[key] ?? null);
  if (!id) return { item: null, source: null };
  const item = pricebook.items.find((i) => i.id === id) ?? null;
  return { item, source: item ? (slot.mode === 'manual' ? 'manual' : 'default') : null };
}

/** Коды проверяемых предупреждений, которые пользователь может подтвердить. */
export type ModuleWarningCode = 'dims' | 'bodyDrawers' | 'bodyDoors' | 'shelves' | 'opening' | 'handles' | 'dimensionSurcharge' | 'legs';

export interface ModuleWarning {
  code: ModuleWarningCode;
  text: string;
}

export interface ModuleCheck {
  level: 'ok' | 'warn' | 'error';
  errors: string[]; // блокируют полный расчёт модуля
  /** Только тексты неподтверждённых предупреждений (для обратной совместимости). */
  warnings: string[];
  openWarnings: ModuleWarning[];
  confirmedWarnings: ModuleWarning[];
}

/**
 * Перемещает модуль на шаг (-1/1) или на указанную позицию массива.
 * Исходный массив и его элементы не изменяются. При невозможном перемещении
 * возвращается тот же экземпляр массива — это удобно для React-состояния.
 */
export function moveModule(modules: KitchenModule[], id: string, target: number): KitchenModule[] {
  const from = modules.findIndex((module) => module.id === id);
  if (from < 0) return modules;

  const to = target === -1 || target === 1 ? from + target : target;
  if (!Number.isInteger(to) || to < 0 || to >= modules.length || to === from) return modules;

  const next = [...modules];
  const [module] = next.splice(from, 1);
  next.splice(to, 0, module);
  return next;
}

export function isWarningConfirmed(module: KitchenModule, code: ModuleWarningCode | string): boolean {
  return module.confirmations?.includes(code) ?? false;
}

/** Возвращает копию модуля с добавленным или снятым подтверждением. */
export function setWarningConfirmed(
  module: KitchenModule,
  code: ModuleWarningCode | string,
  confirmed: boolean,
): KitchenModule {
  const confirmations = module.confirmations ?? [];
  const has = confirmations.includes(code);
  if (has === confirmed) return module;
  return {
    ...module,
    confirmations: confirmed
      ? [...confirmations, code]
      : confirmations.filter((item) => item !== code),
  };
}

/**
 * Извлечение ожидаемого количества ящиков из наименования корпуса.
 * Примеры:
 * - «с ящиком», «и ящиком», «с 1 ящиком», «с 1-м ящиком», «с ящ.» → 1
 * - «с 2-мя ящиками», «с 2мя ящиками», «с 2 ящиками», «с ящиками» → 2
 * - «с 3-мя ящиками», «с 3мя ящиками», «с 3 ящиками» → 3
 * - «с 4-мя ящиками», «с 4мя ящиками», «с 4 ящиками» → 4
 */
export function parseBodyDrawers(name: string): number | null {
  const s = name.toLowerCase();

  // Числовое указание: «с 2-мя ящиками», «с 3-мя ящиками», «с 1 ящиком», «под ДШ с 1 ящиком», «2мя ящиками»
  const numMatch = s.match(/(?:с\s+)?(\d+)\s*(?:-?[а-я]+)?\s*ящ(?:ик(?:ами|а|ом)?|\.?)/i);
  if (numMatch) {
    return parseInt(numMatch[1], 10);
  }

  // Словесные формы
  if (/(?:с\s+)?двумя\s*ящик/i.test(s)) return 2;
  if (/(?:с\s+)?тремя\s*ящик/i.test(s)) return 3;
  if (/(?:с\s+)?четырьмя\s*ящик/i.test(s)) return 4;
  if (/(?:с\s+)?одним\s*ящик/i.test(s)) return 1;

  // «с ящиками» без числа (например, «Стол напольный 2-х дверный с ящиками»)
  if (/с\s+ящиками/i.test(s)) return 2;

  // «с ящиком», «и ящиком», «с ящ.»
  if (/(?:с|и)\s+ящиком|с\s+ящ(?:\.|\s|$)/i.test(s)) return 1;

  return null;
}

/**
 * Извлечение ожидаемого количества дверей/фасадов из наименования корпуса.
 * Примеры:
 * - «1-но дверный», «1-дверный», «1-ой дверкой», «однодверный» → 1
 * - «2-х дверный», «2х дверный», «2-мя дверками», «2мя дверками», «двухдверный» → 2
 * - «3-х дверный», «3-мя дверками», «трехдверный» → 3
 * - «4-х дверный», «4мя дверками», «четырехдверный» → 4
 */
export function parseBodyDoors(name: string): number | null {
  const s = name.toLowerCase();

  // Числовое указание: «1-но дверный», «2-х дверный», «2мя дверками», «1ой дверкой», «4мя дверками»
  const numMatch = s.match(/(\d+)\s*(?:-?[а-я]+)?\s*(?:дверн[а-я]*|дверк[а-я]*)/i);
  if (numMatch) {
    return parseInt(numMatch[1], 10);
  }

  // Словесные формы
  if (/однодверн|(?:с\s+)?одной\s*двер/i.test(s)) return 1;
  if (/двухдверн|двудверн|(?:с\s+)?двумя\s*двер/i.test(s)) return 2;
  if (/трехдверн|трёхдверн|(?:с\s+)?тремя\s*двер/i.test(s)) return 3;
  if (/четырехдверн|четырёхдверн|(?:с\s+)?четырьмя\s*двер/i.test(s)) return 4;

  return null;
}

/** Сколько единиц слота нужно на ОДИН модуль (0 = слот не требуется) */
export function slotNeed(m: KitchenModule, key: SlotKey): number {
  switch (key) {
    case 'body': return 1;
    case 'facade': return m.facades + (m.extraFacadeParts ?? []).reduce((sum, part) => sum + part.qty, 0);
    case 'frame': return m.facades;
    case 'hinge': return m.hinges;
    case 'drawerSys': return m.drawers;
    case 'lift': return m.lifts;
    case 'handle': return m.handles;
    case 'shelf': return m.shelves;
    case 'legs': return m.legs ?? 0;
  }
}

export function checkModule(m: KitchenModule, defaults: ModuleDefaults, pricebook: Pricebook): ModuleCheck {
  const errors: string[] = [];
  const allWarnings: ModuleWarning[] = [];
  const r = (k: SlotKey) => resolveSlot(m, k, defaults, pricebook);
  const warn = (code: ModuleWarningCode, text: string) => allWarnings.push({ code, text });

  if (m.qty <= 0) errors.push('Количество должно быть больше 0');
  if (!m.widthMm || !m.heightMm) warn('dims', 'Не указаны размеры модуля (Ш×В)');

  const body = r('body');
  if (!body.item) {
    errors.push('Не выбран корпус (каркас из прайса)');
  } else {
    // Сверка названия корпуса с конструкцией модуля: ящики
    const expectedDrawers = parseBodyDrawers(body.item.name);
    if (expectedDrawers !== null && m.drawers < expectedDrawers) {
      warn('bodyDrawers', `Корпус по названию — с ${expectedDrawers} ящик${expectedDrawers === 1 ? 'ом' : 'ами'}, а в конструкции указано ${m.drawers}. Если нужны системы выдвижения — укажите количество ящиков; если нет — подтвердите`);
    }

    // Сверка названия корпуса с конструкцией модуля: фасады / двери
    const expectedDoors = parseBodyDoors(body.item.name);
    if (expectedDoors !== null && m.facades < expectedDoors) {
      warn('bodyDoors', 'Фасады в цену каркаса не входят — укажите количество, либо подтвердите');
    }

    const dimensionRules = inferDimensionSurcharges(m, body.item, pricebook);
    const pendingRules = dimensionRules.filter((rule) => !(m.surcharges ?? []).includes(rule.itemId));
    const staleRules = (m.automaticSurcharges ?? []).filter((id) => !dimensionRules.some((rule) => rule.itemId === id));
    if (pendingRules.length > 0) {
      warn('dimensionSurcharge', `Изменены габариты корпуса: примените рекомендованные надбавки (${pendingRules.map((rule) => `+${rule.percent}%`).join(' + ')}) только к корпусу`);
    } else if (staleRules.length > 0) {
      warn('dimensionSurcharge', 'Автоматическая надбавка сохранена от прежних габаритов — проверьте и обновите её');
    }
  }

  if (m.facades > 0) {
    const f = r('facade');
    if (!f.item) errors.push('Указаны фасады, но материал фасада не выбран');
    else if (m.facadeParts?.length) {
      if (m.facadeParts.length !== m.facades) errors.push(`Размеров фасадов указано ${m.facadeParts.length}, а фасадов в конструкции ${m.facades}`);
      if (m.facadeParts.some((part) => part.widthMm <= 0 || part.heightMm <= 0)) errors.push('В размерах фасадов есть нулевые или отрицательные значения');
    } else if (!m.facadeWmm || !m.facadeHmm) errors.push('Не указан размер фасада (Ш×В, мм) — цена материала за м²');
    const frame = r('frame').item;
    if (frame && (!f.item || f.item.category !== 'Фасады: Стекло и зеркала')) errors.push('Алюминиевая рамка выбрана, но материал фасада не относится к стеклу/зеркалу');
  }
  // Отдельные фасадные детали: независимая проверка, работает и без конструктивных фасадов.
  const extras = m.extraFacadeParts ?? [];
  if (extras.length > 0) {
    if (!r('facade').item) errors.push('Отдельные фасадные детали: не выбран материал фасада');
    for (const [index, part] of extras.entries()) {
      const label = part.label?.trim() || `деталь ${index + 1}`;
      if (part.widthMm <= 0 || part.heightMm <= 0) errors.push(`Отдельная фасадная «${label}»: укажите ширину и высоту больше 0`);
      if (part.qty <= 0) errors.push(`Отдельная фасадная «${label}»: укажите количество больше 0`);
    }
  }
  if (m.drawers > 0 && !r('drawerSys').item) errors.push('Указаны ящики, но система выдвижения не выбрана');
  if (m.hinges > 0 && !r('hinge').item) errors.push('Указано количество петель, но модель петли не выбрана');
  if (m.lifts > 0 && !r('lift').item) errors.push('Указаны подъёмники, но механизм не выбран');
  if (m.handles > 0 && !r('handle').item) errors.push('Указаны ручки, но модель не выбрана');
  if ((m.legs ?? 0) > 0 && !r('legs').item) errors.push('Указано количество опор, но модель опоры не выбрана');
  if (moduleStandsOnFloor(m.type) && (m.legs ?? 0) === 0)
    warn('legs', 'Стоящий модуль без опор: обычно нужно 4 — укажите количество и модель, либо подтвердите, что опор нет');
  if (m.shelves > 0 && !r('shelf').item) warn('shelves', 'Полки: если входят в каркас — оставьте как есть; иначе выберите позицию доп. полки');
  if (m.facades > 0 && m.hinges === 0 && m.lifts === 0 && m.drawers === 0)
    warn('opening', 'Есть фасады, но не задано ни петель, ни подъёмников, ни ящиков — укажите, на чём открываются');
  if (m.facades > 0 && m.handles === 0)
    warn('handles', 'Ручки не заданы (0) — подтвердите, если открывание без ручек');
  if ((m.surcharges?.length ?? 0) > 0) {
    if (!body.item) errors.push('Заданы процентные надбавки, но не выбран корпус (база для процента)');
    for (const sid of m.surcharges ?? []) {
      const it = pricebook.items.find((i) => i.id === sid);
      if (!it) errors.push('Надбавка: позиция не найдена в прайсе');
      else if (it.priceKind !== 'percent') errors.push(`«${it.name.slice(0, 40)}» — не процентная позиция`);
    }
  }

  // выбранные позиции без цены
  (['body', 'facade', 'frame', 'hinge', 'drawerSys', 'lift', 'handle', 'shelf'] as SlotKey[]).forEach((k) => {
    if (slotNeed(m, k) <= 0 && k !== 'body') return;
    const { item } = r(k);
    if (item && item.priceKind !== 'fixed') errors.push(`«${item.name.slice(0, 40)}»: в прайсе нет фиксированной цены (${item.priceKind === 'unavailable' ? 'временно недоступна' : 'цена не число'})`);
  });

  const openWarnings = allWarnings.filter((warning) => !isWarningConfirmed(m, warning.code));
  const confirmedWarnings = allWarnings.filter((warning) => isWarningConfirmed(m, warning.code));
  return {
    level: errors.length ? 'error' : openWarnings.length ? 'warn' : 'ok',
    errors,
    warnings: openWarnings.map((warning) => warning.text),
    openWarnings,
    confirmedWarnings,
  };
}

/** Строки расчёта из модуля. Генерируются ТОЛЬКО из выбранных позиций — ничего не подставляется молча. */
export function moduleToLines(m: KitchenModule, defaults: ModuleDefaults, pricebook: Pricebook): ProjectLine[] {
  const out: ProjectLine[] = [];
  const pbId = pricebook.meta.id;
  const tag = moduleLinePrefix(m.name, m.id);
  const push = (item: PriceItem | null, qty: number, params?: { widthMm: number; heightMm: number }, extra?: string) => {
    if (!item || qty <= 0 || item.priceKind !== 'fixed') return;
    const line = lineFromItem(item, pbId, qty, params ?? {});
    line.note = extra ? `${tag} — ${extra}` : tag;
    out.push(line);
  };

  const r = (k: SlotKey) => resolveSlot(m, k, defaults, pricebook).item;

  const body = r('body');
  push(body, m.qty);
  const bodyLine = out.length > 0 && body ? out[0] : null;
  // процентные надбавки (нестандарт) — от суммы корпуса, правило прайса
  for (const sid of m.surcharges ?? []) {
    const it = pricebook.items.find((i) => i.id === sid);
    if (!it || it.priceKind !== 'percent' || !bodyLine) continue;
    const line = lineFromItem(it, pbId, 1);
    line.baseLineId = bodyLine.id;
    line.note = `${tag} — от корпуса`;
    out.push(line);
  }
  if (m.facadeParts?.length) {
    for (const [index, part] of m.facadeParts.entries()) {
      const dimensions = { widthMm: part.widthMm, heightMm: part.heightMm };
      const detail = `${part.kind === 'drawer' ? 'Фасад ящика' : 'Фасад двери'} ${index + 1}: ${part.widthMm}×${part.heightMm} мм`;
      push(r('facade'), m.qty, dimensions, detail);
      push(r('frame'), m.qty, dimensions, `Рамка фасада ${index + 1}: ${part.widthMm}×${part.heightMm} мм`);
    }
  } else if (m.facades > 0 && m.facadeWmm && m.facadeHmm) {
    const dimensions = { widthMm: m.facadeWmm, heightMm: m.facadeHmm };
    push(r('facade'), m.facades * m.qty, dimensions, `${m.facades} фасада ${m.facadeWmm}×${m.facadeHmm} мм`);
    push(r('frame'), m.facades * m.qty, dimensions, `${m.facades} алюминиевые рамки ${m.facadeWmm}×${m.facadeHmm} мм`);
  }
  // Отдельные фасадные детали (боковина, накладка): только материал фасада,
  // каждая — своей строкой по своей площади. Рамка на них не начисляется.
  for (const [index, part] of (m.extraFacadeParts ?? []).entries()) {
    const kindLabel = part.kind === 'drawer' ? 'фасад ящика' : part.kind === 'door' ? 'фасад двери' : 'фасадная панель';
    const name = part.label?.trim() || `${part.kind === 'drawer' ? 'Фасад ящика' : part.kind === 'door' ? 'Фасад двери' : 'Фасадная панель'} ${index + 1}`;
    push(r('facade'), part.qty * m.qty, { widthMm: part.widthMm, heightMm: part.heightMm }, `${name}: ${part.widthMm}×${part.heightMm} мм (${kindLabel})`);
  }
  push(r('hinge'), m.hinges * m.qty, undefined, `${m.hinges} петли`);
  push(r('drawerSys'), m.drawers * m.qty, undefined, `${m.drawers} ящика`);
  push(r('lift'), m.lifts * m.qty, undefined, `${m.lifts} подъёмника`);
  push(r('handle'), m.handles * m.qty, undefined, `${m.handles} ручки`);
  if (m.shelves > 0) push(r('shelf'), m.shelves * m.qty, undefined, `${m.shelves} полки`);
  if ((m.legs ?? 0) > 0) push(r('legs'), (m.legs ?? 0) * m.qty, undefined, `${m.legs} опоры`);
  return out;
}

/** Сводка по всем модулям: счётчики для панели итогов */
export function modulesSummary(mods: KitchenModule[]) {
  const s = { modules: 0, facades: 0, drawers: 0, hinges: 0, handles: 0, lifts: 0, shelves: 0 };
  for (const m of mods) {
    s.modules += m.qty;
    s.facades += m.facades * m.qty;
    s.drawers += m.drawers * m.qty;
    s.hinges += m.hinges * m.qty;
    s.handles += m.handles * m.qty;
    s.lifts += m.lifts * m.qty;
    s.shelves += m.shelves * m.qty;
  }
  return s;
}
