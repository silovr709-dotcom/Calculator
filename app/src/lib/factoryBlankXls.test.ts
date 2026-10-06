import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ExcelJS from 'exceljs';
import type { BlankDraftField } from './factoryBlank';
import { FACTORY_BLANK_SPECS, VISMA_CORPUS_BLANK, VISMA_KITCHEN_BLANK } from './factoryBlank';
import type { BlankSheetMap } from './factoryBlankXls';
import {
  blankCellRefLabel,
  blankFileName,
  blankSketchRangeLabel,
  buildBlankCellWrites,
  buildSketchImagePlacements,
  buildWorktopWrites,
  CORPUS_SHEET_MAP,
  getBlankSheetMap,
  KITCHEN_SHEET_MAP,
  worktopAreaCells,
  worktopSummary,
} from './factoryBlankXls';
import type { Project, WorktopPiece } from '../types';
import { defaultSettings } from './storage';

const here = dirname(fileURLToPath(import.meta.url));
const templateDir = join(here, '../../public/templates');

const draftOf = (spec: typeof VISMA_KITCHEN_BLANK, values: Record<string, string>): BlankDraftField[] =>
  spec.fields.map((field) => ({
    field,
    value: values[field.key] ?? '',
    source: values[field.key] ? 'draft' : 'empty',
  }));

async function loadSheet(map: BlankSheetMap) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(readFileSync(join(templateDir, map.template)) as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const ws = wb.getWorksheet(map.sheet);
  if (!ws) throw new Error(`нет листа ${map.sheet}`);
  return { wb, ws };
}

const text = (v: unknown): string => {
  if (v == null) return '';
  if (typeof v === 'object' && v !== null && 'richText' in v) {
    return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join('');
  }
  return String(v);
};

