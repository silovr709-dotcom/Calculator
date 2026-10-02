import type { ClientDocumentPackageSettings, ClientOfferSettings, Project } from '../types';
import type { ClientOfferDetail, ClientProjectSummary } from './clientOffer';
import { fmtDate, fmtMoney, fmtNum } from './format';
import { downloadFile } from './storage';

export interface ClientPackageModuleRow {
  title: string;
  sub?: string;
  qty: number;
  total: number | null;
}

export interface ClientPackageSketchFile {
  title: string;
  fileName: string;
  blob: Blob;
}

export interface ClientDocumentArgs {
  project: Project;
  offer: ClientOfferSettings;
  details: ClientOfferDetail[];
  modules: ClientPackageModuleRow[];
  total: number;
  summary: ClientProjectSummary;
}

export type NormalizedClientDocumentPackageSettings = Required<ClientDocumentPackageSettings>;

type DocxBlock = { type: 'p'; text: string; bold?: boolean; size?: number; color?: string } | { type: 'table'; headers: string[]; rows: string[][] };
type ZipInput = { name: string; data: string | Uint8Array | Blob };
type PreparedZipInput = { nameBytes: Uint8Array; dataBytes: Uint8Array; crc: number; offset: number };

export function normalizeClientDocumentPackage(settings?: ClientDocumentPackageSettings): NormalizedClientDocumentPackageSettings {
  return {
    includeOffer: settings?.includeOffer !== false,
    includeSketch: settings?.includeSketch !== false,
    includeSpecification: settings?.includeSpecification !== false,
    includeContract: settings?.includeContract !== false,
    includeReceipt: settings?.includeReceipt !== false,
    compact: settings?.compact !== false,
    sketchSummaryOverlay: settings?.sketchSummaryOverlay !== false,
  };
}

const encoder = new TextEncoder();

function xml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function safeFilePart(value: string): string {
  return (value || 'document')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90) || 'document';
}

function sellerName(offer: ClientOfferSettings): string {
  return offer.sellerName?.trim() || 'Исполнитель / мебельное ателье';
}

function contractNumber(project: Project, offer: ClientOfferSettings): string {
  return offer.contractNumber?.trim() || project.id.slice(0, 8).toUpperCase();
}

function detailQtyText(detail: ClientOfferDetail): string {
  const unit = detail.unit || 'шт';
  if (detail.priceBasis === 'm2' || detail.priceBasis === 'lm') {
    const pieces = detail.qty > 0 ? `${fmtNum(detail.qty, 3)} шт` : '';
    const measured = `${fmtNum(detail.qtyEffective, 4)} ${unit}`;
    return pieces ? `${pieces} / ${measured}` : measured;
  }
  if (detail.priceBasis === 'sheet') return `${fmtNum(detail.qtyEffective, 3)} ${unit}`;
  if (detail.kind === 'bodySurcharge') return `${fmtNum(detail.qty, 3)} доп.`;
  return `${fmtNum(detail.qtyEffective, 3)} ${unit}`;
}

function p(text: string, opts: { bold?: boolean; size?: number; color?: string } = {}): DocxBlock {
  return { type: 'p', text, ...opts };
}

function table(headers: string[], rows: string[][]): DocxBlock {
  return { type: 'table', headers, rows };
}

function paragraphXml(block: Extract<DocxBlock, { type: 'p' }>): string {
  const lines = String(block.text ?? '').split('\n');
  const size = block.size ? `<w:sz w:val="${Math.round(block.size * 2)}"/><w:szCs w:val="${Math.round(block.size * 2)}"/>` : '';
  const bold = block.bold ? '<w:b/><w:bCs/>' : '';
  const color = block.color ? `<w:color w:val="${xml(block.color).replace(/^#/, '')}"/>` : '';
  const rPr = bold || size || color ? `<w:rPr>${bold}${size}${color}</w:rPr>` : '';
  return `<w:p><w:r>${rPr}${lines.map((line, index) => `${index ? '<w:br/>' : ''}<w:t xml:space="preserve">${xml(line)}</w:t>`).join('')}</w:r></w:p>`;
}

