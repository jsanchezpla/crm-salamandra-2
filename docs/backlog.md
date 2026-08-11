# Backlog

Lo que hay que hacer, para quién y con qué urgencia. Se mira aquí antes de
decidir en qué trabajar.

---

## Cómo se usa esto

**Para Jorge y Rodrigo.** Cada tarea dice de qué cliente es y qué pasa si no se
hace. Si algo no está aquí, no está acordado: se añade y se prioriza.

**Para Claude.** Cuando encuentres algo que merezca arreglarse y no vayas a
hacerlo en el momento, apúntalo aquí en vez de contarlo solo en el chat — un
hallazgo que solo vive en una conversación se pierde.

⚠️ **NADA se añade ni se quita sin comprobarlo antes contra PRODUCCIÓN.** Las dos
direcciones, y por el mismo motivo:

- **Antes de añadir**: que el problema pase de verdad en el VPS, no en local.
  Local y producción divergen mucho —Aumenta tiene 12 módulos en local y 20 en
  producción, 15 citas frente a 12.030—, así que un fallo que se ve aquí puede
  no existir allí, y al revés. Una tarea falsa hace perder una tarde.
- **Antes de quitar**: que el arreglo funcione en el VPS. No basta con que el
  código esté subido ni con que el despliegue haya terminado: hay que ver el
  comportamiento nuevo. Si no se puede comprobar, la tarea se queda con una nota
  de qué se intentó.

Lo que se cierra pasa a `resuelto.md` **en el mismo commit**, con cómo se
comprobó. Así no hay un momento en que algo no esté en ninguno de los dos.

### Cada tarea lleva su sello

La última línea de cada una dice **cuándo se comprobó contra producción y qué
salió**. Sin sello, la tarea no vale: puede llevar meses arreglada.

Ese sello nació de una tarea falsa. En el repaso del 09/08 había escrita una que
decía «el cobro con tarjeta no se ha completado nunca» — y en producción había
**dos pagos hechos**, uno de 130 € de una paciente real. Se había escrito con
datos de la víspera y nadie la volvió a mirar. De la misma pasada salieron otras
cuatro con el cliente equivocado. **Escribir la tarea y comprobarla son el mismo
acto**: una tarea sin comprobar no es un aviso, es ruido que alguien va a creerse.

Cuando lo que se comprueba es que el problema **ya no pasa**, la tarea no se
edita: se mueve a `resuelto.md`.

### Cómo se añade una tarea

Con estos datos y nada más:

- **Qué pasa hoy**, no qué hay que programar. «El aviso de SLA cuenta tickets
  que no se ven» se entiende dentro de seis meses; «arreglar contador» no.
- **De quién es**: el slug del cliente, o «todos» si es del producto. Comprobado
  contra la base de datos, no contra CLAUDE.md — que se desactualiza.
- **Prioridad** (abajo se explican).
- **Cómo se comprueba que está resuelto.** Sin esto no se puede cerrar sin
  fiarse de alguien.
- **Dónde está**, con fichero y línea si se sabe.
- **El sello de comprobación**, con fecha.

### Cómo se quita

Solo cuando **se ha comprobado contra producción**, no cuando el código está
subido. Se borra la tarea entera; el historial vive en git, no aquí. Si al
comprobarlo resulta que sigue pasando, se queda y se actualiza el sello.

### Prioridades

| | Qué significa |
| --- | --- |
| **P0** | Está pasando ahora y cuesta dinero, clientes o datos. Se hace hoy. |
| **P1** | Un cliente se lo va a encontrar esta semana, o bloquea algo suyo. |
| **P2** | Mejora clara, sin fecha. |
| **P3** | Deuda o limpieza. Se hace cuando se toque esa zona. Aquí van también los fallos reales que **hoy nadie puede ver** porque en producción no se da el caso. |

---

## P0 — hoy

### El acceso SSH al VPS admite contraseña de root · producto

`sshd -T` en el VPS responde `permitrootlogin yes` y `passwordauthentication
yes`. El `PasswordAuthentication no` que hay escrito en `/etc/ssh/sshd_config`
**está muerto**: el `Include /etc/ssh/sshd_config.d/*.conf` de la línea 12 va
ANTES, y en la configuración de sshd gana el primer valor, así que
`50-cloud-init.conf` —que dice `yes`— lo tapa. Y ese fichero lo reescribe
cloud-init, con lo que arreglarlo a mano en el fichero grande no aguanta.

Es una máquina con datos de salud de 1.083 familias y con root abierto a
contraseña desde internet. Las claves públicas de los cuatro que entramos ya
están puestas, así que cerrarlo no deja a nadie fuera.

*Se comprueba*: `sshd -T | grep -E "passwordauthentication|permitrootlogin"`
devuelve `no` y `prohibit-password`, y los cuatro seguimos entrando.
*Dónde*: `/etc/ssh/sshd_config.d/50-cloud-init.conf` (o uno propio con número
más alto, que es lo que aguanta a cloud-init).
*Comprobado en producción*: 10/08/2026 — `passwordauthentication yes` efectivo.

### Ocho familias admitidas no pueden pedir cita · `nutri_laura`

La puerta del formulario está encendida y exige, además de la solicitud
aceptada, que exista una ficha con ese correo. **8 de las 13 aceptadas no la
tienen**: Laura ya les dijo que sí y la agenda las rechaza con un 403. No se
entera nadie, ni ellas ni Laura.

Salió del commit `db974a2` (Rodrigo, 06/08). Tres salidas y hay que elegir:
crearles la ficha, aflojar la condición, o que el 403 avise a Laura.

*Se comprueba*: `SELECT count(*) FROM crm_nutri_laura.form_submissions f WHERE
f.status='accepted' AND NOT EXISTS (SELECT 1 FROM crm_nutri_laura.clients c
WHERE lower(c.email)=lower(f.email))` → 0, o que reservar con uno de esos
correos devuelva 201.
*Dónde*: `lib/citas/puertaFormulario.js:98-105`.
*Comprobado en producción*: 09/08/2026 — **siguen siendo 8**.

