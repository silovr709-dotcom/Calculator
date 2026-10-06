import { inflateSync } from 'fflate';
import type { ClientDocumentPackageSettings, ClientOfferSettings, Project } from '../types';
import type { ClientOfferDetail, ClientOfferDetailKind, ClientProjectSummary } from './clientOffer';
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

const CLIENT_CONTRACT_TEMPLATE = 'templates/client/contract-template.docx';
const CLIENT_ORDER_BLANK_TEMPLATE = 'templates/client/order-blank-template.doc';

type ZipTemplateEntry = {
  name: string;
  nameBytes: Uint8Array;
  method: number;
  flags: number;
  time: number;
  date: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  compressedBytes: Uint8Array;
};

function publicUrl(path: string): string {
  const base = typeof import.meta !== 'undefined' ? (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/' : '/';
  return `${base}${path}`;
}

function isBrowserRuntime(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

async function fetchPublicBytes(path: string): Promise<Uint8Array> {
  if (typeof fetch !== 'function') throw new Error('fetch is not available');
  const res = await fetch(publicUrl(path));
  if (!res.ok) throw new Error(`template ${path} not found`);
  return new Uint8Array(await res.arrayBuffer());
}

function readU16(view: DataView, offset: number): number { return view.getUint16(offset, true); }
function readU32(view: DataView, offset: number): number { return view.getUint32(offset, true); }

function parseZipLocalEntries(bytes: Uint8Array): ZipTemplateEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries: ZipTemplateEntry[] = [];
  let offset = 0;
  while (offset + 30 <= bytes.length && readU32(view, offset) === 0x04034b50) {
    const flags = readU16(view, offset + 6);
    const method = readU16(view, offset + 8);
    const time = readU16(view, offset + 10);
    const date = readU16(view, offset + 12);
    const crc = readU32(view, offset + 14);
    const compressedSize = readU32(view, offset + 18);
    const uncompressedSize = readU32(view, offset + 22);
    const nameLength = readU16(view, offset + 26);
    const extraLength = readU16(view, offset + 28);
    if (flags & 0x0008) throw new Error('DOCX template uses unsupported data descriptors');
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    const nameBytes = bytes.slice(nameStart, nameStart + nameLength);
    const name = new TextDecoder().decode(nameBytes);
    entries.push({ name, nameBytes, method, flags, time, date, crc, compressedSize, uncompressedSize, compressedBytes: bytes.slice(dataStart, dataEnd) });
    offset = dataEnd;
  }
  return entries;
}

async function inflateZipEntry(entry: ZipTemplateEntry): Promise<Uint8Array> {
  if (entry.method === 0) return entry.compressedBytes;
  if (entry.method === 8) return inflateSync(entry.compressedBytes);
  throw new Error(`Unsupported DOCX compression method: ${entry.method}`);
}

function unxml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function replaceVisibleText(documentXml: string, replacements: { find: string; replace: string; occurrence?: number }[]): string {
  const tokenRegex = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
  const tokens: { contentStart: number; contentEnd: number; text: string }[] = [];
  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(documentXml))) {
    const contentStart = match.index + match[0].indexOf('>') + 1;
    tokens.push({ contentStart, contentEnd: contentStart + match[1].length, text: unxml(match[1]) });
  }
  const rebuildCombined = () => tokens.map((token) => token.text).join('');
  const replaceOnce = (find: string, replacement: string, occurrence = 1) => {
    if (!find) return;
    const combined = rebuildCombined();
    let index = -1;
    let from = 0;
    for (let i = 0; i < occurrence; i += 1) {
      index = combined.indexOf(find, from);
      if (index < 0) return;
      from = index + find.length;
    }
    const end = index + find.length;
    let cursor = 0;
    let first = -1;
    let last = -1;
    let startInFirst = 0;
    let endInLast = 0;
    for (let i = 0; i < tokens.length; i += 1) {
      const next = cursor + tokens[i].text.length;
      if (first < 0 && index >= cursor && index <= next) { first = i; startInFirst = index - cursor; }
      if (first >= 0 && end >= cursor && end <= next) { last = i; endInLast = end - cursor; break; }
      cursor = next;
    }
    if (first < 0 || last < 0) return;
    if (first === last) {
      const text = tokens[first].text;
      tokens[first].text = `${text.slice(0, startInFirst)}${replacement}${text.slice(endInLast)}`;
      return;
    }
    const firstText = tokens[first].text;
    const lastText = tokens[last].text;
    tokens[first].text = `${firstText.slice(0, startInFirst)}${replacement}`;
    for (let i = first + 1; i < last; i += 1) tokens[i].text = '';
    tokens[last].text = lastText.slice(endInLast);
  };
  for (const replacement of replacements) replaceOnce(replacement.find, replacement.replace, replacement.occurrence);

  let out = '';
  let lastOffset = 0;
  for (const token of tokens) {
    out += documentXml.slice(lastOffset, token.contentStart) + xml(token.text);
    lastOffset = token.contentEnd;
  }
  return out + documentXml.slice(lastOffset);
}

