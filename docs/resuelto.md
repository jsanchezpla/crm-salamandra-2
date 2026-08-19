# Resuelto

Lo que ya está hecho, de quién era, cuándo se cerró y cómo se comprobó.

Existe por dos motivos. Uno, para no volver a arreglar lo mismo: cuando algo
reaparece, aquí está qué se hizo la vez anterior y por qué. Y dos, para poder
mirar atrás y ver qué se ha entregado a cada cliente sin reconstruirlo de
ningún historial.

---

## Cómo se usa esto

**Nada entra aquí sin haberse comprobado contra PRODUCCIÓN.** No basta con que
el código esté subido, ni con que el despliegue haya terminado: hay que ver el
comportamiento nuevo funcionando en el VPS. Si no se puede comprobar, no se
cierra — se queda en el backlog con una nota de qué se intentó.

Cada entrada lleva **cómo se comprobó**, no solo que se comprobó. Esa línea es
la que permite repetir la verificación dentro de seis meses.

Cuando una tarea sale del backlog, entra aquí **en la misma publicación**. Así no
hay un momento en que algo no esté en ninguno de los dos documentos. El Registro
se baja, se edita y se sube con `scripts/registro.mjs` (manual en
`docs/como-apuntar-en-el-tablero.md`): sin commit ni despliegue.

Lo más reciente arriba.

---

## 19/08/2026

### 21 acciones de auditoría salían sin frase en Actividad, y el filtro «Configuración» no devolvía nada nunca · todos, producto

**Qué pasaba.** En Equipo → Actividad, 21 acciones que escriben los endpoints
no tenían frase en `lib/actividad/etiquetas.js` y salían por el traductor
genérico: «Pack anulado», «Polished report», «Create»… (las del Buzón de ayuda,
varias de citas —el cobro que falla al confirmar, la carrera cobrada-pero-
cancelada, pedir otra tarjeta, los bonos—, el aviso por correo a las familias,
contactos externos y derivaciones de clínica, desempeño, el informe pulido con
IA, los datos completados desde el portal, tres del panel interno). Y el filtro
«Configuración» buscaba el prefijo `tenant.` cuando lo que se escribe es
`configuracion.updated`, que caía en «Otros»; igual `patient.consent.*`,
`suppliers.*`, `arqueo.*`, `buzon.*` y `provisioning.*`: con frase pero sin
módulo.

**Qué lo arregló.** Frase propia para las 21 (la de la carrera no promete
devolución: qué pasa con ese dinero sigue en «Pendiente de una decisión suya»)
y módulo para los seis prefijos huérfanos. Lo sacó
`_smoke-actividad-etiquetas.mjs` (`node:test`, 32 `it`) con un cruce que lee
todos los `action: "x.y"` de `app/api` y `lib`; nació con 21 en su lista de
deuda, queda vacía, y una acción nueva sin frase pone la prueba en rojo
diciendo cuál y dónde.

*Se comprueba*: `etiqueta("clinica.report.polished").texto` es una frase en
español; `prefijosDeModulo("Configuración").prefijos` incluye `configuracion`;
`npm test` en verde.
*Dónde*: `lib/actividad/etiquetas.js`, `scripts/_smoke-actividad-etiquetas.mjs`.
*Comprobado en producción*: 19/08/2026 — antes del despliegue, ejecutado en el
contenedor, `etiqueta("clinica.report.polished")` daba «Polished report» y
`prefijosDeModulo("Configuración")` solo `tenant`; lo arregla `29085e6` (19/08)
y tras desplegar el mismo comando en el contenedor da la frase y
`configuracion`.

### En el fichaje, un nombre o alias repetido en dos personas casaba en silencio con una de ellas · `aumenta`, producto

**Qué pasaba.** `lib/fichaje/mapeo.js` existe para que el Excel del reloj no
meta las horas de una persona en la nómina de otra, y tenía justo ese agujero:
dos personas con el mismo `displayName` casaban EXACTO con la primera del
array, y el mismo alias guardado en dos personas casaba con la última; sin
sugerencia, sin aviso y sin verse en el preview (una fila «resuelta» no se
enseña). Con 15 personas en Aumenta es improbable; el modo de fallo es el peor
del módulo.

**Qué lo arregló.** Un nombre que apunta a DOS personas es ambiguo:
`indiceDeNombres` lo devuelve en `ambiguos`, `resolverNombres` lo deja
pendiente SIN sugerencia y con el motivo, y el modal de importar enseña ese
motivo en ámbar. Se elige con un clic, el alias se guarda en la elegida y el
mes siguiente casa solo (hay un `it` de ida y vuelta). Lo sacó
`_smoke-fichaje-mapeo.mjs` (`node:test`, 56 `it`).

*Se comprueba*: `resolverNombres(["LAURA GARCIA"], dos Lauras García)` deja el
nombre en `pendientes` con `sugerencia: null` y `motivo`; `npm test` en verde.
*Dónde*: `lib/fichaje/mapeo.js`, `modules/fichaje/ImportarFichajeModal.jsx`,
`scripts/_smoke-fichaje-mapeo.mjs`.
*Comprobado en producción*: 19/08/2026 — antes del despliegue, ejecutado en el
contenedor, `resolverNombres(["LAURA GARCIA"], dos Lauras)` resolvía a la
primera y `["ISA"]` con el alias en dos a la última; lo arregla `b2e6825`
(19/08) y tras desplegar el mismo comando en el contenedor los deja pendientes.

### «7.5» en una celda de horas del fichaje se leía como 7 h 05, no como 7 h 30 · `aumenta`, producto

**Qué pasaba.** El regex de reloj de `parseHoraDelDia` y `parseDuracion`
(`lib/fichaje/parseHora.js`) admitía el punto con uno o dos dígitos detrás y lo
atrapaba antes que la rama decimal: «7.5» era 7:05, 25 minutos de menos por
celda, mientras el comentario del fichero y la plantilla genérica prometían
«7:30, 7,5 o 7.5». A Aumenta no le mordía (su reloj da celdas Date/número):
mentía la plantilla que se descarga.

**Qué lo arregló.** `trozosDeReloj`, un solo sitio con la regla del punto:
punto + dos dígitos es reloj («8.30», «8.05»); punto + uno o tres o más es
decimal («7.5», «8.333»); la coma es siempre decimal. Lo sacó
`_smoke-fichaje-horas.mjs` (`node:test`, 120 `it`) el día que se escribió y
ahora lo fija.

*Se comprueba*: `parseDuracion("7.5")` → 450 y `parseHoraDelDia("8.5")` → 510;
`npm test` en verde.
*Dónde*: `lib/fichaje/parseHora.js` (`trozosDeReloj`),
`scripts/_smoke-fichaje-horas.mjs`.
*Comprobado en producción*: 19/08/2026 — antes del despliegue, ejecutado en el
contenedor, `parseDuracion("7.5")` daba 425; lo arregla `39a4f1b` (19/08) y
tras desplegar el mismo comando en el contenedor da 450.

### «24:00» pasaba la validación de disponibilidad y se guardaba como «24:00:00» · producto

**Qué pasaba.** `normalizeTime` (`lib/citas/validation.js`) no miraba el
rango: «24:00», «10:60», «99:99» salían como «24:00:00», «10:60:00»… Los tres
endpoints de disponibilidad lo daban por bueno, y como `timeToMinutes` devuelve
null para esas cadenas, la guarda «endTime debe ser mayor que startTime»
comparaba contra null y dejaba pasar un tramo 24:00→10:00.

**Qué lo arregló.** `normalizeTime` se apoya ahora en `timeToMinutes`: solo
devuelve horas que la otra entiende, y hay un `it` que exige que las dos digan
lo mismo de la misma cadena. Lo sacó `_smoke-citas-validation.mjs`
(`node:test`, 51 `it`).

*Se comprueba*: `normalizeTime("24:00")` → null; `npm test` en verde.
*Dónde*: `lib/citas/validation.js`, `scripts/_smoke-citas-validation.mjs`.
*Comprobado en producción*: 19/08/2026 — antes del despliegue, ejecutado en el
contenedor, `normalizeTime("24:00")` daba «24:00:00»; lo arregla `eb4448f`
(19/08) y tras desplegar el mismo comando en el contenedor da null.

### Los volcados de Fichaje se auditan sin frase propia: en Actividad saldrán con el traductor genérico · `aumenta`, producto

**Qué pasaba.** Los endpoints de `/api/fichaje/*` auditaban cinco acciones
(`fichaje.volcado`, `fichaje.corregido`, `fichaje.creado_a_mano`,
`fichaje.dado_de_baja`, `fichaje.volcado_deshecho`) y
`lib/actividad/etiquetas.js` no tenía ni el módulo ni las frases: en Equipo →
Actividad habrían salido como una clave en crudo.

**Qué lo arregla.** El módulo «Fichaje» en el mapa de prefijos y las cinco
frases en el catálogo (`36b070d`). Sin víctima: Aumenta aún no ha volcado
ningún Excel (0 acciones `fichaje.*` en `master.audit_logs`).

*Se comprueba*: `etiqueta("fichaje.volcado")` devuelve «Volcó el Excel del
reloj de fichar de un mes», módulo «Fichaje».
*Dónde*: `lib/actividad/etiquetas.js`.
*Comprobado en producción*: 19/08/2026 — con `c7f84d2` desplegado, dentro del
contenedor `etiquetas.js` tiene las cinco entradas y `etiqueta("fichaje.volcado")`
devuelve la frase.

### Activar «pacientes» sin «clinica» correría ALTERs sobre una tabla que no existe · producto

**Qué pasaba.** La tabla `patients` solo la creaba `migrate-clinica-module`,
que estaba únicamente en el bloque `clinica` de `scripts/_module-migrations.js`;
el bloque `pacientes` eran seis ALTER sobre esa tabla.

**Qué lo arregla.** `migrate-clinica-module` entra también en el bloque
`pacientes` (`a42a67b`): el script ya estaba escrito para «clinica O
pacientes», como `migrate-patients-care-type` ya estaba en los dos bloques; el
analizador de orden deduplica. Para un tenant con solo `pacientes`, la que crea
la tabla queda la 7.ª y los ALTER en la 19.ª–20.ª. No había mordido a nadie:
en producción ningún tenant tiene `pacientes` sin `clinica`.

*Se comprueba*: `node scripts/check-migration-order.js` coherente y
`migrationsFor(["clients","team","pacientes"])` lista `migrate-clinica-module`
antes que `migrate-patients-clients-phase1`.
*Dónde*: `scripts/_module-migrations.js` (bloque `pacientes`).
*Comprobado en producción*: 19/08/2026 — con `c7f84d2` desplegado, el bloque
`pacientes` del contenedor lleva `migrate-clinica-module`; la migración ya
estaba aplicada en los cuatro tenants con `pacientes` (todos con `clinica`),
así que el despliegue no ejecutó nada nuevo.

### Nueve pruebas no las ve `npm test` por cómo se llaman · producto

**Qué pasaba.** `scripts/pruebas.mjs` solo recoge `_smoke-*` y `smoke-test-*`;
las cuatro de Captación (`_outreach-*`) y las cinco de Nutrición
(`smoke-nutri-laura-recetario-*`) existían y nadie las lanzaba.

**Qué lo arregla** (`28e8bf1`). `_outreach-ai-unit.mjs` →
`_smoke-outreach-ai-unit.mjs`, pura, entra en `npm test` (tenía una aserción
vieja con Opus como modelo por defecto; ahora compara con `DEFAULT_MODEL`).
Las cinco de Nutrición → `_smoke-nutri-laura-recetario-*`, clasificadas
«servidor y base de datos», entran en `npm run test:todo`.
`_smoke-correo-entrante.mjs` deja de apuntar por defecto a `sandbox`.

**Lo que queda fuera, a propósito.** `_outreach-smoke.mjs`, `_outreach-e2e.mjs`
y `_outreach-ui-check.mjs` firman el JWT para `sandbox`, que no existe: en el
runner solo pondrían `test:todo` en rojo. Tienen su propia tarea en P3.

*Se comprueba*: `node scripts/pruebas.mjs --listar` enseña `outreach-ai-unit`
entre las ligeras y las cinco `nutri-laura-recetario-*` entre las pesadas;
`npm test` 36/36.
*Dónde*: `scripts/pruebas.mjs:78`, los seis ficheros renombrados.
*Comprobado en producción*: 19/08/2026 — con `c7f84d2` desplegado, los seis
ficheros están en el contenedor y `pruebas.mjs --listar` los ve.

### Los docs de Leads, Formularios y Analíticas describen overrides y endpoints que ya no existen · documentación

**Qué lo arregla.** `c7f84d2`: `leads.md` habla de cuatro overrides (los siete
y quality/abarcaia/Referidos, como histórico), recoge `convert-to-project`, el
rate limit y la auditoría del público, 15 etapas, `desglose=1`, las dos
migraciones, `/leads/estadisticas` y las plantillas por tenant (`spain_enzymes`
Y `nutri_laura`, que la lista no sabía). `formularios.md` se titula Leads
Comerciales, recoge el DELETE de descartadas y los endpoints `registro-web`, y
cuenta el canje SSO como retirado el 05/08. `analytics.md` sin `--force` y con
la regla #15. Comentarios de `Sidebar.jsx` y `_smoke-leads-etapas.mjs` al día.

*Se comprueba*: cada punto de la sección de estos docs en la revisión del
19/08 está en el doc como lo hace el código; `docs/revision-docs-2026-08-19.md`
ya no existe.
*Dónde*: `docs/modules/{leads,formularios,analytics}.md`.
*Comprobado en producción*: 19/08/2026 — verificado punto a punto contra el
código desplegado (`c7f84d2`); los docs no viajan en la imagen, viven en
`master` y en el checkout del VPS.

### Los docs de Clínica y Pacientes siguen diciendo «solo Aumenta» y describen la maqueta · documentación

**Qué lo arregla.** `c7f84d2`: los dos docs dicen dónde está el módulo (aumenta,
demo, demo_clinica, somos), `clinica.md` recoge los 35 endpoints, los 10
modelos con sus tablas al día, las 5+6 páginas, el sidebar con `requiresAll`
y la migración viva (`migrate-clinica-module`, con `sprint-1` como histórico);
`pacientes.md` cuenta el enlace paciente↔cliente (`patients.client_id` del
16/07, `ClientPatientsSection`, `PacientesDelAlta`, backfill), el modelo
completo, la ficha de seis pestañas y que `enable-module.js <slug> pacientes`
corre siete migraciones con la que crea la tabla la primera. De paso: `[id]`
no tiene DELETE (ningún `Patient.destroy` en la API), y el doc lo dice.

*Se comprueba*: ídem. *Dónde*: `docs/modules/{clinica,pacientes}.md`.
*Comprobado en producción*: 19/08/2026 — contra el código desplegado
(`c7f84d2`); tenants contra master.

### Los docs de Citas, widget, Pagos y Correo describen reglas que cambiaron este mes · documentación

**Qué lo arregla.** `c7f84d2`: `pagos.md` dice la regla del 07/08 («soltar,
nunca devolver», §4 reescrita, fase 4 y §7 con el texto viejo como histórico),
recoge `checkout.js` (bonos y plazos desde `/book`), «pedir otra tarjeta», la
lista de espera que se mantiene, 20 min de ventana, las 19 pruebas de cobro,
plazos, bonos, vigilante y `stripe_webhook_events`. `citas.md` recoge las FK de
`Booking`, el correo de cancelación, las tablas de endpoints completas, el
default con lista de espera (el override de Laura como histórico) y las 15
migraciones. `citas-embed.md`: CSP por tenant, `?wpa=1` retirado, `mi-perfil`,
13 endpoints del portal, `configure-portal-citas.js`. `emails.md`: BYOK, 16
plantillas, correo entrante, receta de plantilla nueva. Cabecera de
`lib/email/resendClient.js` y URL de `dev-mint-wpsso.js` al día.

**Lo que salió y no era de doc** (apuntado en el backlog): dos pruebas de
cobro siguen esperando devoluciones; el 409 de `confirm` dice «el importe se
ha devuelto» sin devolver; cinco plantillas no miran `citaPuedeAvisar`; la
tarjeta de Stripe pide una lista corta de eventos.

*Se comprueba*: ídem. *Dónde*: `docs/modules/{citas,citas-embed,pagos,emails}.md`.
*Comprobado en producción*: 19/08/2026 — contra el código desplegado
(`c7f84d2`).

### Los docs de Facturación e Inventario hablan de FIFO, lotes y pantallas que no están · documentación

**Qué lo arregla.** `c7f84d2`: `billing.md` con el envío real de facturas por
Resend, el FIFO sobre `InboundBatch` como histórico (hoy solo avisa; Pedidos
descuenta), el editor que elige producto de Inventario, las 17 páginas, los
endpoints que faltaban (quotes, pdf, bulk-pdf, partners, 7 exports, morosidad,
operations, arqueo y proveedores fuera de `/api/billing`), los modelos al día
y secciones para `Quote`, `Supplier`, `CashPoint`/`CashClose`; migración sin
filtro de `status` y comandos con `docker exec`; backlog sin PDF ni
Presupuestos (existen). `inventory.md` con la siembra real de la demo,
Proveedores y la auditoría `inventory.*`; `lib/provisioning/catalogo.js` ya no
describe Inventario con «lotes, fórmulas».

**Lo que salió y no era de doc** (apuntado en el backlog): `Cost.supplierId`
no lo aceptan los endpoints de gastos ni la pantalla.

*Se comprueba*: ídem. *Dónde*: `docs/modules/{billing,inventory}.md`,
`lib/provisioning/catalogo.js:68`.
*Comprobado en producción*: 19/08/2026 — contra el código desplegado
(`c7f84d2`); el texto nuevo de `catalogo.js` está en el contenedor.

### Los docs de Equipo, Proyectos, Soporte y Buzón se quedaron en su primera versión · documentación

**Qué lo arregla.** `c7f84d2`: `team.md` con diez páginas y tres modelos, los
cinco campos y cinco endpoints que faltaban, los permisos por módulo (sí los
hace), Actividad con `team_avanzado`, migración sin `status`. `projects.md`
desplegado y en cinco clientes, activación con `enable-module.js`, cuatro
pestañas, la IA de Proyectos (§5.5) y el calendario, SQL sin `status`, §12 como
histórico. `support.md` con el fallback al Buzón, el pie del sidebar actual,
`[attachmentId]`, `demo` en vez de `sandbox`, la deuda de `enable-module.js`
cerrada. `buzon.md` con `quienEscribe.js` y la herramienta de triaje.

*Se comprueba*: ídem. *Dónde*: `docs/modules/{team,projects,support,buzon}.md`.
*Comprobado en producción*: 19/08/2026 — contra el código desplegado
(`c7f84d2`).

### Los docs de Clientes, Nutrición, Formación, Documentos, Configuración y Captación listan menos de lo que hay · documentación

**Qué lo arregla.** `c7f84d2`: `clients.md` con los 26 endpoints, nueve
pestañas y la migración de asignaciones en todos los tenants; `nutricion.md`
con 24 endpoints, cinco tenants, OpenFoodFacts como histórico, el esquema con
el recetario, §5 completa, §8 con las pruebas renombradas y `test:todo`, §9
con las ocho migraciones y `enable-module.js`; `training.md` con nueve
modelos, los rótulos en dos sitios (el override de Aumenta borrado el 18/08),
`/api/cuestionarios` solo `training`, `CRM_WEBHOOK_SECRETS`, la auditoría que
sí hace, seis componentes, seis rutas públicas y cuatro endpoints más;
`documents.md` en producción, §2 con `enable-module.js`, modelo completo y
MIME libre, gates básico/avanzado; `configuracion.md` con el engranaje solo
admin, ocho tarjetas, GET/PATCH completos, diez interruptores, `vetoAi` en 11;
`outreach.md` en producción, regla #15, Resend por cliente (dry-run solo con
la clave literal `dry-run`), `enable-module.js`, y su fila de pruebas con
`_smoke-outreach-ai-unit.mjs` dentro de `npm test`. Comentarios de
`dependencias.js` y `enviar-correo/route.js` al día.

*Se comprueba*: ídem.
*Dónde*: `docs/modules/{clients,nutricion,training,documents,configuracion,outreach}.md`.
*Comprobado en producción*: 19/08/2026 — contra el código desplegado
(`c7f84d2`).

## 17/08/2026

### «Convertidos» ya no sale donde el embudo no puede ganar a nadie · `aumenta`, `demo`, `sandbox`

**Qué pasaba.** De los seis embudos, tres —aumenta, demo y sandbox— terminan en
Nuevo, Contactado y Descartado, sin ninguna etapa de «ganado». Para ellos la
tarjeta «Convertidos» de la pantalla de estadísticas era un 0 que no podía subir
por bien que les fuera, y su conversión pasaba a «0 % de los cerrados» en cuanto
alguien pulsara Descartado, que es uno de los tres botones que ofrecen. Los dos
números eran ciertos y engañaban igual: no es que no conviertan, es que su
embudo no tiene dónde apuntarlo.

**Qué lo arregla.** El mismo criterio que esa pantalla ya seguía con «Con ficha
creada»: cuando la cifra no significa nada se pone a `null` y la tarjeta
desaparece, porque un cero grande se lee como una avería y no como «esto no va
contigo». Un 0 legítimo —embudo con etapa ganadora y nadie convertido todavía—
se sigue viendo.

**Lo que hubo que construir.** Para decidirlo hacía falta que el SERVIDOR supiera
qué etapas ofrece cada cliente, y no podía: viven dentro de componentes de React
que no se pueden importar desde ahí. `lib/leads/embudos.js` las declara. Los
siete componentes NO se han unificado —siguen separados como se decidió el
17/08—, así que la lista está en dos sitios; por eso el arreglo trae su propia
red: `_smoke-leads-etapas.mjs` compara ahora las dos, cliente por cliente, y
casca si alguien añade una etapa a un componente y no la declara. Esa prueba
estaba escrita y sin commitear, y este cambio la rompió al mudar `GANADOS`:
leía el conjunto del TEXTO con una expresión regular. Ahora lo importa.

**Lo que NO entra aquí, a propósito.** Que el embudo de Aumenta siga sin poder
dar a nadie por ganado. Eso ya no es un fallo de la pantalla, es una pregunta de
producto —qué significa «ganado» en un centro de psicología— y sigue abierta en
el backlog junto con el estilo huérfano de `qualified`.

