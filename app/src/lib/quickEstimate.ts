import type { Pricebook, PriceItem, ProjectLine } from '../types';
import { lineFromItem, sheetsFromLength, sheetLengthOf, unitIsHalfSheetAllowed } from './engine';
import { parseBodyDoors, parseBodyDrawers } from './modules';

export type QuickFacadeTier = 'pvc-economy' | 'pvc-standard' | 'pvc-premium' | 'emal' | 'plastic' | 'tss';
export type QuickWorktopTier = 'none' | 'postforming-26' | 'postforming-38' | 'compact';
export type QuickHardwareTier = 'standard' | 'soft-close' | 'blum';

export interface QuickEstimateInput {
  lowerLengthMm: number;
  upperLengthMm: number;
  upperHeightMm: number;
  avgModuleWidthMm: number;
  tallCount: number;
  drawerCount: number;
  worktopLengthMm: number;
  facadeTier: QuickFacadeTier;
  worktopTier: QuickWorktopTier;
  hardwareTier: QuickHardwareTier;
  includeHandles: boolean;
  includeLegs: boolean;
  includePlinth: boolean;
  includeDryer: boolean;
  includeSink: boolean;
  includeMixer: boolean;
}

export interface QuickEstimateMetrics {
  lowerModules: number;
  upperModules: number;
  floorModules: number;
  lowerPlannedLengthMm: number;
  upperPlannedLengthMm: number;
  facadeAreaM2: number;
  facadeCount: number;
  doorFronts: number;
  drawerFronts: number;
  hingeCount: number;
  handleCount: number;
  legCount: number;
  worktopSheets: number;
}

export interface QuickEstimateResult {
  lines: ProjectLine[];
  assumptions: string[];
  warnings: string[];
  missing: string[];
  metrics: QuickEstimateMetrics;
  tolerancePct: number;
}

type BodyKind = 'lower-door' | 'lower-drawer' | 'upper' | 'tall';

