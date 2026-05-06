# 📋 Sesión de trabajo — Terminal de Transportes Tunja + Estudiantes

**Reunión:** Conocernos + arrancar trabajo conjunto

---

## 🎯 Qué estamos construyendo

**TP Routes / Busboy** — el listado abierto del transporte público de Boyacá.
Una sola fuente de verdad sobre qué rutas existen, quién las opera, por dónde
pasan y cuánto cuestan. Los datos quedan disponibles para todos (apps,
estudios, mapas) y siguen estándares internacionales (GTFS, OpenStreetMap).

🌐 **rutas.busboy.app**

---

## ✅ Qué tiene hoy la plataforma

**Estructura de 4 niveles** (jerarquía clara que ya entiende GTFS y OSM):

1. **Corredor** — par de ciudades (ej. Tunja ↔ Sogamoso).
2. **Ruta** — variante del corredor (directa o por ciertas ciudades).
3. **Empresa** — operador que corre esa ruta.
4. **Trayecto** — cada sentido (ida o vuelta), publicable en OpenStreetMap.

**Funciones disponibles:**

- 📋 Listado maestro de rutas con búsqueda y filtro por empresa.
- ✏️ Crear / editar / borrar corredores, rutas y empresas.
- 📜 Adjuntar resoluciones (con número, fecha, PDF).
- 📍 **NUEVO: catálogo de lugares geolocalizados** (acabado hoy).
  - Cada parada se vuelve un punto real con coordenadas.
  - "Paipa" se carga UNA sola vez y se reusa en todas las rutas.
  - Diagrama visual muestra cuántas paradas están geolocalizadas (verde) vs solo texto (gris).

---

## 👥 Reparto de tareas

### 🏢 Equipo del Terminal de Tunja — *mantener los datos*

Ustedes son la fuente: saben qué empresas operan, qué rutas tienen autorizadas,
qué tarifas cobran. Su trabajo en la plataforma es **mantener el listado al día**.

| Tarea | Qué implica |
|---|---|
| Cargar / completar corredores | Asegurar que cada par origen-destino esté en el sistema. |
| Asignar empresas a rutas | Que cada ruta tenga la(s) empresa(s) que la operan. |
| Resoluciones | Adjuntar número, fecha y PDF de la resolución que autoriza la ruta. |
| Tarifas | (Próxima fase — arranca cuando esté el módulo). |
| Geolocalizar paradas | Usar el mapita: clic donde queda cada ciudad/sitio. Se hace una vez. |

### 🎓 Estudiantes — *cartografía y relaciones OSM*

Su trabajo es **convertir las rutas en geometría real** sobre OpenStreetMap.

| Tarea | Qué implica |
|---|---|
| Revisar listado | Verificar que la información del Terminal esté completa y sin huecos. |
| Trazar rutas en OSM | Editor de waypoints, calcular ruta sobre las vías reales. |
| Crear relaciones PTv2 | Publicar cada trayecto como una *relation* en OpenStreetMap. |
| Validar estructura | Que cumpla el estándar PTv2 (orden, roles, tags). |
| Reportar dudas y bugs | Issues en GitHub para mejorar la plataforma. |

---

## 🔄 Cómo fluye el trabajo

```
Terminal carga datos  →  Estudiantes cartografían  →  Sale a OSM
   (listado, paradas,        (waypoints, relación
    empresas, resoluciones)   PTv2 en el editor)
```

Los dos equipos trabajan **sobre la misma plataforma**, sin pisarse:

- Terminal toca el **listado y catálogo**.
- Estudiantes tocan el **editor cartográfico**.

---

## 📌 Próximos pasos (cosas pendientes)

**Inmediato:**

- Que cada miembro del Terminal tenga acceso al repo.
- Cargar las primeras 5-10 rutas como práctica conjunta.
- Geolocalizar Tunja, Paipa, Duitama, Sogamoso (los terminales principales).

**Cosas que faltan en la plataforma (para discutir):**

- Módulo de **tarifas** (estructura ya está, falta UI).
- Módulo de **horarios / frecuencias**.
- Vista pública para usuarios finales.
- Importación masiva desde Excel para acelerar la carga inicial.

---

## 💬 Para la reunión: temas a hablar

1. **Presentaciones** — quién es quién, qué hace cada uno.
2. **Tour de la plataforma** — demo en vivo con la nueva geolocalización.
3. **Acuerdo de roles** — ¿están de acuerdo con la división Terminal/Estudiantes?
4. **Acceso y herramientas** — GitHub, cómo reportar problemas.
5. **Plan de las próximas 2 semanas** — qué cargamos primero.
6. **Frecuencia de seguimiento** — ¿reunión semanal? ¿canal de WhatsApp?
