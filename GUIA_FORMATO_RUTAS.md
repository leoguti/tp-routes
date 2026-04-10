# Guía: Cómo preparar el archivo de rutas para TP Routes

**Terminal de Tunja — Formato de importación de rutas**

---

## ¿Para qué sirve este archivo?

Este archivo permite cargar las rutas del Terminal de Tunja a la herramienta **TP Routes**, que las convierte en datos de transporte público abiertos (OpenStreetMap y GTFS).

---

## Formato del archivo

El archivo debe ser un **Excel (.xlsx) o CSV (.csv)** con exactamente **6 columnas** en este orden:

| Columna | Nombre | Descripción | Ejemplo |
|---------|--------|-------------|---------|
| A | `origen` | Ciudad de origen | `Tunja` |
| B | `destino` | Ciudad de destino | `Aguazul` |
| C | `operador` | Nombre de la empresa | `Autoboy S.A.` |
| D | `telefono` | Teléfono de contacto | `3138873795` |
| E | `resolucion` | Número o nombre del documento legal | `Res. 001234-2022` |
| F | `notas` | Información adicional (opcional) | `Solo fines de semana` |

---

## Reglas importantes

1. **La primera fila debe ser el encabezado** — exactamente como aparece en la tabla anterior
2. **Una fila = una ruta** — si una misma ruta tiene dos operadores, se ponen en filas separadas
3. **No combinar varias empresas en una celda** — cada empresa va en su propia fila
4. **No incluir teléfonos en la columna de operador** — el teléfono va en su propia columna
5. **El nombre del operador debe ser consistente** — siempre igual, sin abreviaciones distintas
6. **La resolución puede repetirse** — si una empresa tiene la misma resolución para varias rutas, se repite en cada fila

---

## Ejemplo correcto ✅

| origen | destino | operador | telefono | resolucion | notas |
|--------|---------|----------|----------|------------|-------|
| Tunja | Aguazul | Autoboy S.A. | 3138873795 | Res. 001234-2022 | |
| Tunja | Aguazul | Concorde | 3143195566 | Res. 005678-2021 | |
| Tunja | Aguazul | Flota Sugamuxi S.A. | 3204909540 | Res. 002345-2023 | |
| Tunja | Bogotá | Autoboy S.A. | 3138873795 | Res. 001234-2022 | |
| Tunja | Bogotá | Berlinas del Fonce S.A. | 3164734956 | Res. 009012-2020 | |

---

## Ejemplo incorrecto ❌

| origen | destino | operador | telefono |
|--------|---------|----------|----------|
| Tunja | Aguazul | AUTOBOY S.A. TELEFONO 313 887 3795 / CONCORDE 3143195566 | |

> **Error:** Dos empresas en una celda, teléfono mezclado con el nombre del operador, columnas faltantes.

---

## ¿Cómo llenar el archivo paso a paso?

1. Abre Excel y crea un archivo nuevo
2. En la fila 1 escribe los encabezados: `origen`, `destino`, `operador`, `telefono`, `resolucion`, `notas`
3. Desde la fila 2 en adelante, ingresa una ruta por fila
4. Cuando termines, guarda como **Excel (.xlsx)** o **CSV UTF-8 (.csv)**
5. Sube el archivo en la herramienta: https://rutas.busboy.app/

---

## Preguntas frecuentes

**¿El origen siempre es Tunja?**
Para el Terminal de Tunja, sí. Si en el futuro se agregan otros terminales, el origen cambia.

**¿Qué pasa si no tengo el número de resolución?**
Deja la celda vacía por ahora, pero es importante completarla después para que la ruta sea válida legalmente.

**¿Puedo tener el teléfono con guiones o espacios?**
Sí, pero preferiblemente solo números: `3138873795`

**¿Qué pasa si el mismo operador tiene teléfonos distintos para rutas distintas?**
Pon el teléfono más relevante para esa ruta específica.

---

## Plantilla lista para descargar

Descarga la plantilla en Excel con los encabezados ya listos:
👉 [plantilla_rutas_terminal.xlsx](plantilla_rutas_terminal.xlsx)

---

*Documento preparado por Trufi Association / Terminal de Tunja — 2026*
