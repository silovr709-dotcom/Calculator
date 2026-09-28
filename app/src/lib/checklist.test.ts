import { describe, expect, it } from 'vitest';
import type { ProjectLine } from '../types';
import { checkKitchenChecklist, checklistPool } from './checklist';

const line = (id: string, name: string, category: string): ProjectLine => ({
  id,
  itemId: id,
  pricebookId: 'pb',
  category,
  group: 'Прочее',
  name,
  article: null,
  unit: 'шт',
  priceKind: 'fixed',
  price: 100,
  priceBasis: 'unit',
  priceGroup: null,
  qty: 1,
  params: {},
});

describe('обязательный состав кухни', () => {
  it('показывает четыре отсутствующие позиции в пустом проекте', () => {
    const result = checkKitchenChecklist([]);
    expect(result.missing.map((item) => item.key)).toEqual(['plinth', 'baseboard', 'worktop', 'wallPanel']);
  });

  it('распознаёт цоколь, плинтус, столешницу и стеновую панель по строкам прайса', () => {
    const result = checkKitchenChecklist([
      line('plinth', 'Цоколь ПВХ 100мм', 'Цоколь и длинномеры'),
      line('baseboard', 'Плинтус+вставка L=3м', 'Цоколь и длинномеры'),
      line('worktop', 'Столешница МС 600*3000*38', 'Столешницы: Мир Столешниц (постформинг)'),
      line('wall', 'Стеновая панель 600*3000*4', 'Столешницы: Мир Столешниц (постформинг)'),
    ]);
    expect(result.missing).toHaveLength(0);
  });

  it('подтверждённое отсутствие зафиксировано и не считается недостающим', () => {
    const result = checkKitchenChecklist([], ['baseboard', 'wallPanel']);
    expect(result.missing.map((item) => item.key)).toEqual(['plinth', 'worktop']);
    expect(result.items.find((item) => item.key === 'baseboard')?.confirmed).toBe(true);
    expect(result.items.find((item) => item.key === 'wallPanel')?.confirmed).toBe(true);
    expect(result.items.find((item) => item.key === 'worktop')?.confirmed).toBe(false);
  });

  it('добавленная позиция перевешивает подтверждение отсутствия', () => {
    const result = checkKitchenChecklist([
      line('baseboard', 'Плинтус+вставка L=3м', 'Цоколь и длинномеры'),
    ], ['baseboard']);
    const baseboard = result.items.find((item) => item.key === 'baseboard')!;
    expect(baseboard.included).toBe(true);
    expect(baseboard.confirmed).toBe(false);
  });

  it('пулы чек-листа не смешивают столешницу и стеновую панель', () => {
    expect(checklistPool('worktop', 'Столешницы: Мир Столешниц (постформинг)', 'Столешница 600*3000*38')).toBe(true);
    expect(checklistPool('worktop', 'Столешницы: СОЮЗ (постформинг)', 'Столешница/панель СОЮЗ 600*3000*26 — Classic')).toBe(true);
    expect(checklistPool('worktop', 'Столешницы: Мир Столешниц (постформинг)', 'Стеновая панель 600*3000*4')).toBe(false);
    expect(checklistPool('wallPanel', 'Столешницы: Мир Столешниц (постформинг)', 'Стеновая панель 600*3000*4')).toBe(true);
  });
});