*Se comprueba*: entrar en la demo pública y pedir `/api/leads/estadisticas`;
`profesionales.ganados` viene a `null` y la tarjeta no se pinta.
*Dónde*: `lib/leads/embudos.js` (nuevo), `lib/leads/estadisticas.js` y
`app/(dashboard)/leads/estadisticas/page.jsx`.
*Comprobado en producción*: 17/08/2026 — con `efee2c2` desplegado, `demo` (16
leads, 5 descartados, que es justo el caso que daba el 0 %) devuelve `ganados:
null` y `conversion: null`; y de control, `demo_agencia`, `demo_nutricion` y
`demo_clinica`, que usan el embudo por defecto, siguen devolviendo `ganados: 0`
con la tarjeta puesta. La prueba de humo, en verde en el repo del VPS.

### El correo de acceso de tunutrilaura sí llega: la tarea era falsa · `nutri_laura`

**Qué decía.** Que al aceptar una solicitud, la paciente nunca recibe el correo
con el enlace para elegir contraseña. Se apuntó en P0 la mañana del 17/08 con
«reproducido dos veces» en el sello.

**No era verdad, y el fallo fue del método de prueba.** Las reproducciones usaron
direcciones con `+` (`info+alta-prueba@…`). El correo de Salamandra es Microsoft
365, que **no acepta subdirecciones con `+` salvo que el administrador lo
active**: para su servidor esa dirección no existe y la rechaza en la puerta. No
fallaba el alta, fallaba el destinatario.

**Cómo se destapó.** Mandando por el mismo camino el correo de WordPress —el del
botón «Restablecer contraseña», que se sabía que SÍ llega— a la misma dirección
con `+`. Tampoco llegó. Si el camino bueno también falla, lo que falla no es el
camino: es la dirección.

**Y entonces se probó bien.** Contra un Gmail normal, sin `+`: llegaron los dos,
a la bandeja de entrada y no a spam. Incluido «Tu acceso a tunutrilaura», que es
justo el que se decía que no salía nunca.

**De la paciente que lo levantó todo**: su ficha tiene el correo bien escrito y
su cuenta en la web se creó dos segundos después, con esa misma dirección exacta.
Lo más probable con diferencia es que le llegara y no lo viera. No se puede
demostrar —del 14/08 no hay registros de envío— y se deja dicho así en vez de
rellenarlo con una suposición.

**Lo que sí queda de todo esto**, y no es poco: `nutrilaura-portal-user.php` es
código nuestro cuya única copia está en el WordPress de una clienta, y
`crearUsuarioPortal` sigue diciendo «se le ha enviado un correo» sin que
WordPress confirme nunca que salió.

*Se comprueba*: llamar a `crm/v1/portal-user` con una dirección **sin `+`** que
no tenga cuenta, y que llegue «Tu acceso a tunutrilaura».
*Dónde*: `lib/formularios/portalUser.js`. El envío, en el tema de
tunutrilaura.com, fuera de este repo.
*Comprobado en producción*: 17/08/2026 — alta contra un Gmail limpio: llegan el
correo del alta y el de WordPress, los dos a la bandeja de entrada. Un registro
temporal de `wp_mail` en la web confirmó que el tema sí intenta el envío y que
no falla.

### Las seis llaves de root del VPS, identificadas una por una · producto

**De dónde venía.** Había una tarea en P0 que decía que el VPS admite entrar como
root con contraseña, y que cerrarlo «no deja a nadie fuera» porque «las claves
públicas de los cuatro que entramos ya están puestas». Antes de cerrar nada se
comprobó de quién es cada llave, y de paso salió que la tarea se equivocaba en
tres cosas.

**Las seis llaves, y ninguna era de un desconocido.** Son de Jorge y de Rodrigo,
tres cada uno. Se identificaron por evidencia y no por el comentario del fichero,
que lo escribe quien quiere:

- rodri-pc-windows (AHFX+bd…) — Rodrigo, sobremesa. Sin accesos esa semana.
- jsanchezpla@gmail.com (4LaZvG…) — Jorge, con su correo personal. Sin accesos.
- rodrigo@salamandra (BNnVND…) — Rodrigo, su máquina de trabajo: 355 accesos.
- rodrigo@portatil (UkCe6r…) — Rodrigo, portátil: 7 accesos, desde la MISMA IP
  que la anterior, o sea el mismo sitio con dos equipos.
- claude-code-deploy@DESKTOP-KEM8CKA (zqDP04…) — el PC de Jorge, la que usa
  Claude Code: 377 accesos, el último el mismo día de esta entrada.
- claude-code-crm (0mIFQM…) — también el PC de Jorge, y no había entrado nunca.

Las dos de Claude Code se ataron en directo: su `.pub` está en el `.ssh` de Jorge
y `ssh -v` enseña al servidor aceptando esa huella desde esa máquina. La de
`claude-code-crm` no se usaba porque su `config` apunta el alias a la otra. Y en
todo el registro solo han entrado con llave DOS IPs, el Jazztel de Jorge y el ONO
de Rodrigo; ninguna tercera.

**Con un límite que hay que saber:** el registro de sshd solo llega al 10 de
agosto, aunque la máquina es del 24 de junio. Así que «sin accesos» quiere decir
«no en esos siete días», no «nunca».

**Lo único que se ha tocado.** Dos líneas fuera de
`/root/.ssh/authorized_keys`, las dos de Jorge: la repetida y la de
`claude-code-crm`. Quedan cinco. Copia previa en
`/root/backups/authorized_keys-antes-de-podar-20260817`, y el script abortaba
solo si el resultado no eran cinco llaves o si faltaba la que estaba en uso. No
se tocó la configuración de sshd ni se reinició: `authorized_keys` se lee en cada
conexión, así que este cambio no podía dejar a nadie fuera de la máquina.

**Lo que se decidió, y hay que leerlo antes de dar esto por seguro.** La
contraseña de root SE QUEDA, por decisión de Jorge: la usa para entrar al VPS a
mano desde cmd. Hoy la máquina sigue respondiendo `permitrootlogin yes` y
`passwordauthentication yes`, así que esta entrada NO significa que el acceso por
contraseña esté cerrado. Lo que queda abierto, medido: 88 intentos contra root en
siete días desde 11 IPs distintas, ninguno acertado; 730 accesos legítimos y
todos con llave; root con contraseña puesta y fail2ban sin instalar.

**Tres cosas en las que la tarea se equivocaba, por si se retoma.** Una, el
arreglo que proponía era al revés: decía un fichero «con número más alto», y en
sshd gana el PRIMER valor, así que un número alto no habría hecho nada y el
problema se habría dado por cerrado. Se midió con `sshd -T -f` sobre una
configuración de mentira en /tmp, borrada después: un fichero numerado 10 da
`no`, uno numerado 99 da `yes`. Dos, eran dos problemas y no uno: la contraseña
sí está tapada por el Include de la línea 12, pero `PermitRootLogin yes` está
escrito a pelo en la línea 124 y no lo tapa nadie. Tres, no son cuatro personas:
son dos, con seis llaves.

**Y la contraseña puede que no haga falta.** El `config` de Jorge tiene la llave
solo en el alias `crm-vps`; los otros Host por IP no llevan IdentityFile, así que
al escribir `ssh root@<IP>` no se ofrece ninguna llave y sshd pide la contraseña.
Escribiendo `ssh crm-vps` desde cmd se entra con llave y sin contraseña, sin
cambiar nada en ningún sitio. Si eso se confirma, cerrar la contraseña deja de
costar nada.

*Se comprueba*: `ssh crm-vps "ssh-keygen -lf /root/.ssh/authorized_keys"` devuelve
cinco llaves sin ninguna repetida, y los dos siguen entrando.
*Dónde*: `/root/.ssh/authorized_keys` en el VPS, fuera de este repositorio. Lo que
NO se hizo, en `/etc/ssh/sshd_config` línea 124 y en el Include de la línea 12.
*Comprobado en producción*: 17/08/2026 — cinco llaves en el fichero, conexión
nueva verificada después de escribir, y `sshd -T` sigue diciendo
`permitrootlogin yes` y `passwordauthentication yes`, como se decidió.

---

## 14/08/2026

### El Registro ya deja escribir la solución de una tarea y copiarla entera · `interno`

**Lo que había.** Cuando ya se sabía cómo se arreglaba algo, ese conocimiento no
tenía dónde ir hasta que alguien se sentara a programarlo: se quedaba en una
conversación y se perdía. Y para pasarle una tarea a Claude había que ir
seleccionando a mano el título, el cliente y el cuerpo, que están en tres sitios
distintos de la tarjeta.

**Lo que hay ahora.** Dos botones dentro de cada tarea. Solución abre un campo de
texto libre y lo guarda; si ya hay una escrita se enseña siempre, sin abrir nada,
porque para eso se escribió. Copiar deja en el portapapeles el título, el
cliente, la descripción y la solución, en ese orden y sin markdown, listo para
pegar en un chat. Vaciar el cuadro y guardar la borra, para que «no hay solución»
sea un solo estado y no dos que se pintan igual.

**Dónde se guarda, que era la trampa.** En `master.tablero_estado`, columna
`solucion`, y NO en docs/backlog.md: ese fichero viaja dentro de la imagen de
Docker y el siguiente despliegue se habría llevado por delante lo que la pantalla
escribiera, sin dar ningún error. Es el mismo motivo por el que ya vivían ahí el
tick y el reparto.

**El orden del despliegue no fue casualidad.** La migración se corrió en
producción ANTES de subir el código: el `findOrCreate` del PATCH hace SELECT de
todos los atributos del modelo, así que con el código nuevo por delante de la
columna, guardar un tick habría dado 42703. Una columna que todavía no lee nadie
es invisible para la app que está corriendo.

*Se comprueba*: escribir una solución en una tarea del Registro, recargar, y que
siga ahí; y que Copiar pegue las cuatro cosas de una vez.
*Dónde*: `app/admin/tablero/page.jsx` (los botones y el texto que se copia),
`app/api/admin/tablero/route.js` (el PATCH acepta `solucion`),
`lib/tablero/estado.js` (`conEstado` la pasa a la pantalla),
`scripts/migrate-tablero-estado.js` (la columna).
*Comprobado en producción*: 14/08/2026 — `solucion` existe en
`master.tablero_estado` (17 filas de estado, intactas), y ejercitado el camino
real del PATCH contra la base del VPS: guardar, leerla por el mismo SELECT que
usa el GET, comprobar que no marca ni mueve la tarea, y borrarla vaciándola.
Fila de prueba eliminada después.

---

### Aumenta no tiene ninguna clave de IA, y ya hay cosas suyas esperándola · `aumenta`

**Se cierra por decisión, no porque haya cambiado nada.** Jorge, 14/08/2026: está
bien así, ya la pondrán ellos. No queda trabajo nuestro — la clave es suya, la
cuenta es suya y el coste es suyo, que es lo que significa BYOK, y desde el
back-office ya se le puede pegar en cuanto la manden sin que tengan que entrar
ellos a configurarla.

**Lo que sigue siendo verdad, para que nadie lo lea como un fallo.** «Redactar
con IA» y la transcripción de sesiones siguen contestando 503 en Aumenta, y
seguirán hasta que haya clave. Eso es exactamente lo que hace
`lib/ai/anthropicKey.js`, que no recurre a la clave del entorno a propósito. Si
dentro de unos meses alguien abre esto como un bug, esta entrada es la respuesta.

*Se comprueba*: en `master.tenants`, `aumenta` sigue sin
`settings.integrations.anthropicApiKey` — y eso es lo esperado, no un problema.
*Dónde*: `lib/ai/anthropicKey.js` (BYOK, sin recurso al entorno);
`lib/provisioning/credencialesCliente.js` es por donde se le pega cuando llegue.
*Comprobado en producción*: 14/08/2026 — consultado `master.tenants`: `aumenta`
sin clave de Anthropic ni de OpenAI, `salamandra_solutions` sí tiene la de
Anthropic. Cerrada por decisión, no por un arreglo: la situación es la misma que
cuando se apuntó.

---

### El informe clínico ya lo redacta la IA, y no puede inventarse nada · `aumenta`, `demo`

**Lo que había.** «Volcar las sesiones al informe» copia literal lo que escribió
la terapeuta en cada sesión, con su fecha delante: `3 de marzo: se trabajan
tareas de atención sostenida con apoyo visual, responde con interés`. Es exacto y
se lee como un parte, no como un informe — y quien lo recibe es una familia. La
cabecera de `redactarInforme.js` llevaba desde julio diciendo que la redacción
asistida «de mañana» se apoyaría en él y no lo sustituiría. Esto es ese mañana.

**Las dos reglas del fichero, ahora en código y no en el prompt.** La primera —no
pisa lo que la terapeuta escribió— se cumple porque **el endpoint no guarda
nada**: `POST /api/clinica/reports/[id]/pulir` devuelve una PROPUESTA que se
pinta al lado, apartado por apartado, con su «Usar este texto». Y porque de los
ocho apartados del informe solo se le mandan al modelo los CINCO que salen del
volcado: el motivo de intervención y la propuesta de continuidad los escribe ella
y no salen de su sitio ni para que la IA los lea.

La segunda —no inventa— se le pide en el prompt, pero pedir no basta. La
propuesta pasa por `verificarSinInventar`, que la **rechaza entera** si aparece
cualquier número o cualquier mes que no estuviera en el volcado, y dice cuál: una
edad, un porcentaje, una sesión que no hubo. Es la invención que más daño hace en
un informe clínico y la única que se puede comprobar sin opinar. Un apartado que
encoge a menos de la mitad no se rechaza —unir dos anotaciones acorta con
razón— pero se avisa, para que lo mire con lupa antes de aceptarlo.

**Lo que no se ha tocado**: `lib/clinica/reportPdf.js`. El PDF que recibe la
familia es el mismo de siempre.

*Cómo se comprobó*: `scripts/_smoke-pulir-informe.mjs` (sin base de datos ni
servidor) fija las dos reglas: que el motivo de intervención y la continuidad no
se le mandan al modelo, que una edad, una fecha o un porcentaje inventados se
cazan y se nombran, que repetir un número que ya estaba sí pasa, que lo que
encoge se avisa y que el modo simulado de la demo pasa la MISMA verificación que
el de verdad. Y de punta a punta contra el servidor: en `demo` el endpoint
devuelve 200 con la propuesta simulada; en un tenant sin clave, 503 con «Este
cliente no tiene configurada la clave de IA».
*Comprobado en producción*: 14/08/2026 — desplegado; y lo que faltaba para que
Aumenta lo use es SOLO su clave de Anthropic, que sigue ausente
(`anthropicApiKey` vacío en `master.tenants`). Queda apuntado en el backlog.

### «Pedirle otra tarjeta»: la retención viva o muerta, por fin comprobada · todos

**Lo que quedaba.** El arreglo del 13/08 estaba desplegado y sin ejercitar: los
seis casos que se deciden sin salir de casa estaban fijados, pero la pregunta
final —¿la retención del intento anterior sigue VIVA?— solo la contesta Stripe, y
ningún tenant de local tiene claves. Ensayarlo contra producción pedía una cita
`failed` de una persona de carne y hueso.

**Cómo se ha resuelto sin una cuenta de Stripe.** Se falsea la LIBRERÍA
(`scripts/_fake-stripe.mjs`, enchufada por un cargador de Node), no nuestro
código. Así se ejercita el camino entero de producción —`getStripe` monta el
cliente con la clave del tenant, `leerEstadoAutorizacion` interpreta el estado y
`estorbaParaPedirOtraTarjeta` decide— y lo único inventado es la respuesta de
Stripe, que es justo lo que no se tenía. El guion se elige por el id del
PaymentIntent, así que ninguna prueba contamina a otra, y el falso se planta si
alguna vez le llega una clave `sk_live_`.

**Los cinco desenlaces, y qué hace el botón con cada uno**: `requires_capture` →
409 (el paciente tiene el importe bloqueado; crear otra retención le dejaría
dos); `canceled` → adelante, que es para lo que existe el botón; `succeeded` →
adelante; el PaymentIntent que ya no existe —clave rotada, cuenta cambiada— →
adelante, porque no hay nada que duplicar; y Stripe que no contesta → 409,
porque «no lo sé» no puede ser vía libre cuando hay dinero de por medio. Los dos
mensajes de 409 son distintos a propósito, y solo el segundo invita a
reintentar, que es el único que se arregla esperando.

*Cómo se comprobó*: `node --import ./scripts/_fake-stripe-loader.mjs
--env-file=.env.local scripts/_smoke-retencion-viva-o-muerta.mjs`, con el tenant
`sandbox`: seis lecturas de estado y cinco decisiones del botón, todas en verde,
más que los dos mensajes no se confunden. Lo que sigue sin ejercitarse es la capa
HTTP de encima —el 409 del endpoint y el correo de Resend—, que no se puede
montar sin una cuenta de Stripe de prueba; ahí manda `_smoke-autorizacion.mjs`.
*Comprobado en producción*: 14/08/2026 — desplegado, contenedor arriba y `/login`
en 200. La lógica que decide es la misma que se ha ejercitado, y `failed` sigue
en `PUEDE_HABER_DINERO`, que es correcto y no se ha tocado.

### El back-office nuevo, ejercitado: demos por oficio, claves y cierre de cuentas · producto

**Las demos por oficio SÍ están en producción** (la tarea decía que no, y era
verdad el 13/08): `demo_clinica`, `demo_nutricion` y `demo_agencia` existen con
su schema, su foto dorada y su administrador. Las cuatro pestañas se pintan
arriba del CRM y llevan a donde dicen — al saltar a la de clínica el menú cambia
al suyo (aparecen Formularios y Equipo, desaparecen Captación, Analíticas y
Proyectos). Un slug que no esté en la lista blanca responde 404, que es lo que
impide que ese botón sea una puerta al CRM de un cliente.

**Poner claves y cerrar cuentas no se pueden mirar: hay que hacerlas.** Se han
hecho contra el tenant `sandbox`, que es el cliente de mentira que pedía la
tarea. Poner una clave: se guarda con prefijo `enc:v1:` y **no se devuelve en la
respuesta**, ni a quien acaba de escribirla; un pegado a medias (corto, con
espacios, con saltos de línea) se rechaza en el acto; y a una demo se le contesta
409. Cerrar la cuenta: la radiografía dice antes lo que hay dentro; sin teclear
el identificador no se cierra, ni tecleándolo mal; una demo da 409 —se rehacen
con su script— y el tenant desde el que trabajas, también; y al cerrarla de
verdad el schema aparece como `zzz_baja_sandbox_<sello>`, `crm_sandbox` deja de
responder, el cliente desaparece de `master.tenants` y la baja sale listada con
su red de rescate.

**Dos cosas que salieron por el camino.** `scripts/seed-sandbox.js` creaba las
tablas con `sequelize.sync()` y **no corría las migraciones**, así que el
sandbox nacía a medias y en silencio: en Soporte, `tickets.number` se quedaba sin
su secuencia y todos los tickets salían sin número —la referencia que se dice por
teléfono era «TK-????» y el correo entrante dejaba de reconocer el «TK-0042» del
asunto—. Ahora llama a `ensure-tenant-schema.js`, como hace el alta de clientes.
Y `podar-bajas.js` rechazaba `--dias=0`, que es justo lo que se quiere después de
una prueba.

*Cómo se comprobó*: en producción, las cuatro demos por HTTP
(`/api/auth/demo` responde 200 a las cuatro y 404 a un slug inventado) y las
pestañas navegando de verdad en el CRM. En local, `scripts/_smoke-backoffice-ciclo.mjs`
contra el sandbox: 21 comprobaciones en verde, incluido el cierre completo y su
schema apartado. Ese smoke se pide con `node:http` y no con `fetch` a propósito
— `fetch` descarta la cabecera `Host`, y sin ella el middleware contestaba 404 a
todo y la prueba pasaba en verde sin haber llegado a ningún sitio.
*Comprobado en producción*: 14/08/2026 — `master.tenants` con las tres demos de
oficio activas (11, 12 y 9 módulos) y sus cuatro schemas `_golden`; las cuatro
pestañas funcionando. Lo de las claves y la baja se ejercitó en local, contra un
cliente de mentira, que es lo que la propia tarea pedía: darle de baja a un
cliente real por probar no es una opción.

### La integración de Retorika no estaba rota: la academia estaba parada · `retorika`

**Decisión de Rodrigo, 14/08/2026**: Retorika está bien, solo parados. La tarea
se cierra.

Lo que se sabía el 10/08 sigue siendo cierto y explica por qué esto nunca llegó a
ser un fallo: **no se rechazó ni una llamada**. Las tres que llegaron en julio
respondieron 200, y la última —del 06/07— era una comprobación que no escribe
nada. Los datos pararon donde para una academia en verano: cuestionarios y
alumnos el 25/06, matrículas e inscripciones el 29/06. La tarea decía
explícitamente que hasta preguntarles no se podía saber; se preguntó, y la
respuesta cierra el caso.

*Cómo se comprobó*: preguntándoselo, que era el `*Se comprueba*` de la tarea.
*Comprobado en producción*: 10/08/2026 — 526 intentos, 100 alumnos, 88 matrículas
y 23 inscripciones, ninguna llamada rechazada.

### El secreto global de webhooks se queda como está · `retorika`

**Decisión de Rodrigo, 14/08/2026**: está bien así. La tarea se cierra.

Es el `CRM_WEBHOOK_SECRET` de reserva, de 31 caracteres, y quien cae en él es
Retorika, que no tiene entrada propia en `CRM_WEBHOOK_SECRETS` (Laura sí, con 64).
No es una vulnerabilidad conocida: es un secreto que parece escrito a mano en vez
de generado al azar. Cambiarlo obliga a tocar el `wp-config.php` de la web de
Retorika a la vez, y el riesgo de dejar su integración muda por una limpieza es
mayor que lo que se gana. Si algún día se toca esa zona, o si Retorika vuelve a
mandar datos y hay que entrar en su WordPress igualmente, es el momento.

*Comprobado en producción*: 09/08/2026 — solo `nutri_laura` (64) tiene entrada
propia; el global sigue en 31.

---

## 13/08/2026

### Módulo de Fichaje: el Excel del reloj de fichar entra en el CRM · `aumenta`, `demo`, producto

**Lo que pasaba.** La tarea llevaba desde el 09/08 diciendo lo mismo: «lo
pidieron por WhatsApp, que vuelquen el excel de cada mes. No sabemos las
columnas, ni de qué máquina sale, ni si un mes se puede volcar dos veces». Sin
el fichero no se podía hacer. El 13/08 llegó un mes real —marzo de 2026— y
resulta que el fichero decide casi todo el diseño.

**La frase que manda.** Un fichaje mal importado es una nómina mal pagada. Las
cuatro garantías salen de ahí: volcar dos veces el mismo mes no duplica horas;
se puede corregir a mano y la corrección sobrevive al siguiente volcado; el
volcado se deshace ENTERO, no fila a fila; y **una fila cuyo nombre no case con
una persona del equipo no se importa jamás** — sale en el preview y se mapea ahí.

