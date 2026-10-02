import { describe, expect, it } from 'vitest';
import type { ClientOfferDetail, ClientProjectSummary } from './clientOffer';
import { buildClientContractDocx, buildClientOfferDocx, buildClientReceiptDocx } from './clientPackage';
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

describe('client document docx export', () => {
  it('собирает Word-файлы КП, договора и товарного чека как docx zip', async () => {
    const args = { project, offer: { sellerName: 'Мебельное ателье' }, details, modules: [], total: 51200, summary };
    const offer = await buildClientOfferDocx(args);
    const contract = await buildClientContractDocx(args);
    const receipt = await buildClientReceiptDocx(args);
    for (const blob of [offer, contract, receipt]) {
      const text = await blobText(blob);
      expect(text.startsWith('PK')).toBe(true);
      expect(text).toContain('word/document.xml');
    }
    expect(await blobText(offer)).toContain('Коммерческое предложение');
    expect(await blobText(contract)).toContain('Договор на изготовление мебели');
    expect(await blobText(receipt)).toContain('Товарный чек');
  });
});
