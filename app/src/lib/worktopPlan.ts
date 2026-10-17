// «Лист 2» бланка кухни Висма — схема столешницы (виды обработки видимых частей).
// Правила (из инструкции, никаких выдумок):
//  — видимые части отмечаются обработкой: ПВХ, «в цвет» (V), постформинг (ПФ),
//    еврозапил (со стяжками 2–3 шт), евростык;
//  — задние НЕотмеченные части фабрика закрывает кромкой ПВХ 0,4 белая;
//  — лист обязателен при наличии столешниц в заказе.
import type { Project, WorktopEdgeKind, WorktopPiece } from '../types';
import { lineMatchesChecklistKey } from './checklist';
import { uid } from './storage';

/** Виды обработки кромки — ровно как в листе 2 бланка. */
export const WORKTOP_EDGE_KINDS = [
  { id: 'pf', label: 'ПФ (постформинг)' },
  { id: 'pvc', label: 'ПВХ' },
  { id: 'v', label: 'V (в цвет)' },
  { id: 'eurozapil', label: 'Еврозапил (со стяжками)' },
  { id: 'eurostyk', label: 'Евростык' },
] as const;

export type { WorktopEdgeKind, WorktopPiece } from '../types';

export const edgeKindLabel = (id: WorktopEdgeKind | null | undefined): string =>
  id ? WORKTOP_EDGE_KINDS.find((k) => k.id === id)?.label ?? id : '—';


const DIMS = /(\d{3,4})[\s*xх*×]*[\s*xх*×](\d{3,4})/;

/** Предлагает детали из позиции столешницы проекта. Размеры берём ТОЛЬКО из имени позиции прайса. */
export function suggestWorktopPlan(project: Project): WorktopPiece[] {
  const line = project.lines.find((l) => lineMatchesChecklistKey('worktop', l));
  if (!line) return [];
  const text = line.name.replace('*', 'x');
  const m = text.match(DIMS) ?? text.match(/(\d{3,4})[\s/xх—-]+(\d{3,4})/);
  let lengthMm: number | null = null; let widthMm: number | null = null;
  if (m) {
    const a = Number(m[1]); const b = Number(m[2]);
    // хлыст: большая сторона — длина, меньшая — ширина (обычно 600)
    lengthMm = Math.max(a, b); widthMm = Math.min(a, b);
  }
  const front: WorktopEdgeKind | null = /постформ/i.test(line.category + ' ' + line.name) ? 'pf' : null;
  return [{ id: uid('wp'), name: 'Столешница', lengthMm, widthMm, front, back: null, left: null, right: null }];
}

export interface WorktopPlanIssue { level: 'error' | 'warn'; text: string }

const WORKTOP_SIDES: { key: 'front' | 'back' | 'left' | 'right'; label: string }[] = [
  { key: 'front', label: 'спереди' },
  { key: 'back', label: 'сзади' },
  { key: 'left', label: 'слева' },
  { key: 'right', label: 'справа' },
];

/** Проверка схемы столешницы: сообщаем, но сам лист не «чиним». */
export function checkWorktopPlan(pieces: WorktopPiece[], hasWorktop: boolean): WorktopPlanIssue[] {
  const issues: WorktopPlanIssue[] = [];
  if (!hasWorktop && pieces.length === 0) return issues;
  if (hasWorktop && pieces.length === 0) {
    // подтверждённое отсутствие столешницы — не ругаемся
    return issues;
  }
  if (pieces.length === 0) {
    issues.push({ level: 'error', text: 'Лист 2 обязателен при столешницах — добавьте хотя бы одну деталь столешницы' });
    return issues;
  }
  pieces.forEach((p, index) => {
    const label = p.name.trim() || `Деталь ${index + 1}`;
    if (!p.lengthMm || p.lengthMm <= 0) issues.push({ level: 'error', text: `Лист 2: у «${label}» не указана длина` });
    if (!p.widthMm || p.widthMm <= 0) issues.push({ level: 'error', text: `Лист 2: у «${label}» не указана ширина` });
    if (!p.front) issues.push({ level: 'warn', text: `Лист 2: у «${label}» не отмечена обработка передней кромки (ПФ/ПВХ/V)` });
    for (const side of WORKTOP_SIDES) {
      const kind = p[side.key];
      if ((kind === 'eurozapil' || kind === 'eurostyk') && pieces.length < 2) {
        issues.push({ level: 'warn', text: `Лист 2: у «${label}» ${side.label} указан стык (${edgeKindLabel(kind)}), но на схеме только одна деталь — проверьте соседний кусок` });
      }
    }
  });
  const joins = pieces.filter((p) => WORKTOP_SIDES.some((side) => p[side.key] === 'eurozapil')).length;
  if (joins > 0) {
    issues.push({ level: 'warn', text: `Еврозапил: по инструкции на стык нужны 2–3 стяжки — укажите их количество в поле «Планки для столешницы»` });
  }
  return issues;
}

/** Как увидит фабрика: задние неотмеченные части — ПВХ 0,4 белая (по инструкции). */
export const BACK_EDGE_NOTE = 'Задние неотмеченные части — ПВХ 0,4 белая (по умолчанию фабрики)';