function cellXml(value: string, header = false): string {
  const fill = header ? '<w:shd w:fill="EAF2FF"/>' : '';
  const bold = header ? '<w:b/><w:bCs/>' : '';
  return `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/>${fill}</w:tcPr><w:p><w:r>${bold ? `<w:rPr>${bold}</w:rPr>` : ''}<w:t xml:space="preserve">${xml(value)}</w:t></w:r></w:p></w:tc>`;
}

function tableXml(block: Extract<DocxBlock, { type: 'table' }>): string {
  const borders = '<w:tblBorders><w:top w:val="single" w:sz="4" w:color="D7E4EF"/><w:left w:val="single" w:sz="4" w:color="D7E4EF"/><w:bottom w:val="single" w:sz="4" w:color="D7E4EF"/><w:right w:val="single" w:sz="4" w:color="D7E4EF"/><w:insideH w:val="single" w:sz="4" w:color="D7E4EF"/><w:insideV w:val="single" w:sz="4" w:color="D7E4EF"/></w:tblBorders>';
  const rows = [block.headers, ...block.rows];
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>${borders}</w:tblPr>${rows.map((row, rowIndex) => `<w:tr>${row.map((value) => cellXml(value, rowIndex === 0)).join('')}</w:tr>`).join('')}</w:tbl>`;
}

function documentXml(blocks: DocxBlock[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
${blocks.map((block) => block.type === 'p' ? paragraphXml(block) : tableXml(block)).join('\n')}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="850" w:right="850" w:bottom="850" w:left="850" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>
</w:body></w:document>`;
}

function coreXml(title: string): string {
  const now = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(title)}</dc:title><dc:creator>РЕцепт</dc:creator><cp:lastModifiedBy>РЕцепт</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
}

