# Decisiones — el porqué de las reglas

Cada fichero es UNA decisión con fecha: qué pasó, qué se decidió y cómo se
aplica hoy. Las **reglas** que salieron de aquí viven en `CLAUDE.md`, corto y
sin la historia; la historia vive aquí, para quien la necesite. La carpeta
existe desde junio de 2026 (planes y runbooks de sprint); el 19/08/2026, al
adelgazar `CLAUDE.md` de 1.012 a menos de 400 líneas, entraron las quince
historias que vivían allí y se escribió este índice.

Convención: `AAAA-MM-DD-titulo-en-kebab.md` (los de junio–julio llevan solo
`AAAA-MM`). Un fichero nuevo por decisión, no se reescriben los viejos: si una
decisión se supera, la nueva lo dice y enlaza a la anterior.

| Fecha | Decisión | Toca a |
| --- | --- | --- |
| 06/2026 | [Personalización visual y módulos nuevos para Aumenta](2026-06-aumenta-personalizacion-visual.md) — sprint de la demo del 09/06: `pacientes`, `clinica`, `training` y la marca por tenant | aumenta, clinica, pacientes, training, brand |
| 15/07 | [Plan de refactor de Nutrición (Sprint 8)](2026-07-nutricion-refactor-sprint-8.md) — 8.1 rename UI, 8.2 recetario, 8.3 PDF+email; decisiones D1–D6 | nutricion |
| 15/07 | [Runbook del deploy 8.2 (Recetario)](2026-07-nutricion-8.2-runbook.md) — migración aditiva, deploy primero y migrar después | nutricion |
| 15/07 | [Home «Tu día» (Sprint 9)](2026-07-home-tu-dia-sprint-9.md) — portada con widgets por módulo, solo lectura | home |
| 16/07 | [Menú en PDF + envío por email (8.3)](2026-07-nutricion-8.3-menu-pdf-email.md) — endpoints `plans/[id]/pdf` y envío; endurecimiento de `lib/email/` | nutricion, emails |
| 23/07 | [Todo registro tiene un cliente y un miembro del equipo](2026-07-23-conexion-cliente-equipo.md) — FKs reales, `db:check-links`, backfill que no cruza por nombre | clients, citas, clinica, pacientes, documents, nutricion, formularios, team |
| 28/07 | [Repaso de seguridad](2026-07-28-repaso-de-seguridad.md) — rol fresco en `withTenant`, cerrojo por cuenta+IP, guard de la demo, auditoría con resumen | transversal |
| 01/08 | [Activar un módulo tiene dos puertas](2026-08-01-activar-un-modulo-tiene-dos-puertas.md) — `tenant_modules` y `users.module_access`; `enable-module.js`, `db:check-access` | team, cualquier alta de módulo |
| 01/08 | [El alta de clientes se adapta al cliente](2026-08-01-alta-de-clientes-por-perfil.md) — perfiles por módulos, `Client.address` es JSONB, pacientes en la misma transacción | clients, pacientes, clients_avanzado |
| 01/08 | [Leads: dos orígenes, un solo grupo](2026-08-01-leads-dos-origenes-un-grupo.md) — `leads` + `formularios`, el padre es `/leads/estadisticas` | leads, formularios |
| 04/08 | [«Fichas a completar» cuelga de `clients_avanzado`](2026-08-04-fichas-a-completar-cuelga-de-clients-avanzado.md) — una fuente para número y filas; tres puertas | clients |
| 04/08 | [Clientes se llama «Pacientes» en nutrición](2026-08-04-clientes-se-llama-pacientes-en-nutricion.md) — `vocabulario.js` por módulos con condición negativa | clients, nutricion |
| 10/08 | [Las listas copiadas a mano mienten](2026-08-10-las-listas-copiadas-a-mano-mienten.md) — los módulos por cliente se miran en `/admin/modulos`, no en `CLAUDE.md` | transversal |
| 10/08 | [`cuestionarios` deja de ser un módulo](2026-08-10-cuestionarios-deja-de-ser-modulo.md) — es una pantalla de Formación | training |
| 12/08 | [Retirada de `sales`](2026-08-12-retirada-de-sales.md) — la única clave comercial es `leads`; comprobado en prod antes | leads |
| 12/08 | [Las migraciones no filtran por `status`](2026-08-12-migraciones-sin-filtrar-por-status.md) — estructura sí, datos no | scripts, provisioning |
| 12/08 | [Tres bajas: abarcaia, quality_energy, healim](2026-08-12-bajas-abarcaia-quality-healim.md) — purgados, volcado en el VPS, nombres en el tablero | tenants |
| 13/08 | [El ciclo de vida de un cliente](2026-08-13-ciclo-de-vida-de-un-cliente.md) — cuatro piezas de `lib/provisioning/`; la baja aparta, destruir es SSH | provisioning |
| 13/08 | [Sincronizar antes de commitear](2026-08-13-sincronizar-antes-de-commitear.md) — dos personas en `master`; si un fichero coincide, parar y preguntar | flujo de trabajo |
| 18/08 | [La pirámide invertida de Leads](2026-08-18-la-piramide-invertida-de-leads.md) — de dónde sale la escalera (regla #16); qué encogió; el letrero `ui_override` | leads, clients, training, overrides |
| 21/08 | [El borrado no viaja](2026-08-21-el-borrado-no-viaja.md) — la copia externa SUMA (`rclone copy`, no `sync`) y caduca sola a los 90 días, con cinco frenos para que no pueda vaciar el destino | copias, VPS |
| 24/08 | [El ancho de todas las pantallas](2026-08-24-el-ancho-de-todas-las-pantallas.md) — 46 contenedores pasan por `anchoPantalla()`; cuatro nombres, tres anchos; qué se dejó fuera (la portada editorial y la ficha de cliente, que comparte paneles con Laura) | UI, todos los módulos |
| 24/08 | [El tablero aprende a escribir](2026-08-24-el-tablero-aprende-a-escribir.md) — apuntar, priorizar, cerrar y colgar capturas desde la pantalla, por la MISMA puerta que `registro.mjs`; tres colores y dos salas de espera; la ficha `<!--id:…-->` que impide que un adjunto se quede huérfano | Registro, tablero |
| 26/08 | [Cuándo se apuntó cada tarea](2026-08-26-cuando-se-apunto-cada-tarea.md) — la fecha va en `tablero_estado` y la pone sola la publicación, sin pisar la que ya haya (o cerrar una tarea la rejuvenecería); las 152 viejas se reconstruyen del historial, siguiendo los once renombrados del 25/08 y con el techo de la fecha en que se cerró | Registro, tablero |
| 26/08 | [Preparar una sesión antes de darla](2026-08-26-preparar-una-sesion-antes-de-darla.md) — el alta ya aceptaba sesiones sin audio: el cerrojo estaba en la pantalla; el enlace desde la cita lleva su FECHA, y por eso las estadísticas cortan el periodo por hoy (una preparada no es una dada) | clinica, citas |

Otras decisiones con su propio doc fuera de esta carpeta:
`docs/sprint-aumenta-2026-07.md` (las pantallas del sprint de Aumenta),
`docs/como-apuntar-en-el-tablero.md` (el formato del backlog),
`docs/modules/buzon.md` (por qué el Buzón vive en `master`),
`docs/modules/inventory.md` (por qué Inventario se rehízo el 02/08/2026).