---

## P1 — esta semana

### «Reorganizar con IA» se rompe justo al aplicar los cambios · `demo`, `aumenta`, `salamandra_solutions`

El modal propone los cambios, el usuario desmarca los que no quiere y al pulsar
«Aplicar cambios» el navegador pide `POST /api/projects/[id]/ai/apply` — **un
endpoint que no se escribió nunca**. No es que se rompiera: no existe en ningún
commit del historial. Lo único que hay es su hermano `/ai/edit`, que es el paso
anterior, el que genera la propuesta.

Donde duele es en la **demo**, que es pública y es el escaparate. Allí la
propuesta se genera en modo simulado, **sin necesidad de clave de IA**, así que
cualquiera a quien se le esté enseñando el CRM llega hasta el último botón y se
come el error. En Aumenta no se llega tan lejos, pero por el motivo malo: el
paso anterior ya devuelve 503 porque no tienen clave.

Esto es la respuesta a «¿se metió al final la IA de proyectos?»: sí, entró
entera en el commit `0d474c7` (31/07) y está desplegada —«Crear con IA» funciona
de punta a punta—, pero la mitad de «Reorganizar» se quedó sin el último paso.
Ni `CLAUDE.md` ni `docs/modules/projects.md` la mencionan, así que la
documentación tampoco se enteró de que existe.

*Se comprueba*: pulsar «Aplicar cambios» en la demo aplica las operaciones en
vez de dar error.
*Dónde*: `components/projects/AiEditModal.jsx:89` es quien llama;
`app/api/projects/[id]/ai/edit/route.js` existe y falta el `apply` de al lado.
*Comprobado en producción*: 10/08/2026 — en el contenedor,
`.next/server/app/api/projects/[id]/ai/` solo contiene `edit`.

### «Pedirle otra tarjeta» no lleva a ninguna parte · todos

El aviso recomienda pedir otra tarjeta y el botón se pinta, pero el endpoint
responde 409: `failed` está dentro de `PUEDE_HABER_DINERO`, así que una tarjeta
rechazada cuenta como «ya hay dinero reservado». Si una tarjeta falla, no hay
salida: o reintentar o cancelar.

Ojo al arreglarlo: esa lista está deliberadamente de más —«preguntar a Stripe de
más es barato; darlo por perdido, no»—. La salida no es sacar `failed` de la
lista, es que el botón sepa distinguir.

*Se comprueba*: pulsarlo en una cita `failed` manda el correo en vez de dar 409.
*Dónde*: `app/api/citas/bookings/[id]/pedir-tarjeta/route.js:77-82` y
`lib/citas/cobroCita.js:37`.
*Comprobado en producción*: 09/08/2026 — `failed` sigue en la lista.

### Trece personas de Aumenta no ven módulos que el centro tiene · `aumenta`

Los usuarios normales no tienen acceso a `clients`, `documents`, `formularios`,
`team` ni una decena más. Puede ser deliberado —trabajan en Pacientes y
Clínica— o puede que nadie se lo diera al ampliar módulos entre el 27/07 y el
01/08. **Es una decisión de negocio, no un fallo**: hay que preguntarles.

Dos de las trece (`rosa_aumenta`, `olga_aumenta`) tienen `billing` y `documents`
y las otras once no, lo que sugiere que en algún momento sí se repartió a mano.

*Se comprueba*: preguntar a Aumenta y dejar la respuesta escrita aquí.
*Comprobado en producción*: 09/08/2026 — **son 13, no 11** como decía esta
tarea antes.

### El filtro de la agenda pinta 72 botones antes del calendario · `aumenta`

Aumenta tiene **57 tipos de cita activos y 15 personas**, y el filtro los pinta
todos como chips, en dos bandas apiladas encima del calendario. Cada banda se
parte en varias líneas y empuja la agenda hacia abajo: en un portátil se empieza
el día haciendo scroll para ver a qué hora es la primera cita. Lo sufre el
cliente que más usa el CRM y lo sufre cada mañana.

Jorge lo pidió el 10/08: que el filtro de cita sea un **desplegable**, y que los
dos —tipo y profesional— vayan **en paralelo**, en la misma línea, en vez de en
dos bandas.

⚠️ Los dos filtros son de selección MÚLTIPLE, y el de profesional tiene además
una regla que costó escribir: el primer clic aísla a esa persona, los siguientes
suman, y quedarse sin ninguna vuelve a enseñarlo todo. Su comentario explica por
qué —con quince profesionales, ir tachando catorce «no es un filtro, es un
castigo»—. Un `<select>` normal se lleva eso por delante: hace falta un
desplegable con casillas, o decidir a propósito que se pasa a selección única.

*Se comprueba*: en Aumenta se ve el calendario sin bajar, y se sigue pudiendo
filtrar por varios tipos a la vez.
*Dónde*: `modules/default/CitasModule.jsx:1246-1319` son las dos bandas;
`toggleEventType` y `toggleTeamMember` (`:608`) son la regla que hay que
respetar.
*Comprobado en producción*: 10/08/2026 — Aumenta, 57 tipos activos de 57 y 15
personas en el equipo. No lo sufre nadie más: nutri_laura tiene 6 tipos y demo 2.

---

## P2 — cuando se pueda

### El back-office sabe suspender a un cliente, pero no darlo de baja · producto

`/admin/clientes` deja crear, editar, cambiar marca, activar módulos y
**suspender**, y ahí se acaba. No hay forma de cerrar la cuenta de un cliente:
en todo el back-office (`app/api/admin/**` y `app/api/provisioning/**`) hay
**siete handlers y ni un solo `DELETE` ni `PUT`**. La cabecera del endpoint lo
dice —«No existe DELETE»—, igual que `lib/provisioning/cicloVida.js`: «un botón
que borra los datos de un cliente es un accidente esperando su turno».