**Universal por dentro, de cada cliente por fuera.** Tablas, endpoints,
pantallas, totales y avisos son los mismos para todos. Lo único que cambia es el
LECTOR del Excel (`lib/fichaje/parsers/`), porque cada reloj escupe un formato
distinto y pedirle al cliente que cambie su hoja es pedirle lo que no va a
hacer. Añadir un cliente nuevo es un fichero ahí y una línea; quien no tenga
lector propio usa el genérico. Cuelga de `team` y no de `team_avanzado` a
propósito: el avanzado exige además `clinica`, y eso dejaría un control horario
invendible a quien solo quiere Equipo, que es justo quien lo compra.

**Las trampas del fichero real, que no se habrían adivinado sin él.** La columna
de nombres también lleva anotaciones (BAJA, MÉDICO, JUSTIFICANTE DE MÉDICO): sin
la regla que las distingue, el justificante se leía como una persona más y **se
llevaba las 39 horas de Victoria**. Los bloques no son de tamaño fijo —«ISA»
está en la fila 13 en unas hojas y en la 14 en otras—. Las fórmulas del Excel
devuelven `21.000000000000245` minutos y, cuando falta una hora de salida,
duraciones NEGATIVAS. Y `M-1` / `M-2` son dos tramos el mismo día —Rosa trabaja
los martes mañana y tarde—, que es la razón de que el modelo guarde tramos y no
días.

**Identificar a la persona.** El Excel trae `ISA` y `DANIA`; el CRM tiene
«Isabel Alberca Bolaños» y «Daniela de la Cruz Esteban». Solo se asigna sola la
coincidencia exacta; lo demás es una sugerencia que confirma una persona, y al
confirmarla el alias se guarda para el mes siguiente. Con el equipo real sugiere
9 de 14 y **se calla en las cinco ambiguas**: dos Isabeles, dos Raqueles, DANIA
junto a DANIELA y dos Lauras. Una sugerencia se acepta a ciegas, y ahí serían las
horas de otra persona.

*Cómo se comprobó*: las cuatro garantías, de punta a punta contra el fichero real
(13/08, local): entran **269 jornadas** de las 271 leídas —las 2 que faltan son
errores reales del Excel, un día sin hora de salida y una jornada de 21 h—,
volver a volcar deja 269 y no 538, una corrección a mano sobrevive con su valor
al RE-VOLCAR, revertir se lleva el lote entero —incluidas las correcciones que
nacieron de él, que es lo correcto: una corrección sobre una fila que no debió
entrar solo hereda el error con mejor letra— y al mes siguiente los 14 nombres
casan solos. En producción, 13/08: módulo activo en `aumenta` y `demo`,
las dos tablas y el índice único `fichajes_import_unico` creados en los dos
schemas, «Fichaje» sale en el menú, `/equipo/fichaje` responde 200, el endpoint
del mes devuelve el equipo, y el volcado está bloqueado en la demo.

⚠️ **Lo que hay que hablar con Aumenta**: en el fichero de marzo hay dos nombres
—`VICTORIA` y `LAURA ARROYO`— que no están en el equipo del CRM, y una persona
del CRM (`Arantxa Garrote`) que no está en el Excel. Eso se resuelve hablando,
no en código.


### En Formación, las personas son «Alumnos» y las inscripciones «Matrículas» · `retorika`, `aumenta`, `nutri_laura`, `demo`, `somos`

**Lo que pasaba.** Había TRES pares de palabras para las mismas dos cosas. El
menú y las tarjetas decían «Usuarios» y «Alumnos por curso»; las métricas de la
portada, justo encima, decían «Usuarios» y «Matrículas»; y el override de Aumenta
llamaba «Alumnos» a las personas y «Matrículas por curso» a las otras. Quien
entraba por primera vez no podía saber en cuál de las dos pantallas se dan de
alta alumnos.

**La prueba estaba escrita en el propio producto**, en la ayuda de Empresas y en
mayúsculas: «IMPORTANTE: los alumnos de empresa se importan desde aquí» — porque
quien quería dar de alta alumnos entraba en «Usuarios», que es donde no se hace.
Un aviso a gritos es lo que se pone cuando el nombre no basta.

**Lo que se decidió** (Rodrigo, 13/08): las PERSONAS son «Alumnos» y las
inscripciones «Matrículas», en los tres sitios a la vez. El aviso en mayúsculas
se ha quitado —ahora es una frase normal, y está en las dos pantallas— y cada una
dice de la otra para qué sirve: en Alumnos, «si buscas quién está apuntado a qué
curso, eso es Matrículas»; en Matrículas, «aquí no se dan de alta personas».

**Las RUTAS no se han tocado, y quedan al revés de lo que parece**: los alumnos
están en `/formacion/usuarios` y las matrículas en `/formacion/alumnos`.
Cambiarlas rompería enlaces guardados por cinco clientes a cambio de nada. Es el
mismo criterio que en Nutrición, donde `/nutricion/asignados` se llama «Pautas».

*Cómo se comprobó*: 13/08/2026 contra producción, en la demo pública. En
`/formacion` salen «Alumnos» y «Matrículas» tres veces cada uno —menú, tarjeta y
métrica, que son los tres sitios que se contradecían—; el título de
`/formacion/usuarios` es «Alumnos» y el de `/formacion/alumnos` «Matrículas», con
la referencia cruzada a la otra en la ayuda de cada una. «Alumnos por curso» no
aparece ya en ninguna de las tres páginas.

### El ancho de una pantalla deja de escribirse a mano · `retorika`, `aumenta`, `nutri_laura`, `demo`, `somos`

**Por qué volvía.** «El módulo de Formación se ve demasiado ancho» se había
arreglado ya varias veces. No era mala suerte: **no había ningún sitio donde el
ancho estuviera decidido**. Cada pantalla escribía su `p-… max-w-…` a mano,
copiado de la que tuviera más cerca, así que el módulo acabó con CUATRO
respuestas a la misma pregunta — la portada a 5xl, Cursos y Empresas a 6xl,
Alumnos y Matrículas a 7xl, y Cuestionarios sin ninguna, de lado a lado de la
pantalla. El CRM entero igual: 19 pantallas a 7xl, 13 a 6xl, 12 a 5xl y 6 a 4xl,
sin nada que diga cuál toca.

El arreglo del 27/07 tocó las dos portadas y las otras cinco pantallas siguieron
cada una por su lado. Por eso «volvía»: arreglar una pantalla no arregla nada.

**Lo que se ha hecho.** `components/layout/anchoPantalla.js` decide, con dos
valores y solo dos —con tres, quien duda elige mal y nadie lo nota—: `portada`
(4xl) para landings, fichas y formularios, `listado` (7xl) para pantallas con
tabla. Las ocho pantallas de Formación cuelgan de ahí. La portada baja de 5xl a
4xl, que es la que Rodrigo veía ancha, y Cuestionarios deja de ocupar la pantalla
entera.

**No se ha aplicado al resto del CRM**, a propósito: cambiaría el ancho de
cincuenta pantallas de siete clientes en un commit que nadie podría revisar. Lo
que sí vale desde ya, y está escrito en el fichero: una pantalla nueva usa eso y
no escribe `max-w-` a mano.

*Cómo se comprobó*: 13/08/2026 contra producción, mirando el HTML servido de las
siete pantallas. `/formacion` sale con `max-w-4xl`; Alumnos, Matrículas, Cursos,
Empresas y **Cuestionarios** —que antes no tenía ninguno— salen con `max-w-7xl`.
Antes eran cuatro anchos distintos; ahora son los dos que decide el fichero.

### La foto dorada ya avisa cuando se queda atrás · `demo`

**Lo que pasaba.** Cada demo se restaura sola desde su foto `crm_{slug}_golden`,
y ese schema es una FOTO: se saca un día y ahí se queda. Las migraciones no la
tocan —y hacen bien: no es un tenant de `master`—, así que cada columna que se
añade desde entonces existe en el schema vivo y no en la foto. El restore solo
copia las columnas comunes, o sea que las nuevas salen con su valor por defecto:
la demo, que es el escaparate de ventas, arrancaba con esos campos vacíos.

**Y no rompía nada, que es justo lo que lo hacía durar.** No había error, no
había log, no había número. Para saber cuánto se había desviado había que ir
tabla por tabla a mano, así que no lo miraba nadie.

**Lo que faltaba por decidir no era cómo rehacerla, era QUÉ AVISA.** Rehacerla
siempre fue un comando. El dato que cerró la discusión: la diferencia era CERO el
27/07, cuando se sacó la foto anterior, y dos semanas y media después había
vuelto a ser 9 tablas y 27 columnas —más tres tipos enum desincronizados que
además abandonaban la restauración en silencio— sin que nadie se enterara.
Cualquier plan que dependa de que alguien se acuerde vuelve a ese mismo sitio.

**La decisión (Rodrigo, 13/08): el comprobador entra en `deploy.sh`.** Es el
único momento en que alguien está mirando esto Y acaba de meter las columnas
nuevas. Va al final, porque de un deploy se leen las tres últimas líneas.

Dos cosas que NO hace, las dos a propósito:

- **No rehace la foto solo.** Congelaría lo que haya en la demo en ese momento,
  incluido lo que un visitante dejara cinco minutos antes: el escaparate pasaría
  a ser la última cagada de alguien, y sin que nadie lo viera. Avisa, lo mira una
  persona y lanza el comando.
- **No hace fallar el deploy.** Una foto vieja no es motivo para dar por malo un
  despliegue que ha ido bien.

*Cómo se comprobó*: 13/08/2026, el bloque tal cual, corriendo en el VPS. Con las
fotos al día imprime las cuatro en verde y sale con 0. Forzando el fallo, saca el
aviso entero con el comando para rehacerlas… y el deploy **sigue saliendo con 0**,
que era el otro requisito. Antes de eso, ese mismo día, el comprobador midió en
producción las 9 tablas y 27 columnas de esta tarea y quedaron a cero al rehacer
las fotos.

### La nutrición ya no vive solo en casa de Laura, y Aumenta se ha mudado · `aumenta`, `nutri_laura`, producto

**Lo que pasaba.** «Que la nutrición de Aumenta sea igual que la de Laura» tenía
dos mitades rotas, y ninguna era encender un interruptor.

**Una: cinco de las nueve tablas no las creaba ninguna migración.** `foods`,
`plans`, `plan_meals`, `plan_meal_options` y `plan_meal_option_foods` salían de
dos scripts de un solo uso con `crm_nutri_laura` escrito a mano dentro, y
ninguno estaba en el mapa del módulo. Activar `nutricion` en un cliente antiguo
le dejaba el menú puesto y nada debajo: las seis migraciones declaradas se
saltan solas cualquier schema sin `foods` y lo dicen por pantalla. Es el fallo
que dejó a Abarcaia tres meses sin registrar leads, esperando a que nutrición se
vendiera dos veces. Ahora existe `migrate-nutricion-base`, declarada la primera
del módulo y con **arista explícita** hacia `migrate-nutricion-recipes`: el
orden salía bien por desempate alfabético, que es lo mismo que no salir.

**Y una que no estaba escrita en ningún sitio: `sequelize.sync()` da las
columnas y no las reglas.** Es lo que salvaba a los tenants NUEVOS —el alta crea
las nueve tablas tenga el cliente el módulo o no, y por eso `somos` las tenía— y
también lo que los dejaba a medias: `crm_somos` tenía `plans` **sin un solo
CHECK**, o sea aceptando una plantilla con paciente asignado, que es justo lo que
el CHECK existe para impedir. La migración repara además lo ya creado.

**Dos: la pestaña «Pautas» era de Laura por accidente.** `ClientPlansPanel` y los
otros diez ficheros del módulo vivían en `modules/overrides/nutri-laura/` aunque
las cuatro pantallas de `/nutricion` los usaran como valor por defecto para
todos —con un mapa `UI_OVERRIDES` cuyo override y cuyo default eran el MISMO
componente—. Estar en esa carpeta es lo que dejó la pestaña solo en su ficha: la
demo llevaba `nutricion` activo en producción y no podía asignar un menú a
nadie. Ahora están en `modules/nutricion/` y la pestaña la monta la ficha por
defecto. Quién la ve lo decide el SERVIDOR (`conNutricion`), no el panel: el
panel siempre pinta algo —cargando, vacío o el error del 403— así que nunca se
declararía vacío y no se escondería solo.

**Y el auto-marcado, que era una bomba de relojería.** `AUTO_ASSIGN_MODULE_KEYS`
colgaba solo de TENER el módulo. Se escribió para una consulta de una persona,
donde «todo cliente nuevo es paciente» es verdad; en Aumenta habría marcado como
paciente de dietas a toda ficha que entrara por la puerta, incluidas las que solo
van a terapia, y sin nada que lo dijera. Ahora es un flag por tenant
(`autoAsignarEnAlta`) **apagado por defecto**, encendido para Laura por
migración para que su comportamiento no cambiara. El backfill
(`backfill-nutricion-assignments.js`) exige el mismo flag: era la puerta de atrás
—se documenta como «repetible sin miedo» y habría marcado las 1.083 familias de
una sentada.

**Lo que no se copia: el recetario.** Activar el módulo siembra los 497
alimentos del catálogo base en ese cliente (un recetario sin alimentos no deja
escribir ni un menú, y Laura no lo sufrió porque el suyo se sembró a mano en
junio). Las 1.084 recetas de Laura NO se copian: son suyas.

**Un hallazgo que no es de esta tarea**: los alimentos NO son comunes entre
clientes. Los 497 de base sí —se siembran iguales— pero lo que añade una
nutricionista se queda en su schema: hay **465 que solo existen en el de Laura**.
Compartirlos de verdad es otra decisión, y hay que resolver antes si el trabajo
de un cliente debe aparecer en el CRM de otro.

*Cómo se comprobó*: en producción, 13/08/2026. `enable-module.js aumenta
nutricion` dejó `crm_aumenta` con **las 9 tablas, las 5 constraints CHECK y 497
alimentos**, y —lo importante— con las **1.083 fichas intactas y 0 marcadas**
como paciente de nutrición, que es el flag apagado haciendo su trabajo. La
pestaña «Pautas» sale en la ficha de un cliente de la demo y NO sale en
`demo_clinica`, que no tiene el módulo. `check-module-tables.js` da `somos` con
todas sus tablas y columnas y no se queja de nutrición en ningún cliente.

### Una receta corregida ya llega a quien tiene la pauta, si se quiere · `nutri_laura`

**Lo que pasaba.** Se congelaba MEDIA receta. Al meterla en un menú se copiaban
nombre e ingredientes, pero los pasos y la foto se leían en vivo de la receta
original. Lo peor de las dos opciones: corregir una cantidad mal puesta no le
llegaba a quien ya tenía la pauta —ni con «Re-aplicar menú origen», que recopia
las copias viejas de la plantilla— y reescribir unos pasos sí le cambiaba pautas
de hace meses, sin avisar a nadie.

**La decisión, de Rodrigo**: de las tres salidas posibles (congelar todo, leer
todo en vivo, o un botón que propague), la tercera. Lo que se le entrega a un
paciente es un documento cerrado y no se mueve solo; para que una corrección
llegue hay una acción explícita.

**Cómo quedó.** Al guardar una receta que ya está usada aparece un panel que
dice cuántas copias se han quedado con la versión anterior y deja marcar a
cuáles llevar el cambio. No interrumpe si no hay nada desincronizado. Tres reglas
del endpoint: **no toca pautas archivadas** —son el registro de lo que se
entregó aquel día—, **no toca `servings`** —la ración es del menú, no de la
receta— y **se audita**, porque reescribe de golpe lo que ya se dio a varias
personas. Los menús plantilla salen en su propia lista: es lo que arregla, de
paso, «Re-aplicar», porque un menú sin corregir vuelve a repartir el error la
próxima vez que se asigne.

**El backfill era la parte delicada.** `migrate-nutricion-congelar-receta` no
solo añade las dos columnas: rellena cada copia existente con lo que su receta
dice HOY. Sin eso, todas las pautas vivas se habrían quedado de golpe sin pasos
y sin foto. Con eso, el día del despliegue no se nota nada y lo que cambia es el
futuro.

*Cómo se comprobó*: de punta a punta en local contra el servidor de desarrollo
(13/08): se corrigió una receta de 200 g a 20 g y se reescribieron sus pasos; la
pauta ya asignada **no se movió**, el sistema detectó el desfase, y al propagar
llegaron tanto la cantidad como los pasos. En producción, 13/08: las dos columnas
existen en los 6 schemas con la tabla y el backfill cubrió el 100% —en el schema
de Laura hay exactamente **una** receta metida dentro de un menú, así que el
cambio cayó sobre casi nada de dato vivo—. El árbol de un menú carga (200) y el
PDF se genera (9.808 bytes) leyendo ya del snapshot.

### A Aumenta le faltaba Analíticas, no le sobraban módulos · `aumenta`

**Lo que pasaba.** La tarea estaba escrita al revés. Decía que `inventory`,
`orders` y `projects` se habían quedado encendidos de cuando se sembraron datos
de escaparate, con 0 filas cada uno, y proponía apagarlos. Rodrigo lo miró el
13/08 y la dio la vuelta: **«está fenomenal, no han empezado a usarlos. Lo
importante es que no tienen el módulo de Analíticas y deberían tenerlo».** Un
módulo vacío no molesta —los bloques sin datos ya no se pintan en la portada—;
lo que sí se pierde es lo que no está.

**Lo que se hizo.** `scripts/enable-module.js aumenta analytics`, que es la vía
correcta y hace las dos mitades del alta a la vez: la fila en
`master.tenant_modules` y el schema al día. De paso corrió las 86 migraciones
que le tocaban a `crm_aumenta` y creó `web_visits_daily`, que es la tabla donde
se guarda el histórico largo de visitas.

**Los tres módulos vacíos se quedan como estaban**, a propósito y no por
olvido.

**Lo que le falta para enseñar algo, y no es código.** Analíticas lee Cloudflare
Web Analytics con las credenciales DEL CLIENTE (BYOK, igual que la IA): sin
ellas la pantalla enseña el estado «sin configurar», que es lo correcto pero es
un vacío. Hoy solo `spain_enzymes` las tiene puestas de los siete clientes.
Aumenta tiene que dar su `accountId` y un token de solo lectura de «Account
Analytics: Read» desde Configuración → Integraciones, y su web tiene que llevar
el beacon de Cloudflare. Hasta entonces el menú está y la pantalla está vacía.

*Cómo se comprobó*: en producción, 13/08/2026, por SQL. `master.tenant_modules`
tiene la fila `analytics` de `aumenta` habilitada; `crm_aumenta.web_visits_daily`
existe; y `admin@aumenta.es` la ve porque su `module_access` es `["all"]`. Los 13
usuarios con rol `user` NO la ven —su `module_access` es una lista explícita de
`calendar/citas/clinica/pacientes`— y eso es lo que hace el script a propósito:
a los admin les da acceso solo, y para los demás hace falta `--grant-users`.
También se comprobó que la captura diaria está viva: el temporizador
`crm-capturar-visitas.timer` corre a las 03:40 UTC y `spain_enzymes` lleva 293
días guardados.

### Las claves de un cliente ya se las podemos poner nosotros · producto

**Lo que pasaba.** La portada del back-office decía, cliente por cliente, qué
credenciales le faltaban —hasta con la frase «Ya tiene todas las claves puestas.
No hay nada que pedirle»— y no podía ponerlas. La única forma era que entrara el
cliente, en su propia Configuración. Y no entran: 1 de 9 clientes tenía clave de
Anthropic (y éramos nosotros) y 0 de 9 la de OpenAI, con once disparadores de IA
desplegados y sin usar por nadie. Recado de Jorge del 12/08: que las pueda poner
el cliente **o** nosotros.

**La regla del endpoint sigue entera, y esa era la parte delicada.** «No descifra
nada» no se ha tocado: escribir una clave no obliga a leer la anterior. El campo
es de SOLO ESCRIBIR — se pega, se cifra con `secretBox` igual que lo hace la
Configuración del cliente, y no se devuelve nunca, ni enmascarado, ni a quien
acaba de escribirlo. De vuelta va qué le pasó a cada una: puesta, cambiada o
borrada. Una sesión robada del panel se sigue llevando una lista de qué está
puesto y ninguna credencial de nadie.

**Lo que se rechaza, y por qué.** A las demos NO se les pone ninguna: son
públicas y dan sesión de admin a cualquiera, así que una clave ahí es la de un
cliente real detrás de un enlace público. Sin `SETTINGS_ENCRYPTION_KEY` tampoco
se guarda nada, porque fuera de producción `encryptSecret` degrada a texto plano
y la clave habría quedado LEGIBLE en la base mientras la pantalla decía
«configurada». Y se rechaza en el acto lo que no puede ser una credencial de
ninguna manera —espacios, saltos de línea, menos de 16 caracteres—: un pegado a
medias tiene que cantar al pegarlo, no tres semanas después con un
«Authentication failed» del proveedor. Un prefijo raro no bloquea: avisa.

**Y el recibo al cliente, que no se podía saltar.** El aviso de cambios de
configuración existe porque «que alguien pueda tocarlas —nosotros incluidos— sin
que él se entere es lo que había que arreglar». Abrir esta puerta sin engancharlo
habría convertido esa frase en mentira el mismo día. Va firmado como Salamandra:
`avisarCambioDeConfiguracion` buscaba al autor entre los usuarios DEL CLIENTE, y
un cambio nuestro no casaba con nadie, así que el correo salía sin firmar.

**El otro medio recado: dónde apuntar a quién se le escribe.** No había sitio. Se
daba por hecho que el `adminEmail` del alta servía, y no sirve: es el nombre de
usuario con el que entra, puede no llevar arroba y si se deja vacío el alta se
inventa `admin_{slug}`. Ahora hay correo, persona y teléfono de contacto, en el
alta y en la ficha de Custodia, y el modal de «pedírselas» dice a qué dirección
iría o avisa de que no hay ninguna.

*Cómo se comprobó*: de punta a punta en local, 13/08/2026. Se pegó una clave de
Anthropic a un cliente desde `/admin`: quedó en la base con prefijo `enc:v1:`, el
CRM de ese cliente la resolvió entera con `getTenantAnthropicKey` —o sea que la
usa— y el GET de Custodia no la devuelve ni entera ni enmascarada (0 apariciones
del valor en la respuesta). Los cinco rechazos, uno a uno: clave a medias 422,
demo 409, credencial inventada 422, prefijo raro guardado con aviso, y la
auditoría guarda `{"anthropicApiKey":"puesta"}` sin el valor.
*Comprobado en producción*: 13/08/2026 — el código está desplegado (los ficheros
de `lib/provisioning/` están dentro del contenedor y el back-office responde en
su host). Lo que NO se ha hecho es pegar una credencial de un cliente real desde
producción, y no se va a hacer por probar: se comprobará la primera vez que haga
falta poner una de verdad. La prueba completa —pegar, que el CRM del cliente la
use y que ninguna pantalla la devuelva— está hecha en local, arriba.

