import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientOfferDetail, ClientProjectSummary } from './clientOffer';
import { buildClientContractDocx, buildClientOfferDocx, buildClientReceiptDocx, buildClientSpecificationDocx, buildReceiptRows } from './clientPackage';
import { defaultSettings } from './storage';
import type { Project } from '../types';

const project: Project = {
  id: 'project-1',
  name: 'Кухня Иванов',
  client: 'Иванов И.И.',
  date: '2026-10-02',
  comment: '',
  status: 'draft',
  pricebookId: 'pb',
  pricebookName: 'Прайс',
  lines: [],
  settings: defaultSettings(),
  createdAt: '2026-10-02',
  updatedAt: '2026-10-02',
};

const details: ClientOfferDetail[] = [{
  id: 'hinge',
  kind: 'hinge',
  kindLabel: 'Петли',
  name: 'Петля Boyard 110',
  itemId: 'it_hinge',
  lineIds: ['l1'],
  qty: 6,
  qtyEffective: 6,
  unit: 'шт',
  priceBasis: 'unit',
  details: ['6 петель'],
  clientSum: 1200,
  hasUnpriced: false,
  sort: 30,
}];

const summary: ClientProjectSummary = {
  moduleCount: 2,
  facadeQty: 3,
  facadeAreaM2: 1.62,
  hingeQty: 6,
  hingeTypes: [{ name: 'Петля Boyard 110', qty: 6 }],
  bodyTotal: 18000,
  facadeTotal: 32000,
  hardwareTotal: 1200,
};

async function blobText(blob: Blob) {
  return new TextDecoder().decode(await blob.arrayBuffer());
}

function visibleDocxText(zipText: string): string {
  return Array.from(zipText.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g))
    .map((match) => match[1]
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&'))
    .join('');
}

describe('client document docx export', () => {
  afterEach(() => vi.restoreAllMocks());
  it('собирает Word-файлы КП, спецификации, договора и товарного чека как docx zip', async () => {
    const args = { project, offer: { sellerName: 'Мебельное ателье' }, details, modules: [], total: 51200, summary };
    const offer = await buildClientOfferDocx(args);
    const contract = await buildClientContractDocx(args);
    const specification = await buildClientSpecificationDocx(args);
    const receipt = await buildClientReceiptDocx(args);
    for (const blob of [offer, specification, contract, receipt]) {
      const text = await blobText(blob);
      expect(text.startsWith('PK')).toBe(true);
      expect(text).toContain('word/document.xml');
    }
    expect(await blobText(offer)).toContain('Коммерческое предложение');
    expect(await blobText(specification)).toContain('Спецификация клиентского КП');
    expect(await blobText(contract)).toContain('Договор на изготовление мебели');
    const receiptText = await blobText(receipt);
    expect(receiptText).toContain('Товарный чек');
    expect(receiptText).toContain('Наименование товара');
    expect(receiptText).toContain('Предоплата');
  });

  it('заполняет фирменный шаблон договора из public/templates/client', async () => {
    const bytes = await readFile(new URL('../../public/templates/client/contract-template.docx', import.meta.url));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(bytes));
    const contract = await buildClientContractDocx({
      project: { ...project, client: 'Петров Пётр' },
      offer: { contractNumber: '777', contractPrepayment: '50%', productionTerms: '30 рабочих дней' },
      details,
      modules: [],
      total: 100000,
      summary,
    });
    const text = visibleDocxText(await blobText(contract)).replace(/\u00a0/g, ' ');
    expect(text).toContain('Договор купли-продажи');
    expect(text).toContain('Петров Пётр');
    expect(text).toContain('100 000');
    expect(text).toContain('50 000');
    expect(text).toContain('30 рабочих дней');
  });
});

