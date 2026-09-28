import type { FacadePart, KitchenModule, PriceItem } from '../types';
import { parseBodyDoors, parseBodyDrawers } from './modules';

export interface FacadeInference {
  facades: number;
  parts: FacadePart[];
  bodyWidthMm: number | null;
  bodyHeightMm: number | null;
  confidence: 'exact' | 'suggestion';
  note: string;
  source: string;
}

export interface HingeInference {
  hinges: number;
  doorCount: number;
  perDoor: number[];
  confidence: 'exact' | 'suggestion';
  note: string;
  source: string;
}

function sameFacadePart(left: FacadePart, right: FacadePart): boolean {
  return left.widthMm === right.widthMm
    && left.heightMm === right.heightMm
    && left.kind === right.kind;
}

function bodyWidthMm(body: PriceItem): number | null {
  const attr = body.attrs?.['размер'] ?? '';
  const fromName = body.name.match(/[—-]\s*(\d+)\s*мм/iu)?.[1];
  const value = fromName ?? attr.match(/^(\d+)\s*мм/iu)?.[1];
  return value ? Number(value) : null;
}

function bodyHeightMm(body: PriceItem, module: KitchenModule): number {
  if (module.heightMm != null) return module.heightMm;
  const fromName = body.name.match(/(?:Н|H)\s*=\s*(\d+)\s*мм?/iu)?.[1];
  if (fromName) return Number(fromName);
  return 720;
}

function isLowerBody(body: PriceItem): boolean {
  return /стол|тумб|мойк|под\s+дш/iu.test(body.name) && !/шкаф\s+настенный/iu.test(body.name);
}

function isUpperBody(body: PriceItem): boolean {
  return /шкаф\s+настенный/iu.test(body.name);
}

function isDrawerUnderOven(body: PriceItem): boolean {
  return /под\s+дш[^—]*ящик/iu.test(body.name);
}

function facadeWidth(body: PriceItem, bodyWidth: number, count: number, lower: boolean): number {
  const name = body.name.toLowerCase();
  if (/дверь\s+гармошка/iu.test(name)) {
    const special = lower ? ({ 800: 220, 900: 320 } as Record<number, number>) : ({ 500: 180, 600: 280 } as Record<number, number>);
    if (special[bodyWidth]) return special[bodyWidth];
  }
  if (/торцевой[^\n]*(?:скос|скош)/iu.test(name)) {
    const special = lower ? ({ 200: 260, 250: 330, 300: 401, 350: 472, 400: 543 } as Record<number, number>) : ({ 200: 210, 250: 268, 300: 326, 350: 383 } as Record<number, number>);
    if (special[bodyWidth]) return special[bodyWidth];
  }
  // Техничка, стр. 31–32: зазор между деталями 4 мм. Для двух дверей
  // 600-мм корпус даёт 296 мм на фасад (600 - 2 × 4) / 2.
  return Math.max(1, Math.floor((bodyWidth - count * 4) / count));
}

function nonStandardTechnicalHeights(
  standard: number[],
  totalHeight: number,
  description: string,
): { heights: number[]; exact: boolean; note: string } {
  if (totalHeight === 720) return { heights: standard, exact: true, note: `${description} Стандартная высота корпуса 720 мм, техничка, стр. 2.` };

  // Для нестандартной высоты сохраняем техническую разбивку верхних фасадов,
  // а разницу переносим в нижний фасад. Это не выдаём за точный шаблон фабрики:
  // пользователь получает новую рекомендацию и явно видит, что её надо подтвердить.
  const heights = [...standard];
  heights[heights.length - 1] += totalHeight - 720;
  if (heights[heights.length - 1] > 0) {
    return {
      heights,
      exact: false,
      note: `${description} Для нестандартной высоты ${totalHeight} мм разница относительно технички 720 мм добавлена к нижнему фасаду; проверьте схему заказа.`,
    };
  }

  const available = Math.max(1, totalHeight - (standard.length + 1) * 4);
  const fallback = Math.max(1, Math.floor(available / standard.length));
  return {
    heights: standard.map(() => fallback),
    exact: false,
    note: `${description} Высота ${totalHeight} мм слишком мала для стандартной разбивки; фасады распределены предварительно, проверьте схему заказа.`,
  };
}