### La demo ya no es una sola: hay una por oficio · `demo`

**Lo que pasaba.** El botón «Prueba una demo» entraba siempre al mismo sitio —el
slug estaba escrito en el código— y esa cuenta tenía 20 módulos encendidos a la
vez: clínica, nutrición, inventario, pedidos, facturación, formación, captación,
proyectos y soporte. Una nutricionista que entraba a verla se encontraba un
centro de psicología con almacén; un centro clínico, un recetario. Recado de
Jorge del 12/08; el reparto lo decidió Rodrigo el 13/08.

**Cómo elige el visitante.** Entra por la general, que es la que abre el botón de
la web, y salta desde unas pestañas arriba del todo del CRM. Se pintan como
pestañas y no como un desplegable a propósito: la gracia es que se VEA que hay
más de una. Cada una tiene su color, que es lo que hace que se note el salto.

**El slug es una lista blanca, nunca el parámetro.** Ese endpoint firma un token
de ADMIN a un visitante anónimo, y lo que lo hacía seguro era justamente no
admitir parámetros. Ahora admite uno, y solo se acepta si está en
`lib/demo/demos.js`. Un slug desconocido responde 404 y NO cae a la demo general:
caer de vuelta escondería un intento de entrar en el CRM de un cliente detrás de
una pantalla normal.

**Y el guard de demo pasó a ser uno para las cuatro.** Había un `DEMO_SLUG =
"demo"` escrito en `lib/demo/isDemo.js` y noventa y cuatro llamadas a sus tres
guards repartidas por el CRM. Cambiando solo ese fichero, las cuatro quedan
protegidas a la vez; si la comparación se hubiera quedado como estaba, las tres
nuevas habrían nacido siendo un CRM de administrador público capaz de gastar IA
real y de escribir en master.

**Una demo no es un cliente.** Sin esto, las pantallas que cuentan habrían dicho
«11 clientes» donde hay siete, y Custodia habría pintado las cuatro en rojo
reclamándoles credenciales que NO PUEDEN tener. Se excluyen de Custodia, Módulos
e Integraciones, y se mantienen en `/admin/clientes`, que es quien las
administra: mismo reparto que con los suspendidos y por el mismo motivo.

*Cómo se comprobó*: en local, 13/08/2026. Desde el botón público se entra en la
general y desde sus pestañas se salta a la de nutrición: cambia el color, el menú
pasa a ser el de una consulta (Pacientes, Recetario, Alimentos, Pautas, sin
inventario ni proyectos) y la de clínica sale con Pacientes separado de Clientes.
Pedir el slug de un cliente real a `/api/auth/demo` devuelve 404; sin cuerpo,
abre la general. Y cada una se limpia sola: se ensució `crm_demo_nutricion` con
una ficha de más y la restauración la dejó otra vez en 14, sin error.
*Comprobado en producción*: 13/08/2026 — las tres cuentas creadas y sembradas
(`demo_clinica` 12 módulos, `demo_nutricion` 9, `demo_agencia` 11). Las cuatro
abren desde el botón público; `aumenta` y `nutri_laura` responden 404, que es la
lista blanca. Cada una sale con su menú y su color: clínica con Pacientes aparte
de Clientes, nutrición con Recetario y Pautas, agencia con Captación, Analíticas,
Proyectos y Pedidos.

**El montaje se cortó a la mitad y de ahí salió un fallo que arreglar.** El
proceso murió (señal 9) sembrando `demo_agencia`: quedó con schema, módulos y
datos pero SIN administrador —`altaTenant` lo crea al final—, y al relanzar el
script entraba por la rama de «ya existe», que daba por hecho que estaba. El
botón devolvía 404 y cada reintento repetía la misma rama. Arreglado en
`crear-demos-por-oficio.js`: ahora esa rama comprueba que haya administrador y lo
crea si falta.

### La demo pública vuelve a limpiarse sola · `demo`

**Lo que pasaba.** La demo se rehace desde una copia «dorada» para que cada
visitante la encuentre impecable, y esa restauración llevaba desde el 10/08
abandonándose a medias. El motivo era de TIPOS, no de datos:
`enum_bookings_payment_status` tenía nueve valores en `crm_demo` y cinco en la
foto, porque la foto tenía un tipo PROPIO en vez de compartir el del schema vivo.
PostgreSQL no convierte solo entre dos enums distintos, así que el INSERT
reventaba, la transacción se deshacía entera y el `catch` —que existe para que un
fallo ahí no tumbe el dashboard— se lo tragaba. La demo seguía en pie, sucia, sin
un solo error visible.

**Por qué no vuelve a pasar solo.** La foto que saca el script hoy copia los
datos con `CREATE TABLE AS TABLE`, que REUTILIZA los tipos del schema vivo
(comprobado el 13/08), así que ampliar un enum con `ALTER TYPE ... ADD VALUE`
—que es como lo hacen las migraciones— llega a la foto sola. El tipo propio era
un resto de otra época.

**Y ahora se puede preguntar.** `npm run db:demo:snapshot:check` compara cada
foto con su schema vivo y canta tres cosas: tipos propios (tienen que ser cero),
tablas que faltan y columnas que faltan. Eso último es la otra tarea del backlog
—la foto iba por detrás del schema— y ahora sale con nombres: al mirarlo el 13/08
faltaban 9 tablas y 38 columnas. Además la restauración deja el último fallo en
memoria en vez de perderlo.

*Cómo se comprobó*: en local, 13/08/2026. Antes del arreglo, el comprobador sacó
los tres tipos propios de la foto de la demo general con sus valores. Después de
rehacerla, las cuatro fotos «casan» y una restauración de `crm_demo` termina sin
error: se cambió el nombre de una ficha y la recarga lo devolvió.
*Comprobado en producción*: 13/08/2026. El comprobador cantó allí exactamente lo
que decía esta tarea —**3 tipos enum propios** (5 valores contra 9), 9 tablas y
27 columnas de menos— y tras rehacer las cuatro fotos no queda ni uno: los tipos
son ya los del schema vivo. Y lo que importa, comprobado sin fiarse del script:
se ensució `crm_demo` con un nombre falso y la recarga lo dejó limpio, **sin una
sola línea de fallo en los logs**; lo mismo con `demo_clinica`. El último fallo
registrado es de siete segundos ANTES de la foto nueva.

### El back-office ya sabe dar de baja a un cliente, y sigue sin poder borrarlo · producto

**Lo que pasaba.** `/admin/clientes` dejaba crear, editar, cambiar marca, activar
módulos y suspender, y ahí se acababa. Quien se iba se quedaba suspendido y ya,
con su usuario y su schema enteros, escondido tras el interruptor «ver los N
suspendidos», y nada decía qué pasaba con él. Las tres bajas del 12/08 se hicieron
por SSH, a mano.

**Lo que NO ha cambiado, a propósito.** No hay DELETE ni lo va a haber. Lo que
hace el botón es APARTAR: el schema se renombra a `zzz_baja_<slug>_<fecha>` y sus
ficheros se mueven a `uploads/_bajas/<slug>_<fecha>/`, todo entero y reversible.
Destruir de verdad sigue siendo SSH, y ahora el script lo dice en voz alta cuando
se lo pides: se lleva por delante sus facturas.

**La pregunta de la retención, respondida.** Las facturas tienen obligación de
conservarse años y los registros de auditoría no se borran nunca. Apartar convive
con las dos cosas —el schema sigue entero con sus facturas dentro, y de la
auditoría no se toca ni una fila: lo que los DELETE le vacían es la ATRIBUCIÓN,
que el `.rollback.sql` guarda para poder devolverla—. Purgar no convive con
ninguna, y por eso es lo único que se queda en una terminal.

**Los cuatro arreglos que hacían falta para poder poner un botón.** Uno, es
atómico: el renombrado y los tres DELETE iban sueltos, así que un proceso muerto
a mitad dejaba una fila de tenant sin schema, que es lo que `altaTenant.js`
describe como veneno para TODAS las altas siguientes. Dos, avisa a la app:
corriendo en otro proceso no se podía invalidar la caché, y el CRM seguía hasta 60
segundos resolviendo a un cliente cuyo schema ya no se llamaba así. Tres, se lleva
los ficheros: el script no tocaba `uploads/` en ninguna línea y los seis almacenes
no comparten forma, así que apartar el schema dejaba en disco los papeles del
cliente, documentos de salud incluidos. Y cuatro, la red de rescate caduca:
`scripts/podar-bajas.js` borra los `.rollback.sql` de más de 90 días, y la purga
se lleva ahora el del cliente que purga — los tres del 12/08 se quedaron con sus
`password_hash` sobre disco cuando sus schemas ya no existían.

**Las trampas del botón son las de suspender más una.** Hay que teclear el
identificador, se enseña cuántas filas y cuántos ficheros hay dentro antes de
nada, y nunca a nosotros mismos ni a una demo. La que se añade es la de los
ficheros: un cliente puede tener cero filas y doscientos documentos subidos, y
hasta hoy eso no lo veía nadie.

*Cómo se comprobó*: de punta a punta en local, 13/08/2026, con un cliente de
prueba con 10 filas y 6 ficheros repartidos por las cuatro rutas de `uploads/`.
Cerrado desde `/admin/clientes`: salió del listado, su schema quedó como
`zzz_baja_zzz_prueba_baja_<fecha>` sin tocar a los demás, sus 6 ficheros
desaparecieron de las seis rutas y aparecieron en `uploads/_bajas/`, el
`.rollback.sql` quedó escrito y `master.audit_logs` guarda su fila
`provisioning.cliente_baja`. Y la vuelta atrás también: `psql < el .rollback.sql`
devolvió el tenant, su usuario, sus 4 módulos, su contacto y sus 7 fichas dentro
del schema. Los cinco frenos, uno a uno: sin teclear el slug 428, con datos sin
aceptarlo 428 (con la lista de tablas), a una demo 409, a nosotros mismos 409, y
la purga sin `--confirmo` se planta.
*Comprobado en producción*: 13/08/2026 — el código está desplegado y el listado
de cuentas cerradas responde en su host (vacío: hoy no hay ninguna). **No se ha
dado de baja a nadie en producción para probarlo**, y no se va a hacer: el único
ensayo posible sería con un cliente de verdad. La prueba entera —incluida la
vuelta atrás con `psql < el .rollback.sql`— está hecha en local, arriba.
*Lo que sigue sin probarse*: el agujero de los ficheros con un cliente REAL que
los tenga. Los tres del 12/08 no tenían ninguno, y en local se probó con seis
puestos a mano. La próxima baja de verdad es la que lo dirá.

### Los dos formularios de Aumenta, y cada uno cae por su puerta · `aumenta`

**Lo que pedía la tarea, y lo que no cuadraba.** El recado de Jorge del 12/08 daba
por hecho que el de profesionales sería otra fila de `forms` y que sus solicitudes
caerían en **Interesados → Comerciales**. Al ir a comprobarlo, el formulario ya
estaba publicado —viene con el tema nuevo— pero enviando a `/api/public/leads`, o
sea a **Interesados → Profesionales**, el embudo por etapas.

**Lo que se decidió.** Rodrigo, 13/08: está bien así y se queda. Son dos puertas
distintas a propósito. «Soy una familia» va a la bandeja de Comerciales, donde
alguien acepta o descarta y de ahí sale la ficha; «Soy profesional» va al embudo y
además **marca el perfil como profesional de la salud** (`tipo_usuario` =
`profesional`), que es lo que permite trabajarlo por etapas y lo que no daría la
bandeja. Es el mismo reparto que tunutrilaura. Se corrige la tarea, no el código.

**Lo que sí cambió.** En el de familias, la pregunta 3 decía «¿Cómo se llama el
peque?» y ahora dice **«¿Cómo se llama el paciente?»** (Rodrigo). El centro no es
solo infantil —estimulación cognitiva y neuropsicología son de adultos, y la
pregunta 2 ya ofrece «Soy yo quien necesita ayuda»—, así que «el peque» dejaba
fuera a media consulta. Cambia el ENUNCIADO; las `key` siguen siendo `nombrePeque`
y `edadPeque` **a propósito**: el `name` de cada campo de la web tiene que
coincidir con la `key` o el CRM lo descarta en silencio, y el CRM se siembra en el
acto mientras que el tema lo sube Rodrigo cuando puede — con las claves cambiadas,
todo lo que entrara entre un momento y el otro perdería el nombre y la edad sin
que saltara ningún error.

*Cómo se comprobó*: 13/08/2026 contra producción. Un envío real a
`POST /api/public/leads` con `x-tenant: aumenta` y el mismo cuerpo que manda la
web: entró con `tipo_usuario = profesional`, `stage = new` y los nueve
`customFields` intactos —incluida la prueba del consentimiento con su fecha y su
URL—; la fila de prueba se borró después, con su notificación, y
`crm_aumenta.leads` volvió a sus 2 reales. Del lado de familias,
`GET /api/public/c/aumenta/formularios/familias` ya devuelve el enunciado nuevo, y
la fila conserva sus 8 preguntas, el aviso a `info@aumentafuenlabrada.com` y su
`wordpressUrl`. En la web, la portada trae los dos formularios (`auf` y `aup`, en
pestañas) y `/formularios/` el de familias (`auf2`).
*Dónde*: `scripts/seed-formulario-aumenta.js`; el tema, en `aumenta-work/aumenta/`
(`aumenta-formularios.php` y `aumenta-leads.php`).

### Dar un bono era cosa solo de la ficha de Laura · `aumenta`, `somos`, `demo`, todos

**Lo que se vio al terminar lo de arriba.** Rodrigo: «todo el mundo tiene bonos,
solo tienen que ponerlos». Y era verdad a medias: la tabla, el endpoint, el
descuento de sesiones y el tipo de cita que ahora se pone solo en el alta manual
son de todos, pero **la sección «Bonos de sesiones» vivía dentro del override de
nutri_laura**. Los otros tres centros con Citas tenían el motor entero y ni un
botón con el que estrenarlo: dar un bono solo era posible llamando a la API.

**Lo que hay.** `components/clients/ClientBonosSection.jsx`, compartido por las
dos fichas. En la ficha por defecto sale en la pestaña **Citas**; en la de Laura,
donde estaba. Una sola implementación: su override pasa a importarla y se queda
con 274 líneas menos.

**Lo que decide la sección, y antes no hacía falta** con un tenant de una
persona: no se pinta si el centro no tiene Citas (403 en `event-types`, mismo
criterio que `ClientCitasSection`); dar y quitar son de admin, como el endpoint,
y quien no lo sea ve los bonos y su cuenta pero no los botones; y **la tarjeta se
pinta aunque no haya ningún bono**, que es donde está el botón de darlo — antes,
sin bonos, no salía nada, que es justo el estado de todos los que aún no ha dado
ninguno. De propina: sin correo en la ficha no deja enviar y explica por qué (el
bono va atado al correo, y el servidor contestaba un 422 seco), y «Quitar bono»
pregunta con el diálogo del CRM y no con el del navegador.

*Cómo se comprobó*: 13/08/2026 en producción con la sesión de la demo —datos
falsos, y solo lecturas—: `/api/auth/me` devuelve `admin` (los botones salen),
`GET /api/citas/event-types` **200** (la puerta de la sección se abre) y la ficha
de un cliente trae `"bonos":[]`, o sea la tarjeta vacía con su botón. Que es
exactamente lo que la sección necesita para pintarse en Aumenta, Somos y la demo.
*Antes de eso, en local*: el ciclo entero desde una ficha del módulo POR DEFECTO
—dar un bono de 6 sesiones, ver «Le quedan 6 · 0 de 6 usadas», los dos avisos del
endpoint, y quitarlo con el diálogo del CRM hasta volver a la tarjeta vacía—.
*Dónde*: `components/clients/ClientBonosSection.jsx`,
`modules/default/ClientDetailModule.jsx` (pestaña Citas),
`docs/modules/citas.md` («Dar un bono a mano»).

### El bono pone el tipo de cita, y «Eliminar» borra de verdad · `nutri_laura`, `aumenta`, todos

**Lo que pidió Rodrigo.** Tres cosas del alta manual y del calendario: que el
bono ponga solo el tipo de cita «así no hay que ir a buscarlo a la ficha de
paciente», que las citas se puedan «eliminar del todo, se quedan canceladas pero
no desaparecen», y que en el formulario vaya «primero el paciente y segundo el
tipo de cita».

**El bono pone el tipo.** Al elegir la ficha se piden sus bonos vivos
(`GET /api/citas/packs`, nuevo: solo activos y con sesiones libres) y el tipo se
rellena con el contador delante — «le quedan 4 de 6». Con varios bonos no
adivina: los lista. Si ya habías elegido otro tipo no lo pisa, lo ofrece. Y hay
un aviso que es el que de verdad importa: **si el bono está a otro correo, la
cita saldría con el tipo correcto y NO descontaría**, porque `asignarSesion` los
busca por correo. Era el fallo mudo de los bonos y ahora se ve antes de guardar.

**«Eliminar» borra de verdad** (`?hard=true`). Hacía exactamente lo mismo que
«Cancelar cita» —dejarla en gris—, así que una cita del día equivocado,
duplicada o de una prueba se quedaba en el calendario para siempre. Se lleva lo
que colgaba de ella (cobro sin dinero, peticiones de cambio, avisos), no manda
ningún correo —el diálogo lo advierte si la cita aún no ha pasado— y queda
auditado (`citas.booking_deleted`) quién lo hizo y qué se llevó: es el único
rastro que queda. **Una cita con dinero no se borra**: cobrada, con retención
viva o devuelta responde 409 y ofrece cancelarla, porque el registro del dinero
tiene que quedar. Puede borrar quien puede cancelar, no solo dirección: quien
apunta las citas del día es quien se equivoca al apuntarlas.

**Primero quién, después qué.** El formulario empezaba por el tipo de cita, que
es el campo que más se falla —Aumenta tiene 57— y el único que la propia ficha
puede rellenar sola. Ahora: cliente, paciente, tipo, fecha y hora, contacto. El
email y el teléfono bajan porque se rellenan solos desde la ficha.

*Cómo se comprobó*: 13/08/2026 en producción, después de desplegar `e110bb3`.
Las dos rutas nuevas responden **401** y no 404 (existen y están cerradas), y los
textos nuevos están dentro de la imagen. La prueba de verdad se hizo corriendo
la MISMA función que usa el endpoint contra los datos reales:
`docker exec crm-salamandra-app-1 node -e "…bonosDeCliente…"` sobre
`nutri_laura` devolvió **sus 6 bonos activos con sesiones libres**, cada uno con
su tipo y su cuenta («1 de 6 usadas, 1 reservada · quedan 4»), o sea que a las
seis se les pondrá el tipo solo; y por SQL, **cero** de esos seis tiene el bono a
un correo distinto del de su ficha, así que hoy el aviso ámbar no le sale a
nadie. El borrado NO se ha ejecutado contra una cita real a propósito.

*Antes de eso, en local* (demo, con un bono de prueba ya limpiado): elegir a la
persona puso el tipo y el aviso; la cita creada quedó enganchada al bono como
sesión 1 (`pack_id` + `session_number`); borrarla la quitó del calendario y de
la base de datos dejando su línea de auditoría con la cita, el estado y lo que
se llevó; una cita con un cobro `paid` devolvió el 409 con el motivo en
pantalla; y una cancelada se pudo borrar, que es el caso que lo motivó.

*Dónde*: `modules/default/CitasModule.jsx` (`buscarBono`, `deleteBooking`),
`app/api/citas/bookings/[id]/route.js` (`borrarDeVerdad`),
`app/api/citas/packs/route.js` (el GET), `lib/citas/packs.js`,
`docs/modules/citas.md` («Repaso del 13/08/2026» y «Borrar una cita del todo»).

### Ya se nos puede abrir una incidencia desde cualquier cliente · producto

**Lo que no había.** Ningún camino por el que un cliente nos contara que algo
va mal. Lo único era un `mailto:` en la pantalla de Soporte, y encima solo lo
veían los clientes SIN el módulo `support`: Aumenta y la demo, que sí lo tienen,
veían su propia bandeja y no tenían ni el correo. Lo pidió Jorge el 10/08.

**Lo que hay.** El cliente escribe en `/ayuda` —icono nuevo en el pie del
sidebar, SIN `moduleKey`, lo ve todo el mundo tenga lo que tenga contratado— y
nos llega a `/admin/buzon`. Con hilo, estados, capturas y correo en las dos
direcciones. No se llama «incidencias» ni «avisos» porque las dos palabras ya
estaban cogidas por otras cosas (`Incidencia` de Clínica y `ClientNotice`).

**La decisión que el backlog dejaba abierta era dónde vive el texto, y vive
entero en `master`.** Tres motivos: sobrevive a la baja del cliente —el 12/08 se
purgaron tres schemas, y lo que escriben antes de irse suele ser el motivo—,
funciona aunque su base esté rota (que es cuando escriben), y la bandeja es una
consulta y no N conexiones. Es una excepción consciente a la regla de no
duplicar datos personales en master, así que va con TRES frenos: el formulario
pide que no se escriban nombres de pacientes, la auditoría guarda la referencia
y el cliente pero NUNCA el cuerpo, y `podar-buzon.js` caduca lo resuelto a los
dos años.

**Un fallo que solo se vio en producción.** La primera respuesta salió con el
asunto «Te hemos contestado · undefined»: a la plantilla le llega la fila de
Sequelize, que tiene `numero` pero no `ref` —eso solo existe en el objeto
serializado—. No dio ningún error, se envió tal cual. Arreglado calculando la
referencia del número, y fijado en el smoke con la fila cruda.

*Cómo se comprobó*: 13/08/2026 en producción, con sesión real en los dos lados.
Se mandó un aviso desde `crm.salamandrasolutions.com/ayuda` → salió **AV-0001**
(el correlativo arranca en 1, no en 2); `docker logs` enseñó
`[email:send] sent to="info@salamandrasolutions.com" subject="AV-0001 · …"` con
id de Resend, o sea envío real y no simulacro; la fila guardó `pantalla=/ayuda`
y el navegador, y **no** la query de la URL. Se contestó desde `/admin/buzon`:
el estado saltó solo a «Esperando al cliente» y salió el segundo correo. Desde
el CRM se vio la respuesta en el hilo, el punto verde encendido en el icono de
Ayuda y apagado después de abrirlo. La fila de prueba se borró y la secuencia
quedó a cero.

*Antes de eso, en local*: `_smoke-buzon.mjs` 42/42 —incluido que la nota interna
no sale en el lado del cliente ni su adjunto—, el reparto por host comprobado en
los dos sentidos (404 y 404) y el envío desde la demo cortado con un 403 legible
y cero filas escritas.

