import type { Pricebook, PriceItem, ProjectLine } from '../types';
import { lineFromItem, sheetsFromLength, sheetLengthOf, unitIsHalfSheetAllowed } from './engine';

export type QuickFacadeTier = 'pvc-economy' | 'pvc-standard' | 'pvc-premium' | 'emal' | 'plastic' | 'tss';
export type QuickWorktopTier = 'none' | 'postforming-26' | 'postforming-38' | 'compact';
export type QuickHardwareTier = 'standard' | 'soft-close' | 'blum';

export interface QuickEstimateInput {
  lowerLengthMm: number;
  upperLengthMm: number;
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
}

export interface QuickEstimateMetrics {
  lowerModules: number;
  upperModules: number;
  floorModules: number;
  facadeAreaM2: number;
  facadeCount: number;
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

function averageWidth(lengthMm: number, count: number, fallback: number): number {
  if (count <= 0 || lengthMm <= 0) return fallback;
  return clamp(Math.round((lengthMm / count) / 50) * 50, 250, 900);
}

function pickLowerBody(pricebook: Pricebook, targetWidth: number): PriceItem | null {
  const items = fixedItems(pricebook, (item) => {
    const name = norm(item.name);
    return item.category === 'Корпуса: столы и пеналы'
      && name.includes('стол напольный')
      && !name.includes('мойк')
      && !name.includes('углов')
      && !name.includes('пенал')
      && !name.includes('бутыл')
      && !name.includes('дш');
  });
  return byScore(items, (item) => {
    const name = norm(item.name);
    const width = widthOf(item) ?? targetWidth;
    return Math.abs(width - targetWidth)
      + (targetWidth >= 500 && /2[-\s]*(?:х|мя)?\s*двер/i.test(item.name) ? -45 : 0)
      + (name.includes('ящ') ? 35 : 0)
      + (item.price ?? 0) / 10000;
  });
}

function pickUpperBody(pricebook: Pricebook, targetWidth: number): PriceItem | null {
  const items = fixedItems(pricebook, (item) => {
    const name = norm(item.name);
    return item.category === 'Корпуса: шкафы навесные'
      && name.includes('шкаф настенный')
      && !name.includes('углов')
      && !name.includes('под вытяж');
  });
  return byScore(items, (item) => {
    const name = norm(item.name);
    const width = widthOf(item) ?? targetWidth;
    return Math.abs(width - targetWidth)
      + (name.includes('н=720') ? -60 : 0)
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
      + (name.includes('н=2140') ? -45 : 0)
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
  return byPricePercentile(items, tier === 'postforming-26' ? 0.35 : 0.35);
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

export function buildQuickEstimate(input: QuickEstimateInput, pricebook: Pricebook): QuickEstimateResult {
  const lowerLength = positive(input.lowerLengthMm);
  const upperLength = positive(input.upperLengthMm);
  const worktopLength = positive(input.worktopLengthMm);
  const avgModuleWidth = clamp(input.avgModuleWidthMm || 600, 300, 900);
  const tallCount = Math.max(0, Math.floor(input.tallCount || 0));
  const drawerCount = Math.max(0, Math.floor(input.drawerCount || 0));

  const lowerModules = moduleCount(lowerLength, avgModuleWidth);
  const upperModules = moduleCount(upperLength, avgModuleWidth);
  const lowerWidth = averageWidth(lowerLength, lowerModules, avgModuleWidth);
  const upperWidth = averageWidth(upperLength, upperModules, avgModuleWidth);
  const floorModules = lowerModules + tallCount;

  const lowerFacadeArea = lowerLength > 0 ? (lowerLength / 1000) * 0.716 : 0;
  const upperFacadeArea = upperLength > 0 ? (upperLength / 1000) * 0.716 : 0;
  const tallFacadeArea = tallCount > 0 ? tallCount * 0.6 * 2.02 : 0;
  const facadeAreaM2 = round3(lowerFacadeArea + upperFacadeArea + tallFacadeArea);
  const facadeCount = lowerModules * 2 + upperModules * 2 + tallCount * 4;
  const hingeCount = Math.max(0, facadeCount * 2);
  const handleCount = input.includeHandles ? facadeCount : 0;
  const legCount = input.includeLegs ? floorModules * 4 : 0;

  const result: QuickEstimateResult = {
    lines: [],
    assumptions: [],
    warnings: [],
    missing: [],
    metrics: { lowerModules, upperModules, floorModules, facadeAreaM2, facadeCount, hingeCount, handleCount, legCount, worktopSheets: 0 },
    tolerancePct: 0.15,
  };

  pushUnitLine(result, pricebook, 'корпус нижнего модуля', pickLowerBody(pricebook, lowerWidth), lowerModules,
    `низ ${lowerLength || 0} мм ≈ ${lowerModules} мод. по ${lowerWidth} мм`);
  pushUnitLine(result, pricebook, 'корпус верхнего модуля', pickUpperBody(pricebook, upperWidth), upperModules,
    `верх ${upperLength || 0} мм ≈ ${upperModules} мод. по ${upperWidth} мм`);
  pushUnitLine(result, pricebook, 'корпус пенала', pickTallBody(pricebook), tallCount,
    `пеналы ${tallCount} шт`);

  if (facadeAreaM2 > 0) {
    const facade = pickFacade(pricebook, input.facadeTier);
    if (facade) result.lines.push(makeLine(pricebook, facade, 1, `фасады общей площадью ${facadeAreaM2} м²`, { areaM2: facadeAreaM2 }));
    else result.missing.push('материал фасада');
  }

  pushUnitLine(result, pricebook, 'петли', pickHinge(pricebook, input.hardwareTier), hingeCount,
    `${hingeCount} петель по экспресс-норме 2 петли на фасад`);
  pushUnitLine(result, pricebook, 'системы выдвижения', pickDrawer(pricebook, input.hardwareTier), drawerCount,
    `${drawerCount} ящиков/направляющих`);
  pushUnitLine(result, pricebook, 'ручки', pickHandle(pricebook), handleCount,
    `${handleCount} ручек по числу фасадов`);
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

  result.assumptions.push(`Корпуса подобраны типовыми позициями прайса: низ ${lowerModules} шт, верх ${upperModules} шт, пеналы ${tallCount} шт.`);
  if (facadeAreaM2 > 0) result.assumptions.push(`Фасады считаются одной площадью: ${facadeAreaM2} м²; точная разбивка створок уточняется в модульном расчёте.`);
  if (hingeCount > 0) result.assumptions.push('Петли: экспресс-норма 2 петли на каждый фасад; для высоких/тяжёлых фасадов может потребоваться больше.');
  if (drawerCount > 0) result.assumptions.push(`Ящики/направляющие: ${drawerCount} комплект(а) выбранного уровня фурнитуры.`);
  if (input.worktopTier !== 'none' && worktopLength > 0) result.assumptions.push(`Столешница подобрана хлыстами из длины ${worktopLength} мм.`);
  result.assumptions.push('Мойка, смеситель, подсветка, GOLA/профили, нестандарт, доставка/монтаж — только если добавлены в настройках или детальном расчёте.');

  if (result.missing.length > 0) result.warnings.push(`Не удалось подобрать из прайса: ${result.missing.join(', ')}.`);
  if (input.facadeTier === 'emal' && facadeAreaM2 > 0 && facadeAreaM2 < 1) result.warnings.push('Для эмали меньше 1 м² движок применит правило +30% при включенной настройке.');
  if (lowerModules + upperModules + tallCount === 0) result.warnings.push('Укажите длину низа/верха или пеналы — сейчас в оценке нет корпусов.');

  result.tolerancePct = clamp(0.12 + result.missing.length * 0.04 + (drawerCount === 0 ? 0.03 : 0) + (input.worktopTier === 'none' ? 0.03 : 0), 0.12, 0.28);
  return result;
}

export function quickEstimateRange(total: number, tolerancePct: number): { low: number; high: number } {
  if (!Number.isFinite(total) || total <= 0) return { low: 0, high: 0 };
  return {
    low: round2(total * (1 - tolerancePct)),
    high: round2(total * (1 + tolerancePct)),
  };
}
