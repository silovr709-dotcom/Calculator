// Финансовый блок РЕцепт PRO. Никакой новой расчётной логики: тонкая обёртка
// над существующим движком (moduleToLines + calcTotals) — единый источник правды.
import type { Pricebook, Project } from '../types';
import { calcTotals } from './engine';
import { moduleToLines } from './modules';

export interface ProjectFinance {
  /** Итоговая стоимость для клиента (выручка по проекту), ₽. */
  clientPrice: number;
  /** Себестоимость проекта (материалы + доп. расходы), ₽. */
  cost: number;
  /** Дополнительные расходы (сборка/доставка/процентные), ₽. */
  extrasTotal: number;
  /** Валовая прибыль = цена клиента − себестоимость, ₽. */
  grossProfit: number;
  /** Маржинальность = прибыль / цена клиента, %. null — цена не задана. */
  marginPct: number | null;
  /** Строк без цены — финансы такого проекта неполные. */
  unpricedCount: number;
}

/** Финансы одного проекта из его существующих данных (модули + строки + настройки). */
export function projectFinance(project: Project, pricebook: Pricebook): ProjectFinance {
  const moduleLines = (project.modules ?? []).flatMap((m) => moduleToLines(m, project.moduleDefaults ?? {}, pricebook));
  const { totals } = calcTotals([...moduleLines, ...project.lines], project.settings);
  return {
    clientPrice: totals.client,
    cost: totals.cost,
    extrasTotal: totals.extraTotal,
    grossProfit: totals.markupRub,
    marginPct: totals.marginPct,
    unpricedCount: totals.unpricedCount,
  };
}

export interface PortfolioFinance {
  projectsCount: number;
  /** Выручка (сумма цен для клиентов), ₽. */
  revenue: number;
  /** Себестоимость, ₽. */
  cost: number;
  /** Дополнительные расходы, ₽. */
  extrasTotal: number;
  /** Валовая прибыль, ₽. */
  grossProfit: number;
  /** Маржинальность портфеля = прибыль / выручка, %. */
  marginPct: number | null;
  /** В скольких проектах есть строки без цены. */
  unpricedProjects: number;
}

/** Сводка по списку проектов (например, по текущему фильтру дашборда). */
export function portfolioFinance(projects: Project[], pricebook: Pricebook): PortfolioFinance {
  let revenue = 0; let cost = 0; let extrasTotal = 0; let grossProfit = 0; let unpricedProjects = 0;
  for (const project of projects) {
    const finance = projectFinance(project, pricebook);
    revenue += finance.clientPrice;
    cost += finance.cost;
    extrasTotal += finance.extrasTotal;
    grossProfit += finance.grossProfit;
    if (finance.unpricedCount > 0) unpricedProjects += 1;
  }
  const round2 = (v: number) => Math.round(v * 100) / 100;
  return {
    projectsCount: projects.length,
    revenue: round2(revenue),
    cost: round2(cost),
    extrasTotal: round2(extrasTotal),
    grossProfit: round2(grossProfit),
    marginPct: revenue > 0 ? round2((grossProfit / revenue) * 100) : null,
    unpricedProjects,
  };
}
