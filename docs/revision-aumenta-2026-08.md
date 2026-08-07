# Revisión de Aumenta — agosto 2026

Fecha: 2026-08-06 · HEAD en el momento de escribir: `3c8d624`

Para: Jorge y Rodrigo.

## Cómo leer este informe

Cada afirmación va marcada:

- **VERIFICADO** — leído en el código del repo, con fichero y línea.
- **VERIFICADO (LOCAL)** — consultado contra la base de datos, pero es el entorno
  **local**, no el VPS. Para Aumenta local ≠ producción y se nota mucho: local
  tiene 12 módulos, 3 tipos de cita y 15 citas; producción tiene ~17 módulos, 62
  tipos y 12.030 citas. Todo lo que lleve esta marca hay que reconfirmarlo con
  `docker exec crm-salamandra-app-1 node scripts/inspect-tenant-modules.js aumenta`.
- **SUPUESTO** — deducción razonable sin comprobar. Se dice por qué.
- **DECLARADO** — lo dice un doc del repo (sprint, runbook, backlog) y no se ha
  podido comprobar desde el código porque es un estado de producción.

Nada de este informe ha modificado ningún fichero salvo este mismo.

---

## 1. Qué tiene Aumenta hoy

| Área | Qué tiene | Dónde |
| --- | --- | --- |
| Módulos | 12 activos en LOCAL: billing, calendar, citas, clients, clinica, inventory, leads, orders, pacientes, projects, team, training. Plan `pro`, status `active` | `master.tenant_modules` — **VERIFICADO (LOCAL)** con `inspect-tenant-modules.js` |
| Módulos (prod) | Además, consta que en producción tiene documents, documents_avanzado, clients_avanzado, formularios y team_avanzado → ~17 | CLAUDE.md, `docs/sprint-aumenta-2026-07.md`, `scripts/migrate-clients-avanzado.js:43`, commit `d9cf53e` — **DECLARADO**, nadie lo ha contado |
| Clínico | Pacientes, sesiones (audio → Whisper → Claude, con clave del propio tenant), informes redactados dentro del CRM y enviados en PDF, coordinaciones, plan de intervención por trimestre, talleres, estadísticas de dirección | `app/api/pacientes/*`, `app/api/clinica/*`, `lib/clinica/*` — **VERIFICADO** |
| Citas | Calendario, alta manual, lista de espera, avisos al cliente, enlace de videollamada, faltas justificadas, festivos, agenda compartida, informe de ocupación, `/citas/sin-profesional` | `modules/default/CitasModule.jsx` (2.102 líneas), `app/api/citas/*` — **VERIFICADO** |
| Equipo | Plantilla con retribución, altas de login al CRM, horario semanal, Desempeño con incentivos en euros, Productividad, Ocupación, Incidencias, Bandeja, Actividad | `app/(dashboard)/equipo/*`, `app/api/team/*`, `app/api/clinica/{performance,productividad,incidencias,bandeja}` — **VERIFICADO** |
| Clientes | 1.083 familias importadas, ficha con contrato/tutores/meses del portal, lista de espera de admisión, «Fichas a completar» | `scripts/import-aumenta.js`, `modules/default/ClientDetailModule.jsx`, `lib/clients/urgentes.js` — **VERIFICADO** (el recuento, DECLARADO) |
| Facturación | Facturas con PDF, presupuestos, cobros, morosidad, gastos, arqueo | `app/api/billing/*` — **VERIFICADO** |
| A medida | Dos overrides de UI (`aumenta/LeadsModule`, `aumenta/FormacionOverview`) y el rótulo «Interesados» para el grupo de Leads | `master.tenant_modules.ui_override`; `components/layout/Sidebar.jsx:344` — **VERIFICADO (LOCAL)** |
| Migración | Histórico de Organízate migrado: 1.178 pacientes, 12.030 citas, 22.811 sesiones, contabilidad, coordinaciones, tipos de cita | `scripts/import-aumenta*.js` + `auditar-migracion-aumenta.js` — **VERIFICADO** (los recuentos, DECLARADO) |

Cuatro módulos están encendidos y vacíos: **inventory, orders, projects y
calendar**. Los activó en bloque `scripts/expand-aumenta.js` para sembrar datos
de escaparate; `scripts/reset-aumenta-real-data.js` borró los datos pero declara
en su cabecera que **no toca master**, así que los módulos siguen ahí.
**VERIFICADO** (cabeceras de ambos scripts) + **VERIFICADO (LOCAL)** (tablas a
cero). No es solo ruido de menú: mete una tarjeta de «0 pedidos» y un acceso
rápido a «Inventario · Materia prima y producto» en la portada de un centro de
psicología, y engorda la lista de módulos que hay que migrar en cada despliegue.

---

## 2. Lo que le falta, ordenado por lo que le duele

### 2.1 Verifactu no está integrado — y factura a familias reales

**Coste: grande. VERIFICADO.**

Los campos `facturantiaId`, `qrUrl`, `verifactuStatus` y `verifactuSentAt`
existen en el modelo `Invoice` y **ningún código los escribe**. El PDF no lleva
QR ni hash encadenado. `/facturacion/cumplimiento` es una pantalla informativa
con las fechas (1-ene-2027 empresas, 1-jul-2027 autónomos), no emite nada. El
propio catálogo de venta lo dice en voz alta: *«Verifactu todavía NO está
integrado»* (`lib/provisioning/catalogo.js`, grupo Dinero).

Lo que hace esto peligroso no es la fecha, es que **CLAUDE.md lo lista bajo
«Decisiones técnicas cerradas»** como si estuviera hecho. Esa discrepancia es la
razón de que se olvide. Aumenta emite facturas desde julio.

### 2.2 Nadie sabe qué módulos tiene Aumenta en producción

**Coste: un minuto. VERIFICADO que no se sabe.**

CLAUDE.md dice 13, «re-verificado en producción el 2026-07-07» — fecha
**anterior** a las tres particiones básico/avanzado (27/07 y 01/08) y a la
activación de `formularios`. Local dice 12. Los docs del sprint suman ~17.

Es la base de cualquier conversación con el cliente y de cualquier factura. Se
resuelve por dos vías que ya existen:

```
docker exec crm-salamandra-app-1 node scripts/inspect-tenant-modules.js aumenta
```

o la pantalla `/admin/clientes` del back-office (`GET /api/provisioning/clientes`
devuelve `modulos` por tenant, `app/api/provisioning/clientes/route.js:29-64`).

### 2.3 Datos de salud de menores: cualquier terapeuta ve los de todos

**Coste: grande, pero antes que código hace falta una decisión. VERIFICADO.**

Ningún endpoint clínico filtra por terapeuta. `/api/pacientes`,
`/api/clinica/sessions` y `/api/clinica/reports` devuelven el centro entero a
cualquier usuario con el módulo. Son 15 personas y 1.174 pacientes menores.

Está listado como pendiente en `docs/modules/pacientes.md`, que es la peor forma
de tenerlo: por omisión. Conviene decidirlo **explícitamente con Rodrigo** —
puede que en un centro pequeño lo quieran así, y entonces se escribe que es una
decisión, no un descuido. Si no lo quieren así, es trabajo grande (hay que tocar
todos los listados y todos los detalles).