describe('карта ячеек бланка сверена с настоящим шаблоном фабрики', () => {
  it('в шаблоне кухни рядом с каждой целевой клеткой стоит подпись поля', async () => {
    const { ws } = await loadSheet(KITCHEN_SHEET_MAP);
    // Основная таблица бланка: подпись в колонке J, значение в K той же строки.
    const labelled: [string, string][] = [
      ['K5', 'Цвет ЛДСП'],
      ['K6', 'Кромка каркаса'],
      ['K9', 'Цвет фасада и  текстур.'],
      ['K14', 'Ножки'],
      ['K22', 'Тип столешницы'],
      ['K33', 'Петли '],
      ['K45', 'Ручки'],
      ['K47', 'Термопланка '],
    ];
    for (const [cell, expected] of labelled) {
      const row = Number(cell.slice(1));
      expect(text(ws.getCell(`J${row}`).value), `подпись для ${cell}`).toBe(expected);
    }
    // Шапка и размеры
    expect(text(ws.getCell('C1').value)).toBe('Менеджер/Технолог');
    expect(text(ws.getCell('A4').value)).toBe('h пеналов общ:');
    expect(text(ws.getCell('H4').value)).toBe('h столов общ:');
    expect(text(ws.getCell('J48').value)).toBe('Прочее');
    expect(blankSketchRangeLabel(KITCHEN_SHEET_MAP)).toBe('A14:I47');
  });

  it('все целевые клетки кухни существуют и попадают в лист бланка', async () => {
    const { ws } = await loadSheet(KITCHEN_SHEET_MAP);
    const all = [...Object.values(KITCHEN_SHEET_MAP.cells), ...KITCHEN_SHEET_MAP.clear];
    for (const addr of all) {
      const row = Number(addr.replace(/^[A-Z]+/, ''));
      expect(row, `${addr} в пределах листа`).toBeGreaterThan(0);
      expect(row).toBeLessThanOrEqual(ws.rowCount + 10);
    }
    // ни одна клетка значения не совпадает с клеткой подписи (иначе затрём подпись)
    const labelCells = new Set(['J5', 'J14', 'J22', 'J33', 'A4', 'C1', 'J48']);
    for (const addr of Object.values(KITCHEN_SHEET_MAP.cells)) {
      expect(labelCells.has(addr), `${addr} не должен быть клеткой подписи`).toBe(false);
    }
  });

  it('в шаблоне корпуса подписи стоят в колонке A, значения — в B', async () => {
    const { ws } = await loadSheet(CORPUS_SHEET_MAP);
    const labelled: [string, string][] = [
      ['B4', 'Размер корпуса (ВШГ) c h цоколя'],
      ['B6', 'Цвет корпуса'],
      ['B13', 'Вид /Цвет/фрезеровка /текстура'],
      ['B26', 'Петли '],
      ['B36', 'Прочее'],
    ];
    for (const [cell, expected] of labelled) {
      const row = Number(cell.slice(1));
      expect(text(ws.getCell(`A${row}`).value), `подпись для ${cell}`).toBe(expected);
    }
    expect(text(ws.getCell('C1').value)).toBe('№ заказа');
    expect(text(ws.getCell('H1').value)).toBe('Дата отгрузки');
  });

  it('заполнение шаблона не ломает объединения, стили и другие листы', async () => {
    const { wb, ws } = await loadSheet(KITCHEN_SHEET_MAP);
    const sheetsBefore = wb.worksheets.map((w) => w.name);
    const mergesBefore = Object.keys((ws as unknown as { _merges: Record<string, unknown> })._merges ?? {}).length;
    const fontBefore = { ...ws.getCell('K14').font };
    const borderBefore = JSON.parse(JSON.stringify(ws.getCell('K14').border ?? {}));

    for (const cell of KITCHEN_SHEET_MAP.clear) ws.getCell(cell).value = null;
    ws.getCell('K5').value = 'U1655 Белый';
    const out = await wb.xlsx.writeBuffer();

    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load(out as unknown as Parameters<typeof wb2.xlsx.load>[0]);
    const ws2 = wb2.getWorksheet(KITCHEN_SHEET_MAP.sheet);
    expect(wb2.worksheets.map((w) => w.name)).toEqual(sheetsBefore);
    expect(Object.keys((ws2 as unknown as { _merges: Record<string, unknown> })._merges ?? {}).length).toBe(mergesBefore);
    expect({ ...ws2!.getCell('K14').font }).toEqual(fontBefore);
    expect(JSON.parse(JSON.stringify(ws2!.getCell('K14').border ?? {}))).toEqual(borderBefore);
    expect(text(ws2!.getCell('K5').value)).toBe('U1655 Белый');
    // примеры из шаблона стёрты
    expect(text(ws2!.getCell('K33').value)).toBe('');
    // подписи полей на месте
    expect(text(ws2!.getCell('J33').value)).toBe('Петли ');
  });
});