Para el BORRADO esa decisión sigue siendo buena. El problema es que no hay nada
en medio: quien se va se queda suspendido y ya. En producción hay **dos así
desde el 08/08** —`quality_energy` (45 tablas, 1,4 MB) y `healim` (17 tablas,
760 kB)—, cada uno con su usuario y su schema enteros, escondidos del listado
tras el interruptor «ver los N suspendidos», y nada dice qué pasa con ellos.

Existe media pieza: `scripts/borrar-tenant.js` (11/08), **ya en git y desplegada
el 11/08**. Su idea es la correcta —APARTAR en vez de destruir: renombrar el
schema a `zzz_baja_<slug>_<fecha>`, borrar las filas de `master` y dejar un
`.rollback.sql`, con la destrucción real como segundo comando aparte—. Pero
**tal como está no se puede poner detrás de un botón**, y arreglarlo es el
trabajo de verdad de esta tarea:

- ~~**La purga no tiene ningún freno.**~~ **Arreglado el 11/08**, antes de subir
  el script, porque era un destructor de datos y no podía viajar así. `--purgar`
  ignoraba el slug posicional y el `--confirmo=`: recorría TODOS los schemas
  `zzz_baja_*` y les hacía `DROP ... CASCADE`, de modo que
  `borrar-tenant.js nutri_laura --purgar --aplicar` parecía tocar a un cliente y
  se llevaba a todos los apartados. El acto irreversible estaba PEOR protegido
  que el reversible. Ahora la purga se acota al slug y exige el mismo
  `--confirmo=`; llevarse los de todos los clientes de golpe hay que pedirlo con
  `--todos --confirmo=todos`. El acotado se hace filtrando por
  `^zzz_baja_<slug>_\d{14}$` **y no con un `LIKE`**, porque un slug puede ser
  prefijo de otro (`demo` se habría llevado por delante los apartados de
  `demo_golden`).
- **La red no sobrevive al despliegue.** El `.rollback.sql` se escribe en
  `/app/backups`, dentro del contenedor, y ahí el único volumen montado es
  `/app/uploads`. El siguiente `deploy.sh` se lo lleva. Además deja los
  `password_hash` en claro sobre disco.
- **Los ficheros se quedan.** El script no toca `uploads/` en ninguna línea, y
  los seis almacenes no comparten forma: tres ponen el slug primero y tres lo
  meten detrás del tipo (`documents/`, `support/`, `nutricion-recipes/`).
  Apartar el schema deja en disco los papeles del cliente, documentos de salud
  incluidos. Cómo hacerlo bien ya está resuelto a nivel de ficha en
  `lib/clients/borrarRastro.js`.
- **No es atómico ni avisa a la app.** El `ALTER SCHEMA` y los tres `DELETE` van
  sueltos, sin transacción: si el proceso muere en medio queda una fila de
  tenant sin schema, que es justo lo que `altaTenant.js` describe como veneno
  para todas las altas siguientes. Y como corre en otro proceso no puede
  invalidar la caché, así que durante hasta 60 s el CRM sigue resolviendo un
  tenant cuyo schema ya no se llama así.

Con eso arreglado, lo razonable es que el panel ofrezca **solo el primer acto**,
el reversible, con las trampas que ya tiene suspender (teclear el slug, enseñar
cuántos datos hay dentro, nunca a nosotros mismos), y que la purga siga siendo
SSH.

⚠️ Y antes hay que responder qué manda sobre la retención: las facturas tienen
obligación de conservarse años y los registros de auditoría no se borran nunca
(regla del proyecto). «Apartar» convive con eso; «purgar» no.

*Se comprueba*: cerrar un cliente de prueba desde `/admin/clientes` lo saca del
listado, deja su schema como `zzz_baja_*` sin tocar a los demás, se lleva sus
ficheros de las seis rutas de `uploads/`, deja el `.rollback.sql` en sitio
montado, y `master.audit_logs` guarda su fila `provisioning.cliente_baja`.
*Dónde*: `app/api/admin/clientes/[slug]/route.js:36` (solo PATCH),
`lib/provisioning/cicloVida.js:26-28` (la decisión de no tener botón) y
`scripts/borrar-tenant.js` (la red efímera, en la parte que escribe el
`.rollback.sql`; la purga sin frenos que había ahí ya está arreglada).
*Comprobado en producción*: 11/08/2026 — 9 clientes, **2 suspendidos** desde el
08/08; ni un schema `zzz_baja_*`, cero filas `provisioning.cliente_baja`, ningún
script de baja en el `scripts/` del contenedor, y `docker inspect` confirma que
el único volumen montado es `/opt/crm-salamandra/uploads → /app/uploads`.

### El tablero ordena por urgencia, pero no por cliente · interno

`/admin/tablero` agrupa por prioridad (P0…P3) y ofrece un buscador de texto. La
pregunta que se hace de verdad al descolgar el teléfono —«¿cómo vamos con
Aumenta?»— se contesta hoy escribiendo el slug en el filtro y confiando en que
esté bien puesto en todas las tareas.

El dato ya existe: el troceador saca el cliente del título (`· aumenta`) y lo
devuelve como `quien`. Falta agrupar por él. **Pero no se puede agrupar por
`quien` tal y como está**, y eso es lo que hay que arreglar primero: es una
CADENA de texto, no una lista de clientes.

Contado con el mismo troceador sobre los ficheros que hay en producción:

- 25 tareas pendientes y 23 resueltas.
- Aumenta tiene **10 pendientes**, pero agrupando por `quien` saldrían **7**.
  Las otras tres viven dentro de cadenas como `demo, aumenta,
  salamandra_solutions` o `abarcaia, aumenta`, que cuentan como grupo propio.
- Salen **12 grupos distintos para 9 clientes**, y cinco son combinaciones con
  una sola tarea dentro.
- `salamandra_solutions` no está en la lista `SLUGS` del troceador, así que su
  tarea se queda sin cliente y no caería en ningún grupo. Lo mismo con la cola
  `· varios` de una entrada de resuelto.