### 2.4 Productividad ignora festivos y vacaciones, y eso son euros

**Coste: medio. VERIFICADO.**

`lib/clinica/productivity.js:14` dice literalmente *«Sin festivos por ahora
(v1)»*: `availableHours` = `weekly_direct_hours ÷ 5 × todos los lunes-viernes
del mes`. Ni festivos (`blocked_days`, que el CRM ya conoce vía
`lib/citas/festivos.js`) ni vacaciones (`team_blocks`, que existen desde hoy vía
`lib/citas/ausencias.js`).

Ese porcentaje se lleva **con un clic** al complemento de ocupación del incentivo
(`components/.../PerformanceEditor.jsx:57-70`, botón «productividad») y de ahí
sale dinero por la tabla de tramos. Quien se coja tres semanas de vacaciones sale
con ~25% de productividad y cobra el tramo de abajo sin haber trabajado peor. En
agosto, Navidad y Semana Santa le pasa a todo el mundo a la vez.

Ahora que las vacaciones ya son un dato, el arreglo es barato y el agravio es
evitable. Es el bug más caro del módulo.

Relacionado, misma pantalla: el complemento de ocupación **no se calcula solo**.
`occupationFromPct()` está exportada en ese fichero y **no la llama nadie** en
todo el repo; el clamp está duplicado a mano en el editor y el valor entra por
`PATCH /api/clinica/performance`. Es decir: un número que parece calculado y lo
teclea una persona. **VERIFICADO.**

### 2.5 El CRM no escala a los números reales de Aumenta

**Coste: medio-grande, repartido. VERIFICADO.**

Cuatro sitios donde 1.083 familias / 1.174 pacientes / 22.811 sesiones / 12.030
citas ya no caben:

| Dónde | El tope | Consecuencia |
| --- | --- | --- |
| Desplegables de paciente | `GET /api/pacientes` hace `Math.min(limit, 300)` | A un paciente cuyo apellido caiga fuera de los 300 primeros **no se le puede** registrar una coordinación, ni apuntarlo a un taller, ni crearle un informe desde `/clinica/informes`. Ninguno de los tres desplegables tiene buscador |
| Sesiones de la ficha | El endpoint trae 100 por defecto, topa en 200; la ficha pide sin límite | Un paciente con cuatro años de historia pierde de vista las antiguas **sin que nada lo diga**, y tampoco se pueden elegir para volcar al informe |
| Informes y Coordinaciones | Listados planos, tope 300, sin buscador por paciente | En un curso escolar dejan de servir para encontrar nada |
| Embudo de interesados | `limit=200` y `/api/leads` topa en 200 | Al interesado nº 201 solo se llega buscándolo por nombre. Los leads viejos se conservaron a propósito en el reset del 24/07 y hoy están fuera de alcance |

### 2.6 En clínica no se puede corregir ni borrar nada

**Coste: medio. VERIFICADO.**

- No existe `DELETE` de sesión, informe, coordinación ni paciente en ningún
  endpoint.
- `app/api/clinica/coordinations/route.js` solo exporta `GET` y `POST`; no existe
  `coordinations/[id]/route.js`. Un acta con una errata o con un participante mal
  escrito **no tiene arreglo desde la UI**.

En un centro de 15 personas, una sesión guardada en el paciente equivocado pasa
cada semana, y la única vía hoy es pedirle a Salamandra que corra un script.
Coordinaciones, además, es una pantalla que pidió Rodrigo y se desplegó el 31/07.

### 2.7 Un paciente no se puede enlazar con su familia pagadora desde la interfaz

**Coste: pequeño. VERIFICADO.**

El API lo acepta (`PATCH clientId`), pero **ninguna pantalla lo manda**: «Editar
ficha» no tiene el campo y la sección de la ficha del cliente solo **crea**
pacientes nuevos. Un paciente sin pagador no puede recibir su informe (el
endpoint de envío responde 409 explicando justo eso) ni facturarse. Salida
actual: un script.

### 2.8 Control horario: no existe nada

**Coste: grande. VERIFICADO por ausencia.**

Ver la sección 5 entera. Resumen: no hay modelo, tabla, endpoint, pantalla ni
script que registre entrada, salida, jornada, pausas ni saldo horario. Las tres
cosas que se le parecen (`team_member_hours` = horario teórico,
`weeklyDirectHours` = objetivo de intervención directa, `team_blocks` =
vacaciones) dicen lo que alguien **debería** hacer, nunca lo que hizo.

### 2.9 Su portada no habla de su trabajo

**Coste: pequeño. VERIFICADO.**

- `QUICK_LINKS` está escrito a fuego en `app/(dashboard)/page.jsx:7-17` y solo
  contempla clients, leads, sales, citas, inventory, billing, training, calendar
  y referidos. La reina del módulo clínico **no tiene atajo a Pacientes, Clínica,
  Equipo ni Documentos** — y sí lo tiene a Inventario.
- En `lib/home/summary.js`, `buildPedidos` (:383) y `buildTareas` (:219)
  devuelven siempre un objeto y el orquestador solo descarta bloques falsy
  (`if (r.data)`, :452). Con `orders` y `calendar` encendidos y vacíos, la
  portada enseña «0 pedidos · 0 en curso» y una tarjeta de tareas vacía todas las
  mañanas a 15 personas.

Arreglo real: apagarle inventory/orders/projects/calendar (ver 4.5) y que
`QUICK_LINKS` salga de la misma fuente que el sidebar.

### 2.10 Analíticas: no lo tiene, y encima no se puede vender

**Coste: pequeño. VERIFICADO.**

La página `/analiticas` y el endpoint `/api/analiticas` existen, gateados por
`hasModule("analytics")`, y la migración `migrate-web-visits-daily` está
declarada bajo la clave `analytics` (`scripts/_module-migrations.js:113`).
spain_enzymes lo tiene; Aumenta no.

Desde el 01/08 Aumenta tiene `formularios` (leads que entran por su web), así que
su embudo empieza en una visita que nadie mide: no pueden responder «¿de dónde
sale la gente que rellena el formulario?».

El hueco extra: **`analytics` no aparece en `lib/provisioning/catalogo.js`**, así
que no se puede activar desde el panel de alta ni vender como línea; solo a mano
con `enable-module.js`.

### 2.11 Una red que falta: nadie comprueba qué migraciones ha corrido cada schema

**Coste: medio. VERIFICADO.**

Los cuatro checks que hay (`db:check-access`, `db:check-links`,
`db:check-links:prod`, `db:check-migration-order`) miran accesos, registros
huérfanos y el **orden declarado**. Ninguno mira si las tablas que un módulo
activo necesita **existen de verdad en ese schema**. Es exactamente el fallo que
ya mordió (trampa 4 de `docs/sprint-aumenta-2026-07.md`: modelo con columnas
nuevas sin migración = 500 en producción). Con Aumenta a ~17 módulos, esto vale
más que casi cualquier feature de esta lista.

### 2.12 Lo demás (menor, pero apuntado)

