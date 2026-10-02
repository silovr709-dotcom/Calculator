import type { ClientDocumentPackageSettings, ClientOfferSettings, Project } from '../types';
import type { ClientOfferDetail, ClientProjectSummary } from './clientOffer';
import { clientSketchSummaryLines } from './clientOffer';
import { fmtDate, fmtMoney, fmtNum } from './format';
import { downloadFile } from './storage';

export interface ClientPackageModuleRow {
  title: string;
  sub?: string;
  qty: number;
  total: number | null;
}

export interface ClientPackageSketchImage {
  title: string;
  imageDataUrl: string;
}

export interface ClientPackageHtmlArgs {
  project: Project;
  offer: ClientOfferSettings;
  details: ClientOfferDetail[];
  modules: ClientPackageModuleRow[];
  total: number;
  summary: ClientProjectSummary;
  sketches: ClientPackageSketchImage[];
}

export type NormalizedClientDocumentPackageSettings = Required<ClientDocumentPackageSettings>;

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

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function nl2br(value: unknown): string {
  return escapeHtml(value).replace(/\n/g, '<br>');
}

function safeFilePart(value: string): string {
  return (value || 'client-package')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90) || 'client-package';
}

function includeSettings(offer: ClientOfferSettings): NormalizedClientDocumentPackageSettings {
  return normalizeClientDocumentPackage(offer.documentPackage);
}

function sellerName(offer: ClientOfferSettings): string {
  return offer.sellerName?.trim() || 'Исполнитель / мебельное ателье';
}

function contractNumber(project: Project, offer: ClientOfferSettings): string {
  return offer.contractNumber?.trim() || project.id.slice(0, 8).toUpperCase();
}

function packageStyles(compact: boolean): string {
  return `
    @page { size: A4; margin: 12mm; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #eef3f8; color: #172033; font-family: Inter, Arial, sans-serif; }
    .pack { max-width: 980px; margin: 0 auto; padding: 22px; }
    .sheet { background: #fff; border: 1px solid #d9e4ef; border-radius: 18px; padding: ${compact ? 18 : 24}px; margin: 0 0 14px; box-shadow: 0 12px 30px rgba(15, 47, 87, .08); page-break-inside: avoid; }
    .hero { display: grid; grid-template-columns: 1fr 230px; gap: 18px; align-items: stretch; color: #fff; background: linear-gradient(135deg, #0f2f57, #164a7c 60%, #1f6feb); border: 0; }
    h1, h2, h3 { margin: 0; }
    h1 { font-size: 28px; line-height: 1.05; }
    h2 { font-size: 18px; color: #0f2f57; margin-bottom: 10px; }
    h3 { font-size: 13px; color: #12385f; margin-bottom: 6px; }
    .muted { color: #64748b; }
    .brand { font-size: 25px; font-weight: 900; letter-spacing: -.03em; }
    .sub { opacity: .78; font-size: 12px; margin-top: 2px; }
    .hero h1 { margin-top: 18px; }
    .meta { display: flex; flex-wrap: wrap; gap: 6px 12px; margin-top: 12px; font-size: 12px; opacity: .9; }
    .price { display: flex; flex-direction: column; justify-content: center; text-align: right; padding: 18px; border-radius: 14px; background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.22); }
    .price span { font-size: 11px; opacity: .78; }
    .price b { font-size: 25px; }
    .facts { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 10px; }
    .facts div { border: 1px solid #dce7f2; border-radius: 12px; padding: 9px; background: #f8fbff; }
    .facts b { display: block; color: #0f2f57; font-size: 17px; }
    .facts span { color: #64748b; font-size: 10.5px; }
    .terms { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
    .terms div, .sign-box { border: 1px solid #dfe8f2; border-radius: 10px; padding: 8px; background: #fbfdff; }
    .terms b { display: block; color: #41566d; font-size: 11px; margin-bottom: 2px; }
    .chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 10px; }
    .chips span { padding: 4px 8px; border-radius: 999px; background: #edf6ff; color: #0f4f8f; font-size: 11px; font-weight: 800; }
    .sketch-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 10px; }
    .sketch { position: relative; border: 1px solid #d9e4ef; border-radius: 14px; overflow: hidden; background: #fff; page-break-inside: avoid; }
    .sketch header { padding: 8px 10px; background: #f6faff; border-bottom: 1px solid #d9e4ef; font-size: 12px; font-weight: 900; color: #0f2f57; }
    .sketch img { display: block; width: 100%; height: auto; }
    .overlay { position: absolute; right: 10px; bottom: 10px; max-width: min(360px, 72%); padding: 9px 10px; border-radius: 12px; background: rgba(255,255,255,.94); border: 1px solid rgba(15,47,87,.22); box-shadow: 0 8px 24px rgba(15,47,87,.16); color: #0f2f57; font-size: 10.5px; line-height: 1.25; }
    .overlay b { display: block; margin-bottom: 4px; font-size: 11px; }
    .overlay span { display: block; }
    table { width: 100%; border-collapse: collapse; font-size: ${compact ? 10.5 : 11.5}px; }
    th, td { border: 1px solid #e1e8f0; padding: ${compact ? 5 : 7}px; vertical-align: top; }
    th { background: #f3f7fb; color: #0f2f57; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
    td.num, th.num { text-align: right; white-space: nowrap; }
    .doc-text { color: #27364a; font-size: ${compact ? 11 : 12}px; line-height: 1.45; }
    .doc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 18px; }
    .sign-line { margin-top: 28px; border-top: 1px solid #9aa9bb; padding-top: 5px; color: #64748b; font-size: 10px; }
    .small-note { margin-top: 8px; color: #64748b; font-size: 10px; }
    @media print { body { background: #fff; } .pack { padding: 0; max-width: none; } .sheet { box-shadow: none; border-radius: 0; } }
    @media (max-width: 760px) { .hero, .facts, .terms, .doc-grid, .signatures { grid-template-columns: 1fr; } .price { text-align: left; } }
  `;
}