O sea: agrupar sin tocar el troceador da un tablero que **miente por poco**, que
es la peor forma de mentir — nadie lo comprueba. Primero `quien` tiene que ser
una lista de slugs, con una tarea de tres clientes apareciendo en los tres
grupos; con eso hecho, la agrupación es casi gratis y encaja con lo que la
pantalla ya hace a propósito: conservar el filtro al cambiar de pestaña, porque
«¿cómo vamos con Aumenta?» incluye lo ya entregado.

*Se comprueba*: agrupado por cliente, Aumenta enseña **10** pendientes, y las
tres compartidas aparecen además en `demo`, `abarcaia` y `salamandra_solutions`.
El número de cada grupo tiene que cuadrar con `grep '^### ' docs/backlog.md`
filtrado por ese slug.
*Dónde*: `app/api/admin/tablero/route.js:35-38` (la lista `SLUGS`) y `71-90` (de
dónde sale `quien`); `app/admin/tablero/page.jsx:70-84` (el filtro de hoy).
*Comprobado en producción*: 11/08/2026 — contado sobre los ficheros del
contenedor: 25 pendientes, Aumenta con 10 reales frente a 7 agrupables.

### La nutrición solo sabe vivir en casa de Laura · `aumenta`, producto

«Que la nutrición de Aumenta sea igual que la de nutri_laura» tiene una mitad
gratis y una mitad rota.

**Gratis**: las cuatro pantallas de `/nutricion/*` ya son idénticas por
construcción. Ese módulo **no tiene base**: las cuatro páginas importan los
componentes de `modules/overrides/nutri-laura/` y los usan como valor por
defecto para cualquier cliente. El `uiOverride` y el flag
`externalSearchEnabled` que Laura tiene en `master.tenant_modules` están
muertos: el primero no lo lee nadie y el segundo era de OpenFoodFacts, que se
retiró entero el 18/07.

⚠️ **Pero «idéntica» solo vale para esas cuatro pantallas.** La pestaña
**Pautas** de la ficha del cliente —y con ella asignar un menú desde la propia
ficha— cuelga de `modules/overrides/nutri-laura/ClientDetailModule.jsx`, que
solo renderiza Laura: el resto ve `modules/default/ClientDetailModule.jsx`, que
no importa `ClientPlansPanel`. La prueba está en producción: **la demo tiene
`nutricion` activo y no tiene la pestaña de Pautas**. Eso es lo que de verdad
habría que llevar al default si se quiere que Aumenta lo tenga «igual que
Laura», y es trabajo de código, no de encender un interruptor.

**Rota**: encenderlo hoy deja a Aumenta con el módulo puesto y **cero tablas**.
De las nueve tablas de nutrición, cinco (`foods`, `plans`, `plan_meals`,
`plan_meal_options`, `plan_meal_option_foods`) solo las crean dos scripts que
llevan `crm_nutri_laura` escrito a mano dentro, y ninguno de los dos está en el
mapa de migraciones del módulo. Las seis migraciones que sí se ejecutarían se
saltan solas cualquier schema que no tenga ya `foods`, y lo dicen por pantalla:
«faltan foods/plan_meal_options. Se salta». Es el mismo fallo que dejó a
Abarcaia tres meses sin registrar leads; la diferencia es que este todavía no le
ha pasado a nadie, porque nutrición nunca se ha vendido dos veces.

Dos avisos para quien lo haga:

- **El vocabulario NO se rompe.** Aumenta tiene `pacientes` y `clinica`, que
  mandan sobre `nutricion` en `lib/clients/vocabulario.js`, así que «Clientes»
  sigue llamándose «Clientes» y no salen dos «Pacientes» en el mismo menú. No
  hay que fiarse del aviso de CLAUDE.md: la demo ya lleva los tres módulos
  juntos en producción y se ve bien.
- **`AUTO_ASSIGN_MODULE_KEYS = ["nutricion"]`**: con el módulo puesto, toda
  ficha NUEVA se marca sola como paciente de nutrición. En un centro de
  psicología con 1.083 familias, eso hay que quererlo.

Y falta lo que no es código: Laura tiene 3.906 alimentos y 1.084 recetas.
Aumenta empezaría con el recetario vacío.

⚠️ Al comprobar esto salió otra cosa: `CLAUDE.md` y `docs/modules/nutricion.md`
dicen que los bloques **C4 y C5 están «pendientes de despliegue» y llevan
tiempo desplegados** (`assign`, `reapply-template` y `meals/reorder` están en el
contenedor). Quien coja esta tarea leerá que falta media nutrición por subir, y
no es verdad.

*Se comprueba*: `docker exec crm-salamandra-app-1 node scripts/check-module-tables.js`
no se queja de `aumenta`/`nutricion`, y las cuatro pantallas cargan.
*Dónde*: `scripts/_module-migrations.js:324`,
`scripts/add-nutricion-module-nutri-laura.js:33` y
`scripts/add-nutricion-c2-plans-nutri-laura.js:36`.
*Comprobado en producción*: 10/08/2026 — `aumenta` no tiene el módulo (solo lo
tienen `nutri_laura` y `demo`) y `crm_aumenta` no tiene ninguna de las nueve
tablas.

### El informe clínico: el PDF ya está, falta que lo escriba la IA · `aumenta`

**El PDF está hecho y desplegado**, que es lo primero que hay que saber para no
rehacerlo: `lib/clinica/reportPdf.js` compone el informe que recibe la familia
—secciones fijas, solo las que tienen contenido, sin membrete porque se abre en
el móvil— y sale por «Enviar al paciente». En clínica hay un segundo PDF, el de
estadísticas del centro (`lib/clinica/estadisticasExport.js`), también hecho.
Ninguno de los dos lleva IA: son maquetación con pdfkit.