- **Soporte** (`support`): completo en código, con portal público y SLA; demo lo
  tiene en local y Aumenta no. Con 1.083 familias, el «¿me cambias la cita del
  jueves?» entra por teléfono y WhatsApp y no deja rastro. Aviso honesto: en un
  centro clínico esto compite con el teléfono y puede quedarse sin usar; vale
  mucho más enchufado al portal de la familia que como bandeja suelta. **Coste
  medio. VERIFICADO.**
- **Referidos**: es el canal natural de crecimiento de un centro de psicología y
  hoy no se registra en ninguna parte. Pero el propio catálogo avisa: *«Hoy está
  hecho a medida de un cliente; requiere ajuste»*, y el único override que existe
  es el de quality-energy. **Coste grande. VERIFICADO.**
- **Captación** (`outreach`): el equivalente para Aumenta sería prospectar
  colegios, pediatras y gabinetes que derivan, que **es** su fuente real de
  pacientes. Pero está construido para B2B en frío, necesita claves de Google y
  de Anthropic del cliente, y la lógica de scoring habría que reescribirla. Lo
  listo como hueco, no como algo obvio de vender. **Coste medio. VERIFICADO.**
- **Google Calendar / Meet real (Fase 2)**: `lib/citas/videollamada.js` declara
  que el modo «automático» **no crea salas**, reutiliza el enlace fijo del tipo
  de cita; las variables de entorno son placeholders en
  `.env.production.example`. Cada cita online exige pegar el enlace a mano.
  **Coste grande. VERIFICADO.**
- **Facturas recurrentes**: son plantillas con `nextRunAt` orientativa; la
  emisión es **manual** y la fecha no avanza al facturar. Aumenta cobra cuotas
  mensuales: si alguien da por hecho que se emiten solas, ese mes no se factura y
  nadie lo ve hasta el cierre. **Coste grande. DECLARADO** en `billing.md`.

---

## 3. Lo que ya existe y solo hay que encenderle

Esta es la lista más rentable del informe. Todo lo de abajo está **construido,
desplegado y es código compartido** (no hay ni un `slug === "nutri_laura"` en
`lib/citas/`, `app/api/` ni en las páginas del widget — **VERIFICADO** con grep).
A Aumenta le llegaría con un interruptor.

| # | Qué | Interruptor exacto | Coste | Marca |
| --- | --- | --- | --- | --- |
| 1 | **Correo** | `settings.integrations.resendApiKey` + `resendFromEmail` (Configuración → Correo; se guarda cifrado, `lib/outreach/resendConfig.js:15-30`) | pequeño (lo pone el cliente: cuenta Resend + verificar dominio) | VERIFICADO el código; que esté vacío en prod es **DECLARADO** |
| 2 | **Recordatorio de la víspera** | `settings.citas.recordatorios === true` (`lib/citas/recordatorios.js:41`), casilla en Configuración. Depende de #1 | pequeño | VERIFICADO |
| 3 | **Vacaciones / ausencias por tramos** | ejecutar `scripts/migrate-vacaciones.js` (la tabla `team_blocks` **no existe en ningún schema**, ni en local) | pequeño | VERIFICADO (LOCAL) |
| 4 | **Portal de la familia** | `settings.widget.sso.enabled === true` (`lib/citas/portalContract.js:40`) **+** una entrada nueva en `WIDGET_SSO_SECRETS` del `.env.production` **+** el snippet `crm_render_iframe` en su WordPress | grande — ver aviso abajo | VERIFICADO |
| 5 | **Contrato del Centro** | subir el PDF (`documents` con `source='contract_template'`) o sembrar `contract_templates` como `scripts/seed-contrato-tunutrilaura.js` | pequeño / medio si lo quieren estructurado | VERIFICADO (LOCAL): cero filas en ambos |
| 6 | **Destinatarios del aviso de faltas** | `settings.citas.avisoFaltas` (vacío = va a **todos** los admin) | pequeño | DECLARADO en sprint §5 |
| 7 | **Analíticas** | `enable-module.js aumenta analytics --grant-users` (y meterlo en el catálogo) | pequeño | VERIFICADO |

**El nº 1 es el cuello de botella de todo.** Sin la clave de Resend el CRM se
queda en dry-run **y no da error**: no sale ni una confirmación, ni un
recordatorio, ni un cambio de hora, ni el enlace de videollamada, ni los avisos
del centro, ni el «Enviar al paciente» de los informes. Aumenta tiene 12.030
citas y hoy no le llega un correo a ninguna familia.

**El nº 4 abre de golpe la mitad del sprint de julio** que hoy no llega a nadie:
firma web del contrato, doble firma de padres separados, «Mis documentos»,
avisos publicados, «Completa tus datos», preferencias de comunicación,
cancelación y petición de cambio de hora por el propio paciente, acceso por meses
y —el caso más doloroso— **el consentimiento de imagen**, que se escribió
literalmente porque de 1.178 pacientes solo 5 lo tenían. Hoy solo se puede ir
recogiendo a mano, paciente a paciente.

Pero **no es una casilla**: no hay UI para encenderlo (no está en
`PATCH /api/tenant/settings` ni en `ConfigModule`), solo existe
`scripts/configure-nutri-laura-citas-portal.js` con `const SLUG = "nutri_laura"`
a fuego. Y antes de encenderlo hay que resolver dos cosas de la sección 4 (4.3 y
4.4).

Interruptores que existen y **nadie puede tocar desde el producto**
(**VERIFICADO**: cero apariciones en `ConfigModule.jsx` y en
`app/api/tenant/settings/route.js`):

- `settings.citas.valoracionSoloConFormulario` — puerta implementada y probada,
  solo se pone con SQL. Aplica a cualquier cliente.
- `settings.widget.sso.enabled` — el portal, el nº 4 de la tabla.

Y dos cosas que existen pero solo en el override de nutri-laura, y a Aumenta le
harían falta el día que encienda el portal:

- **Dar un bono a mano** desde la ficha (`POST /api/citas/packs` existe y está
  gateado solo por `citas`; el formulario vive solo en el override). Es la única
  vía del CRM para abrir derecho a citas sin pasarela — exactamente el caso de un
  centro que cobra cuotas fuera del CRM. **VERIFICADO.**
- **«Qué documento falta firmar y a quién»**: la ficha por defecto solo enseña el
  contador «X de Y firmas»; el detalle documento a documento se quedó en
  `modules/overrides/nutri-laura/ClientAttachmentsPanel.jsx`. Con familias de
  padres separados, Aumenta es donde más falta hace. **VERIFICADO.**

---

## 4. Lo que está roto o puede morder

Ordenado por probabilidad × daño.

### 4.1 BOMBA: dos columnas declaradas en el modelo que no existen en ninguna base

**VERIFICADO (LOCAL, contra `information_schema` de los 7 schemas `crm_*`).**

`models/tenant/Client.model.js:133` y `:162` declaran `assignedTeamMemberId` y
`autoConfirmBookings`. Las columnas `assigned_team_member_id` y
`auto_confirm_bookings` **no existen en ningún schema**. Sequelize genera la
lista explícita de columnas en el SELECT, así que **cualquier consulta de Client
devuelve 500**.