function offerSection(args: ClientPackageHtmlArgs): string {
  const { project, offer, total, summary } = args;
  const terms = [
    ['Действительно до', offer.validUntil ? fmtDate(offer.validUntil) : 'не указано'],
    ['Оплата', offer.paymentTerms || 'по согласованию'],
    ['Монтаж', offer.installation || 'по согласованию'],
    ['Доставка', offer.delivery || 'по согласованию'],
  ];
  return `
    <section class="sheet hero">
      <div>
        <div class="brand">${escapeHtml(sellerName(offer))}</div>
        <div class="sub">пакет документов для клиента · коммерческое предложение</div>
        <h1>${escapeHtml(project.name)}</h1>
        <div class="meta"><span>Клиент: <b>${escapeHtml(project.client || '—')}</b></span><span>Дата: ${escapeHtml(fmtDate(project.date))}</span><span>№ договора: ${escapeHtml(contractNumber(project, offer))}</span></div>
      </div>
      <div class="price"><span>Итоговая стоимость</span><b>${escapeHtml(fmtMoney(total))}</b><span>состав и условия ниже</span></div>
    </section>
    <section class="sheet">
      <h2>Сводка проекта</h2>
      <div class="facts">
        <div><b>${escapeHtml(fmtNum(summary.moduleCount, 3))}</b><span>модулей</span></div>
        <div><b>${escapeHtml(summary.facadeAreaM2 > 0 ? fmtNum(summary.facadeAreaM2, 2) : fmtNum(summary.facadeQty, 3))}</b><span>${summary.facadeAreaM2 > 0 ? 'м² фасадов' : 'фасадов/рамок'}</span></div>
        <div><b>${escapeHtml(fmtNum(summary.hingeQty, 3))}</b><span>петель</span></div>
        <div><b>${escapeHtml(fmtMoney(summary.bodyTotal))}</b><span>корпуса общ.</span></div>
      </div>
      <div class="terms">${terms.map(([label, value]) => `<div><b>${escapeHtml(label)}</b><span>${escapeHtml(value)}</span></div>`).join('')}</div>
      ${offer.notes ? `<p class="doc-text"><b>Примечания:</b><br>${nl2br(offer.notes)}</p>` : ''}
      <div class="chips">${clientSketchSummaryLines(summary).map((line) => `<span>${escapeHtml(line)}</span>`).join('')}</div>
    </section>`;
}

