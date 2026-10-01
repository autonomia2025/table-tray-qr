"""Convierte bloques COPY (formato texto de pg_dump/pg_restore) en INSERT.

Uso: python3 scripts/copy_a_insert.py entrada.sql salida.sql [tabla1 tabla2 ...]
Sirve para cargar datos con el conector de Supabase, que no acepta COPY.
"""
import re
import sys

ESC = {"b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t", "v": "\v", "\\": "\\"}


def valor(campo: str) -> str:
    if campo == r"\N":
        return "NULL"
    texto = re.sub(r"\\(.)", lambda m: ESC.get(m.group(1), m.group(1)), campo)
    return "'" + texto.replace("'", "''") + "'"


def convertir(sql: str, solo: set[str] | None) -> list[str]:
    salida = []
    patron = re.compile(r"^COPY (\S+) \((.*?)\) FROM stdin;\n(.*?)^\\\.$", re.M | re.S)
    for m in patron.finditer(sql):
        tabla, columnas, cuerpo = m.group(1), m.group(2), m.group(3)
        if solo and tabla.split(".")[-1] not in solo and tabla not in solo:
            continue
        for linea in cuerpo.split("\n"):
            if not linea:
                continue
            valores = ", ".join(valor(c) for c in linea.split("\t"))
            salida.append(f"INSERT INTO {tabla} ({columnas}) VALUES ({valores});")
    return salida


if __name__ == "__main__":
    entrada, destino, *tablas = sys.argv[1:]
    filas = convertir(open(entrada, encoding="utf-8").read(), set(tablas) or None)
    open(destino, "w", encoding="utf-8").write("\n".join(filas) + "\n")
    print(f"{len(filas)} filas → {destino}")