Si esto se despliega sin ejecutar `migrate-nutricionista-asignada` y
`migrate-citas-autoconfirmadas-por-paciente`, Aumenta pierde de golpe
`/clientes`, la ficha, el alta, la lista de espera y el portal. Es la trampa nº 4
del propio doc del sprint, otra vez.

Y peor: `node scripts/check-migration-order.js` **termina en rojo** avisando de
que `migrate-citas-autoconfirmadas-por-paciente` y `migrate-firma-opcional-menores`
**no tienen módulo asignado**, así que `ensure-tenant-schema` no las corre nunca:
un cliente nuevo dado de alta desde el panel nace sin esas columnas. Trampa nº 5,
también otra vez.

### 4.2 Las dos puertas: el admin de Aumenta no ve 10 de sus módulos (en local)

**VERIFICADO (LOCAL).** `node --env-file=.env.local scripts/check-module-access.js`
imprime:

```
✗ admin@aumenta.es (admin) no ve: billing, calendar, citas, clients, clinica,
  inventory, orders, pacientes, projects, team
```

Porque `users.module_access` tiene una lista explícita congelada (`["leads",
"training"]`) de cuando solo existían esos dos módulos. Con lista explícita, el
sidebar oculta y la API devuelve 403 aunque el cliente lo tenga contratado.

**En producción no lo he podido comprobar** — pero es exactamente la trampa que
ya mordió dos veces (analytics/spain_enzymes el 31/07, documents/nutri_laura el
01/08) y las dos veces **lo detectó el cliente, no nosotros**. Aumenta tiene 15
usuarios reales. Comprobación de un minuto:

```
docker exec crm-salamandra-app-1 node scripts/check-module-access.js
```

### 4.3 `team_avanzado` no lo activa ningún script

**VERIFICADO.** `grep -rn team_avanzado scripts/` devuelve **cero** resultados, y
no tiene entrada en el mapa `MODULES` de `scripts/_module-migrations.js`. Se dio
a mano: la única prueba de que existe en producción es el texto del commit
`d9cf53e`.

De esa clave cuelgan **7 entradas del sidebar** (`components/layout/Sidebar.jsx:203-214`:
Desempeño, Dirección, Productividad, Incidencias, Bandeja, Ocupación, Actividad)
y **~20 endpoints** que la comprueban. Si esa fila se pierde o un alta nueva no la
marca, **dirección se queda sin sus 7 pantallas en silencio**, y ningún check lo
detecta: `check-module-access` solo mira quién no ve lo contratado, nunca si
falta algo contratado.

Añadido: `enable-module.js aumenta team_avanzado` avisaría «no tiene migraciones»
y no ejecutaría ninguna. Las tablas que necesita (`performance_metrics`,
`incidencias`, `incentive_items`) vienen del paquete `clinica`, así que venderlo
a un cliente **sin** Clínica deja los endpoints apuntando a tablas inexistentes.

### 4.4 El portal cruza las citas por email, y Aumenta son familias

Dos problemas distintos, los dos **VERIFICADOS en código**:

1. **Cruce por email en vez de por FK.**
   `app/api/public/c/[tenantSlug]/citas-portal/bookings/route.js:42` filtra por
   `bookings.client_email`, no por `client_id`, que existe desde el sprint del
   23/07. Y `migrate-booking-email-opcional` quitó el `NOT NULL` al correo
   justamente para poder importar agendas. **SUPUESTO** (no comprobado contra
   producción): si buena parte de las 12.030 citas importadas no lleva correo,
   **«Mis citas» saldría vacío** el día que enciendan el portal. Comprobar con un
   `COUNT` de bookings con `client_email IS NULL` en `crm_aumenta` de producción
   **antes de prometer nada**.

2. **Un email = una persona.** `puedeReservarValoracionInicial`
   (`lib/citas/valoracionInicial.js:85`) cuenta **cualquier** cita con ese
   `clientEmail`: el segundo hermano no podría pedir valoración inicial nunca.
   `debePreguntarBienvenida` y `ofreceValoracionInicial`
   (`lib/citas/bienvenida.js`) hacen lo mismo. La firma del contrato y el
   desbloqueo por meses **sí** son de familia a propósito; la valoración inicial
   y la bienvenida no deberían serlo, y hoy lo son.

Además, `lib/citas/portalClient.js` carga la ficha con una **lista fija de
columnas**: Sequelize devuelve `undefined` para lo que no esté, sin error, así
que la pantalla no revienta, **miente**. `docs/modules/citas.md:813` documenta que
ya ha mordido tres veces. A Aumenta le morderá el día que encienda el portal.

### 4.5 Encender puertas sin lo de detrás mata la agenda pública

**VERIFICADO.** Las cuatro están apagadas hoy y deben seguir así hasta tener el
portal:

- `identidadObligatoria` sin portal montado → nadie puede identificarse.
- `formularioObligatorio` (`lib/citas/puertaFormulario.js:26`) sin bandeja →
  `estadoDeAdmision` devuelve `"sin_bandeja"` y **cierra a propósito**: todo el
  mundo recibe «Ahora mismo no podemos dar cita». En local `crm_aumenta` ni
  siquiera tiene las tablas `forms` / `form_submissions`.
- `soloConPago` con 62 tipos de cita sin precio → agenda muerta.
- `contratoObligatorio` antes de marcar la valoración inicial → nadie nuevo
  puede reservar.

`scripts/comprobar-citas.js` existe justo para avisar antes. **Pero miente sobre
el correo**: mira solo la clave del tenant y dice «no sale ningún correo»,
mientras el envío real cae a `process.env.RESEND_API_KEY` global
(`lib/email/resendClient.js:90`). Si el VPS tiene esa clave, los correos de
Aumenta **salen desde nuestro dominio verificado** y el comprobador dice que no
sale nada. Hay que decidir cuál de las dos cosas es la verdad **antes** de
encender recordatorios a 12.030 citas.

### 4.6 Tres cosas rotas en pantalla, hoy, en producción

Todas **VERIFICADAS**:

1. **«Nuevo informe» tumba la ficha del paciente.**
   `app/(dashboard)/pacientes/[id]/page.jsx:463` (y `:413`) hace
   `setReportForm({ reportType: "evolution", dueDate: "" })`, que **borra**
   `sourceSessionIds` del estado; el modal renderiza
   `reportForm.sourceSessionIds.length` en `:843` → TypeError en render. La app
   **no tiene ningún `error.jsx` ni `global-error.jsx`**, así que en producción es
   la pantalla blanca de «Application error». Entró con `3333bec` del 31/07 y ese
   mismo día se desplegó. Arreglo: incluir `sourceSessionIds: []` y
   `referralSpecialty: ""` en los dos resets.
