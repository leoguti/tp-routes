# 🗺️ Próximos pasos — TP Routes / Busboy

Lista viva de cosas que faltan o que conviene refinar después de la reunión inicial con el Terminal de Tunja + estudiantes.

---

## 🚀 Funcionalidad pendiente

### Auto-ruteo entre paradas — ✅ Implementado (v1)
Integrado **Valhalla** desde el listado maestro: cuando una ruta tiene todas
sus paradas geolocalizadas, aparece el botón "🗺️ Trazar ruta en el mapa".
Abre un modal con mapa Leaflet, paradas como markers numerados, polyline
del trazado calculado por Valhalla, y permite agregar/borrar/arrastrar
waypoints de corrección. El resultado se guarda como GeoJSON en `route_shapes`.

**Pendiente fase 2:**
- Publicar el GeoJSON como relación PTv2 en OpenStreetMap.
- Visualizar el trazado guardado al volver a abrir el listado.

### Módulo de tarifas
Estructura de `route_fares` ya existe en DB. Falta UI para que el equipo del Terminal cargue precios por tramo / origen-destino.

**Estado:** schema listo, sin UI.

### Frecuencias y horarios
Cuántos buses por hora, horario de salida, días que opera. Probablemente otra tabla y UI.

**Estado:** no empezado.

### Importación masiva desde Excel
Carga inicial es lenta a mano. Permitir subir un `.xlsx` con varias rutas a la vez.

**Estado:** scripts existentes (`scripts/convert_xlsx_to_json.py`), falta integrar en UI.

### Vista pública para usuarios finales
Hoy `/rutas` es vista de edición. Crear una vista pública (sin botones de editar/borrar) para ciudadanos: "¿cómo voy de X a Y?"

**Estado:** no empezado.

---

## 🔧 Refinamiento técnico

### Paradas direccionales (opción B/C)
Hoy una parada = un punto. Si se necesita precisión por sentido (avenidas grandes), permitir que `ida` y `vuelta` tengan paradas distintas. Hoy no es urgente — lo necesario para el listado lo cubre el modelo actual.

**Estado:** decidido posponer (modelo A).

### Limpieza de `terminales.html`
Es la cache de OSM, ya no aparece en el menú. Decidir si mantener oculta como herramienta interna o eliminar.

**Estado:** removida del nav, archivo sigue presente.

### Probar end-to-end
Ciclo completo: crear ruta → geolocalizar paradas → editar → eliminar. Debería incluir tests automatizados eventualmente.

**Estado:** prueba manual hecha por el usuario, sin tests automáticos.

---

## 💡 Mejoras de UX (de feedback de estudiantes)

### Autocomplete con teclado
En `/rutas`, navegar con flechas y elegir con Enter. Hoy es solo mouse.

### Edición in-place de waypoints
Hoy para cambiar una parada hay que borrar el chip y re-tipearla. Permitir editar el chip directamente.

### Reordenar waypoints
Drag & drop para cambiar el orden de las paradas en la ruta.

---

## 📋 Para mantener vivo

Cuando aparezca algo nuevo en sesiones de trabajo o issues de GitHub, agregarlo acá. Cuando se complete algo, mover a "✅ Hecho" abajo (o eliminar y dejar el commit como historial).