*Dónde*: `docs/modules/buzon.md`, `lib/buzon/`, `app/api/{ayuda,admin/buzon}/`,
`models/master/Buzon*.model.js`, `scripts/migrate-buzon.js`.

## 12/08/2026

### Abarca, Quality y Healim se han dado de baja, y con ellos Referidos · `abarcaia`, `quality_energy`, `healim`, producto

**Lo que pidió Rodrigo.** «Abarca IA, Quality y Healim hay que eliminarlos
totalmente. Y el módulo de referidos también. Era una cosa que pidió Abarca y
que nadie ha querido.»

**Lo que se hizo con los datos.** Los tres se apartaron con `borrar-tenant.js`
(el schema se renombra, no se destruye) y después se purgaron. Entre medias se
sacó un volcado de los tres a
`/root/backups/bajas-abarcaia-quality-healim-20260812.sql.gz` en el VPS, y se
comprobó DENTRO del fichero que llevaba los datos: 213 leads (84 de Abarca, 129
de Quality), 5 citas pasadas de Healim y sus 10 disponibilidades. Destruir 213
leads con una orden de una línea y sin red no es una operación, es un accidente.
Ese fichero es ahora el único sitio donde existen esos datos.

**Por qué Referidos no se echará de menos.** Nunca fue un módulo de verdad: no
tenía tabla propia —su pantalla leía y escribía `leads` filtrando por
`customFields.source = 'referido_abarcaia'`, con el nombre de un cliente escrito
dentro del código— y sus endpoints exigían `leads` y NUNCA `referidos`. O sea
que cualquiera con Leads podía abrir `/referidos` sin haberlo comprado, y quien
comprara solo Referidos se habría llevado un 403 en su propia pantalla. Por la
mañana ya se había caído del catálogo de venta; esto se llevó el resto.

**Qué se ha ido con ellos.** La pantalla, sus tres endpoints, el formulario
público, la entrada del menú y de la portada, su etiqueta en los accesos del
equipo, sus fichas de dependencias e integraciones, los overrides de leads de
Abarca y Quality, sus seeds y los scripts de un solo uso. 5.843 líneas menos.

**Dos cosas se quedaron a propósito.** Sus nombres siguen en la lista de slugs
del Registro: este tablero lee tareas históricas donde están escritos, y
quitarlos de ahí no borra esas tareas, las deja sin cliente y con la cola metida
dentro del título. Y las etapas extendidas de leads, que también usa el import
histórico de otros clientes.

*Se comprueba*: en el contenedor, `docker exec crm-salamandra-app-1 find
.next/server/app -iname "*referid*"` no devuelve nada y `ls modules/overrides`
no tiene `abarcaia` ni `quality-energy`; en la base de datos,
`SELECT slug FROM master.tenants` devuelve siete y no hay ningún schema
`crm_abarcaia`, `crm_quality_energy` ni `crm_healim`.
*Dónde*: `scripts/borrar-tenant.js`, `lib/provisioning/catalogo.js` (el porqué),
`app/api/admin/tablero/route.js` (los slugs que se quedan).
*Comprobado en producción*: 12/08/2026 — quedan 7 tenants (5 clientes), los tres
schemas purgados, las tres rutas de referidos fuera del build desplegado, y
`uploads/` sin un solo fichero de los tres.

### Un cliente apagado se quedaba sin migraciones, y se notaba al encenderlo · `quality_energy`, `abarcaia`, producto

**Lo que se veía.** Nada, y ese era el problema. Comprobando otra cosa apareció
que los siete clientes activos tenían el schema al día y los suspendidos no:
`quality_energy` llevaba 22 columnas de retraso en 7 tablas y `abarcaia` 20 en 6.

**Lo que había detrás.** Las migraciones eligen sus schemas preguntando a
`master.tenants`, y lo hacían con `WHERE status = 'active'`. Suspender apaga al
cliente de verdad —sus usuarios no pueden entrar y sus widgets públicos no
responden—, así que mientras está apagado nadie choca con nada y el retraso se
acumula callado. El daño no lo hace la suspensión: lo hace la REACTIVACIÓN, que
lo devuelve a la vida con el schema de hace meses y le revienta la primera
pantalla que lea una columna que no existe, con un 500 genérico. Es el incidente
del 21/07 con otro disfraz: elegir schemas por una condición de NEGOCIO en vez
de por lo que hay en la base de datos.

**Lo que se hizo.** El estado ya no se mira en ninguna parte: ni en
`_schema-targets.js` (que usan 43 de las 103 migraciones) ni en las 30 que
llevaban su propia consulta copiada a mano. Y reactivar a un cliente pone su
schema al día solo, con la pieza que ya existía y que hasta ahora solo se
disparaba al activar un módulo.

**Lo que NO se tocó.** Los seeds y los backfills siguen mirando el estado, y
está bien así: escriben datos, no estructura, y sembrar datos en un cliente
apagado no arregla nada.

*Se comprueba*: `grep "status = 'active'" scripts/migrate-*.js` no devuelve
ninguna consulta; y suspendiendo y reactivando un cliente de prueba desde
`/admin/clientes`, el aviso dice que su schema se ha puesto al día.
*Dónde*: `scripts/_schema-targets.js`, `lib/provisioning/cicloVida.js` y las 30
migraciones del commit.
*Comprobado en producción*: 12/08/2026 — antes del arreglo, 22 y 20 columnas de
retraso medidas contra `crm_demo`; los tres clientes en cuestión se dieron de
baja el mismo día, así que la red queda para el siguiente.

### La ficha de cliente ya no es una columna de catorce tarjetas · todos

**Lo que se veía.** Rodrigo: «ficha de cliente reorganizada, que es demasiado
larga; universal, para que el que tenga todos los módulos no se líe». En Aumenta
la ficha medía varias pantallas, y para llegar a la facturación había que pasar
por delante del contrato, los tutores, los consentimientos y las citas.

**Lo que se hizo.** Seis pestañas, agrupadas por PREGUNTA y no por módulo:
Datos, Interacciones, Servicio, Contrato y avisos, Citas y Facturación. El
patrón ya lo usaba la ficha de nutri_laura; aquí se generaliza.

**Lo que costaba dinero pensar.** Casi todas esas secciones se esconden solas
cuando el tenant no tiene su módulo, así que un cliente de solo Citas tendría
cuatro pestañas vacías, que confunde más que una ficha larga. Como el padre no
puede saberlo sin volver a preguntar a los mismos endpoints, cada panel se mide
en el DOM y su pestaña desaparece si dentro no queda nada. Todos se montan
aunque solo se vea uno, que es exactamente lo que hacía la ficha antes de tener
pestañas: ni hay peticiones de más ni se pierde lo que estés escribiendo al
cambiar de pestaña.

**De paso, dos cosas de la misma pantalla.** El botón de crear la cuenta de la
web existía desde el 05/08 pero vivía dentro del override de nutri_laura, así
que Aumenta no lo tenía; el backend siempre fue común y solo faltaba el botón.
Y «Consulta externa» era la única tarjeta sin margen ni ancho máximo: se pegaba
a la de arriba y salía más ancha que sus vecinas.

*Se comprueba*: abrir cualquier ficha de `/clientes/:id` y contar las pestañas;
en la demo salen las seis. Vaciando por consola el panel de una, su pestaña
desaparece del menú.
*Dónde*: `modules/default/ClientDetailModule.jsx` (`PanelPestana`),
`components/clients/ClientCuentaWebSection.jsx`.
*Comprobado en producción*: 12/08/2026 — desplegado a las 20:20; las seis
pestañas pintan y los doce endpoints de la ficha responden 200.

### Los festivos se ponen en el CRM, y no en cuatro ventanas del navegador · todos

**Lo que se veía.** Rodrigo: «modal para festivos, que ahora es una notificación
de navegador extraña». Marcar el 24 de diciembre eran hasta cuatro ventanas del
navegador seguidas —la fecha a mano en DD-MM-AAAA, el motivo, un aviso de
confirmación y otro de resultado— y para saber qué días estaban cerrados había
que ir mes a mes mirando el calendario.

**Lo que se hizo.** Un modal del CRM con la lista de todo lo cerrado por
delante, donde se marca y se quita sin salir. Su lista NO es la del calendario a
propósito: el calendario solo carga el mes visible, y con esa lista marcar el
24-dic desde agosto lo haría desaparecer al instante, que se lee como que no ha
funcionado.

**Y lo mismo con los otros ocho.** Rodrigo pidió «revisar si hay algo más que
use lo mismo», y lo había: cancelar una cita, marcar una falta, borrar, mover la
hora, el aviso de hueco bloqueado. Todos pasan ahora por un diálogo propio y
reutilizable. Dos cambios de comportamiento van con ello, los dos a mejor:
«Cancelar» ahora cancela —con el diálogo del navegador, cancelar el motivo de
cancelación cancelaba la cita igual—, y la falta ya no se pregunta con un sí/no
que llevaba dentro «Aceptar = justificada, Cancelar = sin justificar».

*Se comprueba*: en `/citas`, el botón «Festivos y cierres» abre una ventana del
CRM, no del navegador; marcar un día lo añade a la lista y el calendario lo
pinta atenuado.
*Dónde*: `components/citas/ModalFestivos.jsx`, `components/ui/Dialogo.jsx`.
*Comprobado en producción*: 12/08/2026 — probado antes en local marcando y
quitando el 24-12-2026, con la lista y el calendario refrescándose.

### La agenda ya no se mueve, y el mes no se rompe · todos

**Lo que se veía.** Un scroll de unos pocos píxeles en toda la pantalla del
calendario, y en la vista de mes un día con doce citas estiraba su fila y
encogía las demás hasta que el mes dejaba de leerse como una rejilla.

**Lo que había detrás.** El alto del calendario era una resta a ojo sobre el
alto de la ventana, y esa cuenta no incluía la fila de ayuda de arriba. Ahora el
calendario rellena lo que quede, que es una medida real y no una estimación:
cambie lo que cambie encima, no puede desbordar. Y la vista de mes enseña como
mucho cuatro citas por día, con un «+N más» que abre el resto.

Se fue con ello la frase «Doble clic en un hueco para crear una cita…», que era
justo lo que sobraba.

*Se comprueba*: en `/citas`, `document.scrollingElement.scrollHeight -
clientHeight` da 0 en las vistas de mes y de semana.
*Dónde*: `modules/default/CitasModule.jsx`, el bloque del calendario.
*Comprobado en producción*: 12/08/2026 — medido en local a 1280x720: el
calendario acaba en 704 px con ventana de 720, y un día de 5 citas pinta 4 más
el «+1 más».

### La cita manual ya no se apunta sin profesional ni busca entre nadie · todos

**Tres cosas que pidió Rodrigo, y una cuarta que salió al mirarlas.**

**El profesional era opcional.** Se podían apuntar citas sin nadie que las
atendiera, y esas citas acaban en la cola de `/citas/sin-profesional`: 1.827 de
las 12.030 que importó Aumenta vinieron así. Ahora es obligatorio, pero solo si
hay equipo del que elegir, para que un cliente sin módulo Equipo no se quede
bloqueado por un campo que no ve.

**El tipo de cita no tenía buscador.** Aumenta tiene 57. Se probó con umbral —a
partir de ocho tipos— y Rodrigo lo descartó el mismo día: quien apunta citas
todo el día escribe siempre las primeras letras, y que la caja aparezca o no
según el cliente convierte un gesto automático en algo que hay que mirar antes.

**El buscador de pacientes salía vacío**, con un cartel que sonaba a que faltaba
configurar algo. El servidor filtraba por una marca de módulo asistencial que
vive en la ficha del CLIENTE, y en un centro clínico el cliente es la familia:
Aumenta tiene 1.083 fichas y CERO con esa marca. Ahora, si no la tiene nadie, la
marca no está en uso en ese centro y se ofrecen todos los clientes. Donde sí se
usa, no cambia nada.

**Y los rótulos se contradecían.** Arriba pedía «Cliente / paciente» con
asterisco y abajo ofrecía «Paciente (opcional)», que leídos seguidos parecían el
mismo campo. Ahora dicen de quién hablan: «Cliente (la familia)» y «Paciente»,
con su frase debajo.

*Se comprueba*: en «Nueva cita manual», guardar sin profesional da «Elige el
profesional que la atiende»; el desplegable de tipo de cita trae caja de
búsqueda aunque solo haya dos tipos; y `/api/citas/clientes?q=` devuelve fichas
en un centro donde nadie tiene la marca asistencial.
*Dónde*: `modules/default/CitasModule.jsx`, `app/api/citas/clientes/route.js`,
`components/citas/BuscadorPaciente.jsx`.
*Comprobado en producción*: 12/08/2026 — en local, el buscador pasó de 0 a 15
fichas y la validación del profesional salta.

### Los bloqueos tienen pantalla propia · todos

**Lo que se veía.** «Vacaciones y ausencias» vivía debajo del catálogo de tipos
de cita desde el 06/08, porque se pidió como «un tipo de cita especial». No lo
es —ni por dentro ni por fuera—, y tener las dos cosas apiladas obligaba a bajar
por el catálogo entero para apuntar unas vacaciones.

**Lo que se hizo.** Pantalla propia en `/citas/bloqueos`, con su botón al lado
de «Tipos de cita» y «Disponibilidad» en las tres cabeceras del módulo. Como sus
vecinas, no está en el menú lateral: se llega por esos botones, y la puerta de
verdad la siguen poniendo los endpoints.

Conviene no confundirlo con un festivo: el festivo cierra el centro entero un
día y se pone desde el calendario; el bloqueo es de una persona, con hora de
inicio y de fin.

*Se comprueba*: `/citas/bloqueos` abre la pantalla, y `/citas/tipos` ya no
enseña el panel de vacaciones al final del catálogo.
*Dónde*: `app/(dashboard)/citas/bloqueos/page.jsx`.
*Comprobado en producción*: 12/08/2026 — desplegado a las 20:20.

### «Fichas a completar» desaparece cuando no queda nada que completar · `somos`, `demo`, `aumenta`

`somos` tenía esa pantalla en el menú con **cero filas en las ocho carpetas**: la
abría el primer día, la encontraba vacía y no volvía. A Aumenta le pasará lo
mismo el día que termine su campaña.

Lo que impedía arreglarlo era el precio de saberlo: traerse las filas cuesta
**3.340 ms en Aumenta**. Se partió `lib/clients/urgentes.js` en `cuerpoDe()` —el
FROM y el WHERE de cada carpeta, escritos UNA sola vez— y encima se montan las
dos consultas, la que lista y la que cuenta. Escribir el WHERE dos veces habría
roto sola la regla de la cabecera del fichero: el total de la carpeta y las filas
que se ven al abrirla tienen que salir de la misma fuente, o nadie se fía del
número.

El menú enseña además cuántas **bloquean** el trabajo, no las 1.800 por
completar: un contador que no baja nunca se deja de mirar en dos días.

⚠️ **El número se pide una vez por carga de página.** El menú vive en el layout
del dashboard y no se vuelve a montar al navegar —comprobado: cero llamadas a
`?soloTotales=1` al ir de Clientes a Leads y volver—, así que quien cierre el
último hueco no verá desaparecer la entrada hasta que recargue. Para una entrada
de menú es aceptable; si algún día se quiere un contador en vivo, hay que
refrescarlo aparte.

*Cómo se comprobó*: las dos mitades, en producción y con las dos sesiones.
**Que sale**: en la demo, con sus 21 huecos y sin número al lado (0 bloquean).
**Que no sale**: en `somos`, cuyo menú enseña bajo Clientes únicamente «Lista de
espera» — «Fichas a completar» no está, y el endpoint devuelve 0 y 0. Y antes de
eso, las **24 cuentas** de aumenta, demo y somos cuadran al registro con lo que
devuelve el listado, incluida la resta de lo archivado; Aumenta pasa de 3.340 ms
a **16 ms**.
*Dónde*: `lib/clients/urgentes.js` (`cuerpoDe`, `cuentasDe`),
`app/api/clients/urgentes/route.js` (`?soloTotales=1`) y
`components/layout/Sidebar.jsx`.

### Desde el panel interno ya se puede cerrar sesión · producto

El enlace «salir» era un `<a href>`, o sea un GET, y `/api/auth/logout` solo
entiende POST: 405 y la sesión seguía abierta. En la pantalla que crea clientes,
cambia módulos y suspende cuentas — la que se queda abierta en un portátil.

Ahora es un botón que hace POST (`components/admin/SalirBoton.jsx`) y va a
`/login` con `replace`, para que el botón de atrás no devuelva a una pantalla
del panel. **No se arregló añadiendo un GET al endpoint**, que habría sido una
línea: un cierre de sesión por GET lo dispara cualquier página ajena con una
etiqueta de imagen, y el patrón bueno ya estaba escrito en el sidebar del CRM.

*Cómo se comprobó*: en producción, pulsándolo. El botón pasó a «saliendo…», la
pantalla fue a `/login`, y una llamada a `/api/admin/paquetes` que antes daba
200 pasó a dar **401**.
*Dónde*: `components/admin/SalirBoton.jsx` y `app/admin/layout.jsx`.

### Los paquetes de módulos se crean desde el panel · producto

Los dos que había estaban escritos en `lib/provisioning/catalogo.js`: inventar
un tercero era tocar código y desplegar. Ahora hay pestaña **Paquetes** en el
back-office y tabla `master.paquetes_modulos`.

**Ningún cliente guarda un paquete**, y esa era la pregunta que la tarea tenía
abierta: la contestó Jorge —«los clientes no tienen ningún paquete, solo módulos
puestos a su gusto, quédalo así»— así que no hay FK, ni columna, ni asociación,
y editar o borrar uno no le cambia nada a nadie. El alta ofrece **las dos
formas** bajo un rótulo, «Cómo se monta»: los paquetes y «Personalizado», y en
cuanto se toca una casilla vuelve a Personalizado.

El freno que se perdía al sacarlos del código —«solo se escribe aquí un paquete
cuando está DECIDIDO qué lleva»— se rehízo en `lib/provisioning/paquetes.js`.

*Cómo se comprobó*: el ciclo entero en producción. Se intentó crear uno con
`billing` suelto y **rebotó** con «Para activar Facturación hace falta también
Clientes» ofreciendo «añadir también Clientes»; se pulsó el atajo y se creó; se
abrió el alta y **apareció allí sin desplegar**, marcando exactamente sus
módulos al pulsarlo y volviendo a «Personalizado» al tocar una casilla; se
editó (el nombre cambió, la clave `prueba-de-claude` NO, que es lo buscado); se
retiró —desapareció del alta— y se reactivó; y se borró. Producción vuelve a
tener exactamente los dos de siempre. Los frenos también están fijados sin base
de datos en `scripts/_smoke-paquetes.mjs`, 24 de 24.
*Dónde*: `app/admin/paquetes/page.jsx`, `app/api/admin/paquetes/`,
`lib/provisioning/{paquetes,paquetesStore}.js`,
`models/master/PaqueteModulos.model.js`.

⚠️ **Lo que queda no es código sino contenido**: los dos paquetes de hoy son los
dos de salud, y sigue sin haber ninguno para el perfil comercial (el de
spain_enzymes, retorika y abarcaia). Eso ya se hace desde la pantalla.

### Dos fallos que salieron al probar lo anterior · producto

Ninguno estaba en el backlog: aparecieron el mismo día, probando lo de arriba, y
se arreglaron en el acto. Quedan escritos para que no se vuelvan a descubrir.

**El repo estaba en rojo.** `node scripts/check-migration-order.js` salía con
`exit 1`: la migración del Registro no estaba registrada en
`_module-migrations.js` y daba dos incoherencias —«sin módulo asignado (nadie
las ejecutaría)» e «ilegibles y sin arista declarada»—. Registradas esa y la de
paquetes, vuelve a `exit 0`. **Es un despiste del flujo, no de nadie**: a una
migración de MASTER no le toca ningún módulo y se queda huérfana sola. Ya había
pasado dos veces (`74fc6d2`, `be465f5`).

**Y el panel mentía en la operación más delicada que tiene.** Al abrir NUESTRA
ficha en `/admin/clientes` y pulsar «Guardar cambios», la confirmación decía
«SE QUITAN 1 · **provisioning**» — el módulo que abre todo el back-office. Era
falso: `cicloVida.js:190` filtra por `CLAVES_VALIDAS` justo para que guardar
nuestra ficha no nos deje fuera. O sea que la pantalla asustaba con algo que el
servidor iba a ignorar, y una confirmación que asusta de más se acaba pulsando
sin leer — lo contrario de para lo que está. Ahora cuenta como «se quita» solo
lo que el servidor va a quitar de verdad.

*Cómo se comprobó*: en producción. `check-migration-order` en verde; y al
guardar nuestra ficha ya no sale ningún aviso de módulos, se guarda directo sin
la confirmación, y `provisioning` sigue entre sus 7 módulos.

### Las cinco pantallas de Formación están en el menú · `retorika`, `aumenta`, `nutri_laura`, `demo`, `somos`

Formación era la única entrada grande sin hijos: para ir de Cursos a Alumnos
había que volver a la portada.

**Los rótulos no se han tocado.** Renombrar «Usuarios» y «Alumnos por curso»
—que se pisan— le cambia el vocabulario a cinco clientes de golpe, y Jorge lo
dejó fuera a propósito: «solo la navegación». Queda apuntado aparte.

Nació de paso `TENANT_HIDDEN_CHILDREN`: la portada de Aumenta esconde Empresas y
Cuestionarios porque su formación es B2C, y sin eso el menú le habría devuelto
por el lateral las dos pantallas que su propia pantalla le quita.

*Cómo se comprobó*: en producción, en el menú de la demo — salen las cinco
(Empresas, Cursos, Usuarios, Alumnos por curso, Cuestionarios).
*Dónde*: `components/layout/Sidebar.jsx`.

### La marca de un cliente se cambia desde el panel · producto

Cambiarle dos colores a un cliente era escribir un script, commitearlo,
construir, desplegar y correrlo con `docker exec`: media hora de proceso para
dos campos de seis caracteres. Fue literalmente lo que costó la paleta de Somos
el 12/08 (`scripts/update-somos-brand.js`).

El trabajo de servidor **ya estaba hecho** —`editarTenant()` acepta `brand`,
valida el hex y hace merge—; lo único que faltaba era que la pantalla mandara
esos tres campos. El editor de `/admin/clientes` los tiene ahora, y
`/api/provisioning/clientes` devuelve `marca` (solo el `brand`: en `settings`
también viven las credenciales cifradas del cliente, y esa pantalla no las
necesita).

**Avisa del contraste**, que es la mitad que no era obvia. El color principal NO
es un acento: es el FONDO del menú lateral, con texto blanco encima a opacidades
que bajan al 30%. Si no llega a 4,5:1 lo dice con el número delante.