Lo que falta es el paso de ANTES. Hoy el contenido lo compone
`lib/clinica/redactarInforme.js`, que copia literal lo que dicen las sesiones
elegidas, con su fecha delante. Su cabecera ya dice que la redacción asistida
«de mañana» se apoyará en él —no lo sustituirá—: primero se junta lo que dicen
las sesiones, y luego, si acaso, se le pide a la IA que lo pula.

Las dos reglas que ese fichero ya tiene escritas son la especificación y no se
negocian: **no pisa lo que la terapeuta ya escribió** y **no inventa**. Un
informe clínico acaba en manos de una familia y a veces de un juzgado.

Dos cosas lo hacen prematuro HOY, y las dos son de fuera del código:

- Aumenta **no tiene ninguna clave de IA** —ni Anthropic ni OpenAI—, así que
  esto no se puede ni probar en su casa. Ver la decisión de las claves.
- El módulo clínico se importó de Organízate el 02/08 y **todavía no ha
  registrado su primera sesión por la aplicación**. Las 22.045 sesiones que hay
  son ese volcado: notas ya redactadas a mano entre 2024 y 2026, de las que no
  existió nunca un audio. Sobre ellas la IA no tiene nada que hacer, y contarlas
  como trabajo pendiente es engañarse. El día que empiecen a registrar sesiones
  desde el CRM, esto pasa a valer mucho.

*Se comprueba*: una terapeuta genera el borrador desde sus sesiones, la IA lo
pule sin tocar lo que ella escribió, y sale el PDF de siempre.
*Dónde*: `lib/clinica/redactarInforme.js:1-19` es el punto de enganche;
`lib/clinica/reportPdf.js` es lo que NO hay que tocar.
*Comprobado en producción*: 10/08/2026 — los dos generadores de PDF están en el
contenedor; `/api/clinica/reports/[id]/` tiene `desde-sesiones` y `enviar`, y
ningún paso de IA en medio. Aumenta: 0 informes y 0 sesiones creadas desde la
importación.

### Los contadores del embudo mienten al filtrar · `abarcaia`, `aumenta`

Al pulsar una etapa se reconsulta filtrando y el desglose se recalcula sobre lo
que ha llegado, con lo que las demás etapas caen a cero. En Aumenta hasta el
«X en total» de la cabecera se contagia.

*Los clientes de esta tarea han cambiado dos veces.* Primero decía `aumenta`,
`nutri_laura` y `sandbox`: `nutri_laura` no tiene ese código y tiene **0 leads**,
y `sandbox` **no existe en producción**. Después quedó en `quality_energy` (129
leads) y `abarcaia` (84), que eran los de embudo lleno. Y el **10/08/2026**
`quality_energy` pasó a **suspendido**, así que hoy no lo sufre: el único que lo
sufre de verdad es `abarcaia`. Aumenta lo tiene en el código pero con 2 leads no
se nota. El override de `quality-energy` sigue en el repo y volvería a fallar el
día que se reactive, así que la tarea no se cierra.

La segunda mitad —el corte a 200 filas— hoy no la toca nadie: nadie llega a 200.

*Se comprueba*: filtrar por una etapa en `abarcaia` no pone las otras a cero.
*Dónde*: `modules/overrides/{quality-energy,abarcaia,aumenta}/LeadsModule.jsx`.
*Comprobado en producción*: 10/08/2026 — el patrón sigue en los tres overrides;
`quality_energy` y `healim` están suspendidos (a propósito) y ya no salen en el
back-office.

### Una receta corregida no llega a quien ya tiene la pauta · `nutri_laura`

Al asignarla se congelan nombre e ingredientes, pero los pasos y la foto se leen
en vivo. Corregir una cantidad mal puesta NO le llega a quien ya la tiene —ni
con «Re-aplicar menú origen», que recopia las copias viejas— y reescribir los
pasos sí le cambia pautas de hace meses. Es una decisión de producto: o se
congela todo, o se lee todo en vivo, o hay un botón que propague de verdad.

*Se comprueba*: cambiar una cantidad y ver si llega a un plan ya asignado.
*Dónde*: `lib/nutricion/menuPdf.js:30` lo dice explícito.
*Comprobado en producción*: 09/08/2026 — sigue así, con **3 planes asignados**
que hoy heredarían el cambio a medias.

### Módulo de fichaje · `aumenta`

Lo pidieron por WhatsApp: «que vuelquen el excel de cada mes». No sabemos las
columnas, ni de qué máquina sale, ni si un mes se puede volcar dos veces. Un
fichaje mal importado es una nómina mal pagada. El plan y las preguntas que hay
que hacerles están en `docs/revision-aumenta-2026-08.md`.

*Se comprueba*: existe y Aumenta lo usa.
*Comprobado en producción*: 09/08/2026 — no hay nada de fichaje en el código.

### Retorika lleva cinco semanas sin mandar nada desde su web · `retorika`

El último dato que entró de su WordPress fue el 29/06 (matrículas e
inscripciones); los alumnos y los cuestionarios pararon el 25/06. La última
llamada de `asesoriaretorika.com` a cualquier webhook fue el **06/07**, y era
una comprobación que no escribe nada.

**No estamos rechazando nada**: todas las llamadas que llegaron respondieron
200. O la academia está parada por el verano —que en una academia es lo más
probable— o su plugin dejó de disparar. Hasta preguntarles no se puede saber, y
por eso esto no es un fallo todavía.

Lo que sí es del producto: **nada avisa cuando la integración de un cliente se
queda muda**. La de Laura llama cada noche a las 04:30 y eso solo se ve mirando
a mano el `access.log` de nginx. Si dejara de llamar, tampoco se enteraría
nadie.

