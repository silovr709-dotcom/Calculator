// Экспорт: Excel (внутренний и клиентский) и CSV. Клиентская версия не содержит
// себестоимости, наценок и служебных данных.
import * as XLSX from 'xlsx';
import type { Project, LineCalc } from '../types';
import { downloadFile } from './storage';
import { calcTotals } from './engine';
import { fmtDate } from './format';

function internalRows(p: Project, lineCalcs: Map<string, LineCalc>) {
  return p.lines.map((l) => {
    const c = lineCalcs.get(l.id);
    return {
      'Группа': l.group,
      'Категория прайса': l.category,
      'Позиция': l.name,
      'Артикул': l.article ?? '',
      'Кол-во': l.qty,
      'Расчётное кол-во': c?.qtyEffective ?? '',
      'Ед.': l.unit ?? '',
      'Цена (себестоимость)': l.price ?? '',
      'Сумма (себестоимость)': c?.sum ?? '',
      'Наценка %': c?.markupPct ?? '',
      'Сумма (клиент)': c?.clientSum ?? '',
      'Примечание': [l.note, c?.warning].filter(Boolean).join('; '),
      'Источник (лист прайса)': '',
    };
  });
}

export function exportInternalXlsx(p: Project) {
  const { lineCalcs, totals } = calcTotals(p.lines, p.settings);
  const rows = internalRows(p, lineCalcs);
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Позиции');

  const totalRows: Record<string, string | number>[] = [];
  for (const [g, v] of Object.entries(totals.byGroup)) {
    if (v.cost !== 0 || v.client !== 0) totalRows.push({ 'Показатель': `Себестоимость: ${g}`, 'Значение': v.cost });
  }
  if (totals.emalAdjustment?.applied) {
    totalRows.push({ 'Показатель': 'Правило прайса: эмаль < 1 кв.м (+30%)', 'Значение': totals.emalAdjustment.amount });
  }
  totalRows.push({ 'Показатель': 'Доп. расходы (сборка/доставка/прочее)', 'Значение': totals.extraTotal });
  totalRows.push({ 'Показатель': 'ИТОГО СЕБЕСТОИМОСТЬ', 'Значение': totals.cost });
  totalRows.push({ 'Показатель': 'Наценка, ₽', 'Значение': totals.markupRub });
  totalRows.push({ 'Показатель': 'Наценка, %', 'Значение': totals.markupPct ?? '' });
  totalRows.push({ 'Показатель': 'ЦЕНА ДЛЯ КЛИЕНТА', 'Значение': totals.client });
  totalRows.push({ 'Показатель': 'Маржинальность, %', 'Значение': totals.marginPct ?? '' });
  const ws2 = XLSX.utils.json_to_sheet(totalRows);
  XLSX.utils.book_append_sheet(wb, ws2, 'Итоги');

  const meta = [
    { 'Поле': 'Проект', 'Значение': p.name },
    { 'Поле': 'Клиент', 'Значение': p.client },
    { 'Поле': 'Дата', 'Значение': fmtDate(p.date) },
    { 'Поле': 'Прайс', 'Значение': p.pricebookName },
    { 'Поле': 'Комментарий', 'Значение': p.comment },
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(meta), 'Проект');

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  downloadFile(`${p.name || 'проект'} — внутренний расчёт.xlsx`, new Blob([out]), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

export function exportClientXlsx(p: Project) {
  const { lineCalcs, totals } = calcTotals(p.lines, p.settings);
  const rows = p.lines.map((l) => {
    const c = lineCalcs.get(l.id);
    return {
      'Наименование': l.name,
      'Кол-во': l.qty,
      'Ед.': l.unit ?? '',
      'Стоимость': c?.clientSum ?? '',
    };
  });
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Предложение');
  const t = [
    { 'Показатель': 'Итоговая стоимость', 'Значение': totals.client },
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(t), 'Итого');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  downloadFile(`${p.name || 'проект'} — коммерческое предложение.xlsx`, new Blob([out]), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

function csvEscape(v: unknown): string {
  const s = String(v ?? '');
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportInternalCsv(p: Project) {
  const { lineCalcs, totals } = calcTotals(p.lines, p.settings);
  const rows = internalRows(p, lineCalcs);
  if (rows.length === 0) return;
  const header = Object.keys(rows[0]);
  const lines = [header.join(';'), ...rows.map((r) => header.map((h) => csvEscape((r as Record<string, unknown>)[h])).join(';'))];
  lines.push('');
  lines.push(`ИТОГО СЕБЕСТОИМОСТЬ;${totals.cost}`);
  lines.push(`ЦЕНА ДЛЯ КЛИЕНТА;${totals.client}`);
  downloadFile(`${p.name || 'проект'} — расчёт.csv`, '\ufeff' + lines.join('\r\n'), 'text/csv;charset=utf-8');
}

export function exportProjectJson(p: Project) {
  downloadFile(`${p.name || 'проект'}.recept.json`, JSON.stringify(p, null, 1), 'application/json');
}
