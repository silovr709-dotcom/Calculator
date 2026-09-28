import type { KitchenChecklistKey, KitchenChecklistResult, ProjectLine } from '../types';

export const KITCHEN_CHECKLIST: { key: KitchenChecklistKey; label: string; hint: string }[] = [
  { key: 'plinth', label: 'Цоколь', hint: 'Цоколь ПВХ или фасадный цоколь' },
  { key: 'baseboard', label: 'Плинтус', hint: 'Плинтус к стене со вставкой или профиль' },
  { key: 'worktop', label: 'Столешница', hint: 'Основная рабочая поверхность' },
  { key: 'wallPanel', label: 'Стеновая панель', hint: 'Фартук / стеновая панель' },
];

/** Сопоставляет строку расчёта с ключом чек-листа (столешница, стеновая, цоколь, плинтус). */
export function lineMatchesChecklistKey(key: KitchenChecklistKey, line: ProjectLine): boolean {
  const text = `${line.name} ${line.category}`.toLowerCase();
  if (key === 'plinth') return text.includes('цоколь') && !/плинтус|уплотнитель|заглуш|соеден|угол|вентиляц|пропил|ком-т/iu.test(text);
  if (key === 'baseboard') return text.includes('плинтус') && !/заглуш|соеден|угол|ком-т\s+згл/iu.test(text);
  if (key === 'wallPanel') return text.includes('стеновая панель') || /панель.*\*4|\*4.*панель/i.test(text);
  if (key === 'worktop') return line.category.startsWith('Столешницы:')
    && !line.category.includes('комплектующие')
    && !lineMatchesChecklistKey('wallPanel', line);
  return false;
}

export function checkKitchenChecklist(lines: ProjectLine[], confirmations: KitchenChecklistKey[] = []): KitchenChecklistResult {
  const affirmed = new Set(confirmations);
  const items = KITCHEN_CHECKLIST.map(({ key, label }) => {
    const lineIds = lines.filter((line) => lineMatchesChecklistKey(key, line)).map((line) => line.id);
    const included = lineIds.length > 0;
    // Если позицию добавили — подтверждение больше ни на что не влияет
    return { key, label, included, lineIds, confirmed: !included && affirmed.has(key) };
  });
  // В «недостающие» попадают только не добавленные и не подтверждённые позиции
  return { items, missing: items.filter((item) => !item.included && !item.confirmed) };
}

export function checklistPool(key: KitchenChecklistKey, category: string, name: string): boolean {
  const text = `${category} ${name}`.toLowerCase();
  if (key === 'plinth') return category === 'Цоколь и длинномеры' && text.includes('цоколь') && !/уплотнитель|заглуш|соеден|угол|вентиляц|пропил|ком-т/iu.test(text);
  if (key === 'baseboard') return category === 'Цоколь и длинномеры' && text.includes('плинтус') && !/заглуш|соеден|угол|ком-т\s+згл/iu.test(text);
  if (key === 'wallPanel') return text.includes('стеновая панель') || (category.startsWith('Столешницы') && /панель.*\*4|\*4.*панель/i.test(text));
  if (key === 'worktop') return category.startsWith('Столешницы:')
    && !category.includes('комплектующие')
    && !(text.includes('стеновая панель') || /панель.*\*4|\*4.*панель/i.test(text))
    && !text.includes('планк');
  return false;
}
