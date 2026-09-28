# -*- coding: utf-8 -*-
"""
ETL: ВИСМА 2026 КХМ.xlsm -> нормализованная база цен (JSON) + отчёт о проблемах.

Принципы:
- НИ ОДНА цена не придумывается: всё берётся из ячеек прайса.
- Позиции без цены / с текстовой ценой помечаются флагами и попадают в отчёт.
- Каждая позиция хранит источник (лист, строка) для сверки вручную.

Запуск:  python3 tools/extract_pricebook.py "ВИСМА 2026 КХМ.xlsm" app/public/data/pricebook-visma-2026.json
"""
import sys, json, re, datetime, hashlib
import openpyxl

SRC = sys.argv[1] if len(sys.argv) > 1 else "ВИСМА 2026 КХМ.xlsm"
DST = sys.argv[2] if len(sys.argv) > 2 else "app/public/data/pricebook-visma-2026.json"

wb = openpyxl.load_workbook(SRC, read_only=True, data_only=True)

items = []      # нормализованные позиции
issues = []     # проблемы исходного прайса
refs = {}       # справочные таблицы (декоры и т.п.)
notes = {}      # текстовые примечания листов

def clean(s):
    if s is None: return ""
    return re.sub(r"\s+", " ", str(s)).strip()

def add_issue(kind, sheet, row, detail):
    issues.append({"kind": kind, "sheet": sheet, "row": row, "detail": detail})

_id_counter = [0]
def mkid(sheet, row, suffix=""):
    _id_counter[0] += 1
    base = f"{sheet}:{row}:{suffix}:{_id_counter[0]}"
    return "it_" + hashlib.md5(base.encode()).hexdigest()[:10]

def parse_price(v):
    """-> (kind, value). kind: fixed | percent | unavailable | text | empty"""
    if v is None: return ("empty", None)
    if isinstance(v, (int, float)):
        return ("fixed", round(float(v), 2))
    s = clean(v)
    if not s: return ("empty", None)
    low = s.lower()
    if "недоступ" in low or "выведен" in low or low == "нет":
        return ("unavailable", None)
    m = re.match(r"^\+\s*(\d+(?:[.,]\d+)?)\s*%", s)
    if m:
        return ("percent", float(m.group(1).replace(",", ".")))
    m = re.fullmatch(r"\+\s*(\d+)\s*", s)
    if m:
        return ("surcharge", float(m.group(1)))
    m = re.fullmatch(r"(\d[\d\s]*)(?:[.,]\d+)?\s*(?:руб.*|р\.?|₽)?", s)
    if m:
        num = m.group(1).replace(" ", "").replace("\xa0", "")
        try: return ("fixed", float(num))
        except ValueError: pass
    return ("text", s)

def add_item(sheet, row, category, subcategory, name, unit, price_raw, *,
             article=None, price_basis=None, attrs=None, note=None, group=None):
    name = clean(name)
    unit = clean(unit) or None
    kind, val = parse_price(price_raw)
    it = {
        "id": mkid(sheet, row, name[:20]),
        "category": category,
        "subcategory": subcategory,
        "name": name,
        "article": clean(article) or None,
        "unit": unit,
        "priceKind": kind,             # fixed | percent | surcharge | unavailable | text | empty
        "price": val,
        "priceRaw": clean(price_raw) if kind in ("text",) else None,
        "priceBasis": price_basis,     # unit | m2 | lm | sheet | percent_of_base
        "attrs": attrs or {},
        "note": clean(note) or None,
        "group": group,
        "source": {"sheet": sheet, "row": row},
    }
    items.append(it)
    if not name:
        add_issue("no_name", sheet, row, "Позиция без названия")
    if kind == "empty":
        add_issue("empty_price", sheet, row, f"Пустая цена: {name}")
    if kind == "text":
        add_issue("text_price", sheet, row, f"Нечисловая цена «{clean(price_raw)}»: {name}")
    if kind == "unavailable":
        add_issue("unavailable", sheet, row, f"Позиция недоступна/выведена: {name}")
    if not unit and kind in ("fixed",):
        add_issue("no_unit", sheet, row, f"Нет единицы измерения: {name}")
    if kind == "fixed" and val is not None and val <= 0:
        add_issue("zero_price", sheet, row, f"Ноль/отрицательная цена ({val}): {name}")
    return it