describe('сборка значений для шаблона', () => {
  it('пишет только заполненные поля и сохраняет подпись в объединённой клетке', () => {
    const draft = draftOf(VISMA_KITCHEN_BLANK, { ldspColor: 'U1655 Белый', hinges: 'Boyard 110° — 12 шт' });
    const writes = buildBlankCellWrites(KITCHEN_SHEET_MAP, draft);
    const byCell = new Map(writes.map((w) => [w.cell, w.value]));
    expect(byCell.get('K5')).toBe('U1655 Белый');
    expect(byCell.get('L5')).toBe('U1655 Белый');
    expect(byCell.get('K33')).toBe('Boyard 110° — 12 шт');
    expect(byCell.has('K34')).toBe(false); // пустое поле не пишем
    expect(byCell.get('C3')).toBe('Наименование изделия:'); // подпись остаётся даже без значения
  });

  it('раскладывает официальную таблицу верх/низ и не оставляет нижнюю колонку пустой', () => {
    const draft = draftOf(VISMA_KITCHEN_BLANK, {
      ldspColor: 'Верх — U1655 Белый, низ — U1104 Венге',
      facadeColor: 'Однотонный белый',
    });
    const byCell = new Map(buildBlankCellWrites(KITCHEN_SHEET_MAP, draft).map((w) => [w.cell, w.value]));
    expect(byCell.get('K5')).toBe('U1655 Белый');
    expect(byCell.get('L5')).toBe('U1104 Венге');
    expect(byCell.get('K9')).toBe('Однотонный белый');
    expect(byCell.get('L9')).toBe('Однотонный белый');
    expect(blankCellRefLabel(KITCHEN_SHEET_MAP, 'ldspColor')).toBe('K5 / L5');
  });

  it('дублирует реквизиты на лист 2', () => {
    const draft = draftOf(VISMA_KITCHEN_BLANK, { orderNo: '1234', manager: 'Иванов', startDate: '01.10.2026' });
    const byCell = new Map(buildBlankCellWrites(KITCHEN_SHEET_MAP, draft).map((w) => [w.cell, w.value]));
    expect(byCell.get('L2')).toBe('1234');
    expect(byCell.get('L52')).toBe('1234');
    expect(byCell.get('L53')).toBe('Иванов');
    expect(byCell.get('J1')).toBe('01.10.2026');
    expect(byCell.get('J51')).toBe('01.10.2026');
  });

  it('у корпуса своя карта и нет листа 2', () => {
    const draft = draftOf(VISMA_CORPUS_BLANK, { corpusColor: 'U1147 Дуб табачный', hinges: 'Titus 110 — 4 шт' });
    const byCell = new Map(buildBlankCellWrites(CORPUS_SHEET_MAP, draft).map((w) => [w.cell, w.value]));
    expect(byCell.get('B6')).toBe('U1147 Дуб табачный');
    expect(byCell.get('B26')).toBe('Titus 110 — 4 шт');
    expect(CORPUS_SHEET_MAP.worktop).toBeUndefined();
    expect(CORPUS_SHEET_MAP.sketch).toBeUndefined();
    expect(blankSketchRangeLabel(CORPUS_SHEET_MAP)).toBe('');
    expect(buildWorktopWrites(CORPUS_SHEET_MAP, [], 'что-то')).toEqual([]);
  });

  it('схема столешницы уходит на лист 2 таблицей с кромками', () => {
    const pieces: WorktopPiece[] = [
      { id: 'a', name: 'Левая', lengthMm: 2400, widthMm: 600, front: 'pf', back: 'v', left: 'pvc', right: 'eurozapil' },
      { id: 'b', name: 'Правая', lengthMm: 1200, widthMm: 600, front: 'pf', left: null, right: null },
    ];
    const writes = buildWorktopWrites(KITCHEN_SHEET_MAP, pieces, '38мм СОЮЗ. Белый 1111Q');
    const byCell = new Map(writes.map((w) => [w.cell, w.value]));
    expect(byCell.get('I56')).toBe('38мм СОЮЗ. Белый 1111Q');
    expect(byCell.get('A58')).toBe('Деталь');
    expect(byCell.get('A59')).toBe('Левая');
    expect(byCell.get('C59')).toBe('2400');
    expect(byCell.get('A60')).toBe('Правая');
    expect(byCell.get('D60')).toBe('600');
    expect(byCell.get('F59')).toContain('V');
    expect(byCell.get('F60')).toBe('ПВХ 0,4 белая');
    expect(byCell.get('H59')).toContain('Еврозапил');
  });

  it('длинный список деталей обрезается по лимиту строк шаблона', () => {
    const many: WorktopPiece[] = Array.from({ length: 30 }, (_, i) => ({
      id: `p${i}`, name: `Деталь ${i}`, lengthMm: 100, widthMm: 600, front: null, left: null, right: null,
    }));
    const rows = buildWorktopWrites(KITCHEN_SHEET_MAP, many, '')
      .filter((w) => w.cell.startsWith('A') && /^A\d+$/.test(w.cell))
      .map((w) => Number(w.cell.slice(1)));
    const maxRow = Math.max(...rows);
    expect(maxRow).toBeLessThanOrEqual(KITCHEN_SHEET_MAP.worktop!.firstRow + KITCHEN_SHEET_MAP.worktop!.maxRows);
  });

  it('сводка по столешнице склеивает тип и цвет без дублей', () => {
    expect(worktopSummary(draftOf(VISMA_KITCHEN_BLANK, { worktopType: '38мм СОЮЗ', worktopColor: 'Белый 1111Q' })))
      .toBe('38мм СОЮЗ. Белый 1111Q');
    expect(worktopSummary(draftOf(VISMA_KITCHEN_BLANK, { worktopType: '38мм СОЮЗ', worktopColor: '38мм СОЮЗ' })))
      .toBe('38мм СОЮЗ');
    expect(worktopSummary(draftOf(VISMA_KITCHEN_BLANK, {}))).toBe('');
  });

  it('раскладывает несколько эскизов отдельными картинками внутри штатного поля бланка', () => {
    const image = { base64: 'data:image/png;base64,AA==', extension: 'png' as const, width: 800, height: 500 };
    const placements = buildSketchImagePlacements(KITCHEN_SHEET_MAP.sketch!, [
      { title: '1', image },
      { title: '2', image },
      { title: '3', image },
    ]);
    expect(placements).toHaveLength(3);
    expect(new Set(placements.map((placement) => `${placement.tl.col}:${placement.tl.row}`)).size).toBe(3);
    for (const placement of placements) {
      expect(placement.tl.col).toBeGreaterThanOrEqual(KITCHEN_SHEET_MAP.sketch!.tl.col);
      expect(placement.tl.row).toBeGreaterThanOrEqual(KITCHEN_SHEET_MAP.sketch!.tl.row);
      expect(placement.tl.col).toBeLessThan(KITCHEN_SHEET_MAP.sketch!.br.col);
      expect(placement.tl.row).toBeLessThan(KITCHEN_SHEET_MAP.sketch!.br.row);
      expect(placement.ext.width).toBeGreaterThan(0);
      expect(placement.ext.height).toBeGreaterThan(0);
    }
  });

  it('подсказывает адреса ячеек и очищает весь блок листа 2 перед записью', () => {
    expect(blankCellRefLabel(KITCHEN_SHEET_MAP, 'orderNo')).toBe('L2 / L52');
    expect(blankCellRefLabel(KITCHEN_SHEET_MAP, 'productName')).toBe('C3');
    expect(blankCellRefLabel(CORPUS_SHEET_MAP, 'orderNo')).toBe('C2');
    const cells = worktopAreaCells(KITCHEN_SHEET_MAP);
    expect(cells).toContain('I56');
    expect(cells).toContain('A58');
    expect(cells).toContain('H72');
    expect(worktopAreaCells(CORPUS_SHEET_MAP)).toEqual([]);
  });
});