2. **Talleres devuelve 500 siempre.** ✅ **ARREGLADO el 07/08/2026.**
   `app/api/clinica/talleres/route.js:27` y `talleres/[id]/route.js:14` incluyen
   `TeamMember` con `attributes: ["id", "name"]`, y **TeamMember no tiene `name`**
   (tiene `displayName`) → PostgreSQL 42703. El try/catch solo contempla 42P01
   (tabla ausente). Mismo copy-paste en `app/api/arqueo/cierres/route.js:76` y
   `app/api/inventory/stock-movements/route.js:44`.

   Al arreglarlo aparecieron **dos sitios más** que el barrido de esta revisión no
   había cogido, porque no son includes de Sequelize:
   - `app/api/citas/avisos/route.js:52` pedía `["id", "firstName", "lastName"]`
     sobre `TeamMember`, que **tampoco tiene esos dos campos** → el mismo 42703, y
     ahí el `catch` devuelve `serverError`, así que el historial de avisos de un
     cliente estaba caído en producción igual que Talleres.
   - `app/(dashboard)/clinica/talleres/page.jsx:349` pintaba `{m.name}` sobre los
     miembros de `/api/team` (que devuelve `displayName`): el desplegable «Lo
     lleva» del alta salía con **todas las opciones en blanco**. Este no daba
     error, solo hacía imposible saber a quién asignabas.

   Se ha unificado a `displayName` de punta a punta (endpoint y pantalla) en vez de
   aliasar con `[["displayName","name"]]`: el resto del CRM —proyectos, pacientes,
   calendario, tarifas— ya consume `displayName`, y tener dos nombres para el mismo
   campo es justo lo que produjo estos cinco copia-pega. El `catch` de Talleres se
   deja como está, contemplando **solo** 42P01: tragarse un 42703 como «pantalla
   vacía» habría escondido este fallo en vez de destaparlo.
3. **Datos personales de menores en el schema compartido.**
   `app/api/pacientes/[id]/route.js:89` y `:148-149` auditan `p.toJSON()` completo
   como `before`/`after` — DNI, dirección, motivo de derivación, notas internas,
   consentimientos — y `AuditLog` vive en `master`, **compartido por todos los
   clientes**. Es justo lo que prohíbe la regla de auditoría de CLAUDE.md y para
   lo que existe `auditSummary` (`lib/clinica/audit.js`), que sí usan sesiones,
   informes, coordinaciones y hasta el POST de este mismo fichero. **Solo falla el
   PATCH.**

### 4.7 Números que mienten en pantalla

Todos **VERIFICADOS**:

- **Equipo, cabecera** (`app/(dashboard)/equipo/page.jsx:131-132`): `total =
  members.length` y los inactivos se filtran sobre la página ya filtrada. El
  filtro por defecto es `status IN ('active','on_leave')`, así que imprime
  **«0 inactivos» siempre**. Y el `total` también miente en cuanto haya más de 50
  fichas (el endpoint usa `limit` 50 por defecto). Aumenta tiene 15, así que hoy
  solo se ve el «0 inactivos».
- **Contadores del embudo** (`modules/overrides/aumenta/LeadsModule.jsx:113-116`):
  se calculan con un `reduce` sobre las 200 filas traídas. Con más de 200
  interesados son falsos. Al pulsar una etapa se reconsulta al servidor, así que
  **las demás tarjetas caen a cero** — y se contagia el «{total} en total» de la
  cabecera, porque `/api/leads` devuelve el count de la consulta **ya filtrada**.
- **Etapas sin nombre en el embudo de Aumenta**: su override solo declara
  `new`/`contacted`/`lost` y pinta `STAGES.find(...)?.label ?? lead.stage`, así
  que un lead en `qualified` sale con la clave cruda **«qualified»**, mientras
  `/leads/estadisticas` —que Aumenta tiene— lo llama «En seguimiento». Y esos
  leads no tienen tarjeta, así que no hay forma de filtrarlos.
- **Cambiar la etapa falla en silencio**: el handler hace `if (data.ok)` sin rama
  de error; un 403 o un 422 deja el desplegable como estaba sin decir nada.
- **«Próxima entrega»** en la landing de Clínica
  (`app/api/clinica/overview/route.js:25-29`): coge el informe pendiente con
  `dueDate` **más antiguo**, sin filtrar por fecha futura. En cuanto haya uno
  vencido, la tarjeta enseña una fecha pasada para siempre.
- **Cabecera de `/pacientes`**: «{patients.length} en seguimiento» usa el tamaño
  de página (50) mientras el KPI de al lado enseña el total real. Dos números
  distintos para lo mismo en la misma pantalla.

### 4.8 Comportamiento destructivo llegando por un desplegable

**VERIFICADO.** En `app/api/team/[id]/route.js:271-272`, pasar el Estado de un
miembro a «Inactivo» dispara `revocarAcceso()`, que **borra su usuario de
`master.users`**. Es intencionado, está auditado como `team.user_removed` y tiene
guard anti-demo — pero en Aumenta son 15 personas reales con logins tipo
`nombre_aumenta`, y el camino «Editar → Estado → Inactivo» **no avisa** como sí
lo hace el botón «Dar de baja». Hoy solo lo cubre un tooltip.

### 4.9 Documentación que va a hacer decidir mal

**VERIFICADO.** Tres docs afirman cosas falsas y son los que se leen antes de
tocar un módulo:

- `docs/modules/configuracion.md:204` dice que «todavía NO hay ningún flujo del
  CRM que dispare mensajes [de WhatsApp] solos». Es falso desde el 01/08:
  `lib/citas/avisosWhatsapp.js` se dispara desde el confirm de la cita, desde el
  PATCH y desde el recordatorio.
- `docs/modules/pacientes.md:69-82` sigue diciendo «no hay endpoints CRUD» y
  «todo dummy».
- `docs/modules/clinica.md` sigue diciendo «Activado solo en aumenta», «cuatro
  modelos vacíos» y que la migración es la hardcodeada a `crm_aumenta`, cuando ya
  existe la generalizada, está también en demo, y hay InterventionPlan,
  Incidencia, IncentiveItem, Taller y TallerInscripcion. Talleres, Estadísticas y
  Coordinaciones no aparecen.
- `docs/modules/team.md` dice en «Lo que NO hace» que no hay vacaciones (existen
  desde hoy) y no menciona `team_member_hours`, `/mi-horario`, `specialties`,
  `annualGross`, `weeklyDirectHours`, `team_avanzado` ni las siete pantallas de
  `/equipo/*`. **Este es el que va a leer quien empiece el fichaje.**

### 4.10 Cosas menores pero que muerden luego

- `modules/overrides/sandbox/LeadsModule.jsx` es la copia recoloreada del de
  Aumenta y se quedó sin la ayuda del tope de 200. Comparten el bug de contadores
  y **no comparten código**: si se arregla en uno hay que acordarse del otro.
- `/comercial/leads` es código al que no se llega (248 líneas con textos de una
  campaña de Retorika). Apuntado dos veces. Se borra, no se documenta.
- La auditoría de Vacaciones se registra como `citas.bloqueo_created` /
  `citas.bloqueo_deleted`, o sea que en **Equipo → Actividad** sale bajo el
  módulo CITAS. Quien busque «quién le dio vacaciones a Silvia» no lo encuentra
  donde lo busca.
- `team_blocks` tiene FK con `ON DELETE CASCADE`: hoy no muerde porque el DELETE
  de equipo es soft, pero un script de limpieza que borre de verdad se llevaría
  el histórico de ausencias por delante.