function formatContractDate(project: Project): string {
  const m = project.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : fmtDate(project.date);
}

function moneyDigits(value: number): string {
  return fmtMoney(value).replace(/\s*₽\s*$/u, '').trim();
}

function parseMoneyLike(value: string | undefined, total: number): number | null {
  const raw = value?.trim();
  if (!raw) return null;
  const pct = raw.match(/(\d+(?:[,.]\d+)?)\s*%/);
  if (pct) return total * Number(pct[1].replace(',', '.')) / 100;
  const numeric = raw.replace(/[^\d,.-]/g, '').replace(',', '.');
  const parsed = Number(numeric);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function contractPrepaymentText(offer: ClientOfferSettings, total: number): { text: string; amount: number | null } {
  const fromField = parseMoneyLike(offer.contractPrepayment, total);
  if (fromField != null) return { text: moneyDigits(fromField), amount: fromField };
  const fromPaymentTerms = parseMoneyLike(offer.paymentTerms, total);
  if (fromPaymentTerms != null) return { text: moneyDigits(fromPaymentTerms), amount: fromPaymentTerms };
  return { text: '________', amount: null };
}

function contractRemainderText(offer: ClientOfferSettings, total: number, prepayment: number | null): string {
  const fromField = parseMoneyLike(offer.contractRemainder, total);
  if (fromField != null) return moneyDigits(fromField);
  if (prepayment != null) return moneyDigits(Math.max(0, total - prepayment));
  return '________';
}

async function zipWithReplacedDocumentXml(templateBytes: Uint8Array, nextDocumentXml: string): Promise<Blob> {
  const entries = parseZipLocalEntries(templateBytes);
  const stamp = dosDateTime();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  const prepared: { nameBytes: Uint8Array; method: number; time: number; date: number; crc: number; compressedBytes: Uint8Array; uncompressedSize: number; offset: number }[] = [];
  let offset = 0;
  for (const entry of entries) {
    const isDocument = entry.name === 'word/document.xml';
    const payload = isDocument ? encoder.encode(nextDocumentXml) : entry.compressedBytes;
    const method = isDocument ? 0 : entry.method;
    const crc = isDocument ? crc32(payload) : entry.crc;
    const uncompressedSize = isDocument ? payload.length : entry.uncompressedSize;
    const time = isDocument ? stamp.time : entry.time;
    const date = isDocument ? stamp.date : entry.date;
    const flags = 0x0800;
    const localHeader = concat([
      u32(0x04034b50), u16(20), u16(flags), u16(method), u16(time), u16(date), u32(crc), u32(payload.length), u32(uncompressedSize), u16(entry.nameBytes.length), u16(0), entry.nameBytes,
    ]);
    prepared.push({ nameBytes: entry.nameBytes, method, time, date, crc, compressedBytes: payload, uncompressedSize, offset });
    localParts.push(localHeader, payload);
    offset += localHeader.length + payload.length;
  }
  const centralStart = offset;
  for (const entry of prepared) {
    centralParts.push(concat([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(entry.method), u16(entry.time), u16(entry.date), u32(entry.crc), u32(entry.compressedBytes.length), u32(entry.uncompressedSize), u16(entry.nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(entry.offset), entry.nameBytes,
    ]));
  }
  const central = concat(centralParts);
  const end = concat([u32(0x06054b50), u16(0), u16(0), u16(prepared.length), u16(prepared.length), u32(central.length), u32(centralStart), u16(0)]);
  const zipBytes = concat([...localParts, central, end]);
  const buffer = zipBytes.buffer.slice(zipBytes.byteOffset, zipBytes.byteOffset + zipBytes.byteLength) as ArrayBuffer;
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

async function buildClientContractFromTemplate(args: ClientDocumentArgs): Promise<Blob> {
  const templateBytes = await fetchPublicBytes(CLIENT_CONTRACT_TEMPLATE);
  const entries = parseZipLocalEntries(templateBytes);
  const documentEntry = entries.find((entry) => entry.name === 'word/document.xml');
  if (!documentEntry) throw new Error('word/document.xml not found in contract template');
  const originalXml = new TextDecoder().decode(await inflateZipEntry(documentEntry));
  const prepayment = contractPrepaymentText(args.offer, args.total);
  const remainder = contractRemainderText(args.offer, args.total, prepayment.amount);
  const clientName = args.project.client?.trim() || '_________________________________';
  const productionTerms = args.offer.productionTerms?.trim().replace(/^в\s+течени[еи]\s+/i, '') || 'сорока пяти рабочих дней';
  const replacements = [
    { find: '130', replace: contractNumber(args.project, args.offer) },
    { find: '27.07.2026', replace: formatContractDate(args.project) },
    { find: 'Деригина Татьяна Олеговна', replace: clientName },
    { find: '23 000', replace: moneyDigits(args.total) },
    { find: '________', replace: prepayment.text, occurrence: 1 },
    { find: '________', replace: remainder, occurrence: 1 },
    { find: 'сорока пяти рабочих дней', replace: productionTerms },
    ...(args.offer.warranty?.trim() ? [{ find: 'Гарантия 12месяцев', replace: `Гарантия ${args.offer.warranty.trim()}` }] : []),
    ...(args.offer.clientPassport?.trim() ? [{ find: '________________________________________________________________________', replace: args.offer.clientPassport.trim(), occurrence: 1 }] : []),
    ...(args.offer.clientAddress?.trim() ? [{ find: '____________________________________________________________________________', replace: args.offer.clientAddress.trim(), occurrence: 1 }] : []),
    ...(args.offer.clientPhone?.trim() ? [{ find: '____________________________________', replace: args.offer.clientPhone.trim(), occurrence: 1 }] : []),
    ...(args.offer.clientEmail?.trim() ? [{ find: '___________________________', replace: args.offer.clientEmail.trim(), occurrence: 1 }] : []),
  ];
  const documentXml = replaceVisibleText(originalXml, replacements);
  return zipWithReplacedDocumentXml(templateBytes, documentXml);
}

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
  return offer.sellerName?.trim() || 'ИП Шилова Е.В.';
}

function sellerDetails(offer: ClientOfferSettings): string {
  return offer.sellerDetails?.trim() || 'Телефон: +7 (910) 835-17-49';
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

const CLIENT_CATEGORY_ORDER: ClientOfferDetailKind[] = ['body', 'bodySurcharge', 'facade', 'frame', 'worktop', 'wallPanel', 'hinge', 'drawerSys', 'lift', 'handle', 'legs', 'shelf', 'sink', 'electric', 'other'];
const CLIENT_CATEGORY_ORDER_INDEX = new Map<ClientOfferDetailKind, number>(CLIENT_CATEGORY_ORDER.map((kind, index) => [kind, index]));

function compactCategoryRows(details: ClientOfferDetail[]): string[][] {
  const byKind = new Map<ClientOfferDetailKind, ClientOfferDetail[]>();
  for (const detail of details) {
    const bucket = byKind.get(detail.kind) ?? [];
    bucket.push(detail);
    byKind.set(detail.kind, bucket);
  }
  return Array.from(byKind.entries())
    .sort(([a], [b]) => (CLIENT_CATEGORY_ORDER_INDEX.get(a) ?? 999) - (CLIENT_CATEGORY_ORDER_INDEX.get(b) ?? 999))
    .map(([, items], index) => {
      const label = items[0]?.kindLabel ?? 'Комплектация';
      const composition = items
        .slice(0, 5)
        .map((detail) => `${detail.name} — ${detailQtyText(detail)}`)
        .join('\n');
      const hidden = items.length > 5 ? `\nещё ${items.length - 5} поз.` : '';
      const qty = `${items.length} поз.`;
      const sum = items.reduce((acc, detail) => acc + (detail.clientSum ?? 0), 0);
      return [String(index + 1), label, `${composition}${hidden}`, qty, fmtMoney(sum)];
    });
}

function detailRows(details: ClientOfferDetail[]): string[][] {
  return details.map((detail, index) => [String(index + 1), detail.kindLabel, [detail.name, detail.details.slice(0, 4).join('; ')].filter(Boolean).join('\n'), detailQtyText(detail), fmtMoney(detail.clientSum)]);
}

function offerBlocks(args: ClientDocumentArgs): DocxBlock[] {
  const { project, offer, details, modules, total, summary } = args;
  const blocks: DocxBlock[] = [
    p('Коммерческое предложение', { bold: true, size: 22, color: '0F2F57' }),
    p(`${project.name}\nКлиент: ${project.client || '—'} · Дата: ${fmtDate(project.date)} · № договора: ${contractNumber(project, offer)}`, { size: 11, color: '52667A' }),
    p(`Итоговая стоимость: ${fmtMoney(total)}`, { bold: true, size: 16, color: '1F6FEB' }),
    table(['Показатель', 'Значение'], [
      ['Модулей', `${fmtNum(summary.moduleCount, 3)} шт`],
      ['Фасады, площадь/шт', summary.facadeAreaM2 > 0 ? `${fmtNum(summary.facadeAreaM2, 2)} м² / ${fmtNum(summary.facadeQty, 3)} шт` : `${fmtNum(summary.facadeQty, 3)} шт`],
      ['Петли', `${fmtNum(summary.hingeQty, 3)} шт${summary.hingeTypes.length ? `: ${summary.hingeTypes.map((item) => `${item.name} — ${fmtNum(item.qty, 3)} шт`).join('; ')}` : ''}`],
      ['Корпуса, сумма', fmtMoney(summary.bodyTotal)],
      ['Фасады, сумма', fmtMoney(summary.facadeTotal)],
      ['Фурнитура, сумма', fmtMoney(summary.hardwareTotal)],
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
  if (offer.moduleDetailMode === 'full') {
    blocks.push(table(['№', 'Категория', 'Позиция', 'Кол-во', 'Сумма'], detailRows(details)));
  } else {
    blocks.push(p('Компактная сводка: повторяющаяся фурнитура и однотипные позиции собраны по проекту, чтобы КП без эскизов оставалось в 2–3 страницы.', { size: 10, color: '52667A' }));
    blocks.push(table(['№', 'Категория', 'Основной состав', 'Строк', 'Сумма'], compactCategoryRows(details)));
  }
  if (offer.notes) blocks.push(p(`Примечания:\n${offer.notes}`, { size: 11 }));
  return blocks;
}

function specificationBlocks(args: ClientDocumentArgs): DocxBlock[] {
  const { project, details, modules, total, summary } = args;
  const categoryRows = detailRows(details);
  const summaryRows = [
    ['Модулей', `${fmtNum(summary.moduleCount, 3)} шт`],
    ['Фасады, площадь/шт', summary.facadeAreaM2 > 0 ? `${fmtNum(summary.facadeAreaM2, 2)} м² / ${fmtNum(summary.facadeQty, 3)} шт` : `${fmtNum(summary.facadeQty, 3)} шт`],
    ['Петли', `${fmtNum(summary.hingeQty, 3)} шт${summary.hingeTypes.length ? `: ${summary.hingeTypes.map((item) => `${item.name} — ${fmtNum(item.qty, 3)} шт`).join('; ')}` : ''}`],
    ['Корпуса, сумма', fmtMoney(summary.bodyTotal)],
    ['Фасады, сумма', fmtMoney(summary.facadeTotal)],
    ['Фурнитура, сумма', fmtMoney(summary.hardwareTotal)],
    ['Итого по КП', fmtMoney(total)],
  ];
  const blocks: DocxBlock[] = [
    p('Спецификация клиентского КП', { bold: true, size: 20, color: '0F2F57' }),
    p(`${project.name}\nКлиент: ${project.client || '—'} · Дата: ${fmtDate(project.date)}`, { size: 11, color: '52667A' }),
    p('Компактный перечень состава без внутренних закупочных цен. Фурнитура сгруппирована общими строками, чтобы не повторять её в каждом модуле.', { size: 11 }),
    table(['Показатель', 'Значение'], summaryRows),
  ];
  if (modules.length) {
    blocks.push(p('Модули', { bold: true, size: 14, color: '0F2F57' }));
    blocks.push(table(['№', 'Модуль', 'Описание', 'Кол-во', 'Сумма'], modules.map((module, index) => [String(index + 1), module.title, module.sub || '', fmtNum(module.qty, 3), fmtMoney(module.total)])));
  }
  if (categoryRows.length) {
    blocks.push(p('Состав по категориям', { bold: true, size: 14, color: '0F2F57' }));
    blocks.push(table(['№', 'Категория', 'Позиция', 'Кол-во', 'Сумма'], categoryRows));
  }
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
    p('Форма подготовлена по данным проекта. Для рабочей выгрузки в браузере используется фирменный шаблон договора из templates/client.', { size: 10, color: '64748B' }),
  ];
}

function receiptBlocks(args: ClientDocumentArgs): DocxBlock[] {
  const { project, offer, total, summary } = args;
  const prepayment = contractPrepaymentText(offer, total);
  const remainder = contractRemainderText(offer, total, prepayment.amount);
  const knownTotal = summary.bodyTotal + summary.facadeTotal + summary.hardwareTotal;
  const extraTotal = Math.max(0, total - knownTotal);
  const rows = [
    summary.bodyTotal > 0 ? ['1', `Корпуса и каркас по проекту «${project.name}», согласно эскизу`, fmtMoney(summary.bodyTotal), '1', fmtMoney(summary.bodyTotal)] : null,
    summary.facadeTotal > 0 ? ['2', `Фасады${summary.facadeAreaM2 > 0 ? ` — ${fmtNum(summary.facadeAreaM2, 2)} м²` : ''}, согласно эскизу`, fmtMoney(summary.facadeTotal), '1', fmtMoney(summary.facadeTotal)] : null,
    summary.hardwareTotal > 0 ? ['3', 'Фурнитура и механизмы по проекту', fmtMoney(summary.hardwareTotal), '1', fmtMoney(summary.hardwareTotal)] : null,
    extraTotal > 0 ? ['4', 'Столешницы, работы и дополнительные позиции', fmtMoney(extraTotal), '1', fmtMoney(extraTotal)] : null,
  ].filter((row): row is string[] => Boolean(row));
  const productRows = rows.length ? rows : [['1', `Комплект мебели по проекту «${project.name}», согласно эскизу`, fmtMoney(total), '1', fmtMoney(total)]];
  return [
    p(`Товарный чек № ${contractNumber(project, offer)}`, { bold: true, size: 20, color: '0F2F57' }),
    p(`от ${formatContractDate(project)}`, { size: 11, color: '52667A' }),
    p(`Продавец: ${sellerName(offer)}\n${sellerDetails(offer)}\nПокупатель: ${project.client || '_________________________________'}\nАдрес доставки: ${offer.clientAddress || offer.clientContacts || '_________________________________'}`),
    table(['№', 'Наименование товара', 'Цена', 'Кол-во', 'Сумма'], [...productRows, ['', 'Итого', '', '', fmtMoney(total)]]),
    table(['Оплата', 'Сумма'], [
      ['Предоплата / задаток', `${prepayment.text} руб.`],
      ['Доплата', `${remainder} руб.`],
    ]),
    p(`Телефон покупателя: ${offer.clientPhone || '____________________________________'}\nE-mail: ${offer.clientEmail || '____________________________________'}`, { size: 11 }),
    p('Подпись Продавца ____________________          Подпись Покупателя ____________________', { size: 11 }),
  ];
}

export async function buildClientOfferDocx(args: ClientDocumentArgs): Promise<Blob> {
  return docxBlob(`${args.project.name} — полное КП`, offerBlocks(args));
}

export async function buildClientSpecificationDocx(args: ClientDocumentArgs): Promise<Blob> {
  return docxBlob(`${args.project.name} — спецификация`, specificationBlocks(args));
}

export async function buildClientContractDocx(args: ClientDocumentArgs): Promise<Blob> {
  try {
    return await buildClientContractFromTemplate(args);
  } catch (error) {
    if (isBrowserRuntime()) throw new Error(`Фирменный шаблон договора не загрузился: ${error instanceof Error ? error.message : String(error)}`);
    return docxBlob(`${args.project.name} — договор`, contractBlocks(args));
  }
}

export async function buildClientReceiptDocx(args: ClientDocumentArgs): Promise<Blob> {
  return docxBlob(`${args.project.name} — товарный чек`, receiptBlocks(args));
}

export async function buildClientOrderBlankDoc(args: ClientDocumentArgs): Promise<Blob> {
  try {
    const bytes = await fetchPublicBytes(CLIENT_ORDER_BLANK_TEMPLATE);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return new Blob([buffer], { type: 'application/msword' });
  } catch {
    return docxBlob(`${args.project.name} — бланк заказа`, receiptBlocks(args));
  }
}

export async function downloadClientOfferDocx(args: ClientDocumentArgs): Promise<void> {
  downloadFile(`${safeFilePart(args.project.name)} — полное КП.docx`, await buildClientOfferDocx(args));
}

export async function downloadClientSpecificationDocx(args: ClientDocumentArgs): Promise<void> {
  downloadFile(`${safeFilePart(args.project.name)} — спецификация.docx`, await buildClientSpecificationDocx(args));
}

export async function downloadClientContractDocx(args: ClientDocumentArgs): Promise<void> {
  downloadFile(`${safeFilePart(args.project.name)} — договор.docx`, await buildClientContractDocx(args));
}

export async function downloadClientReceiptDocx(args: ClientDocumentArgs): Promise<void> {
  downloadFile(`${safeFilePart(args.project.name)} — товарный чек.docx`, await buildClientReceiptDocx(args));
}

export async function downloadClientOrderBlankDoc(args: ClientDocumentArgs): Promise<void> {
  downloadFile(`${safeFilePart(args.project.name)} — бланк заказа.doc`, await buildClientOrderBlankDoc(args));
}

export async function downloadClientDocumentZip(args: ClientDocumentArgs, sketchFiles: ClientPackageSketchFile[] = []): Promise<void> {
  const settings = normalizeClientDocumentPackage(args.offer.documentPackage);
  const files: ZipInput[] = [];
  if (settings.includeOffer) files.push({ name: `${safeFilePart(args.project.name)} — полное КП.docx`, data: await buildClientOfferDocx(args) });
  if (settings.includeSpecification) files.push({ name: `${safeFilePart(args.project.name)} — спецификация.docx`, data: await buildClientSpecificationDocx(args) });
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
