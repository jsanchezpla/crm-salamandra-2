# Resuelto

Lo que ya está hecho, de quién era, cuándo se cerró y cómo se comprobó.

Existe por dos motivos. Uno, para no volver a arreglar lo mismo: cuando algo
reaparece, aquí está qué se hizo la vez anterior y por qué. Y dos, para poder
mirar atrás y ver qué se ha entregado a cada cliente sin reconstruirlo del
historial de git.

---

## Cómo se usa esto

**Nada entra aquí sin haberse comprobado contra PRODUCCIÓN.** No basta con que
el código esté subido, ni con que el despliegue haya terminado: hay que ver el
comportamiento nuevo funcionando en el VPS. Si no se puede comprobar, no se
cierra — se queda en el backlog con una nota de qué se intentó.

Cada entrada lleva **cómo se comprobó**, no solo que se comprobó. Esa línea es
la que permite repetir la verificación dentro de seis meses.

Cuando una tarea sale de `backlog.md`, entra aquí **en el mismo commit**. Así no
hay un momento en que algo no esté en ninguno de los dos ficheros.

Lo más reciente arriba.

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