- Audio de más de 25 MB: el navegador no comprueba el tamaño y el servidor
  responde 413 con JSON. **SUPUESTO**: si nginx corta la subida antes de llegar a
  Next (no he podido ver `client_max_body_size` desde el repo), el `await
  r.json()` de la página falla y la terapeuta ve un mensaje ininteligible. Una
  sesión de 50 minutos en m4a se acerca a ese límite.
- `Coordination` tiene `aiTranscription` y `aiActaGenerated` y **nadie los
  escribe nunca**. Campos muertos que sugieren una función que no existe.
- Los adjuntos legacy de la ficha de cliente (`client_attachments`) no tienen
  validación por magic bytes, ni ACL por usuario, ni auditoría. El módulo
  Documents sí. Es el sitio del CRM con datos de salud y el que menos control
  tiene. **DECLARADO** en el backlog de `documents.md`.

---

## 5. MÓDULO DE FICHAJE

Lo pedido, literal, hoy por WhatsApp: **«un módulo de Fichaje en el que vuelquen
el excel de cada mes»**. Eso es todo lo que se sabe: no tenemos el Excel, ni sus
columnas, ni de qué máquina sale.

Este apartado **no inventa el formato**. Propone el esqueleto que aguanta
cualquiera de los formatos posibles, dice qué preguntar y qué se puede empezar
sin respuesta.

### 5.0 Punto de partida: qué hay y qué no

**VERIFICADO por ausencia.** Grep exhaustivo por `fichaje`, `fichar`, `jornada`,
`clock-in`, `clock-out`, `timetrack`, `timesheet`, `worked_hours`, `hoursWorked`,
`turno`, `shift`, `punch`, `presencia`, `registro horario` en `app/`, `lib/`,
`models/`, `components/` y `scripts/`: **cero resultados**. No existe nada.

Las tres cosas que se confunden con fichaje y **no** sirven:

| Qué | Tabla | Qué es de verdad |
| --- | --- | --- |
| Horario semanal | `team_member_hours` | Horario **teórico**: alimenta la generación de huecos de cita |
| Horas de intervención directa | `team_members.weekly_direct_hours` | **Objetivo** semanal: denominador de Productividad |
| Vacaciones | `team_blocks` | Tramos en los que alguien **no está** |

Las tres dicen lo que alguien **debería** hacer. Ninguna sabe si vino a trabajar.

Lo que sí hay y es oro: **el patrón de importador de Excel ya está resuelto en el
repo**, y es bueno.

| Pieza | Dónde | Estado |
| --- | --- | --- |
| Librería Excel | `exceljs ^4.4.0` — **la única**, no hay SheetJS ni parser de CSV | VERIFICADO |
| Exportador genérico | `lib/billing/exportXlsx.js` → `xlsxResponse({filename, sheetName, columns, rows, filters})` con formatos €/%/entero, cabecera congelada y hoja de filtros | VERIFICADO |
| Importador BUENO (el que hay que copiar) | `app/api/training/users/import/{preview,route,template}` — preview que **no escribe nada** + commit aparte + plantilla descargable generada al vuelo | VERIFICADO (leído entero) |
| Parser de fechas tolerante | `lib/training/parseDate.js` — acepta `Date` de ExcelJS, serial numérico de Excel (con el bug de 1900) e ISO / DD-MM-AAAA / DD/MM/AAAA, y devuelve `{ok:false, reason}` explicando **por qué** falla | VERIFICADO |
| Importador MALO (no copiar) | `app/api/leads/import/excel/route.js` — crea fila a fila **sin transacción** y con catch genérico: si revienta en la fila 400 de 1000 quedan 399 creadas y nadie sabe por qué | VERIFICADO |

El preview de Formación ya devuelve exactamente lo que hace falta:
`totalRows / valid / newCount / updateCount`, errores por fila con
`{row, field, value, error}`, detección de duplicados **dentro del propio
Excel**, y resolución create-vs-update con **una sola query**. Eso es la mitad
del trabajo del fichaje ya escrita.

### 5.1 Los cuatro requisitos que mandan sobre el diseño

Antes de las tablas. Si el diseño no responde a estos cuatro, no está terminado:

1. **Volcar el mismo mes dos veces no puede duplicar horas.** Va a pasar: el
   primer mes lo suben mal, o el Excel llega corregido a mitad de mes.
2. **Hay que poder corregir a mano lo que venga torcido** — y que la corrección
   sobreviva al siguiente volcado, y que se vea que alguien la hizo y por qué.
3. **Un fichaje mal importado es una nómina mal pagada.** El volcado tiene que
   ser reversible entero, no fila a fila.
4. **Son datos personales y laborales.** No pueden acabar en `master.audit_log`
   (schema compartido); en el registro de auditoría va un resumen, nunca las
   filas. Precedente: el PATCH de pacientes de la sección 4.6.3.

### 5.2 Modelo de datos propuesto

Dos modelos en `models/tenant/`, JavaScript puro, `underscored: true` como el
resto.

**`FichajeImport`** (tabla `fichaje_imports`) — el **lote**. Es lo que hace el
volcado reversible y no-duplicable:

| Campo | Para qué |
| --- | --- |
| `id` (UUID) | — |
| `periodo` (`YYYY-MM`) | El mes que volcaron |
| `fileName`, `fileHash` (sha256 del buffer) | Detectar «este Excel ya lo has subido» antes de tocar nada |
| `rowsTotal`, `rowsOk`, `rowsError` | Lo que dijo el preview |
| `status` (`applied` \| `superseded` \| `reverted`) | Historial |
| `importedByTeamId` / `importedByUserId`, `appliedAt` | Quién y cuándo |
| `resumen` (JSONB) | Totales por persona en el momento del volcado: la foto |

**`Fichaje`** (tabla `fichajes`) — el dato. Grano propuesto: **un tramo
trabajado** (no un día, no un marcaje suelto). Aguanta los dos formatos posibles
sin rehacer nada:

| Campo | Nota |
| --- | --- |
| `id` (UUID) | — |
| `teamMemberId` (UUID, FK) | **`ON DELETE RESTRICT`**, no CASCADE: un registro de jornada no puede desaparecer porque alguien pase a inactivo (ver 4.10) |
| `fecha` (DATEONLY) | El día, en local. Nunca UTC: el CRM ya tropezó con esto en estadísticas |
| `entradaAt`, `salidaAt` (TIME o TIMESTAMP, **ambos nullable**) | Si el Excel trae marcajes, se llenan. Si trae solo el total del día, quedan a null |
| `minutos` (INTEGER) | El total del tramo. Es **lo único obligatorio** |
| `minutosOriginal` (INTEGER) | Lo que decía el Excel. Nunca se pisa: permite enseñar «el Excel decía 480, alguien lo dejó en 420» |
| `tipo` (`trabajo` \| `pausa` \| `ausencia` \| `festivo`) | Solo si el Excel los distingue; por defecto `trabajo` |
| `origen` (`import` \| `manual` \| `corregido`) | **La clave de todo.** Ver abajo |
| `importId` (UUID, FK nullable) | De qué volcado vino. Null si es manual |
| `filaExcel` (INTEGER) | Para poder decir «fila 312 del fichero de marzo» |
| `nota` (TEXT) | Motivo de la corrección. Obligatoria si `origen != 'import'` |
| `deletedAt` | Soft delete. **Nunca se borra un fichaje de verdad** |