# ------------------------------------------------------------------ каркасы
def do_karkas(sheet, category):
    ws = wb[sheet]
    cur_name = None
    for i, row in enumerate(ws.iter_rows(values_only=True), 1):
        if i == 1: continue
        name = clean(row[1]) if len(row) > 1 else ""
        art  = row[2] if len(row) > 2 else None
        size = clean(row[3]) if len(row) > 3 else ""
        price = row[4] if len(row) > 4 else None
        if name: cur_name = name
        if art is None and not size and price is None:
            continue
        if price is None and not size:
            continue
        full = cur_name or "(без названия)"
        low = full.lower()
        if sheet == "каркас шк":
            sub = "Шкафы навесные"
            if "виница" in low: sub = "Винницы"
            elif "антресол" in low: sub = "Антресоли"
            elif "полк" in low and "открыт" in low: sub = "Открытые полки"
            elif "углов" in low: sub = "Угловые шкафы"
            elif "торцев" in low: sub = "Торцевые шкафы"
            elif "буфет" in low: sub = "Буфеты"
            elif "хлебница" in low: sub = "Хлебницы"
        else:
            sub = "Столы напольные"
            if "пенал" in low: sub = "Пеналы"
            elif "виница" in low: sub = "Винницы"
            elif "мойк" in low: sub = "Столы под мойку"
            elif "углов" in low: sub = "Угловые столы"
            elif "торцев" in low or "радиус" in low: sub = "Торцевые/радиусные"
            elif "дш" in low or "духов" in low: sub = "Под духовой шкаф"
            elif "ящик" in low: sub = "Столы с ящиками"
        add_item(sheet, i, category, sub, f"{full} — {size}", "шт", price,
                 article=art, price_basis="unit",
                 attrs={"размер": size, "серия": full})
        if art is None:
            add_issue("no_article", sheet, i, f"Нет № арт: {full} {size}")

do_karkas("каркас шк", "Корпуса: шкафы навесные")
do_karkas("каркас ст", "Корпуса: столы и пеналы")

# ------------------------------------------------------------ Доп комплект
SECTION_MAP = [
    ("длинномер", ("Цоколь и длинномеры", None)),
    ("прочее", ("Дополнительные элементы", "Прочее")),
    ("крепеж полок", ("Дополнительные элементы", "Крепёж полок")),
    ("планки", ("Столешницы: комплектующие", "Планки")),
    ("петли", ("Петли", None)),
    ("толкатели петель", ("Петли", "Толкатели")),
    ("системы выдвижения", ("Системы выдвижения", None)),
    ("подъемные механизмы", ("Подъёмные механизмы", None)),
    ("посудосушители", ("Посудосушители", None)),
    ("сетчатое наполнение", ("Бутылочницы и карго", None)),
    ("опоры", ("Опоры и ножки", None)),
    ("лотки", ("Внутреннее наполнение", "Лотки")),
    ("хромированные трубы", ("Внутреннее наполнение", "Рейлинги/трубы")),
    ("системы раздвижных дверей", ("Фурнитура", "Раздвижные системы")),
    ("свет", ("Электрика и свет", None)),
    ("дополнительная упаковка", ("Упаковка", None)),
]
def dop_section(title):
    low = title.lower()
    for key, dest in SECTION_MAP:
        if low.startswith(key): return dest
    return None

ws = wb["Доп комплект"]
cat, sub = "Доп. комплектация каркасов", "Работы и надбавки"
for i, row in enumerate(ws.iter_rows(values_only=True), 1):
    name = clean(row[0]) if len(row) > 0 else ""
    unit = clean(row[6]) if len(row) > 6 else ""
    price = row[7] if len(row) > 7 else None
    if not name and price is None: continue
    if name.lower().startswith("наименование"): continue  # шапка таблицы
    if name and not unit and price is None:
        dest = dop_section(name)
        if dest:
            cat = dest[0]; sub = dest[1] or name.split("\n")[0][:60]
        elif i <= 2:
            pass
        else:
            # текстовое примечание
            notes.setdefault("Доп комплект", []).append(name)
        continue
    low = name.lower()
    sub2 = sub
    if cat == "Петли":
        if "толкатель" in low: sub2 = "Толкатели"
        elif "boyard" in low or "боярд" in low: sub2 = "Боярд"
        elif "blum" in low or "блюм" in low or "blumotion" in low: sub2 = "Blum"
        elif "titus" in low: sub2 = "Titus"
        elif "hettich" in low: sub2 = "Hettich"
        elif "pulse" in low: sub2 = "Pulse"
        else: sub2 = sub or "Петли"
    if cat == "Системы выдвижения":
        if low.startswith("т/б"): sub2 = "Тандембоксы"
        elif low.startswith("л/б") or "леграбокс" in low: sub2 = "Леграбокс"
        elif low.startswith(("нпв", "тчо", "тпо")): sub2 = "Направляющие"
        else: sub2 = sub or "Системы выдвижения"
    basis = "unit"
    ulow = unit.lower()
    if "кв.м" in ulow or "м2" in ulow or "м²" in ulow: basis = "m2"
    elif "п.м" in ulow or "п/м" in ulow or "метр" in ulow: basis = "lm"
    kind, _ = parse_price(price)
    if kind == "percent": basis = "percent_of_base"
    add_item("Доп комплект", i, cat, sub2 or "Прочее", name, unit or None, price,
             price_basis=basis)