function lowerHeights(body: PriceItem, drawers: number, doors: number, totalHeight: number): { heights: number[]; exact: boolean; note: string } {
  if (isDrawerUnderOven(body)) {
    if (drawers === 1) return { heights: [120], exact: true, note: 'Под духовым шкафом: фасад ящика 120 мм по техничке, стр. 3.' };
    return { heights: Array.from({ length: drawers }, () => 120), exact: false, note: 'Высота фасадов ящиков под технику требует проверки по схеме конкретной техники.' };
  }
  if (drawers === 1 && doors === 1) return nonStandardTechnicalHeights([176, 536], totalHeight, '1 ящик + дверь: 176 + 536 мм.');
  if (drawers === 2 && doors === 0) return nonStandardTechnicalHeights([356, 356], totalHeight, '2 ящика: 356 + 356 мм.');
  if (drawers === 3 && doors === 0) return nonStandardTechnicalHeights([176, 176, 356], totalHeight, '3 ящика: 176 + 176 + 356 мм.');
  if (drawers === 4 && doors === 0) return nonStandardTechnicalHeights([176, 176, 176, 176], totalHeight, '4 ящика: 176 + 176 + 176 + 176 мм.');
  if (drawers === 0) return { heights: Array.from({ length: doors }, () => Math.max(1, totalHeight - 4)), exact: true, note: 'Зазор 4 мм учтён по техничке, стр. 4.' };
  return { heights: Array.from({ length: drawers + doors }, () => Math.max(1, Math.floor((totalHeight - (drawers + doors + 1) * 4) / (drawers + doors)))), exact: false, note: 'Размеры смешанных фасадов рассчитаны предварительно; проверьте схему заказа.' };
}

/**
 * Определяет количество и размеры фасадов по выбранному корпусу.
 * Важное ограничение: если фабрика не дала точную разбивку, результат помечается
 * как «предложение», а не выдаётся за гарантированный размер.
 */
export function inferFacadeSpec(module: KitchenModule, body: PriceItem): FacadeInference | null {
  const bodyWidth = module.widthMm ?? bodyWidthMm(body);
  const lower = isLowerBody(body);
  const upper = isUpperBody(body);
  const doors = parseBodyDoors(body.name) ?? (/дверь\s+гармошка/iu.test(body.name) ? 2 : 0);
  const drawers = parseBodyDrawers(body.name) ?? 0;
  const count = doors + drawers;
  if (!bodyWidth || count <= 0) return null;

  const height = bodyHeightMm(body, module);
  const width = facadeWidth(body, bodyWidth, count, lower);
  const heightSpec = lower
    ? lowerHeights(body, drawers, doors, height)
    : { heights: Array.from({ length: count }, () => Math.max(1, height - 4)), exact: Boolean(upper), note: 'Зазор 4 мм учтён по техничке; для нестандартной высоты проверьте заказ.' };
  const parts: FacadePart[] = heightSpec.heights.map((heightMm, index) => ({ widthMm: width, heightMm, kind: index < drawers ? 'drawer' : 'door', source: 'technical' }));
  const source = lower ? 'Техничка, стр. 2–3, 31–32' : 'Техничка, стр. 3, 31–32';
  return {
    facades: count,
    parts,
    bodyWidthMm: bodyWidth,
    bodyHeightMm: height,
    confidence: heightSpec.exact ? 'exact' : 'suggestion',
    note: heightSpec.note,
    source,
  };
}

/**
 * Проверяет уже сохранённую техническую разбивку против текущих размеров модуля.
 * Это нужно для старых проектов и для случаев, когда размер меняли не тем полем,
 * которое успевало выставить статус «outdated».
 * Ручная разбивка намеренно не считается устаревшей: её пользователь подтвердил сам.
 */
export function isTechnicalFacadeSpecOutdated(module: KitchenModule, body: PriceItem): boolean {
  if (module.facadeSpecStatus === 'manual') return false;
  const inferred = inferFacadeSpec(module, body);
  if (!inferred) return false;
  if (module.facadeParts?.length) {
    return module.facadeParts.length !== inferred.parts.length
      || module.facadeParts.some((part, index) => !sameFacadePart(part, inferred.parts[index]));
  }
  if (module.facades <= 0) return false;
  if (!module.facadeWmm || !module.facadeHmm || module.facades !== inferred.facades) return true;

  // Старый формат хранит только один размер. Он совместим с технической
  // рекомендацией только если все фасады действительно одинаковые.
  return inferred.parts.some((part) => part.widthMm !== module.facadeWmm || part.heightMm !== module.facadeHmm);
}

