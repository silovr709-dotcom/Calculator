#!/usr/bin/env python3
"""Извлекает справочники разбивок Висмы из xlsx репозитория в один JSON для приложения.

Источники (файлы в корне репозитория, загружены сотрудником):
  !разбивка 2026 ЛДСП.xlsx                          — цвета ЛДСП + артикул кромки GP
  !!разбивка ПВХ.xlsx (Лист1)                       — плёнки для фасадов МДФ (ПВХ)
  !разбивка 2026 ARPA, FENIX, AGT, Rexay.xlsx       — пластики HPL
  Каталог Фрезеровок ВИСМА 2026_compressed (1).pdf  — фрезеровки фасадов (см. extract_millings)
Правила чтения — только из самих файлов и их легенд:
  '!' — направление рисунка/текстура: по инструкции фабрики ОБЯЗАТЕЛЬНО указывать в бланке;
  '*' — плёнка изготавливается только с фрезеровкой «Мыло»;
  '**' — только фрезеровки на МДФ 16мм;
  «выведен»/«снят» — в работу не берутся.
JSON: app/public/data/factory-dicts-visma.json
"""
import json
import re
import sys
from pathlib import Path

import openpyxl

sys.path.insert(0, str(Path(__file__).resolve().parent))
from extract_millings import CATALOG as MILLINGS_FILE  # noqa: E402
from extract_millings import load_millings  # noqa: E402

OUT = 'app/public/data/factory-dicts-visma.json'
LDSP_FILE = '!разбивка 2026 ЛДСП.xlsx'
FILMS_FILE = '!!разбивка ПВХ.xlsx'
PLASTICS_FILE = '!разбивка 2026 ARPA, FENIX, AGT, Rexay.xlsx'


def clean(text):
    return re.sub(r'\s+', ' ', str(text)).strip()


def extract_ldsp():
    wb = openpyxl.load_workbook(LDSP_FILE, read_only=True)
    ws = wb['ЛДСП']
    items = []
    brand = None
    fmt = ''
    category = ''
    for row in ws.iter_rows(values_only=True):
        c0 = clean(row[0]) if row and row[0] else ''
        c6 = clean(row[6]) if len(row) > 6 and row[6] else ''
        if not c0 or c0.startswith('!!!'):
            continue
        cat = re.match(r'^(\d) категория', c0)
        brand_match = re.match(r'^([А-ЯA-Za-z]+)\s+(\d{4}\*\d{4}\*\d+)', c0)
        if brand_match:
            brand, fmt, category = brand_match.group(1), brand_match.group(2), ''
            continue
        if cat:
            category = f'{cat.group(1)} категория'
            continue
        if brand is None or 'артикул' in c0.lower() or 'кромка' in c0.lower() or c0.lower().startswith('лдсп'):
            continue
        texture = c0.startswith('!')
        name = c0.lstrip('!').strip()
        items.append({
            'name': name,
            'texture': texture,
            'brand': brand,
            'format': fmt,
            'category': category,
            'edgingArticle': c6 or None,
        })
    wb.close()
    return items


FILM_STATUS = [('выведен', 'выведена'), ('снят', 'снята')]


def parse_film_cell(code_raw, name_raw):
    code = clean(code_raw)
    name = clean(name_raw)
    if not name or 'пленки нет' in name.lower():
        return None
    flags = {'texture': '!' in code}
    if code.startswith('**'):
        flags['onlyMdf16'] = True
    elif code.startswith('*'):
        flags['onlyMillingMilo'] = True
    codes = code.lstrip('*!').strip()
    if not codes or codes.endswith(')'):
        return None
    status = 'в работе'
    lowered = name.lower()
    for marker, value in FILM_STATUS:
        if marker in lowered:
            status = value
            break
    for marker, _ in FILM_STATUS:
        name = re.sub(rf'\s*{marker}\w*\s*', ' ', name, flags=re.IGNORECASE).strip()
    return {'code': codes, 'name': name, 'status': status, **flags}


def extract_films():
    wb = openpyxl.load_workbook(FILMS_FILE, read_only=True)
    ws = wb['Лист1']
    items = []
    brand, category = None, ''
    block = re.compile(r'^(.+?)\s*\(\s*(\d)\s*кат\s*\)$')
    for row in ws.iter_rows(values_only=True):
        c0 = clean(row[0]) if row and row[0] else ''
        m = block.match(c0)
        if m and not any(ch.isdigit() for ch in m.group(1)):
            brand, category = clean(m.group(1)), f'{m.group(2)} кат'
            continue
        for off in (0, 6, 12, 18):
            code_raw = row[off] if len(row) > off else None
            name_raw = row[off + 2] if len(row) > off + 2 else None
            if not code_raw or not name_raw:
                continue
            item = parse_film_cell(code_raw, name_raw)
            if item and brand:
                items.append({**item, 'brand': brand, 'category': category})
    wb.close()
    return items


def extract_plastics():
    wb = openpyxl.load_workbook(PLASTICS_FILE, read_only=True)
    items = []
    for sheet in ('ARPA', 'Rexay', 'FENIX'):
        ws = wb[sheet]
        rows = list(ws.iter_rows(values_only=True))
        for r in rows[2:]:
            article = clean(r[0]) if r and r[0] else ''
            name = clean(r[2]) if len(r) > 2 and r[2] else ''
            category = clean(r[3]) if len(r) > 3 and r[3] else ''
            fmt = clean(r[1]) if len(r) > 1 and r[1] else ''
            if not article or not name:
                continue
            status = 'в работе'
            if 'снят' in category.lower():
                status, category = 'снята', ''
            items.append({'article': article, 'name': name, 'brand': sheet,
                          'format': fmt or None, 'category': category or None, 'status': status})
    wb.close()
    return items


def main():
    millings, milling_issues = load_millings()
    data = {
        'id': 'visma-dicts-2026',
        'name': 'Справочники разбивок Висма',
        'sources': [LDSP_FILE, FILMS_FILE, PLASTICS_FILE, MILLINGS_FILE],
        'groups': {
            'ldspColors': {
                'label': 'Цвета ЛДСП (разбивка 2026)',
                'items': extract_ldsp(),
            },
            'films': {
                'label': 'Плёнки для фасадов МДФ (ПВХ)',
                'legend': {
                    'texture': '«!» — направление рисунка: обязательно указывать в бланке',
                    'onlyMillingMilo': '«*» — только с фрезеровкой «Мыло»',
                    'onlyMdf16': '«**» — только фрезеровки на МДФ 16 мм',
                    'status': '«выведена»/«снята» — в работу не берутся',
                },
                'items': extract_films(),
            },
            'plastics': {
                'label': 'Пластики HPL (фасады)',
                'items': extract_plastics(),
            },
            'millings': {
                'label': 'Фрезеровки фасадов (каталог 2026)',
                'legend': {
                    'category': 'Категория 1–4 — ею прайс 2026 задаёт цену фасада (ПВХ и эмаль)',
                    'coatings': '«Возможность изготовления» — в чём фабрика делает фрезеровку',
                    'sizes': 'Размеры — допустимые «высота*ширина» в мм для глухого, РК, РБК и ящика',
                    'source': 'Источник — страница PDF каталога, по ней значение можно перепроверить',
                },
                'issues': milling_issues,
                'items': millings,
            },
        },
    }
    total = sum(len(g['items']) for g in data['groups'].values())
    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
    for key, group in data['groups'].items():
        print(f"{key}: {len(group['items'])}")
    print(f'ИТОГО {total} позиций → {OUT}')
    if total < 100:
        sys.exit('слишком мало позиций — проверить парсер')


if __name__ == '__main__':
    main()
