// Выгрузка бланка на фабрику В ФАЙЛОВУЮ ФОРМУ ФАБРИКИ.
//
// Мы не рисуем свою таблицу — открываем настоящий шаблон Висмы
// («!!бланк Висма Кухни 2025.xlsm» / «бланк корпус 2025.xlsx», лежат в public/templates)
// и проставляем значения в те же клетки, куда их вписывает технолог руками.
// Стили, объединения, ширины колонок и остальные листы книги остаются нетронутыми —
// поэтому используется ExcelJS (он читает книгу целиком и пишет её обратно),
// а не сборка листа с нуля.
//
// Разбор шаблонов по ячейкам сделан вручную: подписи полей лежат в колонке J
// (кухня) и в колонке A (корпус), значения — в соседних объединённых клетках.

import type { Project, WorktopPiece } from '../types';
import type { BlankDraftField, FactoryBlankSpec } from './factoryBlank';
import { edgeKindLabel } from './worktopPlan';

/** Куда писать значения одного бланка. */
export interface BlankSheetMap {
  /** Файл шаблона в public/templates. */
  template: string;
  /** Лист книги, который заполняем. */
  sheet: string;
  /** Расширение итогового файла (ExcelJS пишет книгу как .xlsx). */
  outExt: 'xlsx';
  /** field.key → адрес клетки. */
  cells: Record<string, string>;
  /**
   * Клетки, где подпись и значение живут в одной объединённой клетке:
   * пишем «Подпись: значение», чтобы не затереть подпись.
   */
  prefixed?: Record<string, { cell: string; prefix: string }>;
  /** Дубли реквизитов на листе 2 (та же величина в другой клетке). */
  mirrors?: Record<string, string>;
  /** Клетки шаблона с примерами заполнения — их нужно очистить. */
  clear: string[];
  /** Блок «Лист 2»: схема столешницы. */
  worktop?: {
    /** Клетка с описанием столешницы (тип + цвет). */
    summaryCell: string;
    /** Заголовок таблицы деталей. */
    titleCell: string;
    /** Первая строка таблицы деталей и колонки. */
    firstRow: number;
    /** Сколько строк максимум можно занять, не залезая в подписи шаблона. */
    maxRows: number;
    columns: { name: string; length: string; width: string; front: string; left: string; right: string };
  };
}

const KITCHEN_VALUE_CELLS = [
  'F1', 'J1', 'L1', 'E2', 'L2',
  'B4', 'E4', 'G4', 'I4',
  // таблица «Каркас / Фасад»: K — Верх, L — Низ (в шаблоне заполнен пример)
  'K5', 'L5', 'K6', 'L6', 'K7', 'L7', 'K8', 'L8', 'K9', 'L9', 'K10', 'L10', 'K11', 'L11', 'K12', 'L12',
  // дополнения / столешница / фурнитура — одна колонка K:M
  'K14', 'K15', 'K16', 'K17', 'K18', 'K19', 'K20',
  'K22', 'K23', 'K24', 'K25', 'K26', 'K27', 'K28', 'K29', 'K30',
  'K32', 'K33', 'K34', 'K35', 'K36', 'K37', 'K38', 'K39', 'K40',
  'K41', 'K42', 'K43', 'K44', 'K45', 'K46', 'K47', 'J49',
  // левый блок «сведения на упаковку»
  'I8', 'I9', 'I10', 'F11',
  // лист 2
  'J51', 'L51', 'L52', 'L53', 'L54', 'I56',
];

export const KITCHEN_SHEET_MAP: BlankSheetMap = {
  template: 'blank-kitchen-2025.xlsm',
  sheet: 'Бланк_заказа',
  outExt: 'xlsx',
  cells: {
    manager: 'F1', startDate: 'J1', shipDate: 'L1', seriesNo: 'E2', orderNo: 'L2',
    hTall: 'B4', hBread: 'E4', hWall: 'G4', hBase: 'I4',
    ldspColor: 'K5', bodyEdging: 'K6', backPanel: 'K7',
    facadeType: 'K8', facadeColor: 'K9', facadeMilling: 'K10', facadeFrame: 'K11', facadeEdging: 'K12',
    legs: 'K14', plinth: 'K15', plinthExtras: 'K16', mensola: 'K17',
    extraShelves: 'K18', cornice: 'K19', baguette: 'K20',
    worktopType: 'K22', worktopColor: 'K23', worktopEdge: 'K24', worktopEdgeColor: 'K25',
    worktopPlanks: 'K26', baseboard: 'K27', baseboardCaps: 'K28', wallPanel: 'K29', wallPanelPlanks: 'K30',
    light: 'K32', hinges: 'K33', glass: 'K34', glassFrame: 'K35', dishDryer: 'K36',
    drawerGuides: 'K37', hangerRail: 'K38', shelfHolders: 'K39', basket: 'K40', lifts: 'K41',
    tipOn: 'K42', sink: 'K43', tray: 'K44', handles: 'K45', gasLift: 'K46', thermoStrip: 'K47',
    other: 'J49',
    hardPackFacade: 'I8', doublePack: 'I9', worktopScraps: 'I10', packNotes: 'F11',
  },
  prefixed: {
    productName: { cell: 'C3', prefix: 'Наименование изделия:' },
  },
  mirrors: { startDate: 'J51', shipDate: 'L51', orderNo: 'L52', manager: 'L53', worktopScraps: 'L54' },
  clear: KITCHEN_VALUE_CELLS,
  worktop: {
    summaryCell: 'I56',
    titleCell: 'A57',
    firstRow: 58,
    maxRows: 14,
    columns: { name: 'A', length: 'C', width: 'D', front: 'E', left: 'F', right: 'G' },
  },
};