function hingesForDoorHeight(heightMm: number): number {
  if (heightMm <= 900) return 2;
  if (heightMm <= 1600) return 3;
  if (heightMm <= 2000) return 4;
  return 5;
}

/** Количество петель по схеме технички, стр. 31: 2/3/4/5 в зависимости от высоты двери. */
export function inferHingeSpec(module: KitchenModule, body: PriceItem): HingeInference | null {
  const facadeInference = inferFacadeSpec(module, body);
  const technicalParts = facadeInference?.parts ?? [];
  const legacyManualParts = module.facadeSpecStatus === 'manual' && !module.facadeParts?.length && module.facades > 0
    ? Array.from({ length: module.facades }, (_, index) => ({
      widthMm: module.facadeWmm ?? 0,
      heightMm: module.facadeHmm ?? module.heightMm ?? 720,
      kind: index < module.drawers ? 'drawer' as const : 'door' as const,
      source: 'manual' as const,
    }))
    : null;
  const parts = module.facadeSpecStatus === 'manual' && module.facadeParts?.length
    ? module.facadeParts
    : legacyManualParts ?? technicalParts;
  const doors = parts.filter((part) => part.kind === 'door');
  if (!doors.length) return null;
  const perDoor = doors.map((door) => hingesForDoorHeight(door.heightMm));
  const hasWideDoor = doors.some((door) => door.widthMm > 600);
  const hasOverLimitHeight = doors.some((door) => door.heightMm > 2400);
  const confidence = hasWideDoor || hasOverLimitHeight || facadeInference?.confidence === 'suggestion' ? 'suggestion' : 'exact';
  const caveat = hasWideDoor
    ? ' Ширина двери более 600 мм — количество нужно подтвердить с техническим отделом.'
    : hasOverLimitHeight
      ? ' Высота двери более 2400 мм выходит за таблицу технички — требуется подтверждение.'
      : '';
  return {
    hinges: perDoor.reduce((sum, count) => sum + count, 0),
    doorCount: doors.length,
    perDoor,
    confidence,
    note: `По техничке, стр. 31: ${perDoor.join(' + ')} петель на двери.${caveat}`,
    source: 'Техничка 1.08.2025, стр. 31',
  };
}

/** Заполняет только пустую комплектацию; ручные размеры пользователя не затираются. */
export function applyTechnicalFacadeSpec(module: KitchenModule, body: PriceItem, overwrite = false): KitchenModule {
  const inferred = inferFacadeSpec(module, body);
  if (!inferred) return module;
  const hasManualSpec = Boolean(module.facadeParts?.length || module.facades > 0 || module.facadeWmm || module.facadeHmm);
  const outdated = isTechnicalFacadeSpecOutdated(module, body);
  if (hasManualSpec && !overwrite && !outdated) return module;
  const first = inferred.parts[0];
  const inferredDrawers = inferred.parts.filter((part) => part.kind === 'drawer').length;
  const hingeInference = inferHingeSpec({ ...module, facadeParts: inferred.parts, facadeSpecStatus: 'applied' }, body);
  const preserveManualHinges = module.hingeSpecStatus === 'manual';
  return {
    ...module,
    facades: inferred.facades,
    drawers: hasManualSpec && !overwrite ? module.drawers : inferredDrawers,
    hinges: preserveManualHinges ? module.hinges : hingeInference?.hinges ?? module.hinges,
    widthMm: module.widthMm ?? inferred.bodyWidthMm,
    heightMm: module.heightMm ?? inferred.bodyHeightMm,
    facadeParts: inferred.parts,
    facadeWmm: first?.widthMm ?? null,
    facadeHmm: first?.heightMm ?? null,
    facadeSpecStatus: 'applied',
    hingeSpecStatus: preserveManualHinges ? 'manual' : hingeInference ? 'applied' : module.hingeSpecStatus,
  };
}
