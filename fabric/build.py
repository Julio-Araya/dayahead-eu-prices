"""Construye los artefactos de Fabric a partir de sus fuentes.

    python3 fabric/build.py            # todo
    python3 fabric/build.py --no-wheel # solo notebooks y comprobaciones

Qué hace:
1. Convierte cada fabric/notebooks/*.py (formato percent: celdas "# %%", "# %% [markdown]",
   "# %% parameters"; magics como "# MAGIC %pip ...") en un .ipynb importable en Fabric con
   kernel PySpark. La celda "parameters" lleva la etiqueta "parameters".
2. Comprueba que las sentencias CREATE TABLE del notebook de ingesta sean idénticas a las de
   fabric/sql/01_create_tables.sql (una sola fuente de verdad, sin drift).
3. Construye el wheel de etl/ en fabric/dist/ y verifica que la celda %pip del notebook
   referencie exactamente ese archivo.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NOTEBOOKS = ROOT / "fabric" / "notebooks"
SQL_FILE = ROOT / "fabric" / "sql" / "01_create_tables.sql"
DIST = ROOT / "fabric" / "dist"
ETL = ROOT / "etl"

CELL_RE = re.compile(r"^# %%(.*)$")
MAGIC_PREFIX = "# MAGIC "


def parse_percent(text: str):
    cells, current, kind = [], None, None
    for line in text.splitlines():
        m = CELL_RE.match(line)
        if m:
            if current is not None:
                cells.append((kind, current))
            header = m.group(1).strip()
            kind = "markdown" if header.startswith("[markdown]") else ("parameters" if header == "parameters" else "code")
            current = []
            continue
        if current is None:
            continue
        if kind == "markdown":
            current.append(line[2:] if line.startswith("# ") else line.lstrip("#"))
        elif line.startswith(MAGIC_PREFIX):
            current.append(line[len(MAGIC_PREFIX):])
        else:
            current.append(line)
    if current is not None:
        cells.append((kind, current))
    return [(k, "\n".join(lines).strip("\n")) for k, lines in cells if "\n".join(lines).strip()]


def to_ipynb(cells):
    out = []
    for kind, src in cells:
        lines = [l + "\n" for l in src.split("\n")]
        lines[-1] = lines[-1].rstrip("\n")
        if kind == "markdown":
            out.append({"cell_type": "markdown", "metadata": {}, "source": lines})
        else:
            meta = {"tags": ["parameters"]} if kind == "parameters" else {}
            out.append({"cell_type": "code", "execution_count": None, "metadata": meta, "outputs": [], "source": lines})
    return {
        "nbformat": 4,
        "nbformat_minor": 5,
        "metadata": {
            "kernelspec": {"name": "synapse_pyspark", "display_name": "Synapse PySpark"},
            "language_info": {"name": "python"},
            "microsoft": {"language": "python", "language_group": "synapse_pyspark"},
        },
        "cells": out,
    }


def build_notebooks():
    for src in sorted(NOTEBOOKS.glob("*.py")):
        nb = to_ipynb(parse_percent(src.read_text(encoding="utf-8")))
        dst = src.with_suffix(".ipynb")
        dst.write_text(json.dumps(nb, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        n_param = sum(1 for c in nb["cells"] if c["metadata"].get("tags") == ["parameters"])
        print(f"{dst.relative_to(ROOT)}: {len(nb['cells'])} celdas, {n_param} de parámetros")


def _norm(sql: str) -> str:
    return re.sub(r"\s+", " ", sql).strip().rstrip(";").strip()


def split_sql(text: str):
    """Separa sentencias por ';' ignorando los ';' que van dentro de comillas simples."""
    out, buf, quoted = [], [], False
    for ch in text:
        if ch == "'":
            quoted = not quoted
        if ch == ";" and not quoted:
            out.append("".join(buf))
            buf = []
        else:
            buf.append(ch)
    if "".join(buf).strip():
        out.append("".join(buf))
    return out


def sql_statements(text: str):
    text = re.sub(r"^\s*--.*$", "", text, flags=re.M)
    return {_norm(s) for s in split_sql(text) if s.strip()}


def notebook_statements():
    src = (NOTEBOOKS / "nb_dayahead_ingest.py").read_text(encoding="utf-8")
    start = src.index("PRICE_TABLE_DDL = ")
    end = src.index("SOURCES_SCHEMA = ")
    ns = {}
    exec(src[start:end], ns)  # noqa: S102 - solo literales de texto
    stmts = set(ns["CONTROL_TABLES_DDL"])
    for table, comment in ns["PRICE_TABLE_COMMENTS"].items():
        stmts.add(ns["PRICE_TABLE_DDL"].format(table=table, comment=comment))
    return {_norm(s) for s in stmts}


def check_ddl_drift():
    a = sql_statements(SQL_FILE.read_text(encoding="utf-8"))
    b = notebook_statements()
    if a != b:
        only_sql = [s[:80] for s in a - b]
        only_nb = [s[:80] for s in b - a]
        sys.exit(f"DDL divergente.\n  solo en .sql: {only_sql}\n  solo en notebook: {only_nb}")
    print(f"DDL: {len(a)} sentencias idénticas en fabric/sql y en el notebook")


def build_wheel():
    DIST.mkdir(exist_ok=True)
    for old in DIST.glob("*.whl"):
        old.unlink()
    subprocess.run([sys.executable, "-m", "build", "--wheel", "--outdir", str(DIST), str(ETL)], check=True, capture_output=True)
    for junk in (ETL / "build", *ETL.glob("*.egg-info")):
        subprocess.run(["rm", "-rf", str(junk)], check=False)
    wheel = next(DIST.glob("*.whl"))
    src = (NOTEBOOKS / "nb_dayahead_ingest.py").read_text(encoding="utf-8")
    m = re.search(r'%pip install "builtin/([^"]+\.whl)"', src)
    if not m or m.group(1) != wheel.name:
        sys.exit(f"la celda %pip referencia {m.group(1) if m else None!r} pero el wheel construido es {wheel.name!r}")
    print(f"wheel: {wheel.relative_to(ROOT)} (coincide con la celda %pip)")


if __name__ == "__main__":
    build_notebooks()
    check_ddl_drift()
    if "--no-wheel" not in sys.argv:
        build_wheel()