describe('построчный товарный чек', () => {
  const detail = (patch: Partial<ClientOfferDetail>): ClientOfferDetail => ({
    id: patch.id ?? 'd',
    kind: patch.kind ?? 'other',
    kindLabel: patch.kindLabel ?? 'Комплектация',
    name: patch.name ?? 'Позиция',
    itemId: patch.itemId ?? 'it',
    lineIds: ['l'],
    qty: patch.qty ?? 1,
    qtyEffective: patch.qtyEffective ?? patch.qty ?? 1,
    unit: patch.unit ?? 'шт',
    priceBasis: patch.priceBasis ?? 'unit',
    details: [],
    clientSum: patch.clientSum ?? 0,
    hasUnpriced: false,
    sort: patch.sort ?? 100,
  });

  const receiptArgs = {
    project,
    offer: {},
    details: [
      detail({ id: 'b', kind: 'body', kindLabel: 'Корпус', name: 'Корпус нижний 800', clientSum: 18000, qty: 2 }),
      detail({ id: 'f', kind: 'facade', kindLabel: 'Фасады', name: 'МДФ эмаль (матовая)', clientSum: 32000, qty: 6, unit: 'м²', priceBasis: 'm2' as const, qtyEffective: 4.2 }),
      detail({ id: 'h', kind: 'hinge', kindLabel: 'Петли', name: 'Blum 110 с доводчиком', clientSum: 6000, qty: 12 }),
    ],
    modules: [
      { title: 'Низ 800 под мойку', sub: '800×720×520 мм', qty: 1, total: 26000, bodyTotal: 10000 },
      { title: 'Низ 600 ящики', sub: '600×720×520 мм', qty: 1, total: 21000, bodyTotal: 8000 },
    ],
    total: 56000,
    summary,
  };

  it('перечисляет конкретные корпуса, фасады и фурнитуру и сходится с итогом', () => {
    const rows = buildReceiptRows(receiptArgs);
    const names = rows.map((row) => row.name);
    expect(names).toContain('Низ 800 под мойку, 800×720×520 мм');
    expect(names).toContain('Низ 600 ящики, 600×720×520 мм');
    expect(names).toContain('Фасады: МДФ эмаль (матовая)');
    expect(names).toContain('Петли: Blum 110 с доводчиком');
    // корпусные строки не задваиваются: сумма модулей равна корпусной части проекта
    expect(names).not.toContain('Корпусные элементы вне модулей');
    expect(names.some((name) => name.startsWith('Работы, доставка'))).toBe(false);
    expect(rows.reduce((sum, row) => sum + row.sum, 0)).toBe(56000);
  });

  it('добавляет строку работ, если итог больше суммы позиций', () => {
    const rows = buildReceiptRows({ ...receiptArgs, total: 64000 });
    const extra = rows.find((row) => row.name.startsWith('Работы, доставка'));
    expect(extra?.sum).toBe(8000);
    expect(rows.reduce((sum, row) => sum + row.sum, 0)).toBe(64000);
  });

  it('держит объём чека в рамках: много модулей схлопываются в одну строку остатка', () => {
    const manyModules = Array.from({ length: 40 }, (_, index) => ({
      title: `Модуль ${index + 1}`,
      sub: '600×720 мм',
      qty: 1,
      total: 1000,
      bodyTotal: 450,
    }));
    const rows = buildReceiptRows({ ...receiptArgs, modules: manyModules, total: 18000 + 38000 });
    expect(rows.filter((row) => row.name.startsWith('Модуль')).length).toBeLessThanOrEqual(18);
    expect(rows.some((row) => row.name.startsWith('Прочие корпуса по эскизу'))).toBe(true);
    expect(rows.length).toBeLessThanOrEqual(45);
  });

  it('показывает названия корпусов в самом файле чека', async () => {
    const text = visibleDocxText(await blobText(await buildClientReceiptDocx(receiptArgs)));
    expect(text).toContain('Низ 800 под мойку');
    expect(text).toContain('Петли: Blum 110 с доводчиком');
  });
});
