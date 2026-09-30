import { useMemo, useState } from 'react';
import type { ClientOfferSnapshot, Pricebook, Project, ProjectLine, SummaryGroup } from '../types';
import { SUMMARY_GROUPS } from '../types';
import { calcTotals } from '../lib/engine';
import { fmtDate, fmtMoney, fmtNum } from '../lib/format';
import { moduleToLines } from '../lib/modules';
import { calculateVariant } from '../lib/variants';
import { groupValidationIssues, validateProject, type ValidationIssue } from '../lib/validation';
import { collectEskizModuleMarkers, snapshotProject } from '../lib/eskizPro';

interface ProcurementRow {
  key: string;
  group: SummaryGroup;
  category: string;
  name: string;
  article: string | null;
  unit: string;
  qty: number;
  cost: number | null;
  unpriced: boolean;
  notes: string[];
}

function uid(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function moduleNameFromNote(note: string | undefined) {
  if (!note?.startsWith('Модуль:')) return '';
  const match = note.match(/^Модуль:\s*(.*?)(?:\s+\[[^\]]+\])?(?:\s+—\s*(.*))?$/u);
  return match?.[1]?.trim() ?? '';
}

function buildProcurement(lines: ProjectLine[], lineCalcs: ReturnType<typeof calcTotals>['lineCalcs']): ProcurementRow[] {
  const map = new Map<string, ProcurementRow>();
  for (const line of lines) {
    const calc = lineCalcs.get(line.id);
    const qty = calc?.qtyEffective ?? line.qty;
    const sum = calc?.sum ?? null;
    const key = [line.group, line.category, line.itemId, line.name, line.article ?? '', line.unit ?? '', line.price ?? ''].join('|');
    let row = map.get(key);
    if (!row) {
      row = { key, group: line.group, category: line.category, name: line.name, article: line.article, unit: line.unit ?? 'шт', qty: 0, cost: 0, unpriced: false, notes: [] };
      map.set(key, row);
    }
    row.qty += qty;
    if (sum == null) row.unpriced = true;
    else row.cost = (row.cost ?? 0) + sum;
    const moduleName = moduleNameFromNote(line.note);
    if (moduleName && !row.notes.includes(moduleName)) row.notes.push(moduleName);
  }
  return Array.from(map.values()).sort((a, b) => SUMMARY_GROUPS.indexOf(a.group) - SUMMARY_GROUPS.indexOf(b.group) || a.name.localeCompare(b.name, 'ru'));
}

function issueActionLabel(issue: ValidationIssue) {
  if (issue.entity === 'module') return 'Открыть модуль';
  if (issue.entity === 'line') return 'Открыть строку';
  return '';
}