*Se comprueba*: preguntar a Retorika si han dado cursos desde julio. Si dicen
que sí, el fallo es nuestro y sube a P1; si dicen que no, se cierra.
*Dónde*: `app/api/webhooks/tutorlms/*` y `app/api/webhooks/retorika/*`. Los
datos, en `crm_retorika.{quiz_attempts,training_users,course_enrollments,course_registrations}`.
*Comprobado en producción*: 10/08/2026 — 526 intentos (último 25/06), 100
alumnos (25/06), 88 matrículas y 23 inscripciones (29/06). En el `access.log`
de nginx: 3 llamadas suyas en julio, todas 200, la última el 06/07, y ninguna
en agosto. En ese mismo periodo `tunutrilaura.com` llamó 29 veces, la última
hoy a las 04:30.

### Una ausencia mal puesta solo se puede borrar y escribir otra vez · `nutri_laura`, producto

`/api/citas/bloqueos` tiene GET, POST y DELETE, y no tiene PATCH. Ni las fechas,
ni el motivo, ni de quién es una ausencia se pueden cambiar una vez guardada: si
alguien se equivoca de día, la quita y la vuelve a escribir.

**Eso ya costó un script.** Las seis ausencias que en la consulta de Laura se
apuntaron sin querer como «Todo el centro» —y que cerraron su agenda seis
veces— no se pudieron arreglar desde la pantalla: hubo que escribir
`scripts/reasignar-ausencias-sin-persona.js` para cambiarles el dueño. Con un
botón de editar eso lo arregla Laura en un minuto y sin que nadie despliegue.

Jorge pidió además (10/08) **un botón para entrar directamente**. Hoy
«Vacaciones y ausencias» vive dentro de la pantalla de **Tipos de cita** —Rodrigo
la puso ahí porque «es donde va a buscarlo»— así que para apuntar que te vas una
semana hay que pasar por la pantalla donde se configuran precios y duraciones.
No son la misma tarea ni las hace la misma gente: los tipos de cita los toca
dirección de uvas a peras, las ausencias las toca todo el equipo.

⚠️ El PATCH hereda los permisos del POST y del DELETE, y no se pueden aflojar:
quien no es admin solo toca las suyas. Cambiar el dueño de una ausencia es
justo la operación que dejó la agenda de Laura cerrada, así que si se permite
editar ese campo, tiene que seguir siendo cosa de dirección.

*Se comprueba*: cambiar fecha y motivo de una ausencia desde la pantalla, sin
borrarla, y que el cambio quede en la auditoría.
*Dónde*: `app/api/citas/bloqueos/route.js` (los tres métodos que hay, y el que
falta); `components/citas/PanelVacaciones.jsx:294` es donde solo hay «Quitar»;
el panel está incrustado en `app/(dashboard)/citas/tipos/page.jsx`.
*Comprobado en producción*: 10/08/2026 — el bundle desplegado de
`/api/citas/bloqueos` no contiene ningún PATCH. nutri_laura tiene 6 ausencias
(5 aún por venir) y ya ninguna quedó a nombre del centro; Aumenta, demo y healim
no han apuntado ninguna todavía.

### Nadie puede abrirnos una incidencia · producto

No hay ningún camino por el que un cliente nos cuente que algo va mal. Soporte
va del cliente hacia SUS clientes, no hacia nosotros. Y lo que se llama
«Incidencias» es otra cosa: es del Programa de Excelencia del módulo Clínica, se
queda dentro del centro y se asigna a alguien de su propio equipo.

Encima casi nadie la tiene. Exige `team_avanzado` **y** (`clinica` o
`pacientes`), así que la pueden usar 2 de los 9 clientes —Aumenta y la demo— y
**ninguno de los dos ha registrado una sola**, ni de prueba.

Jorge lo pidió el 10/08: que **cualquier cliente** pueda mandar una incidencia
hacia arriba, y que llegue a dos sitios — a su propio administrador y a nosotros.

Son dos trabajos y conviene no mezclarlos:

- **Dentro del centro** ya existe a medias: es abrir la pantalla a quien no
  tiene el módulo clínico, y decidir qué categorías tienen sentido en un cliente
  que no es una clínica (la taxonomía de hoy es terapéutica, documental,
  coordinación…).
- **Sacarla del tenant hasta nosotros** no existe en absoluto, y es la parte
  delicada. La tabla `incidencias` vive en el schema del cliente, y lo que hay
  que decidir ANTES de escribir código es qué viaja: el texto entero o solo un
  aviso con el cliente y un enlace. Una incidencia puede llevar dentro el nombre
  de un paciente, y duplicar eso en `master` —que es la base compartida por
  todos— es la misma regla que ya obliga a que la auditoría guarde un resumen y
  nunca la fila entera.

*Se comprueba*: desde un cliente sin `clinica` —spain_enzymes, por ejemplo— se
abre una incidencia y nos llega.
*Dónde*: `app/api/clinica/incidencias/route.js:19,45` son las dos puertas;
`components/layout/Sidebar.jsx:215` es el menú; `models/tenant/Incidencia.model.js`
es la tabla que hoy no sale del cliente.
*Comprobado en producción*: 10/08/2026 — 2 de 9 clientes pueden usarlas y las
dos tablas tienen **0 filas**. En los otros siete la tabla `incidencias` ni
existe.

### Dar de alta a un cliente ejecuta migraciones sobre los schemas de todos los demás · producto

`ensure-tenant-schema.js <slug>` usa el slug SOLO para elegir QUÉ migraciones
corre; no se lo pasa a ninguna. En la línea 76 las lanza con
`spawnSync(process.execPath, [file])`, sin un solo argumento, así que cada
migración decide su propio alcance — y al menos dos deciden «todos los clientes
activos»: `migrate-citas-sprint-1` y `migrate-inventario-rework`.

O sea que dar de alta a un cliente nuevo entra en el schema de Aumenta, el que
tiene 12.030 citas y quince personas trabajando dentro. Hoy no rompe nada —esas
migraciones son idempotentes y en producción salen bien— pero coge candados
sobre sus tablas en mitad de la jornada, y sobre todo hace que **el alta de un
cliente pueda fallar por el estado de OTRO**.