# ------------------------------------------------------------------- BLUM
ws = wb["BLUM"]
for i, row in enumerate(ws.iter_rows(values_only=True), 1):
    if i <= 2: continue
    name = clean(row[0]) if len(row) > 0 else ""
    unit = clean(row[1]) if len(row) > 1 else ""
    price = row[2] if len(row) > 2 else None
    if not name or (price is None and not unit): 
        continue
    low = name.lower()
    if "петля" in low or "петли" in low or "blumotion" in low or "ограничитель" in low:
        sub = "Петли Blum"
    elif "aventos" in low:
        sub = "Aventos"
    elif low.startswith(("т/б", "тандем", "леграбокс", "тпо", "тчо", "блюм м/б")):
        sub = "Ящики и направляющие Blum"
    elif "лоток" in low:
        sub = "Лотки Blum"
    else:
        sub = "Прочее Blum"
    add_item("BLUM", i, "Фурнитура BLUM (доп. лист)", sub, name, unit or None, price,
             price_basis="unit", note="Лист BLUM (скрытый в исходном прайсе)")

# --------------------------------------------------------------- МДФ(ПВХ)
ws = wb["МДФ(ПВХ)"]
rows = list(ws.iter_rows(values_only=True))
CATS = [
    ("1 категория (плёнки)", [6, 7, 8]),
    ("2 категория (плёнки)", [9, 10, 11]),
    ("3 категория (плёнки)", [12, 13, 14]),
    ("4 категория (плёнки)", [15, 16, 17]),
    ("Матовая + патина", [18, 19, 20]),
]
THICK = ["16мм", "19мм", "22мм"]
def mdf_unit(label):
    l = label.lower()
    if "кв.м" in l or "квадратн" in l: return ("кв.м", "m2")
    if "кратно метру" in l or "п.м" in l: return ("шт (кратно метру)", "unit")
    return ("шт", "unit")
for ri, row in enumerate(rows, 1):
    if ri < 5 or ri > 19: continue
    label = clean(row[0]) if len(row) > 0 else ""
    if not label: continue
    unit, basis = mdf_unit(label)
    for cat_name, cols in CATS:
        for ci, col in enumerate(cols):
            v = row[col - 1] if len(row) >= col else None
            if v is None: continue
            kind, _ = parse_price(v)
            if kind == "empty": continue
            add_item("МДФ(ПВХ)", ri, "Фасады: МДФ (ПВХ плёнка)", cat_name,
                     f"{label} — {THICK[ci]}", unit, v,
                     price_basis=basis,
                     attrs={"толщина": THICK[ci], "категория": cat_name, "изделие": label},
                     group="mdf_pvh")
notes["МДФ(ПВХ)"] = [clean(r[0]) for r in rows[19:28] if r and clean(r[0])]

# ------------------------------------------------------------------ Эмаль
ws = wb["Эмаль"]
rows = list(ws.iter_rows(values_only=True))
EMAL_COLS = [
    (3, "фрезеровка 19 мыло/R3"),
    (4, "фрезеровка 1 кат"),
    (5, "фрезеровка 2 кат"),
    (6, "фрезеровка 3 кат"),
    (7, "фрезеровка 4 кат"),
]
for ri, row in enumerate(rows, 1):
    if ri < 4 or ri > 42: continue
    label = clean(row[0]) if len(row) > 0 else ""
    if not label: continue
    low = label.lower()
    unit, basis = ("кв.м", "m2") if "(кв.м" in low or "кв.м)" in low else ("шт", "unit")
    if "кратно метру" in low: unit = "шт (кратно метру)"
    vals = [(cn, row[c-1] if len(row) >= c else None) for c, cn in EMAL_COLS]
    nonempty = [(cn, v) for cn, v in vals if v is not None and clean(v) != ""]
    if not nonempty: continue
    if len(nonempty) == 1:
        cn, v = nonempty[0]
        add_item("Эмаль", ri, "Фасады: Эмаль", "Декоративные элементы", label, unit, v,
                 price_basis=basis, group="emal")
    else:
        for cn, v in nonempty:
            add_item("Эмаль", ri, "Фасады: Эмаль", cn, f"{label} — {cn}", unit, v,
                     price_basis=basis, attrs={"фрезеровка": cn, "изделие": label},
                     group="emal")
