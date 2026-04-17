#!/usr/bin/env python3
"""
Procesa 'Rutas - resoluciones.xlsx' (hoja "Rutas") y genera un CSV limpio
con 7 columnas listas para importar: origen, destino, via, operador,
telefono, resolucion, notas.

Reglas:
- Forward-fill de ID/Origen/Destino/Vía dentro de cada grupo (celdas
  combinadas verticalmente)
- Cada grupo empieza cuando aparece un nuevo ID no vacío
- Dentro de un grupo, si una fila trae Vía explícita, esa fila usa esa vía
  (no se hereda): permite que distintos operadores tengan distintas vías
  para mismo origen/destino
- Se saltan filas de encabezado repetidas y filas vacías
- Operadores: se mantienen tal cual en esta pasada (la normalización se
  hará en el paso de import contra la tabla operators)
"""
import csv
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}

INPUT = Path('/home/leonardo/tp-routes/Rutas - resoluciones.xlsx')
OUTPUT = Path('/home/leonardo/tp-routes/scripts/rutas_terminal_tunja_v2.csv')


def read_shared_strings(z):
    if 'xl/sharedStrings.xml' not in z.namelist():
        return []
    root = ET.fromstring(z.read('xl/sharedStrings.xml'))
    out = []
    for si in root.findall('s:si', NS):
        txt = ''.join(x.text or '' for x in si.iter() if x.tag.endswith('}t'))
        out.append(txt)
    return out


def ref_to_col(ref):
    letters = ''.join(ch for ch in ref if ch.isalpha())
    col = 0
    for ch in letters:
        col = col * 26 + (ord(ch.upper()) - ord('A') + 1)
    return col - 1


def cell_value(c, ss):
    tp = c.get('t')
    v = c.find('s:v', NS)
    val = v.text if v is not None else ''
    if tp == 's' and val.isdigit():
        val = ss[int(val)]
    if tp == 'inlineStr':
        is_el = c.find('s:is', NS)
        if is_el is not None:
            val = ''.join(x.text or '' for x in is_el.iter() if x.tag.endswith('}t'))
    return (val or '').strip()


def parse_sheet(z, sheet_path, ss):
    """Devuelve lista de dicts {id, origen, destino, empresa, via, resolucion}"""
    root = ET.fromstring(z.read(sheet_path))
    rows_xml = root.findall('.//s:row', NS)

    rows = []
    for r in rows_xml:
        cells = {}
        for c in r.findall('s:c', NS):
            col = ref_to_col(c.get('r', 'A1'))
            cells[col] = cell_value(c, ss)
        rows.append({
            'id': cells.get(2, ''),
            'origen': cells.get(3, ''),
            'destino': cells.get(4, ''),
            'empresa': cells.get(5, ''),
            'via': cells.get(6, ''),
            'resolucion': cells.get(7, ''),
        })
    return rows


def clean_via(v):
    """Normaliza espacios en vía: colapsa dobles espacios, quita leading/trailing."""
    if not v:
        return ''
    return ' '.join(v.split())


import re

_LEADING_ORDINAL = re.compile(r'^\s*\d+\s*\.?\s*[-:]?\s*')
_ACCENT_FIXES = {
    'RESOLUCIÒN': 'RESOLUCIÓN',
    'Resolucion': 'Resolución',
    'RESOLUCION': 'RESOLUCIÓN',
    'HABILITACIÓN': 'HABILITACIÓN',
}


def clean_resolucion(v):
    """Limpia texto de resolución: quita ordinales al inicio (1, 2., 1-),
    normaliza acentos mal escritos, colapsa espacios, trim.
    Ej: '1 RESOLUCIÒN 493 DE 1993' -> 'RESOLUCIÓN 493 DE 1993'
    Ej: '1. RESO. NO. 3335 ...' -> 'RESO. NO. 3335 ...'
    """
    if not v:
        return ''
    v = v.strip()
    # quitar ordinal inicial ("1 ", "2. ", "1-", "01 ")
    v = _LEADING_ORDINAL.sub('', v)
    # normalizar acentos mal escritos
    for bad, good in _ACCENT_FIXES.items():
        v = v.replace(bad, good)
    # colapsar espacios
    v = ' '.join(v.split())
    return v


def process(rows):
    """Aplica forward-fill por grupo (delimitado por id nuevo)."""
    out = []

    current = {'id': '', 'origen': '', 'destino': '', 'via_grupo': ''}

    for r in rows:
        id_ = r['id']
        origen = r['origen']
        destino = r['destino']
        empresa = r['empresa']
        via = clean_via(r['via'])
        resolucion = r['resolucion']

        # salta encabezados y filas de control
        if id_.upper() == 'ID' or origen.lower() == 'origen':
            continue

        # nueva ruta: id no vacío
        if id_:
            current = {
                'id': id_,
                'origen': origen,
                'destino': destino,
                'via_grupo': via,
            }
            row_via = via or current['via_grupo']
        else:
            # fila de continuación del grupo actual (celdas combinadas)
            if not current['id']:
                continue  # fila suelta sin grupo previo, la saltamos
            # si esta fila trae vía explícita distinta de vacío -> esa fila usa esa vía
            # si vía vacía -> hereda de la primera fila del grupo
            row_via = via if via else current['via_grupo']

        # si no hay empresa, no tiene sentido crear una ruta
        if not empresa:
            continue

        # al menos necesitamos origen y destino
        ori = origen or current['origen']
        des = destino or current['destino']
        if not ori or not des:
            continue

        out.append({
            'origen': ori,
            'destino': des,
            'via': row_via,
            'operador': empresa.strip(),
            'telefono': '',
            'resolucion': clean_resolucion(resolucion),
            'notas': '',
        })

    return out


def main():
    with zipfile.ZipFile(INPUT) as z:
        ss = read_shared_strings(z)
        rows_raw = parse_sheet(z, 'xl/worksheets/sheet2.xml', ss)

    clean = process(rows_raw)

    # escribir CSV
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open('w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=['origen', 'destino', 'via', 'operador', 'telefono', 'resolucion', 'notas'])
        w.writeheader()
        w.writerows(clean)

    # resumen
    total = len(clean)
    unique_routes = {(r['origen'], r['destino'], r['via']) for r in clean}
    operators = {r['operador'] for r in clean}
    vias = {r['via'] for r in clean if r['via']}

    print(f'OK — {total} filas escritas en {OUTPUT}')
    print(f'  · Rutas únicas (origen, destino, via):  {len(unique_routes)}')
    print(f'  · Operadores distintos:                 {len(operators)}')
    print(f'  · Vías distintas:                       {len(vias)}')
    print()
    print('Operadores encontrados:')
    for op in sorted(operators):
        count = sum(1 for r in clean if r['operador'] == op)
        print(f'  {count:4}  {op}')


if __name__ == '__main__':
    main()