const CORPUS_VALUE_CELLS = [
  'C2', 'D2', 'E2', 'F2', 'G2', 'H2',
  'B4', 'B5', 'B6', 'B7', 'B8', 'B9',
  'B11', 'B12', 'B13', 'B14', 'B15', 'B16', 'B17', 'B18',
  'B20', 'B21', 'B22', 'B23',
  'B25', 'B26', 'B27', 'B28', 'B29', 'B30', 'B31', 'B32', 'B33', 'B34', 'B35', 'B36',
];

export const CORPUS_SHEET_MAP: BlankSheetMap = {
  template: 'blank-corpus-2025.xlsx',
  sheet: 'БЛАНК',
  outExt: 'xlsx',
  cells: {
    orderNo: 'C2', manager: 'D2', technolog: 'E2', productName: 'F2', startDate: 'G2', shipDate: 'H2',
    corpusSizes: 'B4', plinthHeight: 'B5', corpusColor: 'B6', corpusEdging: 'B7',
    backPanel: 'B8', extraLdsp: 'B9',
    openingSize: 'B11', coupeSystem: 'B12', facadeType: 'B13', facadeEdging: 'B14',
    mirror: 'B15', mirrorEdge: 'B16', mirrorGlue: 'B17', baguette: 'B18',
    worktopSize: 'B20', worktopColor: 'B21', worktopEdging: 'B22', worktopScraps: 'B23',
    drawerGuides: 'B25', hinges: 'B26', shelfHolders: 'B27', hangerRail: 'B28',
    tuba: 'B29', flange: 'B30', basket: 'B31', handles: 'B32', hardPack: 'B33',
    feet: 'B34', hooks: 'B35', other: 'B36',
  },
  clear: CORPUS_VALUE_CELLS,
};

const SHEET_MAPS: Record<string, BlankSheetMap> = {
  'visma-kitchen-2025': KITCHEN_SHEET_MAP,
  'visma-corpus-2025': CORPUS_SHEET_MAP,
};

export const getBlankSheetMap = (specId: string): BlankSheetMap | undefined => SHEET_MAPS[specId];

/** Все клетки шаблона, куда попадёт конкретное поле (основная + дубли на листе 2). */
export function blankCellRefsForField(map: BlankSheetMap, key: string): string[] {
  return [map.cells[key], map.prefixed?.[key]?.cell, map.mirrors?.[key]].filter((cell): cell is string => Boolean(cell));
}

/** Короткая подпись для UI: пользователь сразу видит, куда попадёт значение в шаблоне. */
export function blankCellRefLabel(map: BlankSheetMap, key: string): string {
  const refs = blankCellRefsForField(map, key);
  return refs.length ? refs.join(' / ') : '';
}

/** Клетки таблицы столешницы, которые нужно очистить перед новой записью. */
export function worktopAreaCells(map: BlankSheetMap): string[] {
  const wt = map.worktop;
  if (!wt) return [];
  const cells = [wt.titleCell, wt.summaryCell];
  const cols = Object.values(wt.columns);
  for (let row = wt.firstRow; row <= wt.firstRow + wt.maxRows; row += 1) {
    for (const col of cols) cells.push(`${col}${row}`);
  }
  return cells;
}

/** Одна запись «в клетку X положить значение Y». */
export interface BlankCellWrite { cell: string; value: string }

/**
 * Готовит список записей в клетки шаблона. Чистая функция — её и проверяют тесты,
 * чтобы карта ячеек не разъехалась незаметно.
 */
export function buildBlankCellWrites(map: BlankSheetMap, draft: BlankDraftField[]): BlankCellWrite[] {
  const writes: BlankCellWrite[] = [];
  const byKey = new Map(draft.map((d) => [d.field.key, d.value.trim()]));

  for (const [key, cell] of Object.entries(map.cells)) {
    const value = byKey.get(key);
    if (value) writes.push({ cell, value });
  }
  for (const [key, { cell, prefix }] of Object.entries(map.prefixed ?? {})) {
    const value = byKey.get(key);
    // подпись остаётся в клетке всегда — иначе бланк потеряет название поля
    writes.push({ cell, value: value ? `${prefix} ${value}` : prefix });
  }
  for (const [key, cell] of Object.entries(map.mirrors ?? {})) {
    const value = byKey.get(key);
    if (value) writes.push({ cell, value });
  }
  return writes;
}