export default function OrderCenterPanel(props: {
  project: Project;
  pricebook: Pricebook;
  onChange: (project: Project) => void;
  onOpenClient: () => void;
  onOpenFactoryBlank?: () => void;
  onSelectModule: (id: string) => void;
  onSelectLine: (id: string) => void;
}) {
  const { project, pricebook } = props;
  const [copied, setCopied] = useState(false);
  const moduleLines = useMemo(() => (project.modules ?? []).flatMap((module) => moduleToLines(module, project.moduleDefaults ?? {}, pricebook)), [project.modules, project.moduleDefaults, pricebook]);
  const combinedLines = useMemo(() => [...moduleLines, ...project.lines], [moduleLines, project.lines]);
  const calculated = useMemo(() => calcTotals(combinedLines, project.settings), [combinedLines, project.settings]);
  const validation = useMemo(() => validateProject(project, pricebook), [project, pricebook]);
  const groupedIssues = groupValidationIssues(validation.issues.filter((issue) => issue.severity !== 'info'));
  const procurement = useMemo(() => buildProcurement(combinedLines, calculated.lineCalcs), [combinedLines, calculated.lineCalcs]);
  const procurementGroups = SUMMARY_GROUPS.map((group) => ({ group, rows: procurement.filter((row) => row.group === group) })).filter((item) => item.rows.length > 0);
  const eskizProjects = (project.eskizPro?.snapshots ?? []).map(snapshotProject).filter((item): item is NonNullable<typeof item> => Boolean(item));
  const eskizMarkers = collectEskizModuleMarkers(eskizProjects);
  const boundEskizMarkers = eskizMarkers.filter((marker) => Boolean(project.eskizPro?.moduleBindings?.[marker.key]));
  const variants = project.variants ?? [];
  const variantRows = variants.map((variant) => ({ variant, calculation: calculateVariant(project, pricebook, variant) }));
  const minVariantClient = variantRows.length ? Math.min(...variantRows.map((row) => row.calculation.totals.client)) : null;
  const snapshots = project.clientOfferSnapshots ?? [];

  const canSendClient = validation.errors.length === 0;
  const readyForFactory = validation.errors.length === 0 && validation.warnings.length === 0 && combinedLines.length > 0 && (eskizMarkers.length === 0 || boundEskizMarkers.length === eskizMarkers.length);
  const risk = validation.errors.length > 0 ? 'high' : validation.warnings.length > 0 || calculated.totals.unpricedCount > 0 ? 'medium' : 'low';

  const createSnapshot = () => {
    const snapshot: ClientOfferSnapshot = {
      id: uid('offer'),
      createdAt: new Date().toISOString(),
      name: `КП от ${new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date())}`,
      clientTotal: calculated.totals.client,
      costTotal: calculated.totals.cost,
      modulesCount: project.modules?.length ?? 0,
      linesCount: combinedLines.length,
      issuesCount: validation.errors.length + validation.warnings.length,
      variantId: project.selectedVariantId ?? null,
      note: project.clientOffer?.presentationMode ? `Режим КП: ${project.clientOffer.presentationMode}` : undefined,
    };
    props.onChange({ ...project, clientOfferSnapshots: [snapshot, ...snapshots].slice(0, 20) });
  };

  const copyPackage = async () => {
    const text = [
      `Пакет заказа: ${project.name}`,
      project.client ? `Клиент: ${project.client}` : null,
      `Дата: ${project.date}`,
      `Статус: ${canSendClient ? 'КП можно отправлять' : 'КП нельзя отправлять'}`,
      `Готовность к фабрике: ${readyForFactory ? 'готово' : 'нужна проверка'}`,
      `Себестоимость: ${fmtMoney(calculated.totals.cost)}`,
      `Цена клиента: ${fmtMoney(calculated.totals.client)}`,
      `Ошибки: ${validation.errors.length}, предупреждения: ${validation.warnings.length}, без цены: ${calculated.totals.unpricedCount}`,
      `Модули: ${project.modules?.length ?? 0}, строки закупки: ${procurement.length}, эскиз-маркеры: ${boundEskizMarkers.length}/${eskizMarkers.length}`,
      '',
      'Закупочный список:',
      ...procurement.slice(0, 80).map((row) => `- ${row.group}: ${row.name}${row.article ? ` (${row.article})` : ''} — ${fmtNum(row.qty, 3)} ${row.unit}${row.cost != null ? ` · ${fmtMoney(row.cost)}` : ' · без цены'}`),
    ].filter(Boolean).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
      alert(text);
    }
  };

  const navigateIssue = (issue: ValidationIssue) => {
    if (issue.entity === 'module' && issue.entityId) props.onSelectModule(issue.entityId);
    if (issue.entity === 'line' && issue.entityId) props.onSelectLine(issue.entityId);
  };

  return (
    <div className="order-center">
      <section className={`order-hero risk-${risk}`}>
        <div>
          <span className="eyebrow">ЦЕНТР ЗАКАЗА</span>
          <h2>{readyForFactory ? 'Проект готов к передаче в заказ' : canSendClient ? 'КП можно отправлять, но заказ ещё требует проверки' : 'КП пока нельзя отправлять'}</h2>
          <p>{readyForFactory ? 'Ошибок и предупреждений нет, эскизные модули связаны, закупочный список сформирован.' : 'Слева видны статусы: исправьте критичные ошибки, подтвердите предупреждения и сохраните версию КП перед передачей.'}</p>
        </div>
        <div className="order-hero-total"><span>Цена клиенту</span><b>{fmtMoney(calculated.totals.client)}</b><em>маржа {calculated.totals.marginPct != null ? `${fmtNum(calculated.totals.marginPct, 1)}%` : '—'}</em></div>
      </section>

      <section className="order-status-grid">
        <div className={canSendClient ? 'ok' : 'bad'}><b>{canSendClient ? 'Можно' : 'Нельзя'}</b><span>отправлять КП</span><small>{validation.errors.length ? `ошибок: ${validation.errors.length}` : 'критичных ошибок нет'}</small></div>
        <div className={readyForFactory ? 'ok' : 'warn'}><b>{readyForFactory ? 'Готов' : 'Проверить'}</b><span>пакет на фабрику</span><small>{validation.warnings.length ? `предупреждений: ${validation.warnings.length}` : 'тех. предупреждений нет'}</small></div>
        <div className={calculated.totals.unpricedCount === 0 ? 'ok' : 'bad'}><b>{calculated.totals.unpricedCount}</b><span>строк без цены</span><small>влияет на итог</small></div>
        <div className={eskizMarkers.length === boundEskizMarkers.length ? 'ok' : 'warn'}><b>{boundEskizMarkers.length}/{eskizMarkers.length}</b><span>маркеров эскиза</span><small>{eskizMarkers.length ? 'связаны с просчётом' : 'эскиз без модулей'}</small></div>
      </section>

      <section className="order-actions card no-print">
        <div><h3>Пакет КП / заказа</h3><p className="muted small">Сохраните контрольную версию перед отправкой клиенту, затем используйте закупку и бланк для передачи дальше.</p></div>
        <div className="actions">
          <button className="btn primary" onClick={createSnapshot}>＋ Сохранить версию КП</button>
          <button className="btn ghost" onClick={props.onOpenClient}>Открыть КП</button>
          {props.onOpenFactoryBlank && <button className="btn ghost" onClick={props.onOpenFactoryBlank}>Бланк на фабрику</button>}
          <button className="btn ghost" onClick={() => void copyPackage()}>{copied ? '✓ Скопировано' : 'Скопировать пакет'}</button>
        </div>
      </section>

      <div className="order-grid">
        <section className="card offer-versions">
          <div className="section-head"><div><h3>Версии КП</h3><p className="muted small">Контрольные снимки цены и готовности для повторных согласований.</p></div></div>
          {snapshots.length === 0 ? <div className="empty small">Версий пока нет. Нажмите «Сохранить версию КП» перед отправкой клиенту.</div> : (
            <div className="offer-version-list">{snapshots.map((snapshot, index) => {
              const previous = snapshots[index + 1];
              const delta = previous ? snapshot.clientTotal - previous.clientTotal : 0;
              return <article key={snapshot.id}><div><b>{snapshot.name}</b><span>{fmtDate(snapshot.createdAt)} · {snapshot.modulesCount} мод. · {snapshot.linesCount} строк · проблем: {snapshot.issuesCount}</span>{snapshot.note && <small>{snapshot.note}</small>}</div><strong>{fmtMoney(snapshot.clientTotal)}</strong>{previous && <em className={delta >= 0 ? 'up' : 'down'}>{delta >= 0 ? '+' : ''}{fmtMoney(delta)}</em>}</article>;
            })}</div>
          )}
        </section>

        <section className="card variant-compare-mini">
          <div className="section-head"><div><h3>Сравнение вариантов</h3><p className="muted small">Быстрая таблица для менеджера: какой вариант дешевле и что выбрано для КП.</p></div></div>
          {variantRows.length === 0 ? <div className="empty small">Варианты ещё не созданы. Откройте вкладку «Варианты» и создайте Эконом/Стандарт/Премиум.</div> : (
            <div className="variant-mini-table">{variantRows.map(({ variant, calculation }) => <div className={project.selectedVariantId === variant.id ? 'active' : ''} key={variant.id}><span><b>{variant.name}</b><small>{variant.description}</small></span><strong>{fmtMoney(calculation.totals.client)}</strong><em>{minVariantClient != null && calculation.totals.client === minVariantClient ? 'мин.' : minVariantClient != null ? `+${fmtMoney(calculation.totals.client - minVariantClient)}` : ''}</em></div>)}</div>
          )}
        </section>
      </div>

      <section className="card procurement-card">
        <div className="section-head"><div><h3>Закупочный список</h3><p className="muted small">Сгруппировано по реальным строкам расчёта: корпуса, фасады, фурнитура, ручки, опоры и доп. позиции.</p></div><b>{procurement.length} поз.</b></div>
        {procurementGroups.length === 0 ? <div className="empty small">Нет строк закупки — добавьте модули или позиции прайса.</div> : procurementGroups.map(({ group, rows }) => (
          <details className="procurement-group" key={group} open={group === 'Корпуса' || group === 'Фасады'}>
            <summary>{group}<span>{rows.length} поз. · {fmtMoney(rows.reduce((sum, row) => sum + (row.cost ?? 0), 0))}</span></summary>
            <div className="procurement-table">{rows.map((row) => <div className={row.unpriced ? 'unpriced' : ''} key={row.key}><span><b>{row.name}</b><small>{row.article ? `арт. ${row.article} · ` : ''}{row.category}{row.notes.length ? ` · модули: ${row.notes.slice(0, 3).join(', ')}${row.notes.length > 3 ? '…' : ''}` : ''}</small></span><em>{fmtNum(row.qty, 3)} {row.unit}</em><strong>{row.cost != null ? fmtMoney(row.cost) : 'нет цены'}</strong></div>)}</div>
          </details>
        ))}
      </section>

      <section className="card unresolved-card">
        <div className="section-head"><div><h3>Нерешённые проблемы</h3><p className="muted small">То, что мешает отправке КП или передаче в заказ. Клик ведёт в нужный модуль/строку.</p></div></div>
        {groupedIssues.length === 0 ? <div className="ok-box">✅ Ошибок и предупреждений нет.</div> : groupedIssues.map(([group, issues]) => <div className="unresolved-group" key={group}><h4>{group}</h4>{issues.map((issue) => <div className={`unresolved-issue ${issue.severity}`} key={issue.id}><span>{issue.severity === 'error' ? '⛔' : '⚠'} <b>{issue.title}</b> — {issue.message}</span>{issue.entityId && <button className="btn tiny ghost" onClick={() => navigateIssue(issue)}>{issueActionLabel(issue)}</button>}</div>)}</div>)}
      </section>
    </div>
  );
}