async function docxBlob(title: string, blocks: DocxBlock[]): Promise<Blob> {
  return zipFiles([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>' },
    { name: 'docProps/core.xml', data: coreXml(title) },
    { name: 'docProps/app.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>РЕцепт</Application></Properties>' },
    { name: 'word/_rels/document.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>' },
    { name: 'word/document.xml', data: documentXml(blocks) },
  ], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}

function offerBlocks(args: ClientDocumentArgs): DocxBlock[] {
  const { project, offer, details, modules, total, summary } = args;
  const blocks: DocxBlock[] = [
    p('Коммерческое предложение', { bold: true, size: 22, color: '0F2F57' }),
    p(`${project.name}\nКлиент: ${project.client || '—'} · Дата: ${fmtDate(project.date)} · № договора: ${contractNumber(project, offer)}`, { size: 11, color: '52667A' }),
    p(`Итоговая стоимость: ${fmtMoney(total)}`, { bold: true, size: 16, color: '1F6FEB' }),
    table(['Показатель', 'Значение'], [
      ['Модулей', `${fmtNum(summary.moduleCount, 3)} шт`],
      ['Фасады', summary.facadeAreaM2 > 0 ? `${fmtNum(summary.facadeAreaM2, 2)} м² / ${fmtNum(summary.facadeQty, 3)} шт` : `${fmtNum(summary.facadeQty, 3)} шт`],
      ['Петли', `${fmtNum(summary.hingeQty, 3)} шт${summary.hingeTypes.length ? `: ${summary.hingeTypes.map((item) => `${item.name} — ${fmtNum(item.qty, 3)} шт`).join('; ')}` : ''}`],
      ['Корпуса общ.', fmtMoney(summary.bodyTotal)],
      ['Фасады общ.', fmtMoney(summary.facadeTotal)],
      ['Фурнитура общ.', fmtMoney(summary.hardwareTotal)],
    ]),
    p('Условия', { bold: true, size: 14, color: '0F2F57' }),
    table(['Пункт', 'Значение'], [
      ['Действительно до', offer.validUntil ? fmtDate(offer.validUntil) : 'не указано'],
      ['Оплата', offer.paymentTerms || 'по согласованию'],
      ['Монтаж', offer.installation || 'по согласованию'],
      ['Доставка', offer.delivery || 'по согласованию'],
    ]),
  ];
  if (modules.length) {
    blocks.push(p('Модули', { bold: true, size: 14, color: '0F2F57' }));
    blocks.push(table(['№', 'Модуль', 'Описание', 'Кол-во', 'Сумма'], modules.map((module, index) => [String(index + 1), module.title, module.sub || '', fmtNum(module.qty, 3), fmtMoney(module.total)])));
  }
  blocks.push(p('Состав по категориям', { bold: true, size: 14, color: '0F2F57' }));
  blocks.push(table(['№', 'Категория', 'Позиция', 'Кол-во', 'Сумма'], details.map((detail, index) => [String(index + 1), detail.kindLabel, [detail.name, detail.details.slice(0, 4).join('; ')].filter(Boolean).join('\n'), detailQtyText(detail), fmtMoney(detail.clientSum)])));
  if (offer.notes) blocks.push(p(`Примечания:\n${offer.notes}`, { size: 11 }));
  return blocks;
}

function contractBlocks(args: ClientDocumentArgs): DocxBlock[] {
  const { project, offer, total } = args;
  return [
    p('Договор на изготовление мебели', { bold: true, size: 20, color: '0F2F57' }),
    p(`№ ${contractNumber(project, offer)} · ${offer.contractCity?.trim() || '__________'} · ${fmtDate(project.date)}`, { size: 11, color: '52667A' }),
    p(`Исполнитель: ${sellerName(offer)}\n${offer.sellerDetails || ''}\nЗаказчик: ${project.client || '—'}\n${offer.clientContacts || ''}`),
    p('1. Предмет договора', { bold: true, size: 14, color: '0F2F57' }),
    p('Исполнитель обязуется изготовить и/или укомплектовать мебельное изделие по согласованному эскизу, спецификации и коммерческому предложению, а Заказчик обязуется принять изделие и оплатить его.'),
    p('2. Стоимость и порядок оплаты', { bold: true, size: 14, color: '0F2F57' }),
    p(`Предварительная стоимость комплекта составляет ${fmtMoney(total)}. Условия оплаты: ${offer.paymentTerms || 'по согласованию'}. Изменение размеров, материалов, фурнитуры или состава оформляется пересчётом либо дополнительным соглашением.`),
    p('3. Сроки, доставка и монтаж', { bold: true, size: 14, color: '0F2F57' }),
    p(`Срок изготовления: ${offer.productionTerms || 'согласуется после утверждения размеров и материалов'}. Доставка: ${offer.delivery || 'по согласованию'}. Монтаж: ${offer.installation || 'по согласованию'}.`),
    p('4. Приёмка и гарантия', { bold: true, size: 14, color: '0F2F57' }),
    p(`Заказчик проверяет комплектность и внешний вид при передаче. Гарантия: ${offer.warranty || '12 месяцев, если иное не указано в приложениях'}.`),
    p('Подписи сторон', { bold: true, size: 14, color: '0F2F57' }),
    table(['Исполнитель', 'Заказчик'], [['__________________________', '__________________________']]),
    p('Примечание: это типовой черновик. После загрузки ваших документов заменим его на фирменный шаблон.', { size: 10, color: '64748B' }),
  ];
}

function receiptBlocks(args: ClientDocumentArgs): DocxBlock[] {
  const { project, offer, total, summary } = args;
  const rows = [
    ['Комплект мебели по проекту', '1 комплект', fmtMoney(total)],
    summary.bodyTotal > 0 ? ['Корпуса / каркасная часть', 'общ.', fmtMoney(summary.bodyTotal)] : null,
    summary.facadeTotal > 0 ? ['Фасады / рамки', summary.facadeAreaM2 > 0 ? `${fmtNum(summary.facadeAreaM2, 2)} м²` : `${fmtNum(summary.facadeQty, 3)} шт`, fmtMoney(summary.facadeTotal)] : null,
    summary.hardwareTotal > 0 ? ['Фурнитура', 'общ.', fmtMoney(summary.hardwareTotal)] : null,
  ].filter((row): row is string[] => Boolean(row));
  return [
    p('Товарный чек', { bold: true, size: 20, color: '0F2F57' }),
    p(`Продавец: ${sellerName(offer)}\n${offer.sellerDetails || ''}\nПокупатель: ${project.client || '—'}\nПроект: ${project.name}\nДата: ${fmtDate(project.date)}`),
    table(['Наименование', 'Кол-во', 'Сумма'], [...rows, ['Итого', '', fmtMoney(total)]]),
    p('Продавец ____________________________      Покупатель ____________________________', { size: 11 }),
  ];
}

export async function buildClientOfferDocx(args: ClientDocumentArgs): Promise<Blob> {
  return docxBlob(`${args.project.name} — полное КП`, offerBlocks(args));
}

export async function buildClientContractDocx(args: ClientDocumentArgs): Promise<Blob> {
  return docxBlob(`${args.project.name} — договор`, contractBlocks(args));
}

export async function buildClientReceiptDocx(args: ClientDocumentArgs): Promise<Blob> {
  return docxBlob(`${args.project.name} — товарный чек`, receiptBlocks(args));
}

export async function downloadClientOfferDocx(args: ClientDocumentArgs): Promise<void> {
  downloadFile(`${safeFilePart(args.project.name)} — полное КП.docx`, await buildClientOfferDocx(args));
}

export async function downloadClientContractDocx(args: ClientDocumentArgs): Promise<void> {
  downloadFile(`${safeFilePart(args.project.name)} — договор.docx`, await buildClientContractDocx(args));
}

export async function downloadClientReceiptDocx(args: ClientDocumentArgs): Promise<void> {
  downloadFile(`${safeFilePart(args.project.name)} — товарный чек.docx`, await buildClientReceiptDocx(args));
}

export async function downloadClientDocumentZip(args: ClientDocumentArgs, sketchFiles: ClientPackageSketchFile[] = []): Promise<void> {
  const settings = normalizeClientDocumentPackage(args.offer.documentPackage);
  const files: ZipInput[] = [];
  if (settings.includeOffer || settings.includeSpecification) files.push({ name: `${safeFilePart(args.project.name)} — полное КП.docx`, data: await buildClientOfferDocx(args) });
  if (settings.includeContract) files.push({ name: `${safeFilePart(args.project.name)} — договор.docx`, data: await buildClientContractDocx(args) });
  if (settings.includeReceipt) files.push({ name: `${safeFilePart(args.project.name)} — товарный чек.docx`, data: await buildClientReceiptDocx(args) });
  if (settings.includeSketch) files.push(...sketchFiles.map((file, index) => ({ name: file.fileName || `Эскиз ${index + 1} — ${safeFilePart(file.title)}.pdf`, data: file.blob })));
  downloadFile(`${safeFilePart(args.project.name)} — пакет клиента.zip`, await zipFiles(files, 'application/zip'));
}

const CRC_TABLE = (() => {
  const tableValues = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tableValues[n] = c >>> 0;
  }
  return tableValues;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function dataBytes(data: string | Uint8Array | Blob): Promise<Uint8Array> {
  if (typeof data === 'string') return encoder.encode(data);
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(await data.arrayBuffer());
}

function dosDateTime(date = new Date()): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function u16(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
}

function u32(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

async function zipFiles(files: ZipInput[], mime = 'application/zip'): Promise<Blob> {
  const prepared: PreparedZipInput[] = [];
  const localParts: Uint8Array[] = [];
  let offset = 0;
  const stamp = dosDateTime();
  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const bytes = await dataBytes(file.data);
    const crc = crc32(bytes);
    const localHeader = concat([
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(stamp.time), u16(stamp.date), u32(crc), u32(bytes.length), u32(bytes.length), u16(nameBytes.length), u16(0), nameBytes,
    ]);
    prepared.push({ nameBytes, dataBytes: bytes, crc, offset });
    localParts.push(localHeader, bytes);
    offset += localHeader.length + bytes.length;
  }
  const centralStart = offset;
  const centralParts: Uint8Array[] = [];
  for (const file of prepared) {
    centralParts.push(concat([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(stamp.time), u16(stamp.date), u32(file.crc), u32(file.dataBytes.length), u32(file.dataBytes.length), u16(file.nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(file.offset), file.nameBytes,
    ]));
  }
  const central = concat(centralParts);
  const end = concat([u32(0x06054b50), u16(0), u16(0), u16(prepared.length), u16(prepared.length), u32(central.length), u32(centralStart), u16(0)]);
  const zipBytes = concat([...localParts, central, end]);
  const buffer = zipBytes.buffer.slice(zipBytes.byteOffset, zipBytes.byteOffset + zipBytes.byteLength) as ArrayBuffer;
  return new Blob([buffer], { type: mime });
}