notes["Эмаль"] = [clean(r[0]) for r in rows[42:44] if r and clean(r[0])] + [clean(rows[0][0])]

# ---------------------------------------------------------------- ПЛАСТИК
ws = wb["ПЛАСТИК"]
rows = list(ws.iter_rows(values_only=True))
PLASTIC_BRANDS = [
    ("ARPA/ABET (3050*1300), кромка ПВХ 1мм", [(2, "1 кат"), (3, "2 кат"), (4, "3 кат"), (5, "4 кат"), (6, "5 кат")]),
    ("FENIX (3050*1300), кромка 0,8мм в цвет", [(7, "1 кат"), (8, "2 кат")]),
    ("AGT (2800*1220*18), кромка ПВХ 1мм в цвет", [(9, "1 кат"), (10, "2 кат"), (11, "3 кат")]),
    ("Rexay (1220*2800 / 1220*2400), кромка ПВХ 1мм", [(12, "1 кат"), (13, "2 кат")]),
]
for ri, row in enumerate(rows, 1):
    if ri not in (5, 6): continue
    label = clean(row[0])
    unit, basis = ("кв.м", "m2") if "кв" in label.lower() else ("шт", "unit")
    pretty = "Фасад пластик, кв.м" if basis == "m2" else "Фасад пластик R300, шт"
    for brand, cols in PLASTIC_BRANDS:
        for c, catn in cols:
            v = row[c-1] if len(row) >= c else None
            if v is None: continue
            kind, _ = parse_price(v)
            if kind == "empty": continue
            add_item("ПЛАСТИК", ri, "Фасады: Пластик (HPL)", brand,
                     f"{pretty} — {brand.split(' ')[0]} {catn}", unit, v,
                     price_basis=basis, attrs={"бренд": brand, "категория": catn},
                     group="plastic")
notes["ПЛАСТИК"] = [clean(r[0]) for r in rows[6:18] if r and clean(r[0])]

# -------------------------------------------------------------------- TSS
ws = wb["TSS "]
rows = list(ws.iter_rows(values_only=True))
cur_coll, cur_price = None, None
tss_decors = []
for ri, row in enumerate(rows, 1):
    if ri < 4 or ri > 67: continue
    coll = clean(row[0]) if len(row) > 0 else ""
    art = clean(row[1]) if len(row) > 1 else ""
    dec = clean(row[2]) if len(row) > 2 else ""
    availability = clean(row[3]) if len(row) > 3 else ""
    p18 = row[4] if len(row) > 4 else None
    if coll: cur_coll = coll
    if p18 is not None and clean(p18):
        cur_price = p18
        kindname = f"TSS Eterno, коллекция {cur_coll} — 18мм"
        add_item("TSS ", ri, "Фасады: TSS плита", cur_coll, kindname, "кв.м", 
                 re.sub(r"\D.*$", "", clean(p18).split("\n")[0]) or p18,
                 price_basis="m2", attrs={"коллекция": cur_coll}, group="tss")
    if art:
        tss_decors.append({"коллекция": cur_coll, "артикул": art, "декор": dec,
                           "наличие": availability})
refs["tss_decors"] = tss_decors
notes["TSS"] = [clean(r[0]) for r in rows[67:69] if r and clean(r[0])]

# --------------------------------------------------------- компакс SLOTEX
ws = wb["компакс SLOTEX"]
rows = list(ws.iter_rows(values_only=True))
slotex_decors = []
for ri, row in enumerate(rows, 1):
    if 2 <= ri <= 7:
        name = clean(row[0]); fmt = clean(row[1]); th = clean(row[2])
        for c, ser in ((5, "E1"), (6, "E2"), (7, "E3"), (8, "Mobius")):
            v = row[c-1] if len(row) >= c else None
            if v is None or not clean(v): continue
            add_item("компакс SLOTEX", ri, "Столешницы: компакт-плита Slotex", ser,
                     f"{name} {fmt} {th} — серия {ser}", "шт (лист)", v,
                     price_basis="sheet", attrs={"формат": fmt, "толщина": th, "серия": ser},
                     group="slotex")
    elif 10 <= ri <= 13:
        name = clean(row[0]); v = row[4] if len(row) > 4 else None
        if name and v is not None:
            u = "шт"; 
            if "пм" in clean(v).lower() or "п/м" in name.lower(): u = "п.м"
            add_item("компакс SLOTEX", ri, "Столешницы: компакт-плита Slotex",
                     "Операции", name, u, v, price_basis="unit")
    elif ri >= 17:
        ser = clean(row[0]); code = clean(row[3]) if len(row) > 3 else ""
        nm_en = clean(row[4]) if len(row) > 4 else ""
        nm_ru = clean(row[5]) if len(row) > 5 else ""
        if ser and code:
            slotex_decors.append({"серия": ser, "код": code, "name_en": nm_en, "name_ru": nm_ru})