function sketchSection(args: ClientPackageHtmlArgs, settings: NormalizedClientDocumentPackageSettings): string {
  const summaryLines = clientSketchSummaryLines(args.summary);
  if (args.sketches.length === 0) return '';
  return `<section class="sheet"><h2>Эскиз PRO</h2><div class="sketch-grid">${args.sketches.map((sketch, index) => `
    <figure class="sketch">
      <header>${index + 1}. ${escapeHtml(sketch.title)}</header>
      <img src="${escapeHtml(sketch.imageDataUrl)}" alt="${escapeHtml(sketch.title)}">
      ${settings.sketchSummaryOverlay && summaryLines.length ? `<figcaption class="overlay"><b>Сводка проекта</b>${summaryLines.map((line) => `<span>${escapeHtml(line)}</span>`).join('')}</figcaption>` : ''}
    </figure>`).join('')}</div></section>`;
}

function specificationSection(args: ClientPackageHtmlArgs, settings: NormalizedClientDocumentPackageSettings): string {
  const detailRows = args.details.map((detail, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(detail.kindLabel)}</td><td>${escapeHtml(detail.name)}${detail.details.length && !settings.compact ? `<br><small>${escapeHtml(detail.details.slice(0, 4).join('; '))}</small>` : ''}</td><td>${escapeHtml(detail.priceBasis === 'm2' || detail.priceBasis === 'lm' ? `${fmtNum(detail.qty, 3)} шт / ${fmtNum(detail.qtyEffective, 3)} ${detail.unit}` : `${fmtNum(detail.qtyEffective, 3)} ${detail.unit}`)}</td><td class="num">${escapeHtml(fmtMoney(detail.clientSum))}</td></tr>`).join('');
  const moduleRows = args.modules.map((module, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(module.title)}</td><td>${escapeHtml(module.sub || '')}</td><td class="num">${escapeHtml(fmtNum(module.qty, 3))}</td><td class="num">${escapeHtml(fmtMoney(module.total))}</td></tr>`).join('');
  return `<section class="sheet"><h2>Компактная спецификация</h2>
    ${args.modules.length ? `<h3>Модули</h3><table><thead><tr><th>№</th><th>Модуль</th><th>Описание</th><th class="num">Кол-во</th><th class="num">Сумма</th></tr></thead><tbody>${moduleRows}</tbody></table>` : ''}
    <h3 style="margin-top:12px">Состав по категориям</h3><table><thead><tr><th>№</th><th>Категория</th><th>Позиция</th><th>Кол-во</th><th class="num">Сумма</th></tr></thead><tbody>${detailRows || '<tr><td colspan="5">Состав не заполнен</td></tr>'}</tbody></table>
  </section>`;
}

function contractSection(args: ClientPackageHtmlArgs): string {
  const { project, offer, total } = args;
  const city = offer.contractCity?.trim() || '__________';
  const warranty = offer.warranty?.trim() || '12 месяцев, если иное не указано в приложениях';
  const terms = offer.productionTerms?.trim() || 'срок изготовления и монтажа согласуется сторонами после утверждения размеров и материалов';
  return `<section class="sheet"><h2>Договор на изготовление мебели — черновик</h2>
    <p class="small-note">Типовая структура для предварительной выгрузки. После загрузки ваших документов заменим этот блок на фирменный шаблон.</p>
    <div class="doc-grid doc-text">
      <div><b>№ договора:</b> ${escapeHtml(contractNumber(project, offer))}<br><b>Город:</b> ${escapeHtml(city)}<br><b>Дата:</b> ${escapeHtml(fmtDate(project.date))}</div>
      <div><b>Исполнитель:</b> ${escapeHtml(sellerName(offer))}<br>${nl2br(offer.sellerDetails || '')}<br><b>Заказчик:</b> ${escapeHtml(project.client || '—')} ${offer.clientContacts ? `<br>${nl2br(offer.clientContacts)}` : ''}</div>
    </div>
    <ol class="doc-text">
      <li><b>Предмет договора.</b> Исполнитель обязуется изготовить и/или укомплектовать мебельный комплект по согласованному эскизу, спецификации и коммерческому предложению, а Заказчик обязуется принять и оплатить изделие.</li>
      <li><b>Стоимость.</b> Предварительная стоимость комплекта составляет <b>${escapeHtml(fmtMoney(total))}</b>. Изменение размеров, материалов, фурнитуры и состава оформляется пересчётом или дополнительным соглашением.</li>
      <li><b>Порядок оплаты.</b> ${escapeHtml(offer.paymentTerms || 'условия оплаты согласуются сторонами')}.</li>
      <li><b>Сроки.</b> ${escapeHtml(terms)}.</li>
      <li><b>Доставка и монтаж.</b> Доставка: ${escapeHtml(offer.delivery || 'по согласованию')}. Монтаж: ${escapeHtml(offer.installation || 'по согласованию')}.</li>
      <li><b>Приёмка и гарантия.</b> Заказчик проверяет комплектность и внешний вид при передаче. Гарантия: ${escapeHtml(warranty)}.</li>
    </ol>
    <div class="signatures"><div class="sign-box"><b>Исполнитель</b><div class="sign-line">подпись / расшифровка</div></div><div class="sign-box"><b>Заказчик</b><div class="sign-line">подпись / расшифровка</div></div></div>
  </section>`;
}