Y ese «otro» es fácil de fabricar sin querer. `altaTenant.js` crea la fila en
`master.tenants` ANTES que el schema y, si algo revienta a mitad, deja la fila
puesta a propósito (borrar un schema solo es demasiado peligroso, y eso está
bien). Pero desde ese momento hay un tenant ACTIVO sin schema, y
`migrate-citas-sprint-1` se cae en CADA alta posterior: **un alta a medias
envenena todas las siguientes**.

Salió al probar el alta en local el 11/08 con siete clientes de prueba: seis
acabaron con el aviso «no se pudieron aplicar las migraciones», y la culpa era
de `crm_salamandra_solutions`, que en local no existe.

De paso, el aviso miente por exceso: dice «No se pudieron aplicar las
migraciones» cuando lo que ha fallado es UNA de 55. El cliente de prueba con
Facturación tenía sus series F y R bien sembradas y aun así se anunció como
roto, que es justo lo que lleva a repetir a mano un trabajo ya hecho.

*Se comprueba*: `ensure-tenant-schema.js <slug>` no toca ningún schema que no
sea `crm_<slug>`, y un tenant activo sin schema no impide dar de alta a nadie.
*Dónde*: `scripts/ensure-tenant-schema.js:76` es el spawn sin argumentos;
`scripts/migrate-citas-sprint-1.js:220,254` y `scripts/migrate-inventario-rework.js`
son las dos que se lo saltan; `lib/provisioning/altaTenant.js:178-196` es el
orden que puede dejar la fila huérfana.
*Comprobado en producción*: 11/08/2026 — los 9 tenants tienen su schema y
ninguno conserva las tablas viejas de inventario, así que HOY las dos
migraciones pasan. Lo que sí ocurre en cada alta es que se ejecutan sobre los
9 schemas.

---

## P3 — deuda

### Al borrar una ficha se promete cancelar citas a quien no tiene agenda · `retorika`, `spain_enzymes`

El aviso de borrado dice «se borrarán también sus documentos y las citas que
todavía no han ocurrido». En un cliente sin el módulo Citas esa frase no es
falsa: está **vacía**. Es cosmético.

Se intentó arreglar el 10/08 y **se retiró a propósito**, que es lo que hay que
saber si alguien lo retoma: son 5 ficheros, uno nuevo en `/lib` y una prop nueva
atravesando dos componentes de servidor y dos de cliente, uno de ellos la ficha
que usan todos los clientes menos nutri_laura. Aplicado a medias dejaba
`conCitas` sin declarar dentro de `handleDelete` — y sin TypeScript eso compila,
así que el fallo sale EN CALIENTE: un ReferenceError al pulsar «Eliminar» en
Aumenta, con quince personas trabajando.

**La forma segura**, si se hace: primero el fichero de `/lib` y las props, sin
tocar los textos y con todo funcionando igual, commit y build; y en un SEGUNDO
commit cambiar los avisos. Nunca los dos en el mismo despliegue. Ojo además a
que `app/(dashboard)/clientes/[id]/page.jsx` tiene un `catch` que deja las
banderas a `false`: con el valor por defecto mal elegido, un fallo al leer
`master` haría que Aumenta borrase una ficha SIN que se le avise de que se
cancelan sus citas futuras. El error tiene que caer del lado inocuo.

*Se comprueba*: la frase no sale en un cliente sin `citas`, y sí sale en Aumenta.
*Comprobado en producción*: 10/08/2026 — retorika y spain_enzymes tienen fichas
y no tienen agenda.

### El moduleKey `sales` sigue vivo en trece endpoints · producto

`/comercial/leads` ya se ha borrado, pero la clave `sales` sigue en el patrón
`hasModule("leads") || hasModule("sales")` de trece endpoints —todo
`/api/leads/*`, `/api/referidos/*`, `/api/public/leads`, `/api/public/referidos`
y `/api/analiticas`—, más `lib/home/summary.js`, la etiqueta de
`AccessSection.jsx` y dos seeds. Es la inconsistencia de nomenclatura que
CLAUDE.md tiene apuntada desde hace meses.

**Quitar esos OR es un cambio de AUTORIZACIÓN, no limpieza.** Si algún schema
tiene la fila `sales` activada y `leads` no, ese cliente se queda con 403 en su
módulo comercial entero el mismo día del despliegue. El orden correcto: primero
un script de solo lectura que confirme contra `master.tenant_modules` de
PRODUCCIÓN que ninguna fila `sales` está `enabled`; después quitar los OR.

*Se comprueba*: `sales` no aparece en ningún endpoint y ningún cliente lo tiene.
*Comprobado en producción*: 10/08/2026 — ningún cliente tiene `sales`, pero los
trece OR siguen en el código.

### El secreto global de webhooks tiene 31 caracteres · `retorika`

No es longitud de nada generado al azar: parece escrito a mano. Funciona, pero
conviene cambiarlo por 32 bytes aleatorios. Hay que coordinarlo con el
`wp-config.php` de la web que lo use.

*Esta tarea decía `nutri_laura` y era falso*: Laura ya tiene su propio secreto de
64 caracteres en `CRM_WEBHOOK_SECRETS`. El de 31 es el **global de reserva**
(`CRM_WEBHOOK_SECRET`), y quien cae en él es Retorika, que no tiene entrada
propia.

*Se comprueba*: `CRM_WEBHOOK_SECRETS` tiene entrada para `retorika` con 64
caracteres, y el global deja de usarse.
*Comprobado en producción*: 09/08/2026 — solo `nutri_laura` (64) tiene entrada
propia; el global sigue en 31.

### Aumenta tiene módulos encendidos que no usa · `aumenta`

`inventory`, `orders` y `projects` se activaron en bloque para sembrar datos de
escaparate; los datos se borraron y los módulos se quedaron. Ya no ensucian la
portada —los bloques vacíos no se pintan— pero siguen en su menú. Si no los
usan, apagarlos.