*Cómo se comprobó*: en producción, con la sesión del panel. Se abrió la ficha de
`salamandra_solutions` y los campos salieron con sus colores REALES de la base
(#1B3A2D / #3E6B54). Se escribió el turquesa que Somos no podía usar (#4BBDCF) y
saltó el aviso con **2,22:1**, el mismo número que se había calculado a mano
para esa marca. Y se probó el guardado de verdad sobre `demo` —secondary
#152722 → #152723, comprobado leyendo la base— y se dejó como estaba.
*Dónde*: `app/admin/clientes/page.jsx` (`contrasteConBlanco`, el bloque Marca) y
`app/api/provisioning/clientes/route.js` (el campo `marca`).

### El plan del cliente deja de enseñarse · todos

Debajo del nombre del cliente, en su propio menú, ponía PRO o STARTER en
mayúsculas. No gateaba nada: ni un módulo, ni un límite, ni un precio, y lo que
cada uno tenía escrito venía de cómo se sembró — Somos, con los 21 módulos,
ponía STARTER; Retorika, con tres, PRO.

Fuera del menú del cliente y de las tres pantallas del back-office. La columna
se queda en `master.tenants` (es NOT NULL con valor por defecto y la escriben
doce seeds); lo que se retira es enseñarla y dejar escribirla.

De propina, la casilla de edición era una trampa: **texto libre sobre un ENUM de
cuatro valores**, así que escribir cualquier otra cosa y guardar reventaba con
un error de PostgreSQL. Nadie lo había visto porque nadie tocaba el campo.

*Cómo se comprobó*: en producción, con la sesión del panel — el listado de
`/admin/clientes` enseña «Somos · somos · 21 módulos» sin plan, y el editor ya
no tiene esa casilla. Y dentro del contenedor, **cero** bundles del menú lateral
leen `.plan` (antes salía en el que pinta «Sin tenant»).
*Dónde*: `components/layout/Sidebar.jsx` (lo que veía el cliente),
`app/admin/{page,modulos/page,clientes/page}.jsx`.

### Referidos ya no se puede vender desde el alta · producto

Salía en el catálogo con su casilla y su letra pequeña —«hoy está hecho a medida
de un cliente; requiere ajuste»—, así que se le podía marcar a un cliente nuevo
algo que no le iba a funcionar: no tiene tabla propia (su pantalla lee y escribe
`leads` filtrando por origen), sus endpoints exigen `leads` y NUNCA `referidos`,
y su formulario público está escrito a la medida de abarcaia.

**Quitarlo del catálogo no se lo apaga a quien lo tenga**, y ese es el detalle
que hacía falta comprobar antes de tocarlo: el editor solo desactiva lo que está
en `CLAVES_VALIDAS`, así que un módulo fuera del catálogo queda intocable desde
el panel — el mismo trato que ya recibe `provisioning`. Abarcaia lo conserva
encendido; simplemente deja de tener casilla.

*Cómo se comprobó*: dentro del contenedor, `grep -c 'key: "referidos"'
lib/provisioning/catalogo.js` devuelve **0**. Y antes de tocarlo, contra la base
de producción: solo `abarcaia` lo tiene activo (y está suspendido);
`quality_energy` y `demo` tienen la fila apagada.
*Dónde*: `lib/provisioning/catalogo.js`; el filtro que lo protege está en
`lib/provisioning/cicloVida.js:190` y `lib/provisioning/dependencias.js:568`.

### Los contadores del embudo ya no mienten al filtrar · `abarcaia`, `aumenta`, producto

Al pulsar una etapa, las demás caían a cero y el «X en total» de la cabecera se
contagiaba: el desglose salía de un `reduce` sobre la lista que acababa de
llegar, y esa lista viene FILTRADA.

**Estaba en los OCHO overrides de leads, no en tres.** La tarea nombraba a
abarcaia, aumenta y quality-energy porque son los únicos con embudo lleno; los
otros cinco tenían el mismo `reduce` y nadie lo había visto.

Ahora lo cuenta el servidor: `/api/leads?desglose=1` hace un `GROUP BY stage`
con el mismo `where` que la lista **pero sin la etapa** —los demás filtros sí
cuentan, porque describen el conjunto que se está mirando—, y el total sale de
sumarlo. Con eso desaparece también la resta a ojo de los referidos, que solo
descontaba los que hubieran caído en la página de 200.

**Por qué se resta en vez de excluir, que es lo que hay que entender si alguien
lo toca**: `excluirOrigen` existe por abarcaia y quality-energy, que apartan del
embudo los leads del formulario de referidos. Un `NOT (custom_fields @> …)`
devuelve NULL en una fila con `custom_fields` vacío y **borraría ese lead de la
cuenta sin que se note**. Se cuenta dos veces con `@>` —positivo, y por tanto a
prueba de NULL— y se resta.

De paso: hoy esa exclusión no filtra nada. Los 84 leads de abarcaia son
`excel_import` y **ninguno tiene `customFields.source`**, o sea que el formulario
público de referidos no ha producido ni una entrada.

*Cómo se comprobó*: la aritmética de la resta, contra los NUEVE clientes de
producción, comparándola con un `COALESCE(custom_fields->>'source','') <> …`
explícito — cuadra al lead en todos, y no hay ni una fila con `custom_fields` a
NULL. El comportamiento, en el navegador sobre la demo: al filtrar por etapa los
contadores se quedan en 42/15/15/5 y la cabecera en «42 en total», mientras la
lista baja a 15 filas. Y con búsqueda puesta, el desglose se recalcula sobre lo
buscado (7) y no sobre el total, o sea que el `Op.or` sobrevive a la copia del
`where`. En producción está comprobado que el código nuevo viajó en la imagen
(`totalSinEtapa` en el bundle desplegado); el comportamiento no se pudo ver allí
porque el endpoint pide sesión.
*Dónde*: `app/api/leads/route.js` (`desglosePorEtapa`) y los ocho
`modules/overrides/*/LeadsModule.jsx`.

### Una ausencia mal puesta ya se puede corregir · `nutri_laura`, producto

`/api/citas/bloqueos` tenía GET, POST y DELETE y ningún PATCH: ni las fechas, ni
el motivo, ni de quién era una ausencia se podían cambiar. Quien se equivocaba
de día la quitaba y la volvía a escribir — y arreglar las seis que en la consulta
de Laura quedaron a nombre de «Todo el centro» costó un script
(`scripts/reasignar-ausencias-sin-persona.js`).

Ahora hay PATCH y un botón de Editar. **Los permisos no se aflojaron**, y se
añadió uno: quien no es dirección solo toca las suyas (igual que el DELETE) y
**no puede cambiar de quién es una ausencia**, ni la propia. Reasignar es justo
la operación que cerró la agenda de Laura, y permitirlo desde aquí habría
devuelto por la puerta de atrás lo que el POST cerró el 10/08. Queda en la
auditoría como `citas.bloqueo_updated`, con su frase en `etiquetas.js`.

**La otra mitad la hizo Rodrigo el mismo día**: sacó la pantalla de dentro de
Tipos de cita a `/citas/bloqueos`, con botones en las tres cabeceras del módulo.
Se descartó la versión que se había escrito en paralelo (`/citas/ausencias`) y se
quedó la suya; lo único que se añadió fue la entrada en el menú que pidió Jorge,
apuntando a esa ruta.

⚠️ Queda un cabo: su botón la llama **«Bloqueos»** y el menú **«Vacaciones y
ausencias»**. Dos nombres para la misma pantalla.

*Cómo se comprobó*: en el navegador, creando un tramo del 5 al 9 de octubre a
las 09:00 y pulsando Editar — **el formulario se abre diciendo 09:00, no 07:00**,
que era lo que más podía torcerse (el mismo enredo de zonas del arreglo del
07/08, ahora al revés). Se cambió motivo y fecha final, guardó («Corregida», 5
oct 09:00 → 7 oct 23:59) y se borró la fila de prueba. En producción, la ruta
desplegada registra ya `DELETE, GET, PATCH, POST`.
*Dónde*: `app/api/citas/bloqueos/route.js` (el PATCH) y
`components/citas/PanelVacaciones.jsx` (`editar`, `guardar`, `partirEnMadrid`).

### El aviso de borrado ya solo promete lo que el cliente tiene · `retorika`, `spain_enzymes`, `nutri_laura`

«Se borrarán también sus documentos y las citas que todavía no han ocurrido» se
le decía a todo el mundo. En un cliente sin agenda esa frase no es falsa: está
**vacía**.

**Salió mucho más pequeño de lo que decía la tarea**, y esa es la parte que
merece recordarse. Estaba escrito que eran «5 ficheros, uno nuevo en `/lib` y una
prop atravesando dos componentes de servidor y dos de cliente», y que aplicado a
medias dejaba `conCitas` sin declarar dentro de `handleDelete` — un
ReferenceError en caliente en Aumenta. Nada de eso hizo falta: **`/api/auth/me`
ya devuelve `enabledModules`**, así que cada pantalla lo pregunta ella misma. Sin
prop drilling, sin tocar componentes de servidor y sin variables sueltas.

El texto se arma en `lib/clients/avisoBorrado.js` y lo comparten el listado y las
dos fichas. Si no se sabe qué módulos hay, se avisa DE TODO: avisar de más
sobra, callarse lo que se borra no.

Y el caso contrario, encontrado de paso: la ficha de nutri_laura decía «sus
archivos y su historia clínica» y **se callaba las citas futuras**, que también
se borran y además le mandan a la paciente el correo de cancelación. Laura tiene
agenda, así que a ella le faltaba media frase.

⚠️ Lo que queda escrito en la cabecera del fichero: `/api/auth/me` devuelve el
cruce con el acceso del USUARIO, no los módulos del centro, así que alguien con
`clients` y sin `citas` en un centro con agenda se quedaría sin ese aviso.
Comprobado en producción: **no hay ni una persona así** en los diez clientes —
quien borra fichas es admin, y los admin llevan comodín.

*Cómo se comprobó*: las cuatro combinaciones, ejecutando la función: con agenda y
documentos sale el texto de siempre; sin ninguno de los dos la promesa vacía
desaparece; con agenda y sin documentos solo habla de citas; y sin saberlo, sale
completo. En producción, `lib/clients/avisoBorrado.js` viaja en la imagen y la
consulta de quién podría quedarse corto devuelve cero.
*Dónde*: `lib/clients/avisoBorrado.js`, `app/(dashboard)/clientes/ClientesClient.jsx`,
`modules/default/ClientDetailModule.jsx` y `modules/overrides/nutri-laura/ClientDetailModule.jsx`.

### El Registro ya se reparte y se marca desde la pantalla · interno

Estaba en «Pendiente de una decisión suya» con tres salidas posibles. **Rodrigo
eligió la del medio el 12/08**: poder asignar cada tarea a él o a Jorge, y un
tick que la manda a Resuelto — y quitándolo, de vuelta a Pendiente. Lo que NO
entra es escribir tareas nuevas desde la pantalla.

**Dónde vive cada cosa, que era el problema de verdad.** El texto de una tarea
sigue en `docs/backlog.md` y `docs/resuelto.md`, y no se toca desde el
navegador: los dos ficheros viajan DENTRO de la imagen de Docker
(`Dockerfile:33`), así que cualquier cosa que la pantalla escribiera en ellos se
la llevaría el siguiente despliegue sin dar ningún error. El reparto y el tick
van a una tabla nueva, `master.tablero_estado`, y se pintan ENCIMA de lo que
dicen los ficheros. Una tarea marcada sale en Resuelto aunque siga escrita en
`backlog.md`; al quitarle el tick vuelve a su sitio.

Solo se guarda lo que se DESVÍA del repositorio. Marcar una que ya está en
`resuelto.md` no crea ninguna fila —el fichero ya lo decía— y devolver a
pendiente una de `backlog.md`, tampoco. Así la tabla no acumula filas que no
dicen nada, y el día que alguien cierre la tarea de verdad en su commit, el
apaño desaparece solo.

**Lo marcado a mano se ve marcado a mano.** Cae en su propio bloque —«Marcadas
desde el Registro», con la etiqueta «sin commit»— en vez de mezclarse con lo
cerrado en el repositorio. El tick es para poneros de acuerdo entre los dos;
cerrar una tarea sigue siendo moverla a `resuelto.md` en el commit que la
arregla, y esa regla no la toca nadie.

⚠️ La clave de cada tarea es su TÍTULO normalizado. Reescribir un título en el
fichero deja la fila huérfana y la tarea vuelve a salir donde diga el fichero.
Es el precio de no meter identificadores dentro del markdown, que lo volvería
ilegible y habría que inventarlos a mano al escribir cada tarea. Una fila
huérfana no molesta: simplemente no casa con nada.

*Dónde*: `app/api/admin/tablero/route.js` (ahora con PATCH),
`app/admin/tablero/page.jsx`, `models/master/TableroEstado.model.js` y
`scripts/migrate-tablero-estado.js`, que crea la tabla y es idempotente.
*Cómo se comprobó*: `scripts/_smoke-tablero-estado.mjs` fija los dieciocho casos
de la lógica. Y contra el VPS, con el código YA desplegado y la base de datos de
producción: la migración crea la tabla, un ida y vuelta desde dentro del
contenedor escribe una tarea de mentira con el modelo real —que es donde se
habría visto un nombre de columna mal puesto—, la lee, comprueba que se va a
«Marcadas desde el Registro» y la borra; la tabla queda en 0 filas. Un PATCH sin
sesión responde 401, no 405, que es como se sabe que el método está registrado.
*Falta*: un clic de verdad con sesión de back-office. En local no se puede
—`salamandra_solutions` no tiene ni usuario ni schema— así que esa parte la ve
Rodrigo la primera vez que abra el Registro.

### La IA la paga el cliente, con su clave · producto

Estaba en «Pendiente de una decisión suya» y era la mitad cara: el CRM tiene
once disparadores de IA repartidos por nueve módulos, todos desplegados, y no
los usa nadie porque cada cliente tiene que traer su propia clave y ninguno la
ha puesto. **Rodrigo lo cerró el 12/08: el modelo es BYOK y el consumo lo paga
el cliente.** No entra en el precio.

Con eso, el mecanismo que ya estaba escrito es el bueno y no hay que tocar
código: la tarjeta para pegar la clave sale en Configuración → IA de todos los
clientes (regla #14 de CLAUDE.md), sin clave el CRM contesta «Este cliente no
tiene configurada la clave de IA», y `lib/ai/anthropicKey.js` no mira ninguna
variable de entorno a propósito. Que no haya reserva por entorno deja de ser una
carencia y pasa a ser lo que se quiere: si la clave la pone el cliente, una
nuestra por detrás sería una factura silenciosa.

Lo que queda es COMERCIAL y no de programación: nadie ha puesto su clave porque
lo más probable es que nadie sepa que tiene que ponerla. Eso se resuelve
contándoselo, y para poder pegársela nosotros cuando la traigan ya hay una tarea
en P2 («Custodia sabe qué claves le faltan…»), con el campo de solo escribir.

*Cómo se comprobó*: contra el VPS el 12/08/2026, `master.tenants.settings` →
**1 de 10 clientes con clave de Anthropic (nosotros, `salamandra_solutions`) y 0
de 10 con la de OpenAI**. Sigue igual que el 10/08, con un cliente más en la
lista (`somos`).

### Aumenta no abre su agenda al público · `aumenta`

Estaba en «Pendiente de una decisión suya». **Rodrigo lo cerró el 12/08: no se
abre.** Las familias tienen «Mi espacio» para ver sus citas y ahí acaba; pedir
hora sigue siendo cosa del centro.

Es la respuesta que deja las cosas como están, y por eso lo único que hacía
falta era comprobar que están como creemos. Lo están: el interruptor
`settings.citas.reservaOnlineCerrada` de Aumenta vale `true`, así que la reserva
por internet está cerrada de verdad y no por casualidad.

*Cómo se comprobó*: contra el VPS el 12/08/2026,
`master.tenants.settings->'citas'->>'reservaOnlineCerrada'` = `true` en
`aumenta`. Sigue cerrada, igual que el 09/08.

### La primera visita de Laura puede elegir · `nutri_laura`

Estaba en «Pendiente de una decisión suya»: una clienta llegó a la página de
pago del bono de 360 €, vio el importe y se fue, y había un interruptor para
obligar a que toda primera sesión pasara por la valoración inicial. **Rodrigo lo
cerró el 12/08: puede elegir entre valoración inicial y acompañamiento
mensual.** No se enciende nada.

Los tres tipos públicos de su agenda son hoy «Valoración inicial» (sin precio,
marcada como primera visita), «Acompañamiento mensual» (360 €, 6 sesiones) y
«Supervisión profesional» (60 €, desde el 12/08 solo para profesionales). Quien
entra por primera vez ve las dos primeras y decide; que se fuera al ver el
importe es una conversación de precio, no una puerta que falte.

*Cómo se comprobó*: contra el VPS el 12/08/2026, `crm_nutri_laura.event_types`
→ las dos siguen activas y visibles, y `valoracionSoloConFormulario` no está
puesto en los ajustes del cliente.

### La puerta del formulario deja de pedírselo a los profesionales · `nutri_laura`

Estaba en «Pendiente de una decisión suya» como «¿se apaga la puerta global del
formulario?». **La respuesta de Rodrigo el 12/08 no fue ni sí ni no, sino que
faltaba distinguir**: «una persona registrada como profesional no tiene que
hacer el formulario, con haber hecho su formulario profesional le vale. Un
paciente que entra por el formulario comercial sí que tiene que hacerlo sí o
sí». Así que la puerta sigue encendida y global para los pacientes, y ahora
tiene una excepción.

**Son dos formularios distintos y solo se miraba uno.** Quien viene marcado como
`profesional_salud` —un nutricionista que trae un caso— llegó por el formulario
de profesionales de la web, que NO cae en la bandeja del módulo Formularios. La
puerta le buscaba allí, no lo encontraba y le pedía rellenar el formulario de
pacientes; y encima el único tipo de cita que puede reservar, «Supervisión
profesional», ya está reservado a esa misma marca desde el mismo día.

La excepción se cuelga de la MARCA de la ficha y no de un ajuste nuevo: es la
misma llave que abre los tipos de cita de profesionales, puesta por el mismo
sitio. Y vale para las DOS puertas —la global y la de la valoración inicial—
porque partirlo por la mitad dejaría al mismo correo pasando por una y
chocándose con la otra.

Lo que no cambia: sin la marca no pasa nadie. Si la marca no se puede leer
—tabla sin migrar, base de datos caída— se responde que no es profesional y la
persona cae en la puerta normal. Un fallo de lectura no abre nunca.

*Dónde*: `lib/citas/puertaFormulario.js` (`esProfesionalExento` y `admitido`),
y los tres sitios que preguntaban `estado === "aceptada"` a mano ahora usan
`admitido()`: `/book`, el portal y `lib/citas/puertaValoracion.js`.
*Cómo se comprobó*: `node scripts/_smoke-puerta-profesional.mjs` (lógica pura,
con modelos de mentira) fija los ocho casos, incluido que la marca ilegible
cierra en vez de abrir. Y contra el VPS, con el código ya desplegado y los datos
REALES de nutri_laura: las cuatro pacientes con solicitud aceptada siguen
pasando, y un correo desconocido sigue sin pasar — que era el riesgo de tocar
una puerta que está viva en la agenda pública.
*Falta*: verlo con un profesional de verdad. El 12/08 no hay **ningún** cliente
marcado como `profesional_salud` en producción —la marca nació ese mismo día— así
que la excepción todavía no ha entrado en juego con nadie. La primera vez que
Laura marque a un colega, es la que hay que mirar.

### Los trece de Aumenta ven lo que tienen que ver · `aumenta`

Estaba en P1 esperando una respuesta del centro: trece personas sin acceso a
`clients`, `documents`, `formularios`, `team` y una decena más, con dos de ellas
—`rosa_aumenta` y `olga_aumenta`— sí con `billing` y `documents`, lo que parecía
un reparto a medio hacer. **Preguntado a Aumenta, el reparto es el correcto y no
hay nada que tocar** (Rodrigo, 12/08/2026):

- **Once son terapeutas** y trabajan en Pacientes y Clínica. Tienen `calendar`,
  `citas`, `clinica` y `pacientes`, que es su trabajo entero.
- **Olga y Rosa son administración y finanzas**, y por eso ellas dos suman
  `billing` y `documents`. El reparto a mano que se intuía era ese, y a propósito.
- **La dirección son otras dos personas** y entran por la cuenta de admin
  (`admin@aumenta.es`), que tiene `["all"]` y lo ve todo.

Lo que la tarea leía como un olvido era el organigrama del centro. Que once
personas no vean Facturación no es un permiso que falte: es que no facturan.

**Esta respuesta cierra DOS tareas, no una.** En «Pendiente de una decisión
suya» había una gemela —«¿Los trece de Aumenta deben ver más módulos?»— que era
la misma pregunta escrita desde el otro lado y que apuntaba aquí. Se cierra con
lo mismo y no se le escribe entrada propia: dos entradas diciendo la misma frase
es exactamente lo que hace que dentro de seis meses nadie sepa cuál mirar.

Queda apuntado, sin ser tarea: esas dos personas de dirección comparten un solo
login, así que en Equipo → Actividad sus dos rastros salen como uno.

*Cómo se comprobó*: contra el VPS el 12/08/2026, `master.users` de `aumenta` sale
partida en exactamente tres grupos, sin mezcla ni caso suelto: once con
["calendar","citas","clinica","pacientes"] (araceli, arantxa, blanca, daniela,
elena, estefanía, isabel, laura, raquelm, raquelt, silvia), dos con esos cuatro
más "billing" y "documents" (olga, rosa) y admin@aumenta.es con ["all"]. Catorce
logins: trece de rol user y uno admin.

### La agenda de Laura ya solo tiene pacientes suyas · `nutri_laura`, `healim`

Estaba en P1: dieciséis citas del equipo mezcladas con las pacientes de Laura,
seis de ellas en días que aún no habían llegado, así que parecían visitas que
tenía que atender. **Borradas el 12/08/2026** a petición de Rodrigo: «elimina de
todos lados las citas de Rodrigo, Jorge, Carlos y Rodrigo Herreros de Tejada».

Lo que se ha ido, con `scripts/borrar-citas-por-nombre.js`:

- **nutri_laura, 16 citas**: Jorge Sánchez Pla (7), Rodrigo (6, contando la que
  estaba a nombre de «Rodrigo Herreros de Tejada») y Carlos Torrents (2), más las
  5 sesiones de cobro que colgaban de ellas. Ninguna petición de cambio de hora
  ni aviso al cliente.
- **healim, 1 cita**: Jorge Sánchez Pla, del 17/06. Nadie la había visto porque
  la tarea solo hablaba de Laura; «de todos lados» era literal.
- **Y «Pruebita»**, la cancelada del 06/08 a nombre de prueba@email.com. No
  estaba en los cuatro nombres que se pidieron, así que se preguntó antes en vez
  de darla por basura: Rodrigo confirmó que también se iba.

La agenda de Laura queda en 6 citas y todas son suyas: Inés (2), Inés Chico
Cornejo, Maider Zabala Gonzalez, Cristina García y Carolina Gil —las dos últimas,
pacientes nuevas que entraron después de escribirse la tarea.

Lo que NO se ha tocado, y sigue ahí: en Pacientes de Laura hay dos fichas de
prueba, «Rodrigo» (info@agenciasalamandra.com) y «Jorge Sánchez Pla». No son
citas y no salen gratis — de esas dos cuelgan 2 contratos firmados, 2 documentos,
3 bonos de sesiones, 2 formularios y 4 formas de contacto—, así que borrarlas es
otra decisión y otra pasada. Rodrigo lo dejó para más adelante el 12/08.

⚠️ **Lo que casi sale mal, y hay que saber antes de volver a lanzar ese script.**
Su lista de fábrica lleva «Rodrigo» a secas, y su regla de coincidencia es el
nombre entero o el patrón seguido de un espacio: caza a cualquiera que se llame
Rodrigo algo. En Aumenta hay un paciente REAL, Rodrigo Sebastián Silva Leiva,
con 42 citas confirmadas de aquí a junio de 2027, y otros cinco que empiezan por
Jorge o Carlos con entre 43 y 87 citas cada uno. Lanzarlo con `--tenant aumenta`
y la lista por defecto se habría llevado 302 citas de seis pacientes de verdad,
todas futuras. Por eso se inventarió PRIMERO nombre a nombre en los once schemas
con tabla `bookings`, y en healim se lanzó con `--nombre "Jorge Sánchez Pla"` en
vez de con la lista por defecto. El peligro de este script no es el SQL: son los
homónimos.

**Hay copia de seguridad.** Las 23 filas (17 citas de nutri_laura, sus 5 cobros y
la de healim) están enteras en el schema `zzz_backup_citas_20260812`, que lleva un
COMMENT con cómo devolverlas: `INSERT INTO crm_<slug>.<tabla> SELECT * FROM
zzz_backup_citas_20260812.<tabla>`. Ese schema se puede tirar cuando Laura
confirme que su agenda está como debe.

*Cómo se comprobó*: la misma consulta de nombres contra los once schemas con
tabla `bookings`, antes y después. Antes salían 13 grupos que contenían
rodrigo/jorge/carlos/torrents/prueba; después solo los seis pacientes reales de
Aumenta, intactos con sus 12.030 citas. nutri_laura pasó de 23 citas a 6 y healim
de 6 a 5. Los bloqueos de agenda y los festivos no se tocaron: viven en
`team_blocks` y `blocked_days` y el script no abre esas tablas.

### Las «ocho familias admitidas que no podían pedir cita» no existían · `nutri_laura`

Estaba en P0: *«8 de las 13 aceptadas no tienen ficha; Laura ya les dijo que sí
y la agenda las rechaza con un 403»*. Comprobado en producción, **no hay ninguna
familia esperando a nadie**. La tarea contaba filas sin mirar quién había detrás.

Lo que hay de verdad, con `scripts/comprobar-admision.js` (solo lectura, escrito
para esto) contra el VPS el 12/08: **16 aceptadas, no 13. Nueve bloqueadas, no
ocho.** Y de esas nueve:

- **cinco son pruebas nuestras** — `prueba@email.com` repetido cuatro veces y
  `rodri@email.com`, con teléfonos correlativos inventados (666666665,
  666666654, 656666666);
- **dos son de Rodrigo**, con su nombre y su correo;
- **una es Carlos Torrents**, novio y coworker de Laura;
- **y la última, Andrea Castellanos**, que no es paciente ni ha comprado nada:
  entró en la puesta al día de usuarios de la web y Laura la descartó el 05/08.

Las que **sí** pueden reservar incluyen a Inés y a Maider, que son justo las dos
pacientes reales que identificaba la tarea de las citas de prueba, cerrada hoy
también y unas entradas más arriba. Las nueve están
bloqueadas porque su ficha ya no está, que es **exactamente lo que `3947dc0`
quería que pasara**. La puerta funciona.

También cae el diagnóstico de la tarea: el fallo no salió de `db974a2` —ése es
el del bono y el aviso amarillo— sino de `3947dc0`. Y el `SELECT ... NOT EXISTS`
que proponía como comprobación no cuenta gente bloqueada: ignora a los tutores
—la puerta resuelve la ficha con `resolvePortalClient`— y mezcla dos casos que
piden arreglos opuestos, «tiene ficha y no la vemos» y «no tiene ficha».

Es el mismo fallo del que avisa la cabecera de `backlog.md` con la tarea de los
dos pagos: una cifra escrita sin mirar quién había detrás. **Escribir la tarea y
comprobarla son el mismo acto.**

De la investigación salieron tres cosas que sí valían, y están hechas: la puerta
resuelve la ficha también por `form_submissions.client_id`, un descarte posterior
deja de quedar tapado por una aceptada vieja, y quien agota tres formularios ve
una pantalla que corta en vez de una noria. Detalle en `docs/modules/citas.md`.

*Cómo se comprobó*: `docker exec crm-salamandra-app-1 node
scripts/comprobar-admision.js nutri_laura` en el VPS el 12/08/2026 →
«Bloqueadas TENIENDO ficha (fallo nuestro): **0**». Los nombres y las fechas de
aceptación se contrastaron uno a uno con Rodrigo, que identificó a Carlos
Torrents y a Andrea Castellanos.

> ⚠️ **Estas seis se escribieron ANTES del despliegue, a petición de Jorge.** La
> regla de la casa es no cerrar nada hasta verlo funcionar en el VPS, y eso no se
> ha podido hacer todavía: el código está en el árbol de trabajo, sin commitear.
>
> Se escriben igual porque los dos ficheros viajan DENTRO de la imagen: el
> Registro no las enseñará como resueltas hasta el despliegue que las hace
> verdad, así que no hay ningún momento en el que el tablero mienta. Lo que sí
> queda pendiente es mirar el comportamiento nuevo en producción, y cada sello
> dice exactamente qué se comprobó y contra qué.

### El filtro de la agenda ya no se come la pantalla · `aumenta`

El filtro pintaba un botón por cada tipo de cita y otro por cada profesional.
En Aumenta eso son **74 botones en 10 filas**, y medido en su producción
ocupaban **379 px** cuando al calendario le quedaban **335 px** en un monitor de
1920×953: el filtro ocupaba más que la agenda. En un portátil de 768 px de alto
el día empezaba haciendo scroll para ver la primera cita. Lo sufría cada mañana
el cliente que más usa el CRM.

Ahora son **dos desplegables con casillas en una sola línea**, unos 42 px.
Desplegables con casillas y no un `<select>` normal a propósito: los dos filtros
son de selección múltiple y eso se usa —ver dos tipos a la vez, o a dos
profesionales—, y un `<select>` se lo habría llevado por delante. El componente
nuevo es `components/ui/MultiSelect.jsx`, calcado de `Select.jsx` para no
inventar un lenguaje visual nuevo, con buscador a partir de 8 opciones porque
encontrar uno entre 57 a ojo era el trabajo de verdad.

**Los dos filtros hacían cosas contrarias, y eso se acabó.** El de profesional
aislaba con el primer clic (Rodrigo, 02/08); el de tipo partía de «todos
puestos» y cada clic ESCONDÍA uno, así que para ver un tipo entre 57 había que
tachar 56. Era el mismo castigo que a los profesionales se les había quitado en
agosto, pero peor. Decisión de Jorge (12/08): **el primer clic aísla en los
dos**. La regla vive ahora en `alternar()`, un solo sitio, para que no puedan
volver a divergir sin que nadie se entere.

Tercera decisión suya del mismo día: **quedarse sin nada marcado vuelve a
«todos»**, también en los dos. Antes el de tipo dejaba el calendario EN BLANCO
sin llegar a preguntar al servidor; con chips hacían falta 57 clics para
provocarlo, pero con casillas está a uno, y un calendario vacío se lee como «han
desaparecido las citas». Con eso, la lista vacía dejó de existir y se pudo
borrar código muerto del `fetchEvents`.

⚠️ Para quien lo toque: `visibleTmIds` no solo filtra citas, también decide qué
ausencias se ven (la regla del 10/08 de que con «Todos» cada cual ve las suyas).
El contrato `null` = todos, lista = solo esos, y `[]` no existe.

*Cómo se comprobó*: primero midiendo el problema en la agenda real de Aumenta en
producción (74 botones, 10 filas, 379 px contra 335 px). Después, con un banco
de pruebas en local cargado con los 57 tipos y las 15 personas reales, clic a
clic: el primer clic aísla, el segundo suma y el botón pone «2 tipos», quitar el
último vuelve a «todos» y no a lista vacía, el buscador filtra («pedagog» → 8
resultados, «zzzz» → «Sin resultados») y el panel de 434 px no corta la etiqueta
más larga que tienen, «INFORME PARA DIAGNOSTICO (PSICO - LOGO - I.S.-SOLO TEA)».
*Falta*: verlo en la agenda de Aumenta después del despliegue.
*Dónde*: `modules/default/CitasModule.jsx` y `components/ui/MultiSelect.jsx`
(nuevo). No hay overrides de `CitasModule`, así que llega a la vez a Aumenta,
nutri_laura, healim y la demo.

### «Reorganizar con IA» ya aplica los cambios que propone · `demo`, `aumenta`, `salamandra_solutions`

El modal proponía los cambios, dejaba desmarcar los que no interesaban y al
pulsar «Aplicar cambios» pedía `POST /api/projects/[id]/ai/apply` — un endpoint
que **no existía en ningún commit**. No es que se rompiera: nunca se escribió.
Donde más dolía era en la demo, que es pública: allí la propuesta se simula sin
clave de IA, así que cualquiera a quien se le estuviera enseñando el CRM llegaba
al último botón y se comía el error.

Este endpoint ya se había escrito el 10/08 (`599e9ed`) y **Jorge lo mandó
revertir** el mismo día (`d5f7abe`), porque se había pedido por error desde otra
conversación. El 12/08 pidió rehacerlo, así que se ha recuperado ese trabajo tal
cual con `git revert -n` en vez de reescribirlo: era código ya revisado. Lo
único que hubo que fusionar a mano fue `lib/actividad/etiquetas.js`, al que la
baja de clientes le había metido tres líneas por medio.

Lo que hace, y por qué así: revalida las operaciones que manda el navegador
contra un snapshot RECIÉN leído —no contra el que generó la propuesta—, porque
el cuerpo lo manda el cliente y sin eso se podrían colar operaciones sobre otro
proyecto; y las aplica en una transacción, con las bajas al final, porque media
reorganización aplicada es peor que ninguna. No llama a la IA, así que no
necesita ni clave ni guard de demo: es justo lo que permite que la demo funcione
de punta a punta.

*Cómo se comprobó*: `npm run build` en verde y el endpoint compilado, `apply` al
lado de `edit` en `.next/server/app/api/projects/[id]/ai/`.
*Falta*: pulsar «Aplicar cambios» en la demo después del despliegue y ver que
aplica en vez de dar 404.
*Dónde*: `app/api/projects/[id]/ai/apply/route.js`.

### El moduleKey `sales` ha desaparecido del código · producto

El área comercial tenía dos claves y el código aceptaba las dos:
`hasModule("leads") || hasModule("sales")`. Eran **dieciséis guardas** en doce
ficheros de ruta, más `lib/home/summary.js`, la etiqueta de `AccessSection.jsx`
y dos semillas. La tarea decía trece y eran dieciséis.

**Quitar esos OR no era limpieza, era un cambio de autorización**, así que
primero se comprobó contra producción que no dejaba a nadie fuera: de las ocho
filas comerciales de `master.tenant_modules`, siete son `leads` y están activas,
y la única `sales` es la de la demo y está **apagada**; ningún usuario tenía
`sales` en su `module_access`. Cero clientes afectados.

De paso salió lo que lo habría roto en local: `scripts/db-sync.js` tenía `sales`
en su lista de módulos y **no tenía `leads`**. Es de donde salió esa fila de la
demo. Una demo recién sembrada se habría quedado sin módulo comercial y sin
saber por qué. Arreglado en el mismo cambio.

*Cómo se comprobó*: con una consulta de solo lectura contra `master` en
producción, listando las filas `leads`/`sales` de todos los clientes y los
usuarios con `sales` en su `module_access`. Salieron 0 filas `sales` activas y 0
usuarios.
*Falta*: que un cliente con `leads` siga viendo su módulo comercial después del
despliegue.
*Dónde*: `/api/leads/*`, `/api/referidos/*`, `/api/public/{leads,referidos}`,
`/api/analiticas`, `lib/home/summary.js`, `components/team/AccessSection.jsx`,
`scripts/{db-sync,seed-sandbox}.js`.

### El secreto del SSO se puede rotar sin cortar el portal · producto

`WIDGET_SSO_SECRETS` guardaba **un** secreto por cliente, así que cambiarlo
obligaba a tocar el CRM y WordPress al mismo segundo: entre un despliegue y el
otro, todo lo que viaja firmado dejaba de valer. Ya costó un corte en el portal
de Laura.

Ahora el valor admite una LISTA, y el reparto es lo que importa: **para
verificar lo que llega de WordPress valen todos; para firmar lo que el CRM le
manda se usa el primero**. Al revés no funcionaría — firmando con el viejo,
quitarlo de la lista volvería a ser un corte. Hay dos sitios que verifican
(`ssoToken.js` y el registro web) y tres que firman (los dos de `portalUser.js`
y el sync de formación).

Rotar pasa a ser: poner el nuevo delante y desplegar, cambiar WordPress con
calma, y quitar el viejo en el siguiente despliegue.

*Cómo se comprobó*: 14 asertos en local firmando tokens con cada secreto. Vale
el nuevo, vale el viejo, se firma con el primero, se rechaza uno que no está en
la lista, se rechaza un token de otro cliente, y una lista vacía da
`SSO_SECRET_MISSING` en vez de colarse. **El importante es el primero: el
formato de siempre —un string suelto— sigue funcionando igual**, así que
`.env.production` no hay que tocarlo el día del despliegue.
*Falta*: que el portal «Mis citas» de nutri_laura, que es el único con secreto
configurado, siga abriendo después del despliegue.
*Dónde*: `lib/citas/ssoToken.js` y `lib/formularios/registroWeb.js`.

### El Registro se puede mirar por cliente · interno

`/admin/tablero` agrupaba solo por prioridad, y la pregunta que se hace al
descolgar el teléfono —«¿cómo vamos con Aumenta?»— se contestaba escribiendo el
slug en el filtro y confiando en que estuviera bien puesto en todas las tareas.

Lo que costó no fue agrupar: fue poder hacerlo sin mentir. El troceador devolvía
el destinatario como una CADENA, así que «demo, aumenta, salamandra_solutions»
formaba un grupo propio de una sola tarea y **Aumenta enseñaba 7 de sus 10**. Un
tablero que miente por poco es peor que uno que no agrupa, porque nadie lo
comprueba. Ahora el endpoint devuelve además `quienes`, ya troceado en nombres
conocidos, y una tarea compartida aparece en todos sus grupos.

Los nombres se buscan SUELTOS dentro de la cola y **no partiendo por comas**: hay
colas escritas a mano como `· nutri_laura (y todos con citas)` que partidas por
comas inventan un cliente que no cae en ningún grupo. Se añadió
`salamandra_solutions` a la lista, que no estaba, y `varios`.

⚠️ Contrastar los grupos con un `grep` del fichero vale para los SLUGS y no para
`todos`, `producto`, `interno` ni `varios`: son palabras corrientes y aparecen
dentro del texto de algún título. Si algún día no cuadran en una de esas cuatro,
el que se equivoca es el grep.

*Cómo se comprobó*: sacando `backlog.md` y `resuelto.md` **de dentro del
contenedor de producción** y pasándoles los dos troceadores, el desplegado y el
nuevo. Sobre el backlog los dos dan 5 secciones y 27 tareas con títulos, cuerpos
y `quien` **idénticos** —o sea, el cambio no toca nada de lo que ya se ve—, y el
nuevo añade 10 grupos, con Aumenta en 10 y cero tareas sin grupo. Sobre
`resuelto.md` aparece una sola diferencia, y es el arreglo: «Cosas menores que se
cerraron de la misma pasada · varios» dejaba de tener cliente y ahora lo tiene.
*Falta*: ver el interruptor «Agrupar por» funcionando. No se pudo abrir la
pantalla: exige el módulo `provisioning` y la sesión de producción no llegó.
*Dónde*: `app/api/admin/tablero/route.js` y `app/admin/tablero/page.jsx`.

### El Registro ya no sale vacío en Windows · interno

El troceador partía los ficheros por `"\n"` y luego buscaba `/^##\s+(.+)$/`. En
JavaScript el `.` no casa con `\r`, así que en una copia de trabajo con finales
de línea de Windows **ninguna cabecera casaba**: cero secciones, cero tareas, y
la pantalla decía «Nada por aquí» — exactamente lo contrario de la verdad.

Solo lo veía quien desarrolla en Windows, y solo en local: `core.autocrlf=true`
deja LF en el repositorio y en el contenedor no hay ni un `\r`. Despistaba el
doble porque `resuelto.md` sí estaba en LF y la pestaña de al lado se veía bien,
con lo que el fallo parecía de los datos y no del código.

El arreglo es partir por `/\r?\n/`, y va en el CORTE y no en aflojar los regex:
así se limpian a la vez las cabeceras y los cuerpos, que también arrastraban un
`\r` por línea porque `join("\n").trim()` solo toca los extremos.

*Cómo se comprobó*: ejecutando el troceador real —el del fichero, no una copia—
sobre el `docs/backlog.md` de la copia de trabajo, con sus 805 caracteres `\r`.
Antes: 0 secciones y 0 tareas. Después: 5 y 27, con todos los clientes resueltos
y ningún `\r` dentro de los cuerpos.
*En producción no se daba y se comprobó también*: los dos ficheros del
contenedor tienen 0 caracteres `\r`, así que allí la salida es idéntica byte a
byte antes y después.
*Dónde*: `app/api/admin/tablero/route.js`, la línea del `split`.

---

## 11/08/2026

### Dar de alta a un cliente ejecutaba migraciones sobre los schemas de todos los demás · producto

`ensure-tenant-schema.js <slug>` prometía poner al día el schema de ESE cliente,
y usaba el slug solo para elegir QUÉ migraciones correr. Luego las lanzaba con
`spawnSync(process.execPath, [file])` —**sin un solo argumento**—, así que cada
migración decidía su propio alcance, y noventa y una de las noventa y dos
decidían «todos los clientes activos». Dar de alta a un cliente nuevo entraba en
el schema de Aumenta, con 12.030 citas y quince personas trabajando dentro.

El código lo sabía y lo daba por bueno: la cabecera del disparador decía que las
migraciones «recorren por dentro todos los tenants, así que ejecutarlas de más
es inofensivo». Lo primero era cierto y lo segundo no.

**Qué se hizo.** Cada hija se lanza ahora con `ONLY_SCHEMAS=crm_<slug>`, que no
es una variable nueva: es la que `_schema-targets.js` ya entendía en modo
exclusivo, reutilizada para que no haya dos formas de decir lo mismo. El
ayudante `scripts/_solo-este-tenant.js` la aplica, y **sin la variable devuelve
la lista intacta**, así que una migración lanzada a mano sigue siendo global,
que es como se escribieron y como tienen que seguir funcionando.

Hubo que barrer tres veces, y las tres hicieron falta:

1. Las 31 que consultan `master.tenants`.
2. Un segundo patrón que se había escapado entero —24 que enumeran schemas desde
   el catálogo de PostgreSQL (`information_schema.schemata LIKE 'crm_%'`)—, y
   ahí estaba justo la que reventaba.
3. Una última, `migrate-stage-to-string.js`, que hardcodeaba cinco slugs. Salió
   al auditar las 92 una por una para poder responder «¿me lo garantizas?». No
   escribía nada porque las nueve columnas `stage` ya eran VARCHAR, pero eso era
   el estado de ese día y no una garantía; y a los cuatro clientes posteriores a
   esa lista no les hacía nada. Ahora lee de `master.tenants` (regla 12).

**Dos fallos vecinos que salieron con él.** Un alta que fallaba a mitad dejaba
el cliente `active` sin schema, y como media docena de migraciones enumeran «los
activos», eso rompía TODAS las altas siguientes: en la prueba en local, seis de
siete. Ahora queda `suspended`. Y el aviso de fallo mentía por exceso —decía «no
se pudieron aplicar las migraciones» cuando había fallado UNA de 55—, así que
ahora dice cuántas, de cuántas y cuáles.

*Cómo se comprobó*: **con un alta real en producción**, el 11/08 a las 16:28.

- Antes, huella de los 10 schemas más `master`: por cada uno, número de tablas,
  de columnas, filas totales, un md5 de toda la estructura (tabla, columna,
  tipo, nullabilidad y default) y otro de los recuentos por tabla.
- Se creó «Prueba de huella» (`zzz_prueba_huella`) desde `/admin/clientes` con
  **20 módulos**, los mismos que Demo, el cliente más cargado que hay. Salió
  bien: 101 tablas, 20 módulos, 1 usuario, y las series `F` y `R` de facturación
  sembradas, que es la señal de que las migraciones corrieron de verdad.
- Después, misma huella: **los 10 schemas con estructura Y filas idénticas**.
  Lo único que se movió fue `master`, +23 filas, que se descomponen exactamente
  en 1 tenant + 1 usuario + 20 módulos + 1 línea de auditoría. Cada fila nueva
  de toda la base de datos era del cliente nuevo.
- Se retiró con `scripts/borrar-tenant.js` y se purgó. Huella final contra la
  del principio: **todo idéntico**, salvo `master` con +2 filas — las dos de
  auditoría, `provisioning.cliente_creado` y `provisioning.cliente_baja`, que
  por regla no se borran nunca.

**Y una cola, que es la parte que más enseña.** Jorge preguntó lo evidente:
«mira también los datos, a ver si no han cambiado». Tenía razón en la pega —
la huella comparaba **recuentos** de filas, y un `UPDATE` no cambia cuántas
hay. Varios de esos scripts son `backfill-*`, que hacen exactamente eso.

Se resolvió hacia atrás con el `xmin` de cada fila —la transacción que la
escribió por última vez, sea INSERT o UPDATE—, tomando como referencia la
propia línea de auditoría del alta (transacción 35133). Barriendo TODAS las
tablas de TODOS los schemas apareció una que no encajaba:
**`master.tenant_modules` de `nutri_laura`/`citas`, reescrita a las 16:28:41**,
trece segundos después de empezar el alta y sin línea de auditoría.

Era la Fase B de `migrate-booking-pending.js`: escribía
`feature_flags.autoConfirmPublicBookings = false` en el módulo `citas` de
Laura **con el slug a mano**, corriera quien corriera. La Fase A sí estaba
acotada (usa `byTable`, que respeta ONLY_SCHEMAS); la B no.

El valor no cambió —la migración fuerza `false` y ya estaba en `false`—, pero
el efecto real es peor que un UPDATE de más: **ese interruptor era imposible de
encender**. Si Laura activaba la autoconfirmación de reservas públicas, la
siguiente alta de cualquier otro cliente se la apagaba, en silencio y sin
rastro. Arreglado: la Fase B se omite si el alcance pedido no la incluye.

Se re-auditaron las 92 con ese criterio nuevo —slug escrito a mano **y**
escritura— y aparecieron otros dos candidatos, los dos falsos:
`migrate-client-module-assignments` compara el slug dentro del bucle ya
acotado, y en `migrate-contrato-estructurado` los slugs solo salen en un
comentario. La lección queda: contar filas no basta, y «0 sin acotar» solo
respondía por las enumeraciones de schemas, no por las escrituras en `master`
con destinatario fijo.

Se reproduce con `scripts/huella-schemas.sql` (en el repo desde este commit):
tomarla, dar de alta, volver a tomarla y comparar la columna del md5 de
estructura. Si se mueve en un schema que no sea el del cliente nuevo, ha vuelto.

*Dónde estaba*: `scripts/ensure-tenant-schema.js` (el spawn sin argumentos),
`scripts/_solo-este-tenant.js` (nuevo) y las 55 migraciones acotadas.
Commits `481178a`, `032b4fe` y `271fa80`.

---

## 10/08/2026

### Dos pacientes con el pago a plazos sin freno, y el programa sin precio · `nutri_laura`

Entró como «una paciente no puede pagar el Acompañamiento mensual» y acabó
siendo otra cosa bastante peor.

**Lo que se veía.** El programa (6 sesiones) se había quedado sin precio: la
auditoría enseña que el 07/08 a las 13:34 se guardó el tipo de cita con los tres
campos en blanco, y de paso lo mismo en «Sesión de seguimiento» y «Prueba 1€».
Un bono sin ningún precio no se puede comprar, así que el widget para al final
del formulario. El mensaje —«Esta forma de pago no está disponible para este
programa»— hablaba de la forma de pago cuando lo que faltaba era el precio, y
por eso la paciente entendió que era culpa de su tarjeta. Tampoco le apareció el
selector de pago: solo se pinta si hay cuota configurada.

**Lo que había detrás.** Las DOS suscripciones a plazos vendidas el 07/08
estaban vivas en el Stripe real de Laura **sin tope de cuotas**: calendario en
`end_behavior: release` y una sola fase. Una es de 130 €/mes de una paciente que
aceptó pagar tres veces.

**La causa real no fue la que parecía.** El primer diagnóstico —un fallo
pasajero de red al poner el tope— era falso, y también lo era culpar a
`sesionDeFactura` (se comprobó contra las dos facturas reales: identifica bien).
La causa salió al ejecutar el arreglo y RELEER de Stripe en vez de dar la
llamada por buena: `ponerTopeDeCuotas` pedía la segunda fase con `iterations`, y
la versión de API que tenemos clavada responde «Received unknown parameter:
phases[iterations]» y rechaza el update entero. Esa llamada **no había
funcionado nunca**. Y la salida temprana «si ya hay calendario, no hagas nada»
lo volvía permanente: ningún reintento lo tocaba.

**Qué se hizo.** La fase se mide ahora con `duration`, tomando el intervalo del
precio de la suscripción y no dando por hecho «mes». El guard comprueba el TOPE
en vez de la existencia del calendario. Comprar un bono deja de usar el reloj de
20 min de la retención y pasa a `HOLD_WINDOW_MS` (45), porque la página de
Stripe acepta el pago 31 y en esa franja el hueco ya estaba libre: quien tardara
pagaba y se quedaba sin cita y sin bono. Y a las dos suscripciones se les puso
el tope / se cancelaron.

*Cómo se comprobó*: 10/08/2026, y por tres caminos.
(1) Objeto crudo de Stripe: `sub_1U1lY0…` con `end_behavior: cancel`, fase 0
(07/08→07/09) + fase 1 (07/09→07/11), o sea tres cuotas y para; la de prueba de
1 €, cancelada.
(2) Compra REAL de 1 € desde el widget (Jorge, cuenta de portal propia): la
suscripción nueva nació con el tope **sola** —fase 0 + fase 1, `cancel`—, el
bono de 3 sesiones se creó, la cita quedó como sesión 1 y se cobró 1,00 € y no
los 3,00 € del total.
(3) `scripts/_smoke-fraccionado-reloj.mjs` con un reloj de prueba de Stripe:
cobra las cuotas 2 y 3, y en la 4ª no cobra nada y la suscripción se cancela
sola.
*Dónde*: `lib/payments/fraccionado.js`,
`app/api/public/c/[tenantSlug]/book/route.js:649`,
`scripts/arreglar-suscripciones-sin-tope.js`. Commits `b760bc7`, `88a6c05`,
`cc7a40e`, `db389a6`.

### «Prueba 1 euro» está a la venta · `nutri_laura`

Venía del backlog (P0). Tipo de cita visible en la agenda pública, a 3 €, con
tráfico entrando desde Instagram — y encima sin precio desde el 07/08, así que
quien lo eligiera se llevaba el mismo error que la paciente del programa.

Se le devolvió su precio (3 € / 1 € × 3) para poder probar el fraccionado con
tres euros en vez de con una paciente, y se OCULTÓ. Oculto significa que solo lo
ve quien tenga un bono activo de ese tipo, que es como Laura asigna cosas a
dedo.

*Cómo se comprobó*: 10/08/2026 —
`GET /api/public/c/nutri_laura/event-types` devuelve Valoración inicial,
Acompañamiento mensual y Supervisión profesional, y nada más.

### Los scripts que borran datos reales ya llevan seguro · producto

Era el P0 del registro y llevaba desde el 07/08 hecho en local y sin desplegar.
En el contenedor de producción no existía `_guard-datos-reales.js`, así que los
`clear-*` y los `seed-*` corrían sin freno: cualquiera que lanzase uno dentro
del contenedor —creyendo estar en local, que es como pasa siempre— se llevaba
por delante los datos de Aumenta o de Abarcaia. `seed-clinica-demo.js` empieza
con un `destroy({where:{}})` sobre pacientes, sesiones e informes, y su propia
cabecera enseñaba a lanzarlo contra `aumenta` con el slug ya escrito.

El guard pregunta por el TENANT y no por el entorno, porque mirar la
`DATABASE_URL` no sirve: dentro del contenedor apunta al host `db` de Docker y
no dice «prod» por ningún lado. Y enumera los tenants DE PRUEBA —cuatro, y no
cambian— en vez de los reales, que crecen cada vez que se firma a alguien. Así
el cliente que demos de alta mañana queda protegido hoy sin tocar nada.

De paso, `.gitignore` deja fuera `backups/`, `*.sql.gz` y `uploads/`: en el VPS
la carpeta de copias cuelga DENTRO del checkout, así que un `git clean -fd`
antes de un despliegue se las llevaba todas y un `git add -A` habría metido en
el historial los datos de salud de 1.083 familias.

*Cómo se comprobó*: 10/08/2026, tras desplegar `d68b4ce` —
`docker exec crm-salamandra-app-1 ls scripts/_guard-datos-reales.js` lo
encuentra, y los seis scripts peligrosos (`clear-aumenta-leads`,
`clear-abarcaia-leads`, `clear-quality-leads`, `seed-aumenta`, `seed-abarcaia`,
`seed-clinica-demo`) lo importan. La app quedó respondiendo 200 y sin errores.

### Abarcaia llevaba desde mayo sin poder registrar un solo lead · `abarcaia`, `quality_energy`, `retorika`

Lo encontró `check-module-tables.js` **a los cinco minutos de desplegarse**, que
es justo para lo que se hizo.

El sprint de Proyectos (05/05/2026) añadió `converted_project_id` y
`converted_to_project_at` al modelo `Lead`, que es único para todos los
clientes. Las columnas las creaba la migración de Proyectos, que filtra a
propósito por quien tiene ese módulo —para no reventar los CREATE TABLE con FK a
`projects.id`—. La decisión era correcta para las tablas de proyectos, pero se
llevó por delante dos columnas que son de LEADS y que Sequelize lee en toda
consulta de leads, tenga o no ese cliente Proyectos.

Abarcaia es un programa de referidos con formulario público que hace
`Lead.create()`. Su último lead es del **20/04**, quince días antes de que el
modelo cambiara: **todo lo que entró por ese formulario en tres meses se perdió**
sin que saltara nada.

Se arregló con un script propio y no con la migración de Proyectos, que en estos
clientes habría creado cinco tablas y hecho DROP+ADD sobre `tasks` para alguien
que no ha comprado el módulo. Dos columnas anulables, sin FK —esa FK es justo lo
que abrió el agujero—, transacción por cliente e idempotente.

*Cómo se comprobó*: antes, `Lead.count()` en los tres moría con «column
converted_project_id does not exist». Después, los tres leen: abarcaia 84 leads,
quality_energy 129, retorika 1. Y `check-module-tables.js` pasa de 3 fallos a 0.
*Commit*: `86801ad`.

### Nada comprobaba que un módulo activo tuviera sus tablas · producto

Era el chequeo que faltaba, y el primero que encontró algo de verdad (la entrada
de arriba). Los cuatro que había miran accesos, registros huérfanos y el orden
de las migraciones; ninguno miraba si las tablas que un módulo NECESITA existen
en el schema de quien lo tiene encendido, que es el fallo que ya había mordido.

`npm run db:check-tables`, solo lectura. Lee los clientes de `master.tenants` y
además se audita a sí mismo: comprueba que su mapa cubre los 101 modelos de
`models/tenant/` y todas las tablas que crean las migraciones.

Separa fallo de aviso: si el código atrapa el 42P01 y sigue —como hace la ficha
de cliente con `interactions`— es aviso, no error. Sin esa distinción,
nutri_laura salía en rojo estando perfecta.

*Cómo se comprobó*: lanzado en producción. Encontró 3 fallos reales en 3
clientes y 10 avisos de pantallas secundarias.
*Commit*: `af0992d`.

### Los correos de citas ya no llevan texto sin escapar · todos

El motivo de cancelación lo teclea la profesional y salía crudo dentro del HTML
que se le manda al paciente. Igual el nombre del servicio, el enlace de
videollamada y la ubicación de la consulta, algunos **dentro de un `href`**,
donde unas comillas se salen del atributo y lo que venga detrás ya es marcado.
Cinco plantillas.

Las versiones de TEXTO PLANO se quedan sin escapar a propósito: ahí no hay HTML
que romper y un `&amp;` se leería con las letras.

*Cómo se comprobó*: `escapeHtml` presente en las cinco plantillas del `lib/` que
corre en el contenedor.
*Commit*: `af0992d`.

### El CRM ya no acusa al banco de un cobro que nunca llegó al banco · todos

`paymentStatus: 'failed'` lo escriben dos caminos que no se parecen en nada: el
banco rechaza de verdad la captura, o el checkout caducó sin pagarse. La
pantalla elegía siempre el primero, y a una clienta de Laura se le pudo decir
que su banco había fallado siendo falso.

Ahora lee el motivo que ya estaba guardado en la cita y compara con los literales
exactos que escribe nuestro propio código. Si no lo reconoce, texto neutro: al
banco no se le culpa por defecto.

*Cómo se comprobó*: los dos literales existen tal cual en
`lib/payments/entityHooks.js:116` y `:137`. Desplegado.
*Commit*: `af0992d`.

### Laura deja de ver un bloque de Facturación que no ha comprado · `nutri_laura`

En la ficha de cualquiera de su equipo salía «Facturación · 0,00 €». El endpoint
cortaba con `!hasModule("team") && !hasModule("billing")` —una **Y** que con
Equipo encendido no cortaba nunca— y respondía 200 con ceros, porque el alta de
un cliente hace `sync()` de todos los modelos y las tablas de facturas existen
vacías en cualquier schema. El componente solo se escondía con un 403 que nunca
llegaba.

Ahora gatea por el módulo de destino, como su vecino `/api/team/[id]/projects`,
que ya estaba bien hecho.

*Cómo se comprobó*: el texto «Módulo billing no activo» está en el código
servido y el AND viejo ya no aparece en ningún chunk.
*Commit*: `af0992d`.

### Dos botones llevaban a un módulo que el cliente no ha comprado · `healim`, `nutri_laura`

«Citas → Sin profesional» no exigía ningún módulo, y Healim —que tiene agenda y
no equipo— llegaba a una pantalla cuyo único uso es asignar la cita a alguien
que no puede existir. Y las dos tarjetas fijas de «Mi espacio» no comprobaban
nada. Cerrados **en el servidor** con `notFound()`, como la lista de espera de
admisión: esconderlos del menú no basta, con la URL guardada se sigue entrando.

*Cómo se comprobó*: desplegado, con la puerta nueva en
`app/(dashboard)/citas/sin-profesional/layout.jsx`.
*Commit*: `af0992d`.

### Dos administradores no veían un módulo que su cliente paga · `retorika`, `spain_enzymes`

`admin@retorika.es` no veía `leads` y `admin@spain-enzymes.salamandra` no veía
`clients`. El fallo de las dos puertas por tercera vez: el cliente lo tiene
contratado y su `module_access` no lo lista. Se arregló con `--skip-schema`, que
era lo mínimo: los módulos ya estaban activos y sus tablas existían.

*Cómo se comprobó*: `check-module-access.js` en producción ya no marca ningún
✗ de admin (los 14 usuarios no admin que quedan son decisión de negocio).

### CLAUDE.md deja de listar los módulos de cada cliente · documentación

La tabla mentía en **5 de los 8 clientes** y le faltaban `healim` y
`salamandra_solutions` enteros. De ahí salieron dos tareas falsas del backlog el
mismo día. No es que nadie la actualizara: una lista copiada a mano de algo que
cambia cada semana siempre acaba mintiendo, y ahí mentía en silencio.

Ahora remite a `/admin/modulos` y se queda solo con lo que la base de datos no
sabe: quién es cada cliente y qué no se le puede tocar.

*Cómo se comprobó*: la tabla ya no tiene columna de módulos.
*Commit*: `af0992d`.

### Cosas menores que se cerraron de la misma pasada · varios

- **`analytics` ya se puede vender**: faltaba en el catálogo de alta, así que
  había que activarlo a mano en la base de datos. Su migración ya estaba
  registrada, comprobado antes de añadirlo: el alta sabrá crearle la tabla.
- **La cabecera de Equipo ya no dice siempre «0 inactivos»**: contaba sobre la
  página ya filtrada y el filtro por defecto los excluye.
- **El KPI «Con ficha creada»** ya no se pinta clavado a 0 en quien no tiene
  Clientes.
- **Borrado `/comercial/leads`**: código al que no llegaba nadie, con textos de
  una campaña de Retorika escritos a mano.
- **`modules/leads/LeadsModule`** deja de inventarse las etiquetas de etapa
  («Cualificado / Ganado / Perdido») y las lee de `lib/leads/stages.js`, que es
  la fuente única.
- **El backlog se llama «Registro»** en el back-office, a petición de Jorge. La
  ruta sigue en `/admin/tablero` para no romper marcadores.

*Commits*: `af0992d`, `86801ad`.

---

## 08/08/2026

### El cobro con tarjeta funciona de verdad · `nutri_laura`

Estaba pendiente desde que se montó: el código llevaba semanas escrito y probado
en local y contra Stripe de pruebas, pero ninguna tarjeta real había recorrido
el flujo entero. Ya lo ha hecho.

*Cómo se comprobó*: en producción, dos pagos completados el 07/08 — la prueba de
1 € de Rodrigo a las 10:19 y, cuarenta minutos después, **130 € cobrados de
verdad a una paciente**. Las dos citas quedaron `confirmed` y `paid`, con su
sesión de pago en `paid` y su fecha de cobro.

### El equipo ya no ve el dinero de las citas · `nutri_laura` (y todos con `citas`)

Laura se quejó de que su empleada veía en la agenda el chip «No se pudo cobrar ·
360,00 €» de una clienta. Se cortó en el SERVIDOR, no en la pantalla: el precio
de los tipos de cita ya se escondía en la interfaz desde el 06/08 y el endpoint
lo seguía devolviendo, así que la tarifa entera estaba a un clic derecho.

Un solo `lib/citas/dinero.js` decide qué es dinero y lo aplican los seis puntos
de salida. Se quitan importes y estado de cobro; Laura lo sigue viendo todo.
Quién puede confirmar una cita no cambia.

*Cómo se comprobó*: llamando a los endpoints en producción con la cuenta real de
la empleada. Antes le llegaban las 9 tarifas y las 15 citas con importe; después,
ninguna. Y en el navegador, con las dos sesiones: ella ve la solicitud entera sin
el chip, Laura la ve con sus botones de cobro.
*Commits*: `89e735e`, `6c1bae0`, `e0bb7af`.

### Pantalla de módulos y personalizaciones · interno

No se podía saber qué tenía contratado cada cliente sin abrir la base de datos:
CLAUDE.md decía que Aumenta tenía 13 módulos, local 12, los docs del sprint ~17
y en realidad eran 20. Nueva pestaña en el back-office, en tabla, con filtro por
módulo y una columna que separa los cuatro tipos de personalización según lo que
cuesta mantener cada uno.

*Cómo se comprobó*: abierta en el navegador con sesión de back-office; sale la
tabla con los 8 clientes y sus personalizaciones. En producción, `/admin/modulos`
responde y el endpoint está en el código desplegado.
*Commit*: `483de53`.

### La portada enseña el trabajo del cliente · todos

Aumenta —centro de psicología, 20 módulos, quince personas— abría el CRM cada
mañana sin atajo a Pacientes ni a Clínica, y con uno a «Inventario · Materia
prima y producto». Y con una tarjeta de «0 pedidos» todos los días.

Los accesos rápidos eran una lista escrita a mano paralela al menú, que se quedó
en los nueve de la primera versión. Ahora están los clínicos, equipo,
solicitudes, documentos y soporte. Y un bloque del resumen sin nada que contar ya
no se pinta: tener un módulo encendido no es usarlo.

*Cómo se comprobó*: en el navegador con el tenant de Aumenta — Citas, Pacientes
y Clínica encabezan los accesos y los bloques vacíos desaparecen. En producción,
el código desplegado tiene el atajo a `pacientes` y ya no tiene `sales`.
*Commit*: `faf77fc`.

### El correo de Aumenta funciona · `aumenta`

Era el bloqueo de todo: sin correo no se puede dar de alta a una familia, porque
el alta se hace mandando un enlace. Cuenta de Resend creada, dominio verificado
con DKIM y SPF (el CNAME de rastreo se dejó fuera a propósito: no se quieren
rastrear clics de pacientes), y clave y remitente puestos en el CRM.

*Cómo se comprobó*: dos correos enviados desde producción con la misma tubería
que usan las citas, a `info@salamandrasolutions.com` (id `060ac459…`) y a
`jsanchezpla@gmail.com` (id `e1b0f53e…`). Los dos salieron.

### El portal de citas de Aumenta, montado · `aumenta`

Secreto SSO generado y cargado, y las URLs del portal y del acceso configuradas
(`/mi-espacio/` y `wp-login.php`). El tema de su WordPress ya estaba bien: firma
un JWT HS256 con los mismos campos que espera el CRM.

*Cómo se comprobó*: firmando en producción un pase exactamente como lo firma
`aumenta-portal.php` y pasándolo por el verificador real — aceptado. Y un pase
firmado con otro secreto, rechazado. Las dos páginas del widget responden.

### Rotado el secreto SSO de Laura · `nutri_laura`

Se expuso en un chat por un error mío al enmascararlo. Se rotó de forma
coordinada con el `wp-config.php` de su web para que el corte durase segundos.

*Cómo se comprobó*: el CRM usa el secreto nuevo y un pase firmado con él se
acepta; el portal de Laura sigue dejando entrar.

### Borrado el rastro de pruebas en el cliente de Laura · `nutri_laura`

Dos filas de una cuenta de pruebas —una solicitud del formulario y un usuario de
formación— en la base de datos de una clienta real. Borradas en una transacción,
con respaldo previo. No se tocó ni la cuenta de acceso ni la auditoría.

*Cómo se comprobó*: volviendo a buscar ese correo en los 20 sitios donde podía
estar. Cero filas.

---

## 06–07/08/2026

### Botones de ayuda «?» en todo el CRM · todos

53 globos en unas 76 pantallas. Explican lo que sorprende de verdad la primera
vez, sacado de leer los endpoints: que el trimestre del IVA es el en curso y no
el que se declara; que «Compartidos» no es lo que sube el equipo sino el archivo
central, y borrar ahí borra también de la ficha; que el aviso de SLA ignora los
filtros; que marcar «Inactivo» borra el usuario del CRM.

Lo que costó fue no escribir de más: Facturación salió con 44 y hubo que quitar
24. Con el criterio dado de entrada, Equipo salió a una por pantalla y a la
primera. El detalle y los ocho bugs que aparecieron de camino están al final de
`runbook-ayudas-crm.md`.

*Cómo se comprobó*: recuento de `<HelpTooltip>` por módulo, lint y build en
verde, y desplegado.

### A la primera visita solo se llega por el formulario · `nutri_laura`

La valoración inicial se había quedado sin ninguna puerta: no firma contrato
(por diseño), no pasa por caja cuando es gratis, y lo único que quedaba era el
«una sola vez por persona», que cruza por un correo que escribe quien manda la
petición. Puerta propia, apagada de fábrica, que solo aplica a la primera visita
para no cerrarle la agenda al paciente de siempre.

*Cómo se comprobó*: 12 comprobaciones automáticas, incluida la que asegura que
un seguimiento sigue reservándose sin formulario. Encendida en producción.

### El DNI se pide una vez y llega a la ficha · `nutri_laura`

Campo en el formulario de primer contacto que aterriza en la ficha, para no
volver a pedirlo al firmar el contrato. Es el DNI de quien firma —el paciente
puede ser menor— y no es obligatorio: la puerta de entrada no es sitio para un
trámite.

*Cómo se comprobó*: 10 comprobaciones de punta a punta contra el endpoint real,
y el campo servido por el formulario público en producción.
