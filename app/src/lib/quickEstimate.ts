import type { Pricebook, PriceItem, ProjectLine } from '../types';
import { lineFromItem, sheetsFromLength, sheetLengthOf, unitIsHalfSheetAllowed } from './engine';
import { parseBodyDoors, parseBodyDrawers } from './modules';

export type QuickFacadeTier =
  | 'pvc-economy' | 'pvc-standard' | 'pvc-premium'
  | 'pvc-16-cat1' | 'pvc-16-cat2' | 'pvc-19-cat1' | 'pvc-19-cat2' | 'pvc-22-cat1' | 'pvc-22-cat2'
  | 'emal' | 'emal-matt-cat1' | 'emal-matt-cat2' | 'emal-gloss-cat1' | 'emal-gloss-cat2'
  | 'plastic' | 'plastic-agt-rehau-cat1' | 'plastic-agt-rehau-cat2' | 'plastic-arpa-cat1' | 'plastic-fenix-cat1'
  | 'tss';
export type QuickWorktopTier =
  | 'none' | 'postforming-26' | 'postforming-38' | 'compact'
  | 'ms-26-cat1' | 'ms-26-cat2' | 'ms-26-cat3' | 'ms-26-cat5' | 'ms-26-cat7'
  | 'ms-38-cat1' | 'ms-38-cat2' | 'ms-38-cat3' | 'ms-38-cat5' | 'ms-38-cat7'
  | 'souz-universal' | 'souz-premium'
  | 'souz-26-universal' | 'souz-26-classic' | 'souz-26-standart' | 'souz-26-premium' | 'souz-26-premium-plus'
  | 'souz-38-universal' | 'souz-38-classic' | 'souz-38-standart' | 'souz-38-premium' | 'souz-38-premium-plus'
  | 'slotex-e1' | 'slotex-e2' | 'slotex-e3' | 'arkobaleno-650' | 'arkobaleno-1320';
export type QuickHardwareTier = 'standard' | 'soft-close' | 'blum' | 'boyard-soft-close' | 'titus-soft-close' | 'blum-soft-close';

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

function itemFullText(item: PriceItem): string {
  return `${item.attrs?.['формат'] ?? ''} ${item.attrs?.['толщина'] ?? ''} ${item.attrs?.['категория'] ?? ''} ${item.attrs?.['серия'] ?? ''} ${item.name}`;
}

function isFormat600x3000(item: PriceItem, thickness?: '26' | '38'): boolean {
  const text = itemFullText(item).replace(/\s+/g, '').toLowerCase();
  if (!/(?:^|[^\d])600(?:\*|х|x)3000/.test(text)) return false;
  if (thickness && !new RegExp(`(?:\\*|х|x)${thickness}(?:мм)?|${thickness}мм`).test(text)) return false;
  return true;
}