*Se comprueba*: no están en sus módulos activos, o nos dicen que sí los quieren.
*Comprobado en producción*: 09/08/2026 — los tres activos y **con 0 filas cada
uno** (productos, pedidos, proyectos).

### En Windows el Registro se ve vacío, como si no hubiera nada que hacer · interno

`trocear` parte el fichero por `\n` y luego busca `^##\s+(.+)$`. En JavaScript
`.` no casa con `\r`, así que en una copia de trabajo con finales de línea de
Windows **ninguna cabecera casa** y la pantalla queda en blanco con el mensaje
«Nada por aquí» — que es exactamente lo contrario de lo que pasa.

En producción no se da: `core.autocrlf=true` guarda LF en el repositorio y el
contenedor no tiene ni un `\r`. Solo lo ve quien desarrolla en Windows, o sea
Jorge, y solo en local. Es una línea: partir por `/\r?\n/`.

Ojo a que `resuelto.md` en la misma carpeta SÍ tiene LF, así que la pestaña de
al lado se ve bien y el fallo parece de los datos y no del código.

*Se comprueba*: con el proyecto abierto en Windows, `/admin/tablero` en local
enseña las tareas.
*Dónde*: `app/api/admin/tablero/route.js:60-61`.
*Comprobado en producción*: 10/08/2026 — en el contenedor, `docs/backlog.md`
tiene 0 caracteres `\r` y la pantalla trocea sus 26 tareas. En local, el mismo
endpoint devuelve `pendiente: []` con el mismo fichero.

### El SSO no admite rotar sin corte · producto

`WIDGET_SSO_SECRETS` guarda un secreto por cliente, así que rotarlo obliga a
coordinar el CRM y WordPress al segundo. Ya costó un corte en el portal de Laura.
Aceptando una lista, se pondría el nuevo al lado del viejo, se cambiaría
WordPress con calma y se quitaría el viejo después.

*Se comprueba*: se puede rotar un secreto sin que nadie pierda el acceso.
*Dónde*: `lib/citas/ssoToken.js:23-48`.
*Comprobado en producción*: 09/08/2026 — sigue siendo un secreto por cliente.

---

## Pendiente de una decisión suya

Cosas que no se pueden hacer sin que Jorge o Rodrigo elijan. Van como tareas y
no como una lista suelta a propósito: así aparecen en el tablero. Cuando se
decida, la respuesta se escribe aquí y la tarea baja a su prioridad.

### ¿La IA la ponen ellos, la ponemos nosotros, o se deja como está? · producto

El CRM tiene **once disparadores de IA repartidos por nueve módulos** —el
asistente, reorganizar la semana, proponer huecos de cita, transcribir y
estructurar la sesión clínica, analizar leads de captación, redactar respuestas
de soporte, crear y reorganizar proyectos— y **todos están desplegados**.

Y no la usa nadie, porque es BYOK —cada cliente trae su clave— y **ningún
cliente ha puesto la suya**. De nueve clientes, el único con clave de Anthropic
somos nosotros, y la de OpenAI **no la tiene ni uno**, así que transcribir
sesiones no funciona en ninguna parte del parque. Aumenta, que tiene ocho
módulos con IA dentro, no tiene ninguna de las dos.

⚠️ El registro de auditoría apunta en la misma dirección pero **no vale como
prueba, y conviene no citarlo**: hay 9 filas `ai.uso`, y solo cubren desde el
28/07 —cuando nació `vetoAi`—, solo los diez endpoints que lo llaman, y las de
la demo se borran cada 7 días con la poda. Hay IA de pago que no pasa por ahí
(`/api/public/c/[slug]/soporte` llama a Claude sin `vetoAi`) y hay una llamada
real del 12/07 en `outreach_analyses` sin fila detrás. Lo que sostiene esta
tarea son las CLAVES, no el contador.

No está roto ni escondido: la tarjeta para pegar la clave sale en Configuración
→ IA de todos los clientes (regla #14), y sin ella el CRM contesta «Este cliente
no tiene configurada la clave de IA». Es que nadie la ha puesto — y lo más
probable es que nadie sepa que tiene que ponerla. Hay que elegir una: que se les
explique y la pongan ellos, que la pongamos nosotros y vaya dentro del precio, o
dejarlo así y asumir que la IA del producto es un adorno.

*Comprobado en producción*: 10/08/2026 — **1 de 9 clientes con clave de
Anthropic (nosotros) y 0 de 9 con la de OpenAI**, leído de
`master.tenants.settings`. Sin reserva por entorno: `ANTHROPIC_API_KEY` y
`OPENAI_API_KEY` están ausentes en el contenedor y `lib/ai/anthropicKey.js` no
las mira.

### ¿La agenda de Aumenta se abre al público? · `aumenta`

Hoy la reserva por internet está cerrada: el portal les deja ver sus citas pero
no pedirlas. Si esperaban poder reservar desde la web, hay que abrirlo.

*Comprobado en producción*: 09/08/2026 — cerrada.

### ¿Una primera visita puede comprar el bono de 360 €? · `nutri_laura`

Hoy sí, y una clienta llegó a la página de pago, vio el importe y se fue. Si
toda primera sesión debe pasar por la valoración inicial, hay un interruptor
para eso.

*Comprobado en producción*: 09/08/2026 — se puede.

### ¿Se apaga la puerta global del formulario? · `nutri_laura`

Con ella encendida, un paciente de siempre que quiere una revisión también pasa
por la bandeja. El bloque 5 ya permite exigirlo solo en la primera visita.

Esta decisión y la de las ocho familias de P0 son la misma conversación: si la
puerta se relaja, el P0 se cae solo.

*Comprobado en producción*: 09/08/2026 — encendida y global.

### ¿Los trece de Aumenta deben ver más módulos? · `aumenta`

Ver la tarea de P1: no sabemos si su acceso reducido es lo que el centro quiere.
Nadie de fuera puede responder esto.

*Comprobado en producción*: 09/08/2026 — 13 usuarios con acceso recortado.