refs["slotex_decors"] = slotex_decors

# ----------------------------------------------------- компакт Arkobaleno
ws = wb["компакт Arkobaleno"]
rows = list(ws.iter_rows(values_only=True))
for ri, row in enumerate(rows, 1):
    if 2 <= ri <= 5:
        name = clean(row[0]); v = row[1] if len(row) > 1 else None
        if name and v is not None:
            u = "п.м" if "пм" in clean(v).lower() else "шт"
            add_item("компакт Arkobaleno", ri, "Столешницы: компакт-плита Arkobaleno",
                     "Операции", name, u, v, price_basis="unit")
    elif ri >= 9:
        for base_c, price_c, unit_c in ((0, 1, 2), (3, 4, 5)):
            name = clean(row[base_c]) if len(row) > base_c else ""
            v = row[price_c] if len(row) > price_c else None
            u = clean(row[unit_c]) if len(row) > unit_c else ""
            if not name or v is None: continue
            fmt = "4200*1320" if base_c == 0 else "4200*650"
            add_item("компакт Arkobaleno", ri, "Столешницы: компакт-плита Arkobaleno",
                     fmt, name if base_c == 0 else f"{name} [формат {fmt}]",
                     u or "шт", v, price_basis="sheet", attrs={"формат": fmt},
                     group="arkobaleno")

# ------------------------------------------------------------------ пф МС
ws = wb["пф МС"]
rows = list(ws.iter_rows(values_only=True))
MS_CATS = [(1, "1 категория"), (3, "2 категория"), (5, "3 категория"), (7, "4 категория"),
           (9, "5 категория"), (11, "6 категория"), (13, "7 категория"), (15, "8 категория"),
           (17, "9 категория"), (19, "10 категория")]
def ms_pair(v):
    """'26/38 мм\n4700/6800₽' -> (4700, 6800): берём пару, где оба числа >= 1000"""
    s = clean(v).replace("\xa0", " ")
    for m in re.finditer(r"(\d+)\s*/\s*(\d+)", s):
        a, b = float(m.group(1)), float(m.group(2))
        if a >= 1000 and b >= 1000:
            return a, b
    return None
ms_items = [
    (3, 4, "Стеновая панель 600*3000*4", "шт (хлыст)", "single"),
    (5, 6, "Столешница 600*3000 (хлыст/полхлыста)", "шт (хлыст 3000)", "pair"),
    (7, 8, "Столешница 800*800", "шт", "pair"),
    (9, 10, "Столешница 900*900", "шт", "pair"),
    (11, 12, "Столешница 1200*3000 (только целый хлыст)", "шт (хлыст)", "pair"),
    (13, 14, "Столешница 600*3500*38 (только целый хлыст)", "шт (хлыст)", "single38"),
    (15, 16, "Столешница 600*4100*38 (только целый хлыст)", "шт (хлыст)", "single38"),
]
for hdr_row, val_row, label, unit, mode in ms_items:
    row = rows[val_row-1]
    for c, catn in MS_CATS:
        v = row[c-1] if len(row) >= c else None
        if v is None or not clean(v): continue
        if clean(v).lower() == "нет":
            add_issue("unavailable", "пф МС", val_row, f"{label} {catn}: нет")
            continue
        if mode == "pair":
            pr = ms_pair(v)
            if pr:
                add_item("пф МС", val_row, "Столешницы: Мир Столешниц (постформинг)", catn,
                         f"{label} — 26мм", unit, pr[0], price_basis="sheet",
                         attrs={"толщина": "26мм", "категория": catn}, group="ms")
                add_item("пф МС", val_row, "Столешницы: Мир Столешниц (постформинг)", catn,
                         f"{label} — 38мм", unit, pr[1], price_basis="sheet",
                         attrs={"толщина": "38мм", "категория": catn}, group="ms")
            else:
                add_issue("parse", "пф МС", val_row, f"Не удалось разобрать пару цен «{clean(v)}» ({label}, {catn})")
        else:
            th = "38мм" if mode == "single38" else "4мм"
            add_item("пф МС", val_row, "Столешницы: Мир Столешниц (постформинг)", catn,
                     f"{label}", unit, v, price_basis="sheet",
                     attrs={"толщина": th, "категория": catn}, group="ms")
