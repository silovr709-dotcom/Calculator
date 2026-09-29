import { useEffect, useMemo, useRef, useState } from 'react';
import type { Pricebook } from '../types';
import type { FactoryDicts } from '../lib/factoryDicts';
import { materialEntries, materialFieldMatches, materialPriceText, type MaterialEntry } from '../lib/materials';

interface BlankPickerOption {
  id: string;
  value: string;
  label: string;
  meta: string;
  price: string | null;
  source: 'dict' | 'pricebook';
}

export interface BlankPickerDialogProps {
  fieldKey: string;
  fieldLabel: string;
  currentValue: string;
  pricebook?: Pricebook;
  dicts?: FactoryDicts | null;
  onPick: (value: string) => void;
  onClose: () => void;
}

const normalize = (value: string) => value.toLocaleLowerCase('ru').replace(/ё/g, 'е');

function dictionaryOptions(fieldKey: string, dicts: FactoryDicts | null | undefined): BlankPickerOption[] {
  if (!dicts) return [];
  const out: BlankPickerOption[] = [];
  const add = (id: string, value: string, label: string, meta: string) => {
    if (!value.trim() || out.some((option) => option.value === value)) return;
    out.push({ id, value, label, meta, price: null, source: 'dict' });
  };
  const { ldspColors, films, plastics } = dicts.groups;

  if (fieldKey === 'ldspColor' || fieldKey === 'corpusColor') {
    ldspColors.items.forEach((item, index) => add(
      `ldsp-${index}`,
      `${item.texture ? '!' : ''}${item.name} (${item.brand}, ${item.category || item.format})`,
      `${item.texture ? '! ' : ''}${item.name}`,
      `${item.brand}${item.category ? ` · ${item.category}` : ''}${item.format ? ` · ${item.format}` : ''}`,
    ));
  } else if (fieldKey === 'facadeColor') {
    films.items.filter((item) => item.status === 'в работе').forEach((item, index) => add(
      `film-${index}`,
      `${item.texture ? '! ' : ''}${item.code} — ${item.name} (${item.brand})`,
      `${item.texture ? '! ' : ''}${item.code} — ${item.name}`,
      `${item.brand} · плёнка${item.category ? ` · ${item.category}` : ''}`,
    ));
    plastics.items.filter((item) => item.status !== 'снята' && item.status !== 'выведена').forEach((item, index) => add(
      `plastic-${index}`,
      `${item.article} — ${item.name}${item.brand ? ` (${item.brand})` : ''}`,
      `${item.article} — ${item.name}`,
      `${item.brand || 'пластик'}${item.category ? ` · ${item.category}` : ''}`,
    ));
  } else if (fieldKey === 'bodyEdging' || fieldKey === 'corpusEdging') {
    [...new Set(ldspColors.items.map((item) => item.edgingArticle).filter((value): value is string => Boolean(value)))].forEach((article, index) => add(
      `edge-${index}`,
      `0,4мм ${article} GP`,
      `0,4мм ${article} GP`,
      'Кромка ЛДСП по разбивке фабрики',
    ));
  } else if (fieldKey === 'facadeEdging') {
    plastics.items.filter((item) => item.status !== 'снята' && item.status !== 'выведена').forEach((item, index) => add(
      `plastic-edge-${index}`,
      `кромка ${item.brand || ''} под ${item.article}`.replace(/\s+/g, ' ').trim(),
      `кромка ${item.brand || ''} под ${item.article}`.replace(/\s+/g, ' ').trim(),
      item.name,
    ));
  }
  return out;
}

function pricebookOptions(fieldKey: string, pricebook: Pricebook | undefined): BlankPickerOption[] {
  if (!pricebook) return [];
  return materialEntries(pricebook)
    .filter(({ item }) => materialFieldMatches(fieldKey, item))
    .map(({ item, group }: MaterialEntry) => ({
      id: `price-${item.id}`,
      value: item.name,
      label: item.name,
      meta: `${group.icon} ${group.label} · ${item.category}${item.subcategory ? ` · ${item.subcategory}` : ''}${item.article ? ` · арт. ${item.article}` : ''}`,
      price: materialPriceText(item),
      source: 'pricebook' as const,
    }));
}

export default function BlankPickerDialog(props: BlankPickerDialogProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const options = useMemo(() => {
    const all = [...dictionaryOptions(props.fieldKey, props.dicts), ...pricebookOptions(props.fieldKey, props.pricebook)];
    const seen = new Set<string>();
    return all.filter((option) => {
      const key = normalize(option.value);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [props.fieldKey, props.dicts, props.pricebook]);
  const found = useMemo(() => {
    const normalizedQuery = queryState(query);
    if (!normalizedQuery) return options;
    return options.filter((option) => normalize(`${option.label} ${option.meta} ${option.price ?? ''}`).includes(normalizedQuery));
  }, [options, query]);

  useEffect(() => {
    inputRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [props]);

  const pick = (option: BlankPickerOption) => {
    props.onPick(option.value);
    props.onClose();
  };

  return (
    <div className="modal-back" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}>
      <div className="modal blank-picker-modal" role="dialog" aria-modal="true" aria-label={`Выбор материала: ${props.fieldLabel}`}>
        <header className="blank-picker-head">
          <div>
            <h2>🎨 {props.fieldLabel}</h2>
            <div className="muted small">Материалы и цвета из разбивки фабрики и прайса. Выбор добавится к текущему значению.</div>
          </div>
          <button className="btn tiny ghost" onClick={props.onClose}>Закрыть</button>
        </header>
        {props.currentValue.trim() && (
          <div className="blank-picker-current"><b>Сейчас:</b> {props.currentValue}</div>
        )}
        <input
          ref={inputRef}
          className="search blank-picker-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Поиск по названию, артикулу, бренду…"
        />
        <div className="muted small blank-picker-count">Найдено: {found.length} · выбор закроет окно</div>
        <div className="blank-picker-list">
          {found.slice(0, 500).map((option) => (
            <button className="blank-picker-option" key={option.id} onClick={() => pick(option)}>
              <span className="blank-picker-option-main">
                <b>{option.label}</b>
                <span className="muted small">{option.meta}</span>
              </span>
              <span className={option.price ? 'blank-picker-price' : 'muted small'}>
                {option.price ?? 'разбивка цвета'}
              </span>
            </button>
          ))}
          {found.length === 0 && <div className="empty small">Ничего не найдено. Измените запрос или введите значение вручную.</div>}
          {found.length > 500 && <div className="muted small">Показаны первые 500 — уточните поиск.</div>}
        </div>
        <div className="modal-actions">
          <button className="btn ghost" onClick={props.onClose}>Отмена (Esc)</button>
        </div>
      </div>
    </div>
  );
}

function queryState(value: string): string {
  return normalize(value).trim();
}

export { BlankPickerDialog };
