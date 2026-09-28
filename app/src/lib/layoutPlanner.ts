import type { KitchenWall } from '../types';

export interface LayoutCandidate {
  id: string;
  name: string;
  widthMm: number | null;
  availableQty: number;
  wall?: KitchenWall;
}

export interface LayoutPlanItem {
  candidateId: string;
  count: number;
}

export interface WallLayoutPlan {
  wall: KitchenWall;
  wallLengthMm: number;
  items: LayoutPlanItem[];
  usedWidthMm: number;
  freeMm: number;
  /** Удобный текст для карточки предложения. */
  label: string;
}

/**
 * Подбирает только существующие позиции проекта. Алгоритм перебирает количество
 * каждого кандидата, но никогда не превышает длину стены и не изменяет проект.
 * Обязательные позиции входят минимум по одной штуке в каждое предложение.
 */
export function suggestWallLayouts(
  wall: KitchenWall,
  wallLengthMm: number,
  candidates: LayoutCandidate[],
  mandatoryIds: string[] = [],
  maxResults = 24,
): WallLayoutPlan[] {
  if (!Number.isFinite(wallLengthMm) || wallLengthMm <= 0) return [];
  const usable = candidates.filter((candidate) => candidate.widthMm != null
    && candidate.widthMm > 0
    && candidate.availableQty > 0
    && (candidate.wall == null || candidate.wall === wall));
  const mandatory = new Set(mandatoryIds);
  if (mandatoryIds.some((id) => !usable.some((candidate) => candidate.id === id))) return [];

  const plans: WallLayoutPlan[] = [];
  const counts = new Map<string, number>();

  const visit = (index: number, usedWidthMm: number) => {
    if (plans.length >= maxResults * 12) return;
    if (index >= usable.length) {
      if (counts.size === 0 || mandatoryIds.some((id) => !counts.has(id))) return;
      const items = usable.filter((candidate) => counts.has(candidate.id)).map((candidate) => ({ candidateId: candidate.id, count: counts.get(candidate.id)! }));
      const freeMm = wallLengthMm - usedWidthMm;
      plans.push({
        wall,
        wallLengthMm,
        items,
        usedWidthMm,
        freeMm,
        label: items.map((item) => `${usable.find((candidate) => candidate.id === item.candidateId)!.name} × ${item.count}`).join(' + '),
      });
      return;
    }

    const candidate = usable[index];
    const width = candidate.widthMm!;
    const minCount = mandatory.has(candidate.id) ? 1 : 0;
    const maxCount = Math.min(candidate.availableQty, Math.floor((wallLengthMm - usedWidthMm) / width));
    for (let count = minCount; count <= maxCount; count += 1) {
      if (count > 0) counts.set(candidate.id, count);
      else counts.delete(candidate.id);
      visit(index + 1, usedWidthMm + width * count);
    }
    counts.delete(candidate.id);
  };

  visit(0, 0);
  return plans
    .sort((a, b) => a.freeMm - b.freeMm || b.usedWidthMm - a.usedWidthMm || b.items.length - a.items.length)
    .slice(0, maxResults)
    .map((plan) => ({ ...plan, items: plan.items.map((item) => ({ ...item })) }));
}

export function formatRemainder(mm: number): string {
  if (mm === 0) return 'без остатка';
  return mm > 0 ? `свободно ${mm} мм` : `переразмер на ${Math.abs(mm)} мм`;
}