# декоры МС по категориям
ms_decors = []
for ri in range(19, 60):
    row = rows[ri-1] if len(rows) >= ri else None
    if not row: continue
    for c, catn in MS_CATS:
        code = clean(row[c-1]) if len(row) >= c else ""
        nm = clean(row[c]) if len(row) > c else ""
        if code and (nm or code):
            ms_decors.append({"категория": catn, "код": code, "декор": nm})
refs["ms_decors"] = ms_decors
notes["пф МС"] = [clean(rows[59][0]), clean(rows[60][0]), clean(rows[61][0]), clean(rows[73][0])]

# ---------------------------------------------------------------- пф СОЮЗ
ws = wb["пф СОЮЗ"]
rows = list(ws.iter_rows(values_only=True))
SOUZ_CATS = [(3, "Universal"), (4, "Classic"), (5, "Standart pro"), (6, "Premium"), (7, "Premium+")]
for ri in range(2, 8):
    row = rows[ri-1]
    size = clean(row[1])
    if not size: continue
    for c, catn in SOUZ_CATS:
        v = row[c-1] if len(row) >= c else None
        if v is None: continue
        add_item("пф СОЮЗ", ri, "Столешницы: СОЮЗ (постформинг)", catn,
                 f"Столешница/панель СОЮЗ {size} — {catn}", "шт (хлыст)", v,
                 price_basis="sheet", attrs={"формат": size, "категория": catn}, group="souz")
souz_decors = []
cur = None
for ri, row in enumerate(rows, 1):
    if ri < 10: continue
    a = clean(row[0]) if len(row) > 0 else ""
    nm = clean(row[1]) if len(row) > 1 else ""
    catn = clean(row[2]) if len(row) > 2 else ""
    sizes = clean(row[3]) if len(row) > 3 else ""
    if a.lower() == "артикул": continue
    if a and catn:
        souz_decors.append({"артикул": a, "декор": nm, "категория": catn, "размеры": sizes})
refs["souz_decors"] = souz_decors

# --------------------------------------------------------- Стекло+ал рамка
ws = wb["Стекло+ал рамка"]
rows = list(ws.iter_rows(values_only=True))
sub = "Стекло"
# Добавляем рамки после основных строк листа, чтобы появление новых позиций
# не меняло исторические id всех последующих позиций прайса.
frame_surcharges = []
for ri, row in enumerate(rows, 1):
    if ri == 1: continue
    name = clean(row[0]) if len(row) > 0 else ""
    size = clean(row[1]) if len(row) > 1 else ""
    price = row[2] if len(row) > 2 else None
    unit = clean(row[3]) if len(row) > 3 else ""
    if not name: continue
    low = name.lower()
    # В исходном листе доплата за алюминиевую рамку записана отдельной строкой
    # без цены в колонке C: «к стоимости выбранного стекла/зеркала + 6000
    # руб/кв.м.». Это не текстовая заметка, а самостоятельная фиксированная
    # позиция за м², которую можно выбрать дополнительно к стеклу.
    frame_surcharge = re.search(r"\+\s*(\d+)\s*руб\s*/\s*(?:кв\.?\s*м|м2|м²)", low)
    if price is None and frame_surcharge:
        frame_surcharges.append((ri, sub, float(frame_surcharge.group(1))))
        continue
    if price is None and not size and not unit:
        # заголовок секции
        if "зеркал" in low: sub = "Зеркала"
        elif "рамка" in low and "f1" in low: sub = "Алюм. рамка F1-10"
        elif "integro" in low: sub = "Алюм. рамка INTEGRO"
        elif "еврокромка" in low: sub = "Еврокромка"
        elif "гравировка" in low: sub = "Гравировка"
        elif "фацет" in low: sub = "Фацет"
        elif "оракал" in low or "пленк" in low: sub = "Плёнки"
        elif "наклейка зеркала" in low: sub = "Наклейка на фасад"
        elif "фотопечат" in low: sub = "Фотопечать"
        elif "покраска" in low: sub = "Покраска стекла"
        elif "пескоструй" in low: sub = "Пескоструй"
        elif "сверление" in low: sub = "Сверление"
        elif "витраж" in low: sub = "Витражи"
        elif "моллирование" in low: sub = "Моллирование"
        elif "закалка" in low: sub = "Закалка"
        else:
            notes.setdefault("Стекло", []).append(name)
        continue
    if price is None and ("+ 6000" in name or "+ 7000" in name or "+6000" in name or "+7000" in name):
        m = re.search(r"\+\s*(\d+)", name)
        add_item("Стекло+ал рамка", ri, "Фасады: Стекло и зеркала", sub,
                 name, "кв.м", "+" + m.group(1), price_basis="m2", group="glass")
        continue
    ulow = unit.lower()
    basis = "m2" if ("м2" in ulow or "кв" in ulow) else ("lm" if ("п/м" in ulow or "п.м" in ulow) else "unit")
    add_item("Стекло+ал рамка", ri, "Фасады: Стекло и зеркала", sub,
             name + (f" ({size})" if size else ""), unit or None, price,
             price_basis=basis, attrs={"размер листа": size} if size else {}, group="glass")