/** Строки таблицы деталей столешницы для «Листа 2». */
export function buildWorktopWrites(map: BlankSheetMap, pieces: WorktopPiece[], summary: string): BlankCellWrite[] {
  const wt = map.worktop;
  if (!wt) return [];
  const writes: BlankCellWrite[] = [];
  if (summary.trim()) writes.push({ cell: wt.summaryCell, value: summary.trim() });
  if (pieces.length === 0) return writes;

  writes.push({ cell: wt.titleCell, value: 'Детали столешницы: длина × ширина, обработка видимых кромок' });
  const head = wt.firstRow;
  writes.push({ cell: `${wt.columns.name}${head}`, value: 'Деталь' });
  writes.push({ cell: `${wt.columns.length}${head}`, value: 'Длина' });
  writes.push({ cell: `${wt.columns.width}${head}`, value: 'Ширина' });
  writes.push({ cell: `${wt.columns.front}${head}`, value: 'Перед' });
  writes.push({ cell: `${wt.columns.left}${head}`, value: 'Лево' });
  writes.push({ cell: `${wt.columns.right}${head}`, value: 'Право' });

  for (const [i, p] of pieces.slice(0, wt.maxRows).entries()) {
    const row = head + 1 + i;
    writes.push({ cell: `${wt.columns.name}${row}`, value: p.name });
    writes.push({ cell: `${wt.columns.length}${row}`, value: p.lengthMm == null ? '' : String(p.lengthMm) });
    writes.push({ cell: `${wt.columns.width}${row}`, value: p.widthMm == null ? '' : String(p.widthMm) });
    writes.push({ cell: `${wt.columns.front}${row}`, value: edgeKindLabel(p.front) });
    writes.push({ cell: `${wt.columns.left}${row}`, value: edgeKindLabel(p.left) });
    writes.push({ cell: `${wt.columns.right}${row}`, value: edgeKindLabel(p.right) });
  }
  return writes;
}

/** Текстовая сводка по столешнице для клетки шаблона. */
export function worktopSummary(draft: BlankDraftField[]): string {
  const get = (key: string) => draft.find((d) => d.field.key === key)?.value.trim() ?? '';
  const parts = [get('worktopType'), get('worktopColor')].filter(Boolean);
  return [...new Set(parts)].join('. ');
}

/** Безопасное имя файла: без служебных символов, с датой. */
export function blankFileName(project: Project, spec: FactoryBlankSpec): string {
  const safe = project.name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Проект';
  const date = new Date().toISOString().slice(0, 10);
  return `${spec.blankName} — ${safe} — ${date}.xlsx`;
}

/**
 * Заполняет шаблон фабрики и отдаёт готовую книгу.
 * ExcelJS подключается динамически: библиотека тяжёлая и нужна только по клику,
 * поэтому она уезжает в отдельный чанк и не тормозит первую загрузку приложения.
 */
export async function buildFactoryBlankWorkbook(
  baseUrl: string,
  map: BlankSheetMap,
  writes: BlankCellWrite[],
): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default;
  const url = `${baseUrl}templates/${map.template}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Не удалось загрузить шаблон фабрики (${map.template}): ${res.status}`);
  const buffer = await res.arrayBuffer();

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet(map.sheet);
  if (!ws) throw new Error(`В шаблоне нет листа «${map.sheet}»`);

  // 1) убираем примеры заполнения, которые лежат в шаблоне, включая старые строки листа 2
  for (const cell of [...map.clear, ...worktopAreaCells(map)]) ws.getCell(cell).value = null;
  // 2) пишем свои значения; длинные тексты сразу включаем с переносом строк,
  // чтобы технолог видел весь состав без ручного растягивания ячеек.
  for (const w of writes) {
    const cell = ws.getCell(w.cell);
    cell.value = w.value === '' ? null : w.value;
    if (w.value !== '') {
      const lineCount = Math.max(w.value.split('\n').length, Math.ceil(w.value.length / 46));
      cell.alignment = { ...(cell.alignment ?? {}), wrapText: true, vertical: 'top' };
      if (lineCount > 1) {
        const row = ws.getRow(Number(cell.row));
        row.height = Math.max(row.height ?? 15, Math.min(90, 15 + (lineCount - 1) * 12));
      }
    }
  }

  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

/** Скачивание готовой книги в браузере. */
export function downloadWorkbook(data: ArrayBuffer, fileName: string): void {
  const blob = new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Полный сценарий кнопки «Excel — бланк заказа». */
export async function exportFactoryBlankXlsx(args: {
  baseUrl: string;
  project: Project;
  spec: FactoryBlankSpec;
  draft: BlankDraftField[];
  pieces: WorktopPiece[];
}): Promise<void> {
  const map = getBlankSheetMap(args.spec.id);
  if (!map) throw new Error(`Для бланка «${args.spec.blankName}» нет карты шаблона`);
  const writes = [
    ...buildBlankCellWrites(map, args.draft),
    ...buildWorktopWrites(map, args.pieces, worktopSummary(args.draft)),
  ];
  const data = await buildFactoryBlankWorkbook(args.baseUrl, map, writes);
  downloadWorkbook(data, blankFileName(args.project, args.spec));
}
