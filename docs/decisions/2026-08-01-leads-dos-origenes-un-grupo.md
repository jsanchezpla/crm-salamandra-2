# Leads: dos orígenes, un solo grupo

**Fecha:** 01/08/2026 · **Quién:** Jorge · **Módulos:** leads, formularios ·
**Lo que quedó en `CLAUDE.md`:** la tabla de los dos submódulos y que
`formularios` requiere `leads`.

## Qué se decidió

`leads` y `formularios` son **submódulos de Leads** y se nombran por su origen:

| Módulo | Se llama | Sidebar | Ruta | Qué es |
| --- | --- | --- | --- | --- |
| — | Leads (el grupo) | «Leads» | `/leads/estadisticas` | Estadísticas: lo único que mira los dos orígenes juntos. |
| `leads` | Leads Profesionales | «Profesionales» | `/leads` | El embudo por etapas: quien deriva o pregunta. |
| `formularios` | Leads Comerciales | «Comerciales» | `/formularios` | Quien llega por la web, a una bandeja de aceptación. |

En el menú van SIN la palabra «Leads» delante (ya la pone el grupo); dentro de
cada pantalla, completa. `formularios` **requiere `leads`**: una bandeja de
comerciales sin embudo donde caer no es un producto.

## Dos avisos

⚠️ **El padre del grupo NO es `/leads`**: es la pantalla de estadísticas. El
embudo no se movió de `/leads` porque en aquel momento tenía ocho overrides por
tenant colgando de esa ruta (hoy quedan cuatro, ver
[2026-08-18-la-piramide-invertida-de-leads.md](2026-08-18-la-piramide-invertida-de-leads.md)).
Quien no tenga `formularios` ve el bloque de comerciales directamente ausente,
no a cero.

Aumenta llama «Interesados» al grupo por override de rótulo
(`TENANT_LABEL_OVERRIDES` en `components/layout/Sidebar.jsx`; sandbox también
lo hacía hasta el 18/08/2026), y sus hijos se llaman igual que en todas partes.
Es el **peldaño 1 de la regla #16**: solo cambian las palabras.
