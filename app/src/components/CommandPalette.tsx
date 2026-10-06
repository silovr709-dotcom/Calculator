import { useEffect, useMemo, useRef, useState } from 'react';
import type { ClientProfile, KbArticle, Pricebook, Project } from '../types';
import { fmtDate, fmtMoney } from '../lib/format';
import { WORK_MODE_LABELS, calcProjectWorkflowTotal, projectClient, projectNextStep, type WorkMode, type WorkflowTone } from '../lib/workflow';

export type CommandProjectTab = 'modules' | 'sketch' | 'order' | 'lines' | 'photos' | 'settings' | 'client' | 'check' | 'variants' | 'measurement';

interface CommandItem {
  id: string;
  group: string;
  title: string;
  subtitle: string;
  badge?: string;
  tone?: WorkflowTone;
  keywords: string;
  run: () => void;
}

function normalize(value: string): string {
  return value.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
}

function matches(item: CommandItem, query: string): boolean {
  const needle = normalize(query.trim());
  if (!needle) return true;
  return normalize(`${item.title} ${item.subtitle} ${item.group} ${item.keywords}`).includes(needle);
}

function commandToneIcon(tone?: WorkflowTone): string {
  if (tone === 'danger') return '●';
  if (tone === 'warn') return '▲';
  if (tone === 'good') return '✓';
  if (tone === 'muted') return '•';
  return '↵';
}