# ------------------------------------------------------------------ Ручки
ws = wb["Ручки"]
for i, row in enumerate(ws.iter_rows(values_only=True), 1):
    if i == 1: continue
    name = clean(row[0]) if len(row) > 0 else ""
    art = clean(row[1]) if len(row) > 1 else ""
    unit = clean(row[2]) if len(row) > 2 else ""
    price = row[4] if len(row) > 4 else None
    if not name: continue
    add_item("Ручки", i, "Ручки", "Ручки и профиль-ручки", name, unit or "шт", price,
             article=art or None, price_basis="unit")

# -------------------------------------------------------------- смесители
ws = wb["смесители"]
for i, row in enumerate(ws.iter_rows(values_only=True), 1):
    if i <= 2: continue
    name = clean(row[0]) if len(row) > 0 else ""
    dims = clean(row[2]) if len(row) > 2 else ""
    chars = clean(row[3]) if len(row) > 3 else ""
    price = row[4] if len(row) > 4 else None
    if not name or price is None and not chars: continue
    if "срок" in name.lower(): 
        notes.setdefault("смесители", []).append(name); continue
    add_item("смесители", i, "Смесители", "Смесители", f"Смеситель {name}", "шт", price,
             note=(dims + (" | " if dims and chars else "") + chars)[:400] or None,
             price_basis="unit")

# ------------------------------------------------------------------ мойки
ws = wb["мойки"]
for i, row in enumerate(ws.iter_rows(values_only=True), 1):
    if i <= 2: continue
    name = clean(row[0]) if len(row) > 0 else ""
    colors = clean(row[2]) if len(row) > 2 else ""
    price = row[3] if len(row) > 3 else None
    size = clean(row[4]) if len(row) > 4 else ""
    if not name: continue
    add_item("мойки", i, "Мойки", "Мойки (с сифоном)", f"Мойка {name}", "шт", price,
             note=(size[:250] + (" | Цвета: " + " ".join(colors.split())[:120] if colors else "")) or None,
             price_basis="unit")

# ------------------------------------------------------------------- Gola
ws = wb["Gola"]
sub = "GOLATIME / GOLIGHT"
for i, row in enumerate(ws.iter_rows(values_only=True), 1):
    name6 = clean(row[5]) if len(row) > 5 else ""
    art = clean(row[3]) if len(row) > 3 else ""
    unit = clean(row[11]) if len(row) > 11 else ""
    price = row[12] if len(row) > 12 else None
    head = clean(row[0]) if len(row) > 0 else ""
    if head and not name6:
        hl = head.lower()
        if "schuco" in hl and "подсвет" in hl: sub = "SCHUCO под подсветку"
        elif "schuco" in hl: sub = "SCHUCO"
        elif "golatime" in hl or "golight" in hl: sub = "GOLATIME / GOLIGHT"
        else: notes.setdefault("Gola", []).append(head)
        continue
    if not name6 or (price is None and not unit): continue
    if name6.lower() == "наименование": continue
    ulow = unit.lower()
    basis = "lm" if ("п.м" in ulow or "метр" in ulow) else "unit"
    add_item("Gola", i, "GOLA / профили", sub, name6, unit or None, price,
             article=art or None, price_basis=basis, group="gola")

# --------------------------------------------------- разбивка ЛДСП (файл)
try:
    wb2 = openpyxl.load_workbook("!разбивка 2026 ЛДСП.xlsx", read_only=True, data_only=True)
    ws2 = wb2["ЛДСП"]
    ldsp = []
    section = ""
    curcat = ""
    for i, row in enumerate(ws2.iter_rows(values_only=True), 1):
        c1 = clean(row[0]) if len(row) > 0 else ""
        if not c1: continue
        low = c1.lower()
        if "увадрев" in low or "ламарти" in low or "эггер" in low or "egger" in low or "lamarty" in low:
            section = c1; continue
        if re.match(r"^\d\s*категория", low):
            curcat = c1; continue
        edge_gp = clean(row[6]) if len(row) > 6 else ""
        edge_add = clean(row[7]) if len(row) > 7 else ""
        edge_1mm = clean(row[8]) if len(row) > 8 else ""
        surcharge = row[9] if len(row) > 9 else None
        waste = clean(row[10]) if len(row) > 10 else ""
        if i <= 3: continue
        ldsp.append({"декор": c1, "плита": section, "категория": curcat,
                     "кромка_база": edge_gp, "кромка_доплата_пм": edge_add,
                     "кромка_1мм_пм": edge_1mm,
                     "доплата_за_лист": surcharge if isinstance(surcharge, (int, float)) else clean(surcharge),
                     "перерасход": waste})
    refs["ldsp_decors"] = ldsp