interface BodyPlanEntry {
  widthMm: number;
  item: PriceItem | null;
  kind: BodyKind;
  desiredDrawers?: number;
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const round3 = (value: number) => Math.round(value * 1000) / 1000;
const positive = (value: number) => Number.isFinite(value) && value > 0 ? value : 0;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const norm = (value: string) => value.toLowerCase().replace(/ё/g, 'е');

function fixedItems(pricebook: Pricebook, pred: (item: PriceItem) => boolean): PriceItem[] {
  return pricebook.items.filter((item) => item.priceKind === 'fixed' && item.price != null && item.price > 0 && pred(item));
}

function widthOf(item: PriceItem): number | null {
  const direct = `${item.attrs?.['размер'] ?? ''}`.match(/(\d{3,4})\s*мм/i);
  if (direct) return Number(direct[1]);
  const afterDash = item.name.match(/—\s*(\d{3,4})\s*мм/i);
  if (afterDash) return Number(afterDash[1]);
  return null;
}

function heightOf(item: PriceItem, fallback: number): number {
  const raw = `${item.attrs?.['серия'] ?? ''} ${item.name}`;
  const match = raw.match(/Н\s*=\s*(\d{3,4})/i) ?? raw.match(/H\s*=\s*(\d{3,4})/i);
  if (!match) return fallback;
  const height = Number(match[1]);
  return height >= 300 && height <= 2600 ? height : fallback;
}

function lengthOfLongItem(item: PriceItem): number | null {
  const s = `${item.attrs?.['формат'] ?? ''} ${item.name}`;
  const meter = s.match(/L\s*=\s*(\d+(?:[,.]\d+)?)\s*м/i);
  if (meter) return Math.round(Number(meter[1].replace(',', '.')) * 1000);
  const dotted = s.match(/(?:^|[^\d])(\d)[,.](\d{3})\s*(?:\*|х|x|мм)/i);
  if (dotted) return Number(`${dotted[1]}${dotted[2]}`);
  const size = s.match(/(?:^|[^\d])(\d{4})\s*(?:\*|х|x|мм)/i);
  if (size) return Number(size[1]);
  return null;
}

function sheetLengthForEstimate(item: PriceItem): number {
  return lengthOfLongItem(item) ?? sheetLengthOf(item);
}

function byScore<T>(items: T[], score: (item: T) => number): T | null {
  return [...items].sort((a, b) => score(a) - score(b))[0] ?? null;
}

function byPricePercentile(items: PriceItem[], percentile: number): PriceItem | null {
  const priced = [...items].sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
  if (priced.length === 0) return null;
  const index = clamp(Math.round((priced.length - 1) * percentile), 0, priced.length - 1);
  return priced[index];
}

function moduleCount(lengthMm: number, avgWidthMm: number): number {
  if (lengthMm <= 0) return 0;
  return Math.max(1, Math.ceil(lengthMm / clamp(avgWidthMm || 600, 300, 900)));
}

function bodyWidthPool(pricebook: Pricebook, kind: 'lower' | 'upper'): number[] {
  const widths = fixedItems(pricebook, (item) => {
    const name = norm(item.name);
    if (kind === 'upper') return item.category === 'Корпуса: шкафы навесные' && name.includes('шкаф настенный') && !name.includes('углов') && !name.includes('под вытяж');
    return item.category === 'Корпуса: столы и пеналы'
      && name.includes('стол напольный')
      && !name.includes('мойк')
      && !name.includes('углов')
      && !name.includes('пенал')
      && !name.includes('бутыл')
      && !name.includes('дш');
  })
    .map(widthOf)
    .filter((width): width is number => width != null && width >= 150 && width <= 1200);
  const fallback = kind === 'upper' ? [250, 300, 350, 400, 450, 500, 600, 700, 800, 900] : [300, 350, 400, 450, 500, 600, 700, 800, 900];
  return [...new Set(widths.length ? widths : fallback)].sort((a, b) => a - b);
}

function planWidths(lengthMm: number, avgWidthMm: number, allowedWidths: number[]): number[] {
  const count = moduleCount(lengthMm, avgWidthMm);
  if (count === 0) return [];
  const widths: number[] = [];
  let remaining = lengthMm;
  for (let slot = count; slot > 0; slot -= 1) {
    const target = remaining / slot;
    const width = byScore(allowedWidths, (value) => Math.abs(value - target) + (value > target ? 0.02 : 0)) ?? allowedWidths[0] ?? avgWidthMm;
    widths.push(width);
    remaining -= width;
  }
  return widths;
}

function commonBodyFilter(item: PriceItem): boolean {
  const name = norm(item.name);
  return item.category === 'Корпуса: столы и пеналы'
    && name.includes('стол напольный')
    && !name.includes('мойк')
    && !name.includes('углов')
    && !name.includes('пенал')
    && !name.includes('бутыл')
    && !name.includes('дш')
    && !name.includes('открытой нишей');
}

function pickLowerBody(pricebook: Pricebook, targetWidth: number, desiredDrawers = 0): PriceItem | null {
  const items = fixedItems(pricebook, (item) => {
    if (!commonBodyFilter(item)) return false;
    const drawers = parseBodyDrawers(item.name) ?? 0;
    return desiredDrawers > 0 ? drawers > 0 : drawers === 0;
  });
  return byScore(items, (item) => {
    const width = widthOf(item) ?? targetWidth;
    const drawers = parseBodyDrawers(item.name) ?? 0;
    const doors = parseBodyDoors(item.name) ?? (width >= 500 ? 2 : 1);
    return Math.abs(width - targetWidth)
      + Math.abs(drawers - desiredDrawers) * (desiredDrawers > 0 ? 18 : 12)
      + (desiredDrawers === 0 && targetWidth >= 500 && doors >= 2 ? -35 : 0)
      + (desiredDrawers > 0 && drawers === desiredDrawers ? -30 : 0)
      + (item.price ?? 0) / 10000;
  }) ?? (desiredDrawers > 0 ? pickLowerBody(pricebook, targetWidth, 0) : null);
}

function pickUpperBody(pricebook: Pricebook, targetWidth: number, targetHeight: number): PriceItem | null {
  const items = fixedItems(pricebook, (item) => {
    const name = norm(item.name);
    return item.category === 'Корпуса: шкафы навесные'
      && name.includes('шкаф настенный')
      && !name.includes('углов')
      && !name.includes('под вытяж');
  });
  return byScore(items, (item) => {
    const width = widthOf(item) ?? targetWidth;
    const height = heightOf(item, 720);
    return Math.abs(width - targetWidth)
      + Math.abs(height - targetHeight) * 0.45
      + (targetWidth >= 500 && /2[-\s]*(?:х|мя)?\s*двер/i.test(item.name) ? -30 : 0)
      + (item.price ?? 0) / 10000;
  });
}

function pickTallBody(pricebook: Pricebook): PriceItem | null {
  const items = fixedItems(pricebook, (item) => item.category === 'Корпуса: столы и пеналы' && norm(item.name).includes('пенал'));
  return byScore(items, (item) => {
    const name = norm(item.name);
    const width = widthOf(item) ?? 600;
    return Math.abs(width - 600)
      + Math.abs(heightOf(item, 2140) - 2140) * 0.25
      + (name.includes('полками') ? -25 : 0)
      + (item.price ?? 0) / 10000;
  });
}

function pickFacade(pricebook: Pricebook, tier: QuickFacadeTier): PriceItem | null {
  const category: Record<QuickFacadeTier, string> = {
    'pvc-economy': 'Фасады: МДФ (ПВХ плёнка)',
    'pvc-standard': 'Фасады: МДФ (ПВХ плёнка)',
    'pvc-premium': 'Фасады: МДФ (ПВХ плёнка)',
    emal: 'Фасады: Эмаль',
    plastic: 'Фасады: Пластик (HPL)',
    tss: 'Фасады: TSS плита',
  };
  const percentile: Record<QuickFacadeTier, number> = {
    'pvc-economy': 0.08,
    'pvc-standard': 0.36,
    'pvc-premium': 0.72,
    emal: 0.28,
    plastic: 0.35,
    tss: 0.45,
  };
  let items = fixedItems(pricebook, (item) => item.category === category[tier] && item.priceBasis === 'm2');
  if (tier.startsWith('pvc')) items = items.filter((item) => !norm(`${item.attrs?.['категория'] ?? ''} ${item.name}`).includes('патина'));
  return byPricePercentile(items, percentile[tier]);
}

function pickWorktop(pricebook: Pricebook, tier: QuickWorktopTier): PriceItem | null {
  if (tier === 'none') return null;
  if (tier === 'compact') {
    const compact = fixedItems(pricebook, (item) => item.category.startsWith('Столешницы: компакт-плита')
      && item.priceBasis === 'sheet'
      && /(?:650|600)/.test(`${item.attrs?.['формат'] ?? ''} ${item.name}`));
    return byPricePercentile(compact, 0.25);
  }
  const thickness = tier === 'postforming-26' ? '26' : '38';
  const items = fixedItems(pricebook, (item) => item.category === 'Столешницы: Мир Столешниц (постформинг)'
    && item.priceBasis === 'sheet'
    && norm(item.name).includes('столешница')
    && `${item.attrs?.['толщина'] ?? ''} ${item.name}`.includes(thickness));
  return byPricePercentile(items, 0.35);
}

function pickHinge(pricebook: Pricebook, tier: QuickHardwareTier): PriceItem | null {
  if (tier === 'blum') {
    const blum = fixedItems(pricebook, (item) => item.category.includes('BLUM')
      && item.subcategory === 'Петли Blum'
      && norm(item.name).includes('clip top')
      && norm(item.name).includes('дов')
      && norm(item.name).includes('110'));
    return byPricePercentile(blum, 0.35) ?? byPricePercentile(fixedItems(pricebook, (item) => item.category.includes('BLUM') && item.subcategory === 'Петли Blum'), 0.45);
  }
  const hinges = fixedItems(pricebook, (item) => item.category === 'Петли'
    && norm(item.name).includes('боярд')
    && norm(item.name).includes(tier === 'soft-close' ? 'дов' : '90'));
  return byPricePercentile(hinges, tier === 'soft-close' ? 0.35 : 0.2) ?? byPricePercentile(fixedItems(pricebook, (item) => item.category === 'Петли'), 0.35);
}

function pickDrawer(pricebook: Pricebook, tier: QuickHardwareTier): PriceItem | null {
  if (tier === 'blum') {
    const blum = fixedItems(pricebook, (item) => item.category.includes('BLUM')
      && item.subcategory === 'Ящики и направляющие Blum'
      && norm(item.name).includes('450')
      && norm(item.name).includes('дов'));
    return byPricePercentile(blum, 0.35) ?? byPricePercentile(fixedItems(pricebook, (item) => item.category.includes('BLUM') && item.subcategory === 'Ящики и направляющие Blum'), 0.35);
  }
  const drawers = fixedItems(pricebook, (item) => item.category === 'Системы выдвижения'
    && norm(item.name).includes('боярд')
    && (tier === 'soft-close' ? norm(item.name).includes('дов') : true)
    && !norm(item.name).includes('т/б'));
  return byPricePercentile(drawers, tier === 'soft-close' ? 0.35 : 0.15) ?? byPricePercentile(fixedItems(pricebook, (item) => item.category === 'Системы выдвижения'), 0.25);
}

function pickHandle(pricebook: Pricebook): PriceItem | null {
  const handles = fixedItems(pricebook, (item) => item.category === 'Ручки');
  return byPricePercentile(handles, 0.35);
}

function pickLeg(pricebook: Pricebook): PriceItem | null {
  const legs = fixedItems(pricebook, (item) => item.category === 'Опоры и ножки' && norm(item.name).includes('пвх'));
  return byPricePercentile(legs, 0.2) ?? byPricePercentile(fixedItems(pricebook, (item) => item.category === 'Опоры и ножки'), 0.2);
}

function pickPlinth(pricebook: Pricebook): PriceItem | null {
  const plinths = fixedItems(pricebook, (item) => item.category === 'Цоколь и длинномеры' && norm(item.name).includes('цоколь') && /(?:4\s*м|\/4м|4000)/i.test(item.name));
  return byPricePercentile(plinths, 0.25) ?? byPricePercentile(fixedItems(pricebook, (item) => item.category === 'Цоколь и длинномеры' && norm(item.name).includes('цоколь')), 0.25);
}

function pickDryer(pricebook: Pricebook): PriceItem | null {
  return byPricePercentile(fixedItems(pricebook, (item) => item.category === 'Посудосушители'), 0.35);
}

function pickSink(pricebook: Pricebook): PriceItem | null {
  return byPricePercentile(fixedItems(pricebook, (item) => item.category === 'Мойки'), 0.35);
}

function pickMixer(pricebook: Pricebook): PriceItem | null {
  return byPricePercentile(fixedItems(pricebook, (item) => item.category === 'Смесители'), 0.35);
}

function makeLine(pricebook: Pricebook, item: PriceItem, qty: number, note: string, params: ProjectLine['params'] = {}): ProjectLine {
  const line = lineFromItem(item, pricebook.meta.id, qty, params);
  line.note = `Экспресс-оценка — ${note}`;
  return line;
}

function pushUnitLine(result: QuickEstimateResult, pricebook: Pricebook, label: string, item: PriceItem | null, qty: number, note: string) {
  if (qty <= 0) return;
  if (!item) {
    result.missing.push(label);
    return;
  }
  result.lines.push(makeLine(pricebook, item, qty, note));
}

function pushBodyPlan(result: QuickEstimateResult, pricebook: Pricebook, plan: BodyPlanEntry[], label: string) {
  const groups = new Map<string, { item: PriceItem; qty: number; widths: number[] }>();
  for (const entry of plan) {
    if (!entry.item) {
      result.missing.push(`${label} ${entry.widthMm} мм`);
      continue;
    }
    const current = groups.get(entry.item.id) ?? { item: entry.item, qty: 0, widths: [] };
    current.qty += 1;
    current.widths.push(entry.widthMm);
    groups.set(entry.item.id, current);
  }
  for (const group of groups.values()) {
    const widths = [...new Set(group.widths)].sort((a, b) => a - b).join('/');
    result.lines.push(makeLine(pricebook, group.item, group.qty, `${label}: ${group.qty} шт, ширины ${widths} мм`));
  }
}

function bodyFrontStats(entry: BodyPlanEntry): { doors: number; drawers: number; areaM2: number } {
  if (!entry.item) return { doors: 0, drawers: 0, areaM2: 0 };
  const width = widthOf(entry.item) ?? entry.widthMm;
  const name = norm(entry.item.name);
  const drawers = parseBodyDrawers(entry.item.name) ?? 0;
  const fallbackDoors = entry.kind === 'lower-drawer'
    ? 0
    : width >= 500 ? 2 : 1;
  const parsedDoors = parseBodyDoors(entry.item.name);
  const doors = parsedDoors ?? (drawers > 0 && !name.includes('двер') ? 0 : fallbackDoors);
  const height = entry.kind === 'upper'
    ? heightOf(entry.item, 720) - 4
    : entry.kind === 'tall'
      ? heightOf(entry.item, 2140) - 8
      : 716;
  const columns = width >= 500 && doors + drawers > 1 ? 2 : 1;
  const visibleWidth = Math.max(0, width - columns * 4);
  return { doors, drawers, areaM2: (visibleWidth / 1000) * (Math.max(0, height) / 1000) };
}

export function buildQuickEstimate(input: QuickEstimateInput, pricebook: Pricebook): QuickEstimateResult {
  const lowerLength = positive(input.lowerLengthMm);
  const upperLength = positive(input.upperLengthMm);
  const worktopLength = positive(input.worktopLengthMm);
  const avgModuleWidth = clamp(input.avgModuleWidthMm || 600, 300, 900);
  const upperHeight = clamp(input.upperHeightMm || 720, 600, 920);
  const tallCount = Math.max(0, Math.floor(input.tallCount || 0));
  const drawerCount = Math.max(0, Math.floor(input.drawerCount || 0));

  const lowerWidths = planWidths(lowerLength, avgModuleWidth, bodyWidthPool(pricebook, 'lower'));
  const upperWidths = planWidths(upperLength, avgModuleWidth, bodyWidthPool(pricebook, 'upper'));
  const lowerPlannedLength = lowerWidths.reduce((sum, width) => sum + width, 0);
  const upperPlannedLength = upperWidths.reduce((sum, width) => sum + width, 0);
  const lowerModules = lowerWidths.length;
  const upperModules = upperWidths.length;
  const floorModules = lowerModules + tallCount;

  const drawerModuleCount = lowerModules > 0 && drawerCount > 0 ? Math.min(lowerModules, Math.ceil(drawerCount / 3)) : 0;
  let drawersLeft = drawerCount;
  const lowerPlan: BodyPlanEntry[] = lowerWidths.map((width, index) => {
    const desiredDrawers = index < drawerModuleCount ? clamp(drawersLeft, 1, 3) : 0;
    if (desiredDrawers > 0) drawersLeft -= desiredDrawers;
    return { widthMm: width, item: pickLowerBody(pricebook, width, desiredDrawers), kind: desiredDrawers > 0 ? 'lower-drawer' : 'lower-door', desiredDrawers };
  });
  const upperPlan: BodyPlanEntry[] = upperWidths.map((width) => ({ widthMm: width, item: pickUpperBody(pricebook, width, upperHeight), kind: 'upper' }));
  const tallItem = pickTallBody(pricebook);
  const tallWidth = tallItem ? widthOf(tallItem) ?? 600 : 600;
  const tallPlan: BodyPlanEntry[] = Array.from({ length: tallCount }, () => ({ widthMm: tallWidth, item: tallItem, kind: 'tall' }));

  const bodyStats = [...lowerPlan, ...upperPlan, ...tallPlan].map(bodyFrontStats);
  const doorFronts = bodyStats.reduce((sum, item) => sum + item.doors, 0);
  const drawerFrontsFromBodies = bodyStats.reduce((sum, item) => sum + item.drawers, 0);
  const drawerFronts = Math.max(drawerCount, drawerFrontsFromBodies);
  const facadeAreaM2 = round3(bodyStats.reduce((sum, item) => sum + item.areaM2, 0));
  const facadeCount = doorFronts + drawerFronts;
  const hingeCount = doorFronts * 2;
  const handleCount = input.includeHandles ? facadeCount : 0;
  const legCount = input.includeLegs ? floorModules * 4 : 0;

  const result: QuickEstimateResult = {
    lines: [],
    assumptions: [],
    warnings: [],
    missing: [],
    metrics: {
      lowerModules,
      upperModules,
      floorModules,
      lowerPlannedLengthMm: lowerPlannedLength,
      upperPlannedLengthMm: upperPlannedLength,
      facadeAreaM2,
      facadeCount,
      doorFronts,
      drawerFronts,
      hingeCount,
      handleCount,
      legCount,
      worktopSheets: 0,
    },
    tolerancePct: 0.10,
  };

  pushBodyPlan(result, pricebook, lowerPlan, `нижние корпуса под ${lowerLength || 0} мм`);
  pushBodyPlan(result, pricebook, upperPlan, `верхние корпуса Н=${upperHeight} под ${upperLength || 0} мм`);
  pushBodyPlan(result, pricebook, tallPlan, `пеналы ${tallCount} шт`);

  if (facadeAreaM2 > 0) {
    const facade = pickFacade(pricebook, input.facadeTier);
    if (facade) result.lines.push(makeLine(pricebook, facade, 1, `фасады по подобранным корпусам: ${facadeAreaM2} м²`, { areaM2: facadeAreaM2 }));
    else result.missing.push('материал фасада');
  }

  pushUnitLine(result, pricebook, 'петли', pickHinge(pricebook, input.hardwareTier), hingeCount,
    `${hingeCount} петель: ${doorFronts} распашных фасадов × 2`);
  pushUnitLine(result, pricebook, 'системы выдвижения', pickDrawer(pricebook, input.hardwareTier), drawerCount,
    `${drawerCount} ящиков/направляющих`);
  pushUnitLine(result, pricebook, 'ручки', pickHandle(pricebook), handleCount,
    `${handleCount} ручек по числу фасадов/ящиков`);
  pushUnitLine(result, pricebook, 'опоры', pickLeg(pricebook), legCount,
    `${legCount} опор по 4 на напольный модуль/пенал`);

  if (input.worktopTier !== 'none' && worktopLength > 0) {
    const worktop = pickWorktop(pricebook, input.worktopTier);
    if (worktop) {
      const sheetLength = sheetLengthForEstimate(worktop);
      const sheets = sheetsFromLength(worktopLength, sheetLength, unitIsHalfSheetAllowed(worktop.unit));
      result.metrics.worktopSheets = sheets;
      result.lines.push(makeLine(pricebook, worktop, sheets,
        `столешница ${worktopLength} мм → ${sheets} хлыст. по ${sheetLength} мм`));
    } else result.missing.push('столешница');
  }

  if (input.includePlinth && lowerLength > 0) {
    const plinth = pickPlinth(pricebook);
    if (plinth) {
      const pieceLength = lengthOfLongItem(plinth) ?? 4000;
      result.lines.push(makeLine(pricebook, plinth, Math.ceil(lowerLength / pieceLength),
        `цоколь ${lowerLength} мм → хлысты по ${pieceLength} мм`));
    } else result.missing.push('цоколь');
  }

  pushUnitLine(result, pricebook, 'посудосушитель', pickDryer(pricebook), input.includeDryer && upperModules > 0 ? 1 : 0,
    '1 посудосушитель в верхний ряд');
  pushUnitLine(result, pricebook, 'мойка', pickSink(pricebook), input.includeSink ? 1 : 0,
    'мойка среднего уровня из прайса');
  pushUnitLine(result, pricebook, 'смеситель', pickMixer(pricebook), input.includeMixer ? 1 : 0,
    'смеситель среднего уровня из прайса');

  result.assumptions.push(`Корпуса разложены по реальным ширинам прайса: низ ${lowerModules} шт на ${lowerPlannedLength || 0} мм, верх ${upperModules} шт на ${upperPlannedLength || 0} мм, пеналы ${tallCount} шт.`);
  if (facadeAreaM2 > 0) result.assumptions.push(`Фасады считаются по площади подобранных корпусов: ${facadeAreaM2} м², створок/фронтов ${facadeCount}.`);
  if (hingeCount > 0) result.assumptions.push(`Петли считаются только на распашные фасады: ${doorFronts} × 2 = ${hingeCount} шт.`);
  if (drawerCount > 0) result.assumptions.push(`Ящики/направляющие: ${drawerCount} комплект(а), корпусные ящики учтены в подборе нижних модулей.`);
  if (input.worktopTier !== 'none' && worktopLength > 0) result.assumptions.push(`Столешница подобрана хлыстами из длины ${worktopLength} мм.`);
  result.assumptions.push('Нестандартные углы, GOLA/профили, подсветка, доставка/монтаж и техника добавляются отдельно в детальном расчёте.');

  const lengthDelta = Math.abs(lowerPlannedLength - lowerLength) + Math.abs(upperPlannedLength - upperLength);
  if (lowerLength > 0 && Math.abs(lowerPlannedLength - lowerLength) > 50) result.warnings.push(`Низ разложен стандартными корпусами на ${lowerPlannedLength} мм вместо ${lowerLength} мм.`);
  if (upperLength > 0 && Math.abs(upperPlannedLength - upperLength) > 50) result.warnings.push(`Верх разложен стандартными корпусами на ${upperPlannedLength} мм вместо ${upperLength} мм.`);
  if (result.missing.length > 0) result.warnings.push(`Не удалось подобрать из прайса: ${result.missing.join(', ')}.`);
  if (input.facadeTier === 'emal' && facadeAreaM2 > 0 && facadeAreaM2 < 1) result.warnings.push('Для эмали меньше 1 м² движок применит правило +30% при включенной настройке.');
  if (lowerModules + upperModules + tallCount === 0) result.warnings.push('Укажите длину низа/верха или пеналы — сейчас в оценке нет корпусов.');

  result.tolerancePct = clamp(
    0.08
      + result.missing.length * 0.035
      + Math.min(lengthDelta / 10000, 0.035)
      + (input.worktopTier === 'none' ? 0.02 : 0)
      + (lowerModules + upperModules + tallCount === 0 ? 0.06 : 0),
    0.08,
    0.22,
  );
  return result;
}

export function quickEstimateRange(total: number, tolerancePct: number): { low: number; high: number } {
  if (!Number.isFinite(total) || total <= 0) return { low: 0, high: 0 };
  return {
    low: round2(total * (1 - tolerancePct)),
    high: round2(total * (1 + tolerancePct)),
  };
}
