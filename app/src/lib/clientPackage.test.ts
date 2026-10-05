import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientOfferDetail, ClientProjectSummary } from './clientOffer';
import { buildClientContractDocx, buildClientOfferDocx, buildClientReceiptDocx, buildClientSpecificationDocx } from './clientPackage';
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