except Exception as e:
    add_issue("import_error", "!разбивка 2026 ЛДСП.xlsx", 0, str(e))

# --------------------------------------- разбивка пластиков ARPA и др.
try:
    wb3 = openpyxl.load_workbook("!разбивка 2026 ARPA, FENIX, AGT, Rexay.xlsx", read_only=True, data_only=True)
    plastics = []
    for shname in wb3.sheetnames:
        ws3 = wb3[shname]
        for i, row in enumerate(ws3.iter_rows(values_only=True), 1):
            vals = [clean(v) for v in row if v is not None and clean(v)]
            if len(vals) < 2: continue
            art = clean(row[0]) if len(row) > 0 else ""
            if art.lower() in ("артикул", "") or "категор" in art.lower(): continue
            cat = ""
            for v in reversed([clean(x) for x in row if x is not None]):
                if re.match(r"^\d\s*к(ат)?", v.lower()) or v.lower() in ("снят", "выводим", "1 категория", "2 категория", "3 категория"):
                    cat = v; break
            nm = ""
            for v in [clean(x) for x in row[1:] if x is not None]:
                if len(v) > len(nm): nm = v
            if art and nm:
                plastics.append({"бренд": shname, "артикул": art, "наименование": nm[:160], "категория": cat})
    refs["plastic_decors"] = plastics
except Exception as e:
    add_issue("import_error", "!разбивка ARPA...", 0, str(e))

# --------------------------------------------------------- Титульный (правила)
ws = wb["Титульный"]
notes["Титульный"] = [clean(r[0]) for r in ws.iter_rows(values_only=True) if r and r[0] and clean(r[0])]

# Новые дополнительные позиции добавляем после всех исторических строк, чтобы
# их появление не меняло id уже используемых позиций в старых проектах.
for ri, frame_subcategory, frame_price in frame_surcharges:
    add_item("Стекло+ал рамка", ri, "Фасады: Стекло и зеркала", frame_subcategory,
             f"{frame_subcategory} — доплата к выбранному стеклу/зеркалу", "м2", frame_price,
             price_basis="m2",
             attrs={"тип рамки": frame_subcategory, "расчёт": "доплата к стеклу/зеркалу за м²"},
             note="Цена исходного прайса указана как доплата к выбранному стеклу/зеркалу.", group="glass")

# ------------------------------------------------------------- пост-проверки
# дубли артикулов (только числовые арт. каркасов)
seen = {}
for it in items:
    if it["article"] and it["source"]["sheet"].startswith("каркас"):
        key = it["article"]
        if key in seen:
            add_issue("dup_article", it["source"]["sheet"], it["source"]["row"],
                      f"Дубль артикула {key}: «{it['name']}» и «{seen[key]}»")
        else:
            seen[key] = it["name"]

# статистика
by_cat = {}
for it in items:
    by_cat.setdefault(it["category"], {"count": 0, "priced": 0})
    by_cat[it["category"]]["count"] += 1
    if it["priceKind"] == "fixed": by_cat[it["category"]]["priced"] += 1

units = {}
for it in items:
    u = it["unit"] or "(нет)"
    units[u] = units.get(u, 0) + 1

pricebook = {
    "meta": {
        "id": "visma-2026",
        "name": "ВИСМА 2026 КХМ",
        "supplier": "Висма",
        "priceYear": 2026,
        "sourceFile": SRC.split("/")[-1],
        "importedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "itemCount": len(items),
        "categories": sorted(by_cat.keys()),
        "stats": {"byCategory": by_cat, "byUnit": units},
    },
    "items": items,
    "refs": refs,
    "notes": notes,
    "issues": issues,
}

import os
os.makedirs(os.path.dirname(DST), exist_ok=True)
with open(DST, "w", encoding="utf-8") as f:
    json.dump(pricebook, f, ensure_ascii=False, indent=1)

print(f"Позиции: {len(items)}")
print(f"Проблемы: {len(issues)}")
for k in sorted(set(i['kind'] for i in issues)):
    print("  ", k, sum(1 for i in issues if i['kind']==k))
print("Категории:")
for c, s in sorted(by_cat.items()):
    print(f"   {c}: {s['count']} (с ценой: {s['priced']})")
print("Единицы:", units)
print("OK ->", DST)