export default function CommandPalette(props: {
  open: boolean;
  onClose: () => void;
  projects: Project[];
  clients: ClientProfile[];
  pricebooks: Pricebook[];
  activePricebook: Pricebook;
  kbArticles: KbArticle[];
  currentProject?: Project | null;
  workMode: WorkMode;
  onWorkModeChange: (mode: WorkMode) => void;
  onOpenDashboard: () => void;
  onOpenCrm: () => void;
  onOpenQuick: () => void;
  onOpenFactory: (projectId?: string) => void;
  onOpenKb: () => void;
  onOpenSettings: () => void;
  onOpenPricebook: () => void;
  onOpenSync: () => void;
  onOpenProject: (id: string, tab?: CommandProjectTab) => void;
}) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!props.open) return undefined;
    const timer = window.setTimeout(() => {
      setQuery('');
      setActiveIndex(0);
      inputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [props.open]);

  const items = useMemo<CommandItem[]>(() => {
    const list: CommandItem[] = [];
    const current = props.currentProject ?? null;
    const add = (item: CommandItem) => list.push(item);

    add({ id: 'nav-dashboard', group: 'Навигация', title: 'Открыть рабочий стол дня', subtitle: 'Проекты, задачи на сегодня, проблемные заказы', badge: 'Сегодня', keywords: 'проекты dashboard рабочий стол сегодня задачи', run: props.onOpenDashboard });
    add({ id: 'nav-crm', group: 'Навигация', title: 'Открыть CRM клиентов', subtitle: 'Клиенты, контакты, документы, деньги, история', badge: 'CRM', keywords: 'клиент клиенты crm контакт звонок whatsapp деньги документы', run: props.onOpenCrm });
    add({ id: 'nav-quick', group: 'Навигация', title: 'Быстрый расчёт', subtitle: 'Предварительная оценка кухни', keywords: 'быстрый расчет оценка калькулятор', run: props.onOpenQuick });
    add({ id: 'nav-factory', group: 'Навигация', title: 'Бланк на фабрику', subtitle: current ? `Открыть для проекта «${current.name}»` : 'Выбрать проект и заполнить официальный бланк', badge: 'Excel', keywords: 'фабрика бланк производство висма excel верх низ', run: () => props.onOpenFactory(current?.id) });
    add({ id: 'nav-kb', group: 'Навигация', title: 'База знаний', subtitle: 'Инструкции, материалы, подсказки', keywords: 'база знания инструкция помощь', run: props.onOpenKb });
    add({ id: 'nav-pricebook', group: 'Навигация', title: 'Прайс и версии', subtitle: `${props.activePricebook.meta.name} · ${props.activePricebook.meta.itemCount} позиций`, keywords: 'прайс каталог позиции цены', run: props.onOpenPricebook });
    add({ id: 'nav-sync', group: 'Навигация', title: 'Синхронизация и телефон', subtitle: 'QR, облако, обмен между устройствами', keywords: 'синхронизация телефон qr облако обмен', run: props.onOpenSync });
    add({ id: 'nav-settings', group: 'Навигация', title: 'Настройки интерфейса и расчёта', subtitle: 'Наценка, расходы, поведение новых проектов', keywords: 'настройки интерфейс наценка расходы', run: props.onOpenSettings });

    if (current) {
      const pb = props.pricebooks.find((item) => item.meta.id === current.pricebookId) ?? props.activePricebook;
      const client = projectClient(current, props.clients);
      const next = projectNextStep(current, pb, client);
      add({ id: 'current-next', group: 'Текущий проект', title: next.title, subtitle: next.detail, badge: next.actionLabel, tone: next.tone, keywords: `следующий шаг ${next.target}`, run: () => {
        if (next.target === 'factory') props.onOpenFactory(current.id);
        else if (next.target === 'crm' || next.target === 'payment') props.onOpenCrm();
        else if (next.target === 'client') props.onOpenProject(current.id, 'client');
        else if (next.target === 'check') props.onOpenProject(current.id, 'check');
        else if (next.target === 'modules') props.onOpenProject(current.id, 'modules');
        else if (next.target === 'sketch') props.onOpenProject(current.id, 'sketch');
        else props.onOpenProject(current.id);
      } });
      add({ id: 'current-offer', group: 'Текущий проект', title: 'Подготовить КП', subtitle: 'Открыть компактное КП, Word, договор, чек и пакет клиента', badge: 'КП', keywords: 'кп коммерческое предложение договор чек пакет word', run: () => props.onOpenProject(current.id, 'client') });
      add({ id: 'current-check', group: 'Текущий проект', title: 'Проверить проект', subtitle: 'Ошибки, предупреждения, готовность к КП и фабрике', badge: 'Проверка', keywords: 'проверка ошибки предупреждения готовность', run: () => props.onOpenProject(current.id, 'check') });
      add({ id: 'current-factory', group: 'Текущий проект', title: 'Передать на фабрику', subtitle: 'Официальный бланк, Эскиз PRO, столешница, техпакет', badge: 'Фабрика', keywords: 'фабрика производство бланк excel техлист техпакет эскиз столешница', run: () => props.onOpenFactory(current.id) });
      add({ id: 'current-sketch', group: 'Текущий проект', title: 'Открыть Эскиз PRO', subtitle: 'Скрин, размеры, коммуникации, маркеры модулей', badge: 'Эскиз', keywords: 'эскиз pro sketch размеры коммуникации', run: () => props.onOpenProject(current.id, 'sketch') });
    }

    (Object.keys(WORK_MODE_LABELS) as WorkMode[]).forEach((mode) => add({
      id: `mode-${mode}`,
      group: 'Режим работы',
      title: `Режим: ${WORK_MODE_LABELS[mode].label}`,
      subtitle: WORK_MODE_LABELS[mode].hint,
      badge: props.workMode === mode ? 'активен' : WORK_MODE_LABELS[mode].primary,
      keywords: `режим ${mode} ${WORK_MODE_LABELS[mode].label} ${WORK_MODE_LABELS[mode].hint}`,
      run: () => props.onWorkModeChange(mode),
    }));

    props.projects.slice(0, 80).forEach((project) => {
      const pb = props.pricebooks.find((item) => item.meta.id === project.pricebookId) ?? props.activePricebook;
      const client = projectClient(project, props.clients);
      const next = projectNextStep(project, pb, client);
      const total = calcProjectWorkflowTotal(project, pb);
      add({
        id: `project-${project.id}`,
        group: 'Проекты',
        title: project.name,
        subtitle: `${project.client || client?.name || 'Без клиента'} · ${fmtMoney(total.client)} · ${next.title}`,
        badge: fmtDate(project.updatedAt || project.date),
        tone: next.tone,
        keywords: `${project.client} ${project.comment} ${next.detail}`,
        run: () => props.onOpenProject(project.id),
      });
    });

    props.clients.slice(0, 80).forEach((client) => {
      const clientProjects = props.projects.filter((project) => project.clientId === client.id || project.client === client.name);
      const latest = clientProjects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      add({
        id: `client-${client.id}`,
        group: 'Клиенты',
        title: client.name || 'Без имени',
        subtitle: `${clientProjects.length} проект(а) · ${(client.phones ?? []).join(', ') || 'телефон не указан'}`,
        badge: 'клиент',
        tone: client.phones?.length ? 'info' : 'warn',
        keywords: `${client.phones?.join(' ')} ${client.emails?.join(' ')} ${client.managerComment ?? ''}`,
        run: () => latest ? props.onOpenProject(latest.id) : props.onOpenCrm(),
      });
    });

    props.kbArticles.slice(0, 80).forEach((article) => add({
      id: `kb-${article.id}`,
      group: 'База знаний',
      title: article.title,
      subtitle: [article.category, article.tags?.join(', ')].filter(Boolean).join(' · ') || 'статья',
      badge: 'KB',
      keywords: `${article.body ?? ''} ${article.tags?.join(' ') ?? ''}`,
      run: props.onOpenKb,
    }));

    props.activePricebook.items.forEach((item) => add({
      id: `price-${item.id}`,
      group: 'Прайс',
      title: item.name,
      subtitle: `${item.category} · ${item.article || 'без артикула'} · ${item.price ?? '—'} ₽`,
      badge: item.unit ?? undefined,
      keywords: `${item.category} ${item.subcategory ?? ''} ${item.article ?? ''} ${item.group ?? ''}`,
      run: props.onOpenPricebook,
    }));

    return list;
  }, [props]);

  const results = useMemo(() => items.filter((item) => matches(item, query)).slice(0, 18), [items, query]);

  useEffect(() => {
    if (!props.open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); props.onClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props]);

  if (!props.open) return null;

  const runItem = (item: CommandItem) => {
    item.run();
    props.onClose();
  };

  return (
    <div className="command-palette-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}>
      <div className="command-palette" role="dialog" aria-modal="true" aria-label="Командная палитра">
        <div className="command-palette-search">
          <span>⌘K</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
            placeholder="Найти проект, клиента, действие, документ, позицию прайса…"
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((index) => Math.min(index + 1, Math.max(0, results.length - 1))); }
              if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((index) => Math.max(0, index - 1)); }
              if (event.key === 'Enter' && results[activeIndex]) { event.preventDefault(); runItem(results[activeIndex]); }
            }}
          />
          <button type="button" onClick={props.onClose} aria-label="Закрыть">Esc</button>
        </div>
        <div className="command-mode-strip" aria-label="Режим работы">
          {(Object.keys(WORK_MODE_LABELS) as WorkMode[]).map((mode) => <button key={mode} type="button" className={props.workMode === mode ? 'active' : ''} onClick={() => props.onWorkModeChange(mode)}><b>{WORK_MODE_LABELS[mode].label}</b><span>{WORK_MODE_LABELS[mode].primary}</span></button>)}
        </div>
        <div className="command-results" role="listbox">
          {results.length === 0 ? <div className="command-empty">Ничего не найдено. Попробуйте: «КП», «Иванов», «фабрика», «Rehau», «сегодня».</div> : results.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className={`command-result ${index === activeIndex ? 'active' : ''} tone-${item.tone ?? 'info'}`}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => runItem(item)}
              role="option"
              aria-selected={index === activeIndex}
            >
              <i>{commandToneIcon(item.tone)}</i>
              <span><small>{item.group}</small><b>{item.title}</b><em>{item.subtitle}</em></span>
              {item.badge && <strong>{item.badge}</strong>}
            </button>
          ))}
        </div>
        <div className="command-footer">↑↓ выбрать · Enter открыть · Esc закрыть · Ctrl+K из любого раздела</div>
      </div>
    </div>
  );
}
