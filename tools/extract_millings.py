#!/usr/bin/env python3
"""Справочник фрезеровок Висмы из «Каталог Фрезеровок ВИСМА 2026».

Каталог свёрстан с текстом в кривых — текстового слоя в PDF нет, автоматически
распарсить его нечем. Поэтому источник истины — расшифровка страниц каталога
в `tools/millings-visma-2026.tsv`: одна строка = одна страница каталога, в каждой
строке есть номер страницы PDF, по которому значение можно перепроверить глазами.

Этот скрипт только читает расшифровку, проверяет её на непротиворечивость и
отдаёт нормализованный список; его подключает `tools/extract_factory_dicts.py`.
Картинки фрезеровок рендерит отдельный скрипт `tools/render_milling_images.py`.

Запуск отдельно (отчёт в консоль):  python3 tools/extract_millings.py
"""
from __future__ import annotations

import csv
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TSV = ROOT / "tools" / "millings-visma-2026.tsv"
CATALOG = "Каталог Фрезеровок ВИСМА 2026_compressed (1).pdf"

FIRST_PAGE, LAST_PAGE = 2, 61          # страницы PDF с фрезеровками
CATALOG_PAGES = 76                     # всего страниц в каталоге
CATEGORIES = (1, 2, 3, 4)              # ровно столько категорий и в прайсе 2026

# Кириллица → латиница для имён файлов с картинками.
TRANSLIT = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e', 'ж': 'zh',
    'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
    'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'c',
    'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e',
    'ю': 'yu', 'я': 'ya',
}

NOT_MADE = 'не изготавливается'


def slugify(name: str) -> str:
    out = ''.join(TRANSLIT.get(ch, ch) for ch in name.lower())
    return re.sub(r'[^a-z0-9]+', '-', out).strip('-')


def _opt(value: str) -> str | None:
    """Прочерк в каталоге — это «не указано», а не пустая строка."""
    value = value.strip()
    return None if value in ('', '-') else value


def _size(value: str) -> str | None:
    """Размер либо есть, либо фабрика такой фасад не делает (тогда None)."""
    value = value.strip()
    if value in ('', '-') or value.lower() == NOT_MADE:
        return None
    return value


def _coatings(value: str) -> list[str]:
    """«ПВХ, эмаль» → ['ПВХ', 'эмаль'] в стабильном порядке."""
    parts = [p.strip().lower() for p in value.split(',') if p.strip()]
    order = {'пвх': 0, 'эмаль': 1}
    parts.sort(key=lambda p: order.get(p, 9))
    return ['ПВХ' if p == 'пвх' else 'эмаль' for p in parts]


def read_rows() -> list[dict[str, str]]:
    with TSV.open(encoding='utf-8') as fh:
        lines = [ln for ln in fh if not ln.startswith('#')]
    return list(csv.DictReader(lines, delimiter='\t'))


def load_millings() -> tuple[list[dict], list[dict]]:
    """Возвращает (позиции, проблемы источника)."""
    items: list[dict] = []
    issues: list[dict] = []
    seen_names: set[str] = set()
    seen_pdf: set[int] = set()
    printed: dict[int, list[str]] = {}

    for row in read_rows():
        name = row['name'].strip()
        pdf_page = int(row['pdf_page'])
        printed_page = int(row['printed_page'])
        category = int(row['category'])

        if name in seen_names:
            issues.append({'level': 'error', 'text': f'дубль названия «{name}»'})
        if pdf_page in seen_pdf:
            issues.append({'level': 'error', 'text': f'дубль страницы PDF {pdf_page}'})
        if category not in CATEGORIES:
            issues.append({'level': 'error', 'text': f'{name}: категория {category} вне 1–4'})
        if not FIRST_PAGE <= pdf_page <= LAST_PAGE:
            issues.append({'level': 'error', 'text': f'{name}: страница PDF {pdf_page} вне {FIRST_PAGE}–{LAST_PAGE}'})
        seen_names.add(name)
        seen_pdf.add(pdf_page)
        printed.setdefault(printed_page, []).append(name)

        coatings = _coatings(row['coatings'])
        slug = slugify(name)
        items.append({
            'name': name,
            'slug': slug,
            'category': category,
            'categoryLabel': f'{category} категория',
            'faska': _opt(row['faska']),
            'frameWidthMm': _opt(row['frame_width']),
            'mdfThicknessMm': row['mdf'].strip(),
            'coatings': coatings,
            'onlyEnamel': coatings == ['эмаль'],
            'sizes': {
                'blind': _size(row['blind']),
                'rk': _size(row['rk']),
                'rbk': _size(row['rbk']),
                'drawer': _size(row['drawer']),
            },
            'stepMm': _opt(row['step']),
            'note': _opt(row['note']),
            'image': f'img/millings/{slug}.jpg',
            'source': {'file': CATALOG, 'pdfPage': pdf_page, 'printedPage': printed_page},
        })

    if len(items) != LAST_PAGE - FIRST_PAGE + 1:
        issues.append({'level': 'error', 'text': f'позиций {len(items)}, ожидалось {LAST_PAGE - FIRST_PAGE + 1}'})

    # Нумерация в подвале каталога: проверяем и фиксируем расхождения как есть.
    for page, names in sorted(printed.items()):
        if len(names) > 1:
            issues.append({
                'level': 'warn',
                'text': f'в каталоге номер страницы {page} напечатан дважды: {", ".join(names)} '
                        f'— опечатка вёрстки, ссылаться нужно на страницу PDF',
            })
    for item in items:
        expected = item['source']['pdfPage'] - 1
        if item['source']['printedPage'] != expected:
            issues.append({
                'level': 'warn',
                'text': f'{item["name"]}: в подвале напечатано {item["source"]["printedPage"]}, '
                        f'а по порядку это {expected} (страница PDF {item["source"]["pdfPage"]})',
            })

    return items, issues


def main() -> int:
    items, issues = load_millings()
    by_cat: dict[int, list[str]] = {}
    for item in items:
        by_cat.setdefault(item['category'], []).append(item['name'])
    print(f'Фрезеровки Висма 2026: {len(items)} позиций из «{CATALOG}»')
    for cat in sorted(by_cat):
        print(f'  {cat} категория: {len(by_cat[cat]):2d} — {", ".join(by_cat[cat])}')
    only_enamel = [i['name'] for i in items if i['onlyEnamel']]
    print(f'  только эмаль: {len(only_enamel)} — {", ".join(only_enamel)}')
    if issues:
        print(f'\nПроблемы источника ({len(issues)}):')
        for issue in issues:
            print(f'  [{issue["level"]}] {issue["text"]}')
    errors = [i for i in issues if i['level'] == 'error']
    if errors:
        return 1
    if not (ROOT / CATALOG).exists():
        print(f'\n! каталога {CATALOG} нет в репозитории — расшифровку не с чем сверить')
    return 0


if __name__ == '__main__':
    sys.exit(main())