function receiptSection(args: ClientPackageHtmlArgs): string {
  const { project, offer, total, summary } = args;
  const rows = [
    ['Комплект мебели по проекту', '1 комплект', fmtMoney(total)],
    summary.bodyTotal > 0 ? ['Корпуса / каркасная часть', 'общ.', fmtMoney(summary.bodyTotal)] : null,
    summary.facadeTotal > 0 ? ['Фасады / рамки', summary.facadeAreaM2 > 0 ? `${fmtNum(summary.facadeAreaM2, 2)} м²` : `${fmtNum(summary.facadeQty, 3)} шт`, fmtMoney(summary.facadeTotal)] : null,
    summary.hardwareTotal > 0 ? ['Фурнитура', 'общ.', fmtMoney(summary.hardwareTotal)] : null,
  ].filter((row): row is string[] => Boolean(row));
  return `<section class="sheet"><h2>Товарный чек</h2>
    <div class="doc-grid doc-text"><div><b>Продавец:</b> ${escapeHtml(sellerName(offer))}<br>${nl2br(offer.sellerDetails || '')}</div><div><b>Покупатель:</b> ${escapeHtml(project.client || '—')}<br><b>Проект:</b> ${escapeHtml(project.name)}<br><b>Дата:</b> ${escapeHtml(fmtDate(project.date))}</div></div>
    <table style="margin-top:10px"><thead><tr><th>Наименование</th><th>Кол-во</th><th class="num">Сумма</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escapeHtml(row[0])}</td><td>${escapeHtml(row[1])}</td><td class="num">${escapeHtml(row[2])}</td></tr>`).join('')}<tr><th colspan="2">Итого</th><th class="num">${escapeHtml(fmtMoney(total))}</th></tr></tbody></table>
    <div class="signatures"><div class="sign-box"><b>Продавец</b><div class="sign-line">подпись</div></div><div class="sign-box"><b>Покупатель</b><div class="sign-line">подпись</div></div></div>
  </section>`;
}

export function buildClientDocumentPackageHtml(args: ClientPackageHtmlArgs): string {
  const settings = includeSettings(args.offer);
  const sections = [
    settings.includeOffer ? offerSection(args) : '',
    settings.includeSketch ? sketchSection(args, settings) : '',
    settings.includeSpecification ? specificationSection(args, settings) : '',
    settings.includeContract ? contractSection(args) : '',
    settings.includeReceipt ? receiptSection(args) : '',
  ].filter(Boolean).join('\n');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(args.project.name)} — пакет клиента</title><style>${packageStyles(settings.compact)}</style></head><body><main class="pack">${sections}</main></body></html>`;
}

export function downloadClientDocumentPackageHtml(args: ClientPackageHtmlArgs): void {
  const html = buildClientDocumentPackageHtml(args);
  downloadFile(`${safeFilePart(args.project.name)} — пакет клиента.html`, html, 'text/html;charset=utf-8');
}