function isMainWorktopSheet(item: PriceItem): boolean {
  const text = norm(itemFullText(item));
  return item.priceBasis === 'sheet'
    && text.includes('столешниц')
    && !text.includes('стеновая панель')
    && !text.includes('800*800')
    && !text.includes('800х800')
    && !text.includes('800x800')
    && sheetLengthForEstimate(item) >= 3000;
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

function attrText(item: PriceItem, key: string): string {
  return norm(`${item.attrs?.[key] ?? ''}`);
}

function tierIncludes(item: PriceItem, value: string): boolean {
  const target = norm(value);
  return norm(`${item.subcategory ?? ''} ${Object.values(item.attrs ?? {}).join(' ')} ${item.name}`).includes(target);
}

function pickFacade(pricebook: Pricebook, tier: QuickFacadeTier): PriceItem | null {
  const pvc = () => fixedItems(pricebook, (item) => item.category === 'Фасады: МДФ (ПВХ плёнка)' && item.priceBasis === 'm2');
  const enamel = () => fixedItems(pricebook, (item) => item.category === 'Фасады: Эмаль' && item.priceBasis === 'm2');
  const plastic = () => fixedItems(pricebook, (item) => item.category === 'Фасады: Пластик (HPL)' && item.priceBasis === 'm2');

  const pickPvc = (thicknessMm: string, category: string, percentile = 0.35) => byPricePercentile(
    pvc().filter((item) => attrText(item, 'толщина').includes(thicknessMm) && tierIncludes(item, category) && !norm(item.name).includes('патина')),
    percentile,
  );
  const pickEnamel = (finish: 'матовая' | 'глянец', category: string) => byPricePercentile(
    enamel().filter((item) => tierIncludes(item, category) && norm(item.name).includes(finish)),
    finish === 'глянец' ? 0.35 : 0.25,
  );
  const pickPlastic = (brand: string | null, category: string, percentile = 0.35) => byPricePercentile(
    plastic().filter((item) => {
      const brandText = attrText(item, 'бренд');
      const catText = attrText(item, 'категория');
      return (!brand || brandText.includes(norm(brand))) && (catText.includes(norm(category)) || tierIncludes(item, category));
    }),
    percentile,
  );

  switch (tier) {
    case 'pvc-16-cat1': return pickPvc('16', '1 категория', 0.25) ?? byPricePercentile(pvc(), 0.08);
    case 'pvc-16-cat2': return pickPvc('16', '2 категория', 0.30) ?? byPricePercentile(pvc(), 0.22);
    case 'pvc-19-cat1': return pickPvc('19', '1 категория', 0.25) ?? byPricePercentile(pvc(), 0.12);
    case 'pvc-19-cat2': return pickPvc('19', '2 категория', 0.30) ?? byPricePercentile(pvc(), 0.28);
    case 'pvc-22-cat1': return pickPvc('22', '1 категория', 0.25) ?? byPricePercentile(pvc(), 0.18);
    case 'pvc-22-cat2': return pickPvc('22', '2 категория', 0.30) ?? byPricePercentile(pvc(), 0.34);
    case 'emal-matt-cat1': return pickEnamel('матовая', 'фрезеровка 1 кат') ?? byPricePercentile(enamel(), 0.22);
    case 'emal-matt-cat2': return pickEnamel('матовая', 'фрезеровка 2 кат') ?? byPricePercentile(enamel(), 0.32);
    case 'emal-gloss-cat1': return pickEnamel('глянец', 'фрезеровка 1 кат') ?? byPricePercentile(enamel(), 0.45);
    case 'emal-gloss-cat2': return pickEnamel('глянец', 'фрезеровка 2 кат') ?? byPricePercentile(enamel(), 0.55);
    case 'plastic-agt-rehau-cat1': return pickPlastic('AGT', '1', 0.20) ?? pickPlastic(null, '1', 0.22) ?? byPricePercentile(plastic(), 0.25);
    case 'plastic-agt-rehau-cat2': return pickPlastic('AGT', '2', 0.20) ?? pickPlastic(null, '2', 0.35) ?? byPricePercentile(plastic(), 0.40);
    case 'plastic-arpa-cat1': return pickPlastic('ARPA', '1', 0.25) ?? pickPlastic('ABET', '1', 0.25) ?? byPricePercentile(plastic(), 0.30);
    case 'plastic-fenix-cat1': return pickPlastic('FENIX', '1', 0.25) ?? byPricePercentile(plastic(), 0.70);
    case 'pvc-economy': return byPricePercentile(pvc().filter((item) => !norm(`${item.attrs?.['категория'] ?? ''} ${item.name}`).includes('патина')), 0.08);
    case 'pvc-standard': return byPricePercentile(pvc().filter((item) => !norm(`${item.attrs?.['категория'] ?? ''} ${item.name}`).includes('патина')), 0.36);
    case 'pvc-premium': return byPricePercentile(pvc().filter((item) => !norm(`${item.attrs?.['категория'] ?? ''} ${item.name}`).includes('патина')), 0.72);
    case 'emal': return byPricePercentile(enamel(), 0.28);
    case 'plastic': return byPricePercentile(plastic(), 0.35);
    case 'tss': return byPricePercentile(fixedItems(pricebook, (item) => item.category === 'Фасады: TSS плита' && item.priceBasis === 'm2'), 0.45);
  }
}

function facadeTierLabel(tier: QuickFacadeTier): string {
  const labels: Record<QuickFacadeTier, string> = {
    'pvc-economy': 'ПВХ · эконом',
    'pvc-standard': 'ПВХ · средняя категория',
    'pvc-premium': 'ПВХ · высокая категория',
    'pvc-16-cat1': 'ПВХ 16 мм · 1 категория',
    'pvc-16-cat2': 'ПВХ 16 мм · 2 категория',
    'pvc-19-cat1': 'ПВХ 19 мм · 1 категория',
    'pvc-19-cat2': 'ПВХ 19 мм · 2 категория',
    'pvc-22-cat1': 'ПВХ 22 мм · 1 категория',
    'pvc-22-cat2': 'ПВХ 22 мм · 2 категория',
    emal: 'Эмаль · базовая',
    'emal-matt-cat1': 'Эмаль матовая · фрезеровка 1 кат',
    'emal-matt-cat2': 'Эмаль матовая · фрезеровка 2 кат',
    'emal-gloss-cat1': 'Эмаль глянец · фрезеровка 1 кат',
    'emal-gloss-cat2': 'Эмаль глянец · фрезеровка 2 кат',
    plastic: 'Пластик HPL · средний',
    'plastic-agt-rehau-cat1': 'AGT / Rehau-кромка · 1 категория',
    'plastic-agt-rehau-cat2': 'AGT / Rehau-кромка · 2 категория',
    'plastic-arpa-cat1': 'ARPA/ABET пластик · 1 категория',
    'plastic-fenix-cat1': 'FENIX пластик · 1 категория',
    tss: 'TSS плита',
  };
  return labels[tier];
}

function pickWorktop(pricebook: Pricebook, tier: QuickWorktopTier): PriceItem | null {
  if (tier === 'none') return null;
  const byCat = (category: string) => fixedItems(pricebook, (item) => item.category === category && item.priceBasis === 'sheet');
  const mirSheets = () => byCat('Столешницы: Мир Столешниц (постформинг)').filter((item) => isMainWorktopSheet(item) && isFormat600x3000(item));
  const souzSheets = () => byCat('Столешницы: СОЮЗ (постформинг)').filter((item) => isMainWorktopSheet(item) && isFormat600x3000(item));
  const pickMir = (thickness: '26' | '38', category: string) => byPricePercentile(
    mirSheets().filter((item) => isFormat600x3000(item, thickness) && tierIncludes(item, category)),
    0.25,
  );
  const pickSoyuz = (thickness: '26' | '38', category: string) => byPricePercentile(
    souzSheets().filter((item) => isFormat600x3000(item, thickness) && tierIncludes(item, category)),
    0.25,
  );
  if (tier === 'ms-26-cat1') return pickMir('26', '1 категория') ?? byPricePercentile(mirSheets().filter((item) => isFormat600x3000(item, '26')), 0.10);
  if (tier === 'ms-26-cat2') return pickMir('26', '2 категория') ?? byPricePercentile(mirSheets().filter((item) => isFormat600x3000(item, '26')), 0.20);
  if (tier === 'ms-26-cat3') return pickMir('26', '3 категория') ?? byPricePercentile(mirSheets().filter((item) => isFormat600x3000(item, '26')), 0.30);
  if (tier === 'ms-26-cat5') return pickMir('26', '5 категория') ?? byPricePercentile(mirSheets().filter((item) => isFormat600x3000(item, '26')), 0.50);
  if (tier === 'ms-26-cat7') return pickMir('26', '7 категория') ?? byPricePercentile(mirSheets().filter((item) => isFormat600x3000(item, '26')), 0.70);
  if (tier === 'ms-38-cat1') return pickMir('38', '1 категория') ?? byPricePercentile(mirSheets().filter((item) => isFormat600x3000(item, '38')), 0.10);
  if (tier === 'ms-38-cat2') return pickMir('38', '2 категория') ?? byPricePercentile(mirSheets().filter((item) => isFormat600x3000(item, '38')), 0.20);
  if (tier === 'ms-38-cat3') return pickMir('38', '3 категория') ?? byPricePercentile(mirSheets().filter((item) => isFormat600x3000(item, '38')), 0.30);
  if (tier === 'ms-38-cat5') return pickMir('38', '5 категория') ?? byPricePercentile(mirSheets().filter((item) => isFormat600x3000(item, '38')), 0.50);
  if (tier === 'ms-38-cat7') return pickMir('38', '7 категория') ?? byPricePercentile(mirSheets().filter((item) => isFormat600x3000(item, '38')), 0.70);
  if (tier === 'souz-universal') return pickSoyuz('38', 'Universal') ?? byPricePercentile(souzSheets(), 0.10);
  if (tier === 'souz-premium') return pickSoyuz('38', 'Premium') ?? byPricePercentile(souzSheets(), 0.70);
  if (tier === 'souz-26-universal') return pickSoyuz('26', 'Universal') ?? byPricePercentile(souzSheets().filter((item) => isFormat600x3000(item, '26')), 0.10);
  if (tier === 'souz-26-classic') return pickSoyuz('26', 'Classic') ?? byPricePercentile(souzSheets().filter((item) => isFormat600x3000(item, '26')), 0.30);
  if (tier === 'souz-26-standart') return pickSoyuz('26', 'Standart pro') ?? byPricePercentile(souzSheets().filter((item) => isFormat600x3000(item, '26')), 0.45);
  if (tier === 'souz-26-premium') return pickSoyuz('26', 'Premium') ?? byPricePercentile(souzSheets().filter((item) => isFormat600x3000(item, '26')), 0.70);
  if (tier === 'souz-26-premium-plus') return pickSoyuz('26', 'Premium+') ?? byPricePercentile(souzSheets().filter((item) => isFormat600x3000(item, '26')), 0.90);
  if (tier === 'souz-38-universal') return pickSoyuz('38', 'Universal') ?? byPricePercentile(souzSheets().filter((item) => isFormat600x3000(item, '38')), 0.10);
  if (tier === 'souz-38-classic') return pickSoyuz('38', 'Classic') ?? byPricePercentile(souzSheets().filter((item) => isFormat600x3000(item, '38')), 0.30);
  if (tier === 'souz-38-standart') return pickSoyuz('38', 'Standart pro') ?? byPricePercentile(souzSheets().filter((item) => isFormat600x3000(item, '38')), 0.45);
  if (tier === 'souz-38-premium') return pickSoyuz('38', 'Premium') ?? byPricePercentile(souzSheets().filter((item) => isFormat600x3000(item, '38')), 0.70);
  if (tier === 'souz-38-premium-plus') return pickSoyuz('38', 'Premium+') ?? byPricePercentile(souzSheets().filter((item) => isFormat600x3000(item, '38')), 0.90);
  if (tier === 'slotex-e1' || tier === 'slotex-e2' || tier === 'slotex-e3') {
    const series = tier === 'slotex-e1' ? 'E1' : tier === 'slotex-e2' ? 'E2' : 'E3';
    return byPricePercentile(
      byCat('Столешницы: компакт-плита Slotex').filter((item) => tierIncludes(item, series) && /(?:650|600|1320)/.test(`${item.attrs?.['формат'] ?? ''} ${item.name}`)),
      0.25,
    ) ?? byPricePercentile(byCat('Столешницы: компакт-плита Slotex').filter((item) => tierIncludes(item, series)), 0.25);
  }
  if (tier === 'arkobaleno-650') return byPricePercentile(
    byCat('Столешницы: компакт-плита Arkobaleno').filter((item) => /650/.test(`${item.attrs?.['формат'] ?? ''} ${item.name}`)),
    0.25,
  ) ?? byPricePercentile(byCat('Столешницы: компакт-плита Arkobaleno'), 0.25);
  if (tier === 'arkobaleno-1320') return byPricePercentile(
    byCat('Столешницы: компакт-плита Arkobaleno').filter((item) => /1320/.test(`${item.attrs?.['формат'] ?? ''} ${item.name}`)),
    0.25,
  ) ?? byPricePercentile(byCat('Столешницы: компакт-плита Arkobaleno'), 0.45);
  if (tier === 'compact') {
    const compact = fixedItems(pricebook, (item) => item.category.startsWith('Столешницы: компакт-плита')
      && item.priceBasis === 'sheet'
      && /(?:650|600)/.test(`${item.attrs?.['формат'] ?? ''} ${item.name}`));
    return byPricePercentile(compact, 0.25);
  }
  const thickness = tier === 'postforming-26' ? '26' : '38';
  const items = mirSheets().filter((item) => isFormat600x3000(item, thickness));
  return byPricePercentile(items, 0.35);
}

function isOverlayHingeName(nameRaw: string): boolean {
  const name = norm(nameRaw);
  return !name.includes('полунак')
    && !name.includes('вклад')
    && !name.includes('без пруж')
    && !name.includes('гормош')
    && !name.includes('огранич')
    && !name.includes('толкател')
    && !name.includes('45')
    && !name.includes('30')
    && !name.includes('155')
    && !name.includes('165')
    && !name.includes('170')
    && !name.includes('180');
}

function pickHinge(pricebook: Pricebook, tier: QuickHardwareTier): PriceItem | null {
  const hinges = fixedItems(pricebook, (item) => item.category === 'Петли');
  const blumExtra = fixedItems(pricebook, (item) => item.category.includes('BLUM') && item.subcategory === 'Петли Blum');
  const boyardSoft = hinges.filter((item) => {
    const name = norm(item.name);
    return name.includes('боярд') && name.includes('дов') && isOverlayHingeName(item.name) && (name.includes('90') || name.includes('110'));
  });
  const titusSoft = hinges.filter((item) => {
    const name = norm(item.name);
    return name.includes('titus') && name.includes('110') && name.includes('дов') && isOverlayHingeName(item.name);
  });
  const blumSoft = [
    ...hinges.filter((item) => {
      const name = norm(item.name);
      return name.includes('blum') && name.includes('110') && name.includes('дов') && isOverlayHingeName(item.name);
    }),
    ...blumExtra.filter((item) => {
      const name = norm(item.name);
      return name.includes('clip top') && name.includes('110') && name.includes('дов') && isOverlayHingeName(item.name);
    }),
  ];

  if (tier === 'blum' || tier === 'blum-soft-close') {
    return byPricePercentile(blumSoft, 0.35) ?? byPricePercentile(blumExtra, 0.45) ?? byPricePercentile(hinges.filter((item) => norm(item.name).includes('blum')), 0.45);
  }
  if (tier === 'titus-soft-close') {
    return byPricePercentile(titusSoft, 0.35) ?? byPricePercentile(hinges.filter((item) => norm(item.name).includes('titus') && norm(item.name).includes('дов')), 0.35);
  }
  if (tier === 'boyard-soft-close' || tier === 'soft-close') {
    return byPricePercentile(boyardSoft, 0.35) ?? byPricePercentile(hinges.filter((item) => norm(item.name).includes('боярд') && norm(item.name).includes('дов')), 0.35);
  }
  const standard = hinges.filter((item) => norm(item.name).includes('боярд') && isOverlayHingeName(item.name) && norm(item.name).includes('90'));
  return byPricePercentile(standard, 0.20) ?? byPricePercentile(hinges, 0.35);
}

function pickDrawer(pricebook: Pricebook, tier: QuickHardwareTier): PriceItem | null {
  if (tier === 'blum' || tier === 'blum-soft-close') {
    const blum = fixedItems(pricebook, (item) => item.category.includes('BLUM')
      && item.subcategory === 'Ящики и направляющие Blum'
      && norm(item.name).includes('450')
      && norm(item.name).includes('дов'));
    return byPricePercentile(blum, 0.35) ?? byPricePercentile(fixedItems(pricebook, (item) => item.category.includes('BLUM') && item.subcategory === 'Ящики и направляющие Blum'), 0.35);
  }
  const drawers = fixedItems(pricebook, (item) => item.category === 'Системы выдвижения'
    && norm(item.name).includes('боярд')
    && (tier === 'standard' ? true : norm(item.name).includes('дов'))
    && !norm(item.name).includes('т/б'));
  return byPricePercentile(drawers, tier === 'standard' ? 0.15 : 0.35) ?? byPricePercentile(fixedItems(pricebook, (item) => item.category === 'Системы выдвижения'), 0.25);
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
    if (facade) result.lines.push(makeLine(pricebook, facade, 1, `${facadeTierLabel(input.facadeTier)}: фасады по подобранным корпусам ${facadeAreaM2} м²`, { areaM2: facadeAreaM2 }));
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
  if ((input.facadeTier === 'emal' || input.facadeTier.startsWith('emal-')) && facadeAreaM2 > 0 && facadeAreaM2 < 1) result.warnings.push('Для эмали меньше 1 м² движок применит правило +30% при включенной настройке.');
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
