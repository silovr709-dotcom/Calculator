import type { KitchenModule, Pricebook, PriceItem } from '../types';

export interface BodyNominalDimensions {
  widthMm: number | null;
  heightMm: number | null;
  depthMm: number | null;
}

export type DimensionKind = 'width' | 'height' | 'depth';

export interface DimensionSurchargeRecommendation {
  itemId: string;
  dimension: DimensionKind;
  percent: number;
  deltaMm: number;
  rule: string;
  bodyOnly: true;
}

const SURCHARGE_NAMES = {
  width10: 'ширину каркаса пеналов (кратность 10мм)',
  width50: 'ширину каркаса пеналов (кратность менее 10мм)',
  height10: 'высоту каркаса шк, пеналов (max + 200мм, кратно 2мм)',
  height100: 'высоту каркаса шк, пеналов (max + 200мм, не кратно 2мм)',
  depth10: 'глубину каркаса шк/ст/пеналов (max + 50мм)',
  lowerHeight100: 'высоту каркаса ст (max до 930мм, min 460мм)',
} as const;

function findSurcharge(pricebook: Pricebook, text: string): PriceItem | null {
  return pricebook.items.find((item) => (
    item.category === 'Доп. комплектация каркасов'
    && item.priceKind === 'percent'
    && item.name.toLowerCase().includes(text)
  )) ?? null;
}

function numberFrom(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.match(/(\d{2,4})/);
  return match ? Number(match[1]) : null;
}

function bodyWidth(body: PriceItem): number | null {
  const attr = body.attrs?.['размер'];
  return numberFrom(attr) ?? numberFrom(body.name.match(/[—-]\s*(\d+)\s*мм/iu)?.[1]);
}

function bodyHeight(body: PriceItem): number | null {
  const explicit = body.name.match(/(?:Н|H)\s*=\s*(\d+)\s*мм?/iu)?.[1];
  if (explicit) return Number(explicit);
  if (/стол|тумб|мойк|под\s+дш/iu.test(body.name) && !/шкаф\s+настенный/iu.test(body.name)) return 720;
  return null;
}

function isLowerBody(body: PriceItem): boolean {
  return /стол|тумб|мойк|под\s+дш/iu.test(body.name) && !/шкаф\s+настенный/iu.test(body.name);
}

function isBodyWithDimensionRules(body: PriceItem): boolean {
  return body.category.startsWith('Корпуса') && !/сложн|виниц/iu.test(body.name);
}

/**
 * Базовые габариты корпуса из выбранной строки прайса.
 * Глубина в прайсе не записана в названии, поэтому используются стандартные
 * глубины из технички: 560 мм для нижних/пеналов и 300 мм для навесных.
 */
export function nominalBodyDimensions(body: PriceItem): BodyNominalDimensions {
  const lower = isLowerBody(body);
  const upper = /шкаф\s+настенный/iu.test(body.name);
  return {
    widthMm: bodyWidth(body),
    heightMm: bodyHeight(body),
    depthMm: lower || /пенал/iu.test(body.name) ? 560 : upper ? 300 : null,
  };
}

function recommendation(
  pricebook: Pricebook,
  text: string,
  dimension: DimensionKind,
  deltaMm: number,
  rule: string,
): DimensionSurchargeRecommendation | null {
  const item = findSurcharge(pricebook, text);
  if (!item || item.price == null) return null;
  return { itemId: item.id, dimension, percent: item.price, deltaMm, rule, bodyOnly: true };
}

/**
 * Находит надбавки по изменённым габаритам корпуса.
 * Рекомендация ничего не меняет в модуле: применение выполняется кнопкой в UI.
 * Каждая процентная строка в moduleToLines имеет базовой строкой только корпус.
 */
export function inferDimensionSurcharges(
  module: KitchenModule,
  body: PriceItem,
  pricebook: Pricebook,
): DimensionSurchargeRecommendation[] {
  if (!isBodyWithDimensionRules(body)) return [];
  const nominal = nominalBodyDimensions(body);
  const result: DimensionSurchargeRecommendation[] = [];

  if (nominal.widthMm != null && module.widthMm != null && module.widthMm !== nominal.widthMm) {
    const delta = module.widthMm - nominal.widthMm;
    const exact = Math.abs(delta) % 10 === 0;
    const item = recommendation(
      pricebook,
      exact ? SURCHARGE_NAMES.width10 : SURCHARGE_NAMES.width50,
      'width',
      delta,
      exact
        ? `Нестандартная ширина ${module.widthMm} мм вместо ${nominal.widthMm} мм, изменение кратно 10 мм.`
        : `Нестандартная ширина ${module.widthMm} мм вместо ${nominal.widthMm} мм, изменение не кратно 10 мм.`,
    );
    if (item) result.push(item);
  }

  if (nominal.heightMm != null && module.heightMm != null && module.heightMm !== nominal.heightMm) {
    const delta = module.heightMm - nominal.heightMm;
    const lower = isLowerBody(body);
    if (lower && module.heightMm >= 460 && module.heightMm <= 930) {
      const item = recommendation(
        pricebook,
        SURCHARGE_NAMES.lowerHeight100,
        'height',
        delta,
        `Нестандартная высота стола ${module.heightMm} мм вместо ${nominal.heightMm} мм: правило стола до 930 мм.`,
      );
      if (item) result.push(item);
    } else if (delta > 0 && delta <= 200) {
      const exact = delta % 2 === 0;
      const item = recommendation(
        pricebook,
        exact ? SURCHARGE_NAMES.height10 : SURCHARGE_NAMES.height100,
        'height',
        delta,
        exact
          ? `Высота увеличена на ${delta} мм, изменение кратно 2 мм (допуск до +200 мм).`
          : `Высота увеличена на ${delta} мм, изменение не кратно 2 мм (допуск до +200 мм).`,
      );
      if (item) result.push(item);
    }
  }

  if (nominal.depthMm != null && module.depthMm != null && module.depthMm !== nominal.depthMm) {
    const delta = module.depthMm - nominal.depthMm;
    if (delta > 0 && delta <= 50) {
      const item = recommendation(
        pricebook,
        SURCHARGE_NAMES.depth10,
        'depth',
        delta,
        `Глубина увеличена на ${delta} мм, допустимый диапазон до +50 мм.`,
      );
      if (item) result.push(item);
    }
  }

  return result;
}

export function surchargeItem(pricebook: Pricebook, recommendationItem: DimensionSurchargeRecommendation): PriceItem | null {
  return pricebook.items.find((item) => item.id === recommendationItem.itemId) ?? null;
}

/** Применяет только ранее рассчитанные надбавки; вызывается после явного подтверждения пользователя. */
export function applyDimensionSurcharges(
  module: KitchenModule,
  body: PriceItem,
  pricebook: Pricebook,
): KitchenModule {
  const recommendations = inferDimensionSurcharges(module, body, pricebook);
  const surcharges = [...(module.surcharges ?? [])];
  const automaticSurcharges = [...(module.automaticSurcharges ?? [])];
  for (const item of recommendations) {
    if (!surcharges.includes(item.itemId)) surcharges.push(item.itemId);
    if (!automaticSurcharges.includes(item.itemId)) automaticSurcharges.push(item.itemId);
  }
  return { ...module, surcharges, automaticSurcharges };
}