**Nada de saldos guardados.** Los totales del mes se cuentan en lectura, como
`lib/clinica/trimestres.js` cuenta el cumplimiento y como el inventario calcula
el stock sumando movimientos. Un contador guardado se desincroniza y nadie se fía
del número.

**Idempotencia, dos cerrojos:**

1. Índice **UNIQUE parcial** sobre `(team_member_id, fecha, entrada_at, tipo)
   WHERE deleted_at IS NULL AND origen = 'import'`. La base impide el duplicado
   aunque falle la lógica.
2. **Reemplazo por periodo**: aplicar un volcado del mes M marca el lote anterior
   de ese mes como `superseded` y hace soft-delete de **solo sus filas con
   `origen='import'`**. Las filas `manual` y `corregido` **sobreviven**, y el
   preview lo dice en voz alta: «se conservan 4 correcciones manuales de este
   mes».

Y `fileHash` da el aviso barato: «este fichero exacto ya se volcó el 3 de marzo,
¿seguro?».

**Identificación de la persona.** El Excel no va a traer el UUID del CRM. Hace
falta una columna nueva en `team_members` — `clockCode` (o
`customFields.fichajeCodigo` si preferís no migrar) — y una pantalla de mapeo
«este código / este nombre = esta persona» que **se persiste**, para que el mes
siguiente resuelva solo. Regla dura: **una fila que no case con nadie no se
importa nunca a ojo**; sale en el preview como error y se mapea ahí mismo.

### 5.3 Pantallas

Cuelgan de Equipo, siguiendo lo que ya existe (`/equipo/*`, `/mi-horario`,
`/mi-desempeno`):

| Ruta | Qué | Quién |
| --- | --- | --- |
| `/equipo/fichaje` | Mes en curso: personas × días, totales por persona, y **avisos** (día sin salida, jornada > 12 h, fichaje en día de vacaciones o festivo, persona sin ninguna fila) | admin |
| `/equipo/fichaje/importar` | Subir → **preview** → confirmar. Con el mapeo de códigos sin resolver integrado | admin |
| `/equipo/fichaje/[teamMemberId]?mes=` | Detalle de una persona: fila a fila, editable, con el original a la vista y el motivo obligatorio | admin |
| `/equipo/fichaje/volcados` | Histórico de lotes, con botón de **revertir** el lote entero | admin |
| `/mi-fichaje` | Cada persona ve **lo suyo** y puede avisar de un error (no editar) | todos — **depende de la pregunta 3** |

El aviso de «fichaje en día de vacaciones» es gratis y vale mucho: el CRM ya sabe
de festivos (`lib/citas/festivos.js`) y de ausencias (`lib/citas/ausencias.js`).

### 5.4 Endpoints

Todos con `withTenant`, gateados por `hasModule("fichaje")`, y los de escritura
además por rol admin leído de la cabecera (que `withTenant` ya reescribe fresco
de BD).

```
GET    /api/fichaje?mes=YYYY-MM&teamMemberId=   → filas + totales + avisos
GET    /api/fichaje/export?mes=YYYY-MM          → xlsx vía lib/billing/exportXlsx.js
POST   /api/fichaje/import/preview              → multipart, NO ESCRIBE NADA
POST   /api/fichaje/import                      → commit en UNA transacción
GET    /api/fichaje/import/template             → xlsx de plantilla al vuelo
GET    /api/fichaje/imports                     → histórico de volcados
POST   /api/fichaje/imports/[id]/revertir       → deshacer el lote entero
POST   /api/fichaje                             → alta manual de un tramo
PATCH  /api/fichaje/[id]                        → corregir (exige nota)
DELETE /api/fichaje/[id]                        → soft delete (exige nota)
```

El cálculo de totales, avisos y saldos vive en **`lib/fichaje/`**, en un solo
sitio, y lo comparten la pantalla, el export y cualquier informe futuro — igual
que `lib/clinica/estadisticas.js` alimenta pantalla, Excel y PDF. Si el total de
la pantalla y el del Excel salen de sitios distintos, nadie se fía de ninguno.

Auditoría: `lib/utils/auditoria.js`, **después** de la mutación y **fuera** de la
transacción, con **resumen** (persona, fecha, minutos antes/después, motivo) —
nunca la fila entera, nunca el fichero. Y su frase en
`lib/actividad/etiquetas.js`, bajo el módulo **Equipo** (no repetir el error de
las vacaciones, que salen bajo Citas).

