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
| 26/08 | [La agenda importada iba dos horas tarde](2026-08-26-la-agenda-importada-iba-dos-horas-tarde.md) — la importación corrió en un contenedor en UTC y guardó el reloj de Organízate como UTC (12.030 citas corregidas fila a fila); el backfill de cobros ponía a 0 € las 14.243 facturas importadas en cada migración (ahora exige que existan cobros); y las 1.827 citas sin terapeuta son agendas de BAJAS con su origen ya anotado — el reparto es decisión del centro | citas, billing, migración |
| 26/08 | [Preparar una sesión antes de darla](2026-08-26-preparar-una-sesion-antes-de-darla.md) — el alta ya aceptaba sesiones sin audio: el cerrojo estaba en la pantalla; el enlace desde la cita lleva su FECHA, y por eso las estadísticas cortan el periodo por hoy (una preparada no es una dada) | clinica, citas |
| 26/08 | [«No vino» en vez de borrar](2026-08-26-no-vino-en-vez-de-borrar.md) — las 21 fichas que Lau quería borrar tienen 127 facturas cobradas y `invoices.client_id` es CASCADE; el estado va en `clients.status`, que ya tenía `prospect` sin estrenar, y solo en perfil salud (en comercial esa columna ya significa «compró una vez») | clients, billing |
| 26/08 | [El correo de una cuenta no es su usuario](2026-08-26-el-correo-de-una-cuenta-no-es-su-usuario.md) — `users.email` es el IDENTIFICADOR y para 18 de 30 cuentas no es un correo; se separa en `email_contacto` (nullable, único), que además sirve para entrar — y dos identificadores NO son el doble de intentos: el cerrojo vuelve a preguntar por el canónico. La exigencia va en un hook `beforeCreate` del modelo, no en cada formulario | auth, team, provisioning |
| 26/08 | [La factura se sostiene sola](2026-08-26-la-factura-se-sostiene-sola.md) — `invoices.client_id` pasa de CASCADE a RESTRICT (y de hasta 15 restricciones duplicadas a una), y la factura congela al EMITIR a quién se le emitió: corregir un NIF ya no reescribe hacia atrás las 14.243 facturas de Aumenta | billing, clients |
| 26/08 | [Qué cuenta como «ganado» en Aumenta](2026-08-26-que-cuenta-como-ganado-en-aumenta.md) — su embudo gana `paciente` («Ya es paciente») y la regla se muda al SERVIDOR: al enlazar la ficha, el CRM mueve el interesado solo (`etapaAlGanar`), salvo en booking, donde ganar es cerrar la fecha; y en una clínica se ENLAZA la ficha, no se crea | leads, clients |
| 27/08 | [Partir las cuatro pantallas más grandes](2026-08-27-partir-las-cuatro-pantallas-mas-grandes.md) — Config, Citas, el editor de pautas y el embudo de Laura, en piezas con nombre y sin cambiar comportamiento; la red de `no-undef` que ni el lint ni el build dan (y que cazó un `ReferenceError` de producción en la ficha de Laura); el remontaje por `key` sustituye a los resets | config, citas, nutricion, leads, overrides |
| 28/08 | [Los ficheros ya no caben en la copia](2026-08-28-los-ficheros-ya-no-caben-en-la-copia.md) — la migración del OneDrive metió 6,2 GB en `uploads/` y el paquete diario pasó de 127 MB a 5,3 GB: con 14 días de retención, el disco lleno hacia el 6/09 y el registro diciendo «✅ Copia completada» cada mañana. Ahora es un espejo + lo que cambió esa noche (20 KB medidos), y el `.tar.gz` entero es semanal. No se usó tar incremental porque la rotación rompe la cadena, ni `rsync --link-dest` porque el VPS no tiene rsync. De paso: sin `-maxdepth 1`, la rotación habría borrado documentos de pacientes que encajaran en el patrón | copias, infra |
| 28/08 | [Buscar a alguien por su nombre y sus apellidos](2026-08-28-buscar-por-nombre-y-apellidos.md) — el buscador metía la frase entera en cada columna, y el nombre vive partido en dos: los 1.174 pacientes de Aumenta, los 1.174, eran imposibles de encontrar por «nombre + primer apellido». Ahora se parte en palabras y se exigen todas, sin tildes; el cambio solo puede AÑADIR resultados. El mismo fallo estaba en Formación (la otra tabla con el nombre partido) y NO en el resto de Clínica, que no tiene buscador de personas. De paso: el de Matrículas no filtraba nunca (`Object.keys` no ve los symbols de Sequelize) | pacientes, training, búsqueda |
| 29/08 | [Las fotos doradas se migran solas](2026-08-29-las-fotos-doradas-se-migran-solas.md) — tres pasadas manuales en dos días: `byTable`/`byModule` incluyen ahora los schemas dorados de las demos, la migración lleva columnas y backfills a la foto en la misma pasada (mejor que re-fotografiar: no congela lo que dejó un visitante). `slugDeSchema()` para quien derive el slug del schema. La re-foto queda solo para cambios de DATOS | demos, migraciones, deploy |

Otras decisiones con su propio doc fuera de esta carpeta:
`docs/sprint-aumenta-2026-07.md` (las pantallas del sprint de Aumenta),
`docs/como-apuntar-en-el-tablero.md` (el formato del backlog),
`docs/modules/buzon.md` (por qué el Buzón vive en `master`),
`docs/modules/inventory.md` (por qué Inventario se rehízo el 02/08/2026).
