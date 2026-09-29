#!/usr/bin/env python3
"""Извлечение полных текстов документов фабрики в базу знаний приложения.

Берёт PDF из корня репозитория (инструкции по бланкам, технички) и складывает
их в app/public/data/knowledge-docs.json — разбитыми на секции, чтобы по ним
работал поиск и можно было показать источник (документ + страница).

Запуск:  python3 tools/extract_knowledge_docs.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

try:
    from pypdf import PdfReader
except ImportError:  # pragma: no cover
    sys.exit("Нужен pypdf:  pip install pypdf")

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "app" / "public" / "data" / "knowledge-docs.json"

# (файл, id, заголовок, категория базы знаний)
DOCS = [
    ("Инструкция по заполнению бланк а кухни 2025.pdf", "blank-kitchen-2025",
     "Инструкция по заполнению бланка кухни (2025)", "order-forms"),
    ("Инструкция по заполнению бланка корпус 2025.pdf", "blank-corpus-2025",
     "Инструкция по заполнению бланка корпус (2025)", "order-forms"),
    ("Техничка 1.08.2025.pdf", "tech-main-2025",
     "Техничка фабрики от 01.08.2025", "tech"),
    # «Фрезеровка фасады .pdf» — побайтовая копия этого же файла (одинаковый md5),
    # поэтому берём документ один раз, чтобы не двоить результаты поиска.
    ("Техничка фасады октябрь 2023 (1).pdf", "tech-facades-2023",
     "Техничка по фасадам: фрезеровки и размеры", "facades"),
]

# Заголовок-поле инструкции:  «Цвет ЛДСП: ...»
FIELD_HEADING = re.compile(r"^([А-ЯЁA-Z][^:\n]{2,70}):\s*(.*)$")
# Нумерованный раздел технички:  «3.1. Общие конструктивные особенности»
NUM_HEADING = re.compile(r"^(\d+(?:\.\d+)*)\.?\s+([А-ЯЁ][^\n]{3,90})$")
# Строка оглавления: «1. Общие положения ....... 2»
TOC_LINE = re.compile(r"\.{4,}\s*\d+\s*$")
PAGE_MARK = re.compile(r"^\s*Страница\s+\d+\s+из\s+\d+\s*$", re.IGNORECASE)

MAX_SECTION_CHARS = 1600


def clean_lines(raw: str) -> list[str]:
    out: list[str] = []
    for line in raw.splitlines():
        line = line.replace("\xa0", " ").rstrip()
        line = re.sub(r"[ \t]{2,}", " ", line).strip()
        if not line or PAGE_MARK.match(line) or TOC_LINE.search(line):
            continue
        out.append(line)
    return out


def split_sections(pages: list[str]) -> list[dict]:
    """Режем документ на секции по заголовкам, длинные — по объёму."""
    sections: list[dict] = []
    heading = "Начало документа"
    buf: list[str] = []
    page_of_heading = 1

    def flush() -> None:
        nonlocal buf
        text = " ".join(buf).strip()
        buf = []
        if not text:
            return
        # слишком длинную секцию режем на части по предложениям
        if len(text) <= MAX_SECTION_CHARS:
            chunks = [text]
        else:
            chunks, cur = [], ""
            for sentence in re.split(r"(?<=[.;!?])\s+", text):
                if len(cur) + len(sentence) + 1 > MAX_SECTION_CHARS and cur:
                    chunks.append(cur.strip())
                    cur = sentence
                else:
                    cur = f"{cur} {sentence}".strip()
            if cur.strip():
                chunks.append(cur.strip())
        for i, chunk in enumerate(chunks):
            sections.append({
                "heading": heading if i == 0 else f"{heading} (продолжение {i + 1})",
                "page": page_of_heading,
                "text": chunk,
            })

    for page_no, raw in enumerate(pages, start=1):
        for line in clean_lines(raw):
            num = NUM_HEADING.match(line)
            fld = FIELD_HEADING.match(line)
            if num:
                flush()
                heading = f"{num.group(1)}. {num.group(2)}".strip()
                page_of_heading = page_no
            elif fld and len(fld.group(1)) <= 70:
                flush()
                heading = fld.group(1).strip()
                page_of_heading = page_no
                if fld.group(2).strip():
                    buf.append(fld.group(2).strip())
            else:
                buf.append(line)
    flush()
    return [s for s in sections if len(s["text"]) > 15]


def main() -> int:
    docs = []
    for filename, doc_id, title, category in DOCS:
        path = ROOT / filename
        if not path.exists():
            print(f"  ! пропуск, нет файла: {filename}")
            continue
        reader = PdfReader(str(path))
        pages = [(p.extract_text() or "") for p in reader.pages]
        sections = split_sections(pages)
        for i, s in enumerate(sections):
            s["id"] = f"{doc_id}-{i:03d}"
        chars = sum(len(s["text"]) for s in sections)
        docs.append({
            "id": doc_id,
            "title": title,
            "category": category,
            "file": filename,
            "pages": len(reader.pages),
            "sections": sections,
        })
        print(f"  ✓ {title}: {len(reader.pages)} стр., {len(sections)} секций, {chars} символов")

    payload = {
        "id": "visma-knowledge-docs",
        "name": "Документы фабрики Висма",
        "docs": docs,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    total = sum(len(d["sections"]) for d in docs)
    print(f"\nГотово: {OUT.relative_to(ROOT)} — {len(docs)} документов, {total} секций, "
          f"{OUT.stat().st_size // 1024} КБ")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