El parser de horas va en `lib/fichaje/parseHora.js` — fichero nuevo, no se toca
`lib/training/parseDate.js` (regla #2). `parseFlexibleDate` se **reutiliza tal
cual** para la fecha; lo único genuinamente nuevo es parsear horas y duraciones
(`08:30`, `8,5`, `8:30:00`, el serial fraccionario de Excel).

### 5.5 Las dos puertas y el catálogo

Un módulo nuevo necesita, sin excepción:

1. `MODULE_KEYS.FICHAJE = "fichaje"` en `lib/tenant/moduleKeys.js` — para que la
   misma clave la usen el gate, el enable y la migración.
2. Entrada en `lib/provisioning/catalogo.js`, grupo **Base**, con
   `requiere: ["team"]`.
3. Entrada en `MODULES.fichaje` de `scripts/_module-migrations.js` +
   `_migration-order.js`, o `ensure-tenant-schema` no lo crea nunca y un cliente
   nuevo nace sin las tablas (trampas 4 y 5 del sprint, sección 4.1).
4. Entrada en `components/layout/Sidebar.jsx`.
5. Alta:
   `docker exec crm-salamandra-app-1 node scripts/enable-module.js aumenta fichaje --grant-users`
   y después `npm run db:check-access`. Sin `--grant-users`, los 13 usuarios de
   Aumenta con `module_access` explícito verán 403 y lo detectará el cliente —
   como las dos veces anteriores.

**Decisión de diseño importante: colgarlo de `team`, NO de `team_avanzado`.**
Los siete submenús de `team_avanzado` exigen `requiresAll: ["team_avanzado",
"clinica"]` tanto en el menú como en los endpoints (**VERIFICADO**,
`Sidebar.jsx:203-214`). Si el fichaje sigue ese patrón queda atado a Clínica y
**no se le puede vender a un cliente que solo quiera Equipo** — que es
exactamente el perfil de quien compra un control horario. Si se quiere vender
aparte, que sea su propio `moduleKey` con `requiere: ["team"]`, no un apéndice de
`team_avanzado`.

### 5.6 Las cinco preguntas

Solo estas cinco. Cada una bifurca el trabajo de verdad; el resto se puede
decidir sin ellos.

**1. ¿Nos mandáis un mes real del Excel, tal cual sale?**
Con eso se contestan solas la mitad de las dudas: qué columnas trae, si hay una
fila por marcaje (entrada/salida) o una por día con el total ya sumado, cómo
escribe las horas, y de qué máquina o programa sale.
*Por qué bifurca:* el grano del Excel decide si podemos detectar «faltó fichar la
salida» o si solo podemos sumar lo que nos den. Si viene el total del día, el CRM
**nunca** sabrá a qué hora entró nadie, y hay cosas que no se pueden prometer.
Pueden anonimizar los nombres si quieren; lo que importa es la forma.

**2. ¿Para qué lo vais a usar: cumplir el registro de jornada, o calcular
nómina?**
*Por qué bifurca:* si es **el papel para la Inspección**, el módulo es guardar,
enseñar y exportar — y el trabajo es la mitad. Si es **calcular horas extra o de
menos**, hace falta un dato que el CRM **no tiene**: la jornada contratada de
cada persona (`weekly_direct_hours` es solo intervención directa, no jornada), y
eso arrastra tipo de contrato, saldo mensual y qué se hace con los festivos.

**3. ¿Cada persona ve su propio fichaje, o solo dirección?**
*Por qué bifurca:* decide si existe `/mi-fichaje`, si el módulo se le da a los 15
usuarios o solo a admin, y con ello el `--grant-users` del alta. No es solo UI:
es a quién se le abre un módulo con datos laborales.
*Aviso:* con los datos que tengo, la ley de registro de jornada da al trabajador
derecho a su registro y obliga a conservarlo unos años (creo que cuatro, **no lo
he verificado y no es una cuestión de código**). Que lo confirme su gestoría, y
mientras tanto el diseño no borra nada y exporta a Excel, que cubre las dos
respuestas.

**4. ¿Cómo identifica el Excel a cada persona: nombre, DNI o número de empleado?
¿Y son las mismas 15 que están en Equipo?**
*Por qué bifurca:* si viene un **código de máquina**, hace falta la columna
`clockCode` y la pantalla de mapeo (una vez, y ya). Si viene el **nombre**, hay
que decidir qué se hace con «M. José» vs «María José» y el mapeo pasa a ser
manual el primer mes. Si viene el **DNI**, estaríamos metiendo en el CRM un dato
personal nuevo que hoy no guardamos de los empleados, y eso hay que decidirlo a
propósito, no de rebote. Y si el Excel trae gente que no está en Equipo (una
sustituta, alguien de limpieza), hay que decidir si se dan de alta o se ignoran.

**5. Si volvéis a subir el Excel del mismo mes corregido, ¿queréis que reemplace
el mes entero o que solo añada lo que falta? ¿Y podéis corregir a mano dentro del
CRM, o el Excel manda siempre?**
*Por qué bifurca:* es la pregunta de la idempotencia y la que decide si las
correcciones manuales sobreviven a un re-volcado. Mi propuesta por defecto es
**reemplazar el mes conservando lo corregido a mano**, pero si para ellos «el
Excel es la verdad» el diseño se simplifica (y entonces la corrección manual solo
tiene sentido como aviso, no como dato).

### 5.7 Qué se puede empezar YA, sin respuesta

**Se puede hacer hoy** (nada de esto depende del formato del Excel):

- `moduleKey` `fichaje` + entrada en el catálogo + entrada en
  `_module-migrations.js` + sidebar. Es media hora y es lo que evita las trampas
  4 y 5.
- Modelo `FichajeImport` completo: lote, hash del fichero, periodo, quién, cuándo,
  reversible. No depende de qué columnas traiga el Excel.
- Modelo `Fichaje` con el grano propuesto (tramo con `entradaAt`/`salidaAt`
  **nullable** + `minutos` obligatorio). Ese grano aguanta las dos respuestas
  posibles a la pregunta 1, que es justamente para lo que se eligió.
- La columna `clockCode` en `team_members` y la pantalla de mapeo
  persona↔código. Hace falta **siempre**, diga lo que diga el Excel.
- Pantalla de vista mensual + corrección manual + alta manual + soft delete con
  motivo, y su auditoría con resumen.
- Exportador a Excel con `lib/billing/exportXlsx.js` (para la Inspección y para
  la gestoría). No depende del formato de **entrada**.
- El endpoint de revertir un lote.

**No se puede empezar** hasta tener el fichero:

- El parser de columnas y su diccionario de alias de cabecera.
- La plantilla descargable (no sabemos qué formato pedirles… y puede que no haya
  que pedirles ninguno: si el reloj escupe algo fijo, la plantilla la dicta la
  máquina, no nosotros).
- Las reglas de validación: jornada máxima, pausas, solapes, qué es un error y
  qué es un aviso.
- Cualquier cálculo de saldo, horas extra o conexión con la nómina — eso depende
  de la pregunta 2.

**El premio, para después:** con fichaje real, dos cosas que hoy se rellenan a
ojo dejan de hacerlo. El complemento de **asistencia** del desempeño es hoy un
botón booleano «✓ Sin faltas / Con faltas» que Dirección marca de memoria, y el
de **antigüedad** un número tecleado a mano (que además hoy no es ni derivable:
el seed del equipo real **no puso `hiredAt` a ninguna de las 15 personas** —
**VERIFICADO**). Y el denominador de Productividad podría por fin descontar
festivos y ausencias (sección 2.4). Nada de eso se promete en la v1, pero
conviene que el modelo no lo impida — y este no lo impide.

---

## Anexo: los tres comandos que resuelven la mitad de las dudas de este informe

Solo lectura, dentro del contenedor de producción:

```
docker exec crm-salamandra-app-1 node scripts/inspect-tenant-modules.js aumenta
docker exec crm-salamandra-app-1 node scripts/check-module-access.js
docker exec crm-salamandra-app-1 node scripts/comprobar-citas.js aumenta
```

Con el tercero, recordar el matiz de la sección 4.5: **miente sobre el correo**.

---

## Comprobado en PRODUCCIÓN al cerrar el informe (2026-08-06, 20:2x)

Dos cosas que el informe daba por verificar, resueltas contra el VPS:

**El admin de Aumenta tiene `module_access = ["all"]`.** El escenario grave que
temía la lente de módulos —una lista congelada de cuando el cliente tenía dos
módulos— **es solo del entorno local**. En producción el admin ve todo, así que
NO hay nada roto ahora mismo por esa vía.

**Once de los quince usuarios normales no ven** `clients`, `clients_avanzado`,
`documents_avanzado`, `formularios`, `inventory`, `leads`, `orders`, `projects`,
`support`, `team`, `team_avanzado` ni `training`; la mayoría tampoco `billing` ni
`documents`. Sí ven lo suyo: pacientes, clínica y citas.

Eso puede ser deliberado —una psicóloga trabaja en Pacientes y Clínica, no en
Facturación— o puede ser que nadie les diera acceso al ampliar los módulos entre
el 27/07 y el 01/08. **Es una decisión de negocio, no un fallo técnico**, y por
eso no se ha tocado: dar o quitar acceso a once personas reales lo deciden los
socios. Si se quiere abrir, es `scripts/enable-module.js <modulo> --grant-users`.

Comprobado con `docker exec crm-salamandra-app-1 node scripts/check-module-access.js`
y una consulta de solo lectura a `master.users`. No se ha modificado nada.