describe('имя файла и карты бланков', () => {
  const project: Project = {
    id: 'p1', name: 'Кухня / Иванов: 2 этаж', client: '', date: '2026-09-29', comment: '',
    status: 'draft', pricebookId: 'visma-2026', pricebookName: '', lines: [],
    settings: defaultSettings(), modules: [], createdAt: '2026-09-29', updatedAt: '2026-09-29',
  };

  it('чистит запрещённые символы и подставляет дату', () => {
    const name = blankFileName(project, VISMA_KITCHEN_BLANK);
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
    expect(name.endsWith('.xlsx')).toBe(true);
    expect(name).toContain('Бланк заказа кухни 2025');
  });

  it('для каждого бланка из списка есть карта шаблона', () => {
    for (const spec of FACTORY_BLANK_SPECS) {
      expect(getBlankSheetMap(spec.id), `карта для ${spec.id}`).toBeDefined();
    }
  });

  it('каждое поле бланка имеет клетку в шаблоне', () => {
    const check = (spec: typeof VISMA_KITCHEN_BLANK, map: BlankSheetMap) => {
      const known = new Set([...Object.keys(map.cells), ...Object.keys(map.prefixed ?? {})]);
      const missing = spec.fields.map((f) => f.key).filter((k) => !known.has(k));
      expect(missing, `поля без клетки в ${spec.blankName}`).toEqual([]);
    };
    check(VISMA_KITCHEN_BLANK, KITCHEN_SHEET_MAP);
    check(VISMA_CORPUS_BLANK, CORPUS_SHEET_MAP);
  });
});
