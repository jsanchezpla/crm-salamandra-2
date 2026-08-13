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

---

## P1 — esta semana

### «Pedirle otra tarjeta» ya funciona, pero nadie lo ha visto funcionar · todos

**Desplegado el 13/08/2026; sin ejercitar en el VPS.** El botón se pintaba
y el aviso lo recomendaba, pero el endpoint contestaba 409 a toda cita `failed`:
usaba `tieneRetencionPendiente`, y esa lista mete `failed` a propósito. De las
tres salidas del dinero perdido —reintentar, pedir otra tarjeta, rechazar—
desaparecía la del medio, justo la recomendada. El propio endpoint tenía escrito
el camino de la tarjeta rechazada, con su palabra para el correo
(`motivo = "rechazada"`), y era inalcanzable.

**Lo que se hizo.** `PUEDE_HABER_DINERO` no se tocó —sus otros cuatro
consumidores la quieren ancha—: el botón usa ahora una comprobación propia,
`estorbaParaPedirOtraTarjeta`, que en vez de mirar la lista le PREGUNTA a Stripe
por la retención vieja con una lectura que no mueve dinero. Muerta (lo normal) →
crea la nueva y manda el correo. Viva → 409 explicando que el paciente aún tiene
el importe retenido. Sin poder preguntar → 409 también, porque «no lo sé» no
puede ser vía libre: crear la segunda a ciegas le bloquea el importe dos veces.

**La decisión que faltaba la tomó Rodrigo el 13/08**: opción (b), el CRM **no**
suelta el dinero por su cuenta. Y con un matiz suyo que conviene no perder — si
el banco no acepta el pago, el CRM no reintenta nada: espera a que la persona
vuelva a pagar físicamente.

**Por qué sigue aquí y no en `resuelto.md`.** Comprobarlo de verdad pide una cita
`failed` real, y pulsarlo crea una retención y le manda un correo a un paciente
de carne y hueso; no se puede ensayar contra producción sin molestar a alguien.
En local tampoco: ningún tenant tiene claves de Stripe. Se queda hasta que se
vea funcionando, que es lo que manda la norma de arriba.

*Se comprueba*: en una cita `failed` con la retención ya muerta, pulsarlo manda
el correo en vez de dar 409; y con una viva, contesta 409 sin crear la segunda
—el paciente nunca acaba con dos importes bloqueados—. La vía barata es un
tenant de pruebas con claves `sk_test_`: entonces vale `_smoke-autorizacion.mjs`
para montar el caso y este flujo entero se puede ensayar sin tocar a nadie.
*Dónde*: `lib/citas/cobroCita.js` (`estorbaParaPedirOtraTarjeta`),
`lib/payments/autorizacion.js` (`leerEstadoAutorizacion`),
`app/api/citas/bookings/[id]/pedir-tarjeta/route.js:77`. El apartado del doc:
`docs/modules/citas.md`, «Cuando el dinero se pierde: las tres salidas».
*Probado*: 13/08/2026 — `scripts/_smoke-pedir-otra-tarjeta.mjs`, seis casos en
verde, incluido el de «no se pudo preguntar → estorba». No cubre la distinción
viva/muerta contra Stripe: eso necesita claves de prueba.
*Comprobado en producción*: 13/08/2026 — el arreglo está **desplegado** (las dos
funciones nuevas responden dentro del contenedor y `/login` sigue en 200), pero
su COMPORTAMIENTO no se ha ejercitado: para eso hace falta una cita `failed`
real. Lo anterior, del 09/08: `failed` sigue en la lista, que es correcto y no se
ha tocado.

---

## P2 — cuando se pueda

### El back-office nuevo está desplegado y en producción no se le nota · producto

Salió al comprobar el despliegue del 13/08 (17:35), que subió `fbdd116` —demos
por oficio, poner claves a un cliente y cerrar cuentas—. El código está en el
VPS, pero **sus cuatro entradas de `resuelto.md` dicen «comprobado en local»** y
ninguna se ha visto funcionando allí. La norma de arriba pide lo contrario, así
que o se comprueban o vuelven aquí.

Lo único que se puede afirmar hoy, mirando la base de datos: **las demos por
oficio no existen en producción**. `master.tenants` tiene los siete clientes de
siempre y ninguna `demo_clinica`, `demo_nutricion` ni `demo_agencia`. O sea que
el escaparate público sigue siendo exactamente el de antes —una sola demo con
veinte módulos—, que es el problema que esa tarea daba por resuelto. No está
roto: `DemoTabs` cuenta las que existen de verdad y se esconde con menos de dos,
así que no hay ninguna pestaña que lleve a un 404. Simplemente no hay nada nuevo
que ver hasta que se siembren.

Las otras dos —poner claves y cerrar cuentas— no se pueden comprobar mirando:
hay que ponerle una clave a alguien y dar de baja a alguien. La de bajas conviene
ensayarla con un cliente de mentira antes que con uno real.

*Se comprueba*: en producción existen `demo_clinica`, `demo_nutricion` y
`demo_agencia`, y desde la demo general se salta a ellas por las pestañas.
*Dónde*: `npm run db:demos` (`scripts/crear-demos-por-oficio.js`) es lo que las
siembra; el catálogo está en `lib/demo/demos.js`.
*Comprobado en producción*: 13/08/2026 — desplegado y sano (contenedores arriba,
`/login` en 200), y `master.tenants` con 7 clientes y ninguna demo de oficio.

### La nutrición ya sabe vivir fuera de casa de Laura, pero nadie se ha mudado · `aumenta`, producto

**El trabajo de código está hecho (13/08/2026) y falta desplegarlo.** Lo que
queda de la tarea es una pregunta de negocio, no de programación: **¿Aumenta
quiere Nutrición?** Rodrigo decidió no encendérselo hasta que lo confirmen, y
encenderlo será entonces un comando.

Lo que estaba roto y ya no:

- **Las cinco tablas sin migración.** De las nueve de nutrición, cinco (`foods`,
  `plans`, `plan_meals`, `plan_meal_options`, `plan_meal_option_foods`) solo las
  creaban dos scripts con `crm_nutri_laura` escrito a mano dentro, y ninguno
  estaba en el mapa del módulo: activarlo en un cliente antiguo dejaba el módulo
  en el menú y nada debajo. Ahora las crea `migrate-nutricion-base`, declarada
  la primera de `nutricion` y con arista explícita hacia `migrate-nutricion-recipes`
  (el orden salía bien por desempate alfabético, que es lo mismo que no salir).
- **`sequelize.sync()` da las columnas y NO las reglas.** Es la razón de que
  `somos` (alta del 12/08) sí tuviera las nueve tablas: el alta las crea todas,
  tenga el cliente el módulo o no. Pero sin un solo CHECK — su `plans` aceptaba
  una plantilla con paciente asignado, que es justo lo que el CHECK impide. La
  migración repara además lo ya creado: 5 constraints y 3 índices parciales.
- **La pestaña Pautas.** `ClientPlansPanel` y los otros diez ficheros del módulo
  vivían en `modules/overrides/nutri-laura/` aunque los usara todo el mundo;
  ahora están en `modules/nutricion/` y la pestaña la monta el
  `ClientDetailModule` por defecto, condicionada al módulo. Se comprobó en los
  dos sentidos contra el servidor de desarrollo: `demo` (con nutrición) enseña
  Pautas y `demo_clinica` (sin ella) no.
- **El recetario vacío.** Activar el módulo ahora siembra los 497 alimentos del
  catálogo base en ese cliente (`MODULE_SEEDS` en `_module-migrations.js`). Las
  recetas NO se copian: las 1.084 de Laura son suyas.
- **El auto-marcado.** `AUTO_ASSIGN_MODULE_KEYS` colgaba solo de tener el módulo,
  así que en un centro con 1.083 familias toda ficha nueva habría quedado marcada
  como paciente de dietas. Ahora es un flag por tenant apagado por defecto
  (`autoAsignarEnAlta`); `migrate-auto-asignar-nutricion` se lo enciende a Laura
  para que su comportamiento no cambie.

Lo que sigue en pie de la tarea original: **el vocabulario NO se rompe** —Aumenta
tiene `pacientes` y `clinica`, que mandan sobre `nutricion` en
`lib/clients/vocabulario.js`, así que «Clientes» se sigue llamando «Clientes»—, y
Aumenta empezaría con el recetario de recetas vacío aunque tenga el catálogo de
alimentos.

Y una cosa que se descubrió por el camino y no es de esta tarea: **los alimentos
no son comunes entre clientes**. Los 497 del catálogo base sí (se siembran
iguales en todos), pero lo que añade una nutricionista se queda en su schema —
hoy hay **465 alimentos que solo existen en el de Laura**. Si se quiere que un
alimento nuevo llegue a todos, es otra tarea, y hay que decidir antes si el
trabajo de un cliente debe aparecer en el CRM de otro.

*Se comprueba*: `docker exec crm-salamandra-app-1 node scripts/check-module-tables.js`
no se queja de `aumenta`/`nutricion`, las cuatro pantallas cargan y la ficha de
un cliente enseña la pestaña Pautas.
*Dónde*: `scripts/migrate-nutricion-base.js`, `modules/nutricion/`,
`lib/clients/moduleAssignments.js` (`AUTO_ASSIGN_FLAG`).
*Comprobado en producción*: 10/08/2026 — `aumenta` no tiene el módulo y
`crm_aumenta` no tiene ninguna de las nueve tablas. Sigue igual a propósito: el
código está listo, la decisión no.

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

### Una receta corregida no llega a quien ya tiene la pauta · `nutri_laura`

**Decidido y escrito el 13/08/2026; falta desplegarlo.** Se queda aquí y no en
Resuelto porque nada entra allí sin verse funcionando en producción.

Lo que pasaba: al asignar se congelaban nombre e ingredientes, pero los pasos y
la foto se leían en vivo. Media receta quieta y media viva, que es lo peor de las
dos opciones — corregir una cantidad no le llegaba a quien ya tenía la pauta, ni
con «Re-aplicar menú origen» (recopia las copias viejas del menú plantilla), y
reescribir unos pasos sí le cambiaba pautas de hace meses.

De las tres salidas posibles, Rodrigo eligió la tercera: **congelar todo y que
haya un botón que propague de verdad**. La pauta entregada pasa a ser un
documento cerrado, y al guardar una receta que ya está usada aparece un panel que
dice en cuántos sitios está y deja marcar a cuáles llevar la corrección. Las
pautas archivadas nunca se tocan: son el registro de lo que se entregó aquel día.
Los menús plantilla salen en la lista aparte, porque un menú sin corregir vuelve
a repartir el error la próxima vez que se asigne — y eso es lo que arregla, de
paso, «Re-aplicar».

Al desplegar hay que correr `migrate-nutricion-congelar-receta`, que además de
las dos columnas nuevas hace un **backfill desde la receta viva**: sin él las
pautas vivas se quedarían de golpe sin pasos y sin foto. Con él, el día del
despliegue no se nota nada; lo que cambia es que a partir de ahí se quedan
quietas.

*Se comprueba*: cambiar una cantidad de una receta usada y ver que la pauta ya
asignada NO cambia, y que el panel de después de guardar la ofrece.
*Dónde*: `app/api/nutricion/recipes/[id]/propagate/route.js`,
`modules/nutricion/PropagarRecetaPanel.jsx`, `lib/nutricion/plans.js`
(`attachRecipesToTree`).
*Comprobado en producción*: 09/08/2026 — sigue así, con **3 planes asignados**
que hoy heredarían el cambio a medias. Probado de punta a punta en local el
13/08 contra el servidor de desarrollo.

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

### Lo que un cliente escriba por correo a Soporte no llega a ningún sitio · `aumenta`, `demo`

Soporte se vendió con dos vías de entrada: el portal y el correo. El portal
funciona; el correo nunca llegó a encenderse, porque hace falta dar de alta el
dominio de recepción en Resend, crear el webhook y poner las dos variables en el
servidor. Hoy no lo sufre nadie —Aumenta tiene el módulo activo pero aún no ha
abierto ni un ticket—, y por eso está aquí y no más arriba. El día que empiecen
a usarlo, el correo de un cliente se perderá sin que nadie se entere: no hay
rebote ni aviso.

*Se comprueba*: un correo a `soporte-aumenta@{dominio}` crea su ticket en la
bandeja de Aumenta.
*Dónde*: `app/api/webhooks/resend-inbound/route.js:141` y
`lib/support/notify.js:27`. Los pasos están comentados en `.env.production.example`.
*Comprobado en producción*: 10/08/2026 — `.env.production` tiene 26 variables y
**ninguna se llama RESEND**, ni `RESEND_INBOUND_DOMAIN` ni `RESEND_WEBHOOK_SECRET`.
`support` está activo en `aumenta` y `demo`; Aumenta tiene 0 tickets.

---

## P3 — deuda

### La foto dorada de la demo va por detrás del schema · `demo`

Cada demo se restaura sola desde su foto `crm_{slug}_golden` en cada recarga
dura, y ese schema es una FOTO: se sacó un día y ahí se quedó. Las migraciones no
lo tocan —y hacen bien: no es un tenant de `master`, así que no aparece en
ninguna lista—, de modo que cada columna que se añade desde entonces existe en el
schema vivo y no en la foto.

No rompe nada, y eso es lo que hace que nadie se acuerde: el restore solo copia
las columnas que existen en LOS DOS schemas, así que las nuevas se quedan con su
valor por defecto en vez de con el dato de ejemplo. El efecto es que la demo
—que es el escaparate de ventas— arranca con esos campos vacíos.

**Ya se puede medir (13/08/2026).** Antes había que ir tabla por tabla a mano y
por eso nadie lo miraba nunca. `npm run db:demo:snapshot:check` lo dice de las
cuatro demos de golpe, con nombres. Al mirarlo ese día en local, ANTES de rehacer
las fotos, salían **9 tablas y 38 columnas** de diferencia, no las cuatro que
decía esta tarea: `blocked_days`, `waitlist_entries`, `contract_signatures`,
`intervention_plans`, `session_packs`… La cifra real era diez veces la anunciada.

**Lo que queda es CUÁNDO rehacerla**, que sigue sin decidirse. Rehacerla es un
comando y no se olvida por difícil, se olvida porque nada avisa. Las opciones
siguen siendo las de siempre: a mano cada cierto tiempo, o dejarlo escrito en el
guion de despliegue. Una tercera, ahora que se puede medir: que el comprobador
salga en el despliegue y cante la diferencia.

*Se comprueba*: `npm run db:demo:snapshot:check` (o el mismo script con
`--comprobar` dentro del contenedor) sale sin ninguna diferencia.
*Dónde*: `lib/demo/resetDemo.js` (la parte que solo copia columnas comunes) y
`scripts/demo-golden-snapshot.js`.
*Comprobado en producción*: 12/08/2026 — `crm_demo_golden` no tiene ninguna de
las cuatro columnas que sí tiene `crm_demo`, y en los logs de la app no aparece
ni un fallo de `demo-reset` en 48 h: falla en silencio por diseño. (En local, ya
con el comprobador, 13/08/2026: 9 tablas y 38 columnas de diferencia antes de
rehacer las fotos, y ninguna después.)

### En Formación, «Usuarios» y «Alumnos por curso» se pisan · `retorika`, `aumenta`, `nutri_laura`, `demo`, `somos`

**Usuarios** son las personas y **Alumnos por curso** son las matrículas, y la
tarjeta de Usuarios se describe además como «alumnos privados y de empresa».
Arriba, el recuadro de métricas vuelve a decir «Usuarios» y «Matrículas», que es
un tercer par de palabras para las mismas dos cosas.

La prueba de que no se entiende está escrita en la propia ayuda de Empresas, en
mayúsculas: «IMPORTANTE: los alumnos de empresa se importan desde aquí» — porque
quien quiere dar de alta alumnos entra en Usuarios, que es donde no se hace.

Salió al colgar las cinco pantallas del menú (12/08/2026) y se dejó fuera a
propósito: Jorge pidió «solo la navegación». **Renombrarlas le cambia el
vocabulario a cinco clientes de golpe**, dos de ellos con formación en uso real
(Retorika lleva 526 intentos de cuestionario), así que es una decisión de
producto, no una limpieza. Si se hace, hay que tocar a la vez el menú, la
portada, los rótulos de las métricas y el override de Aumenta, o quedarán
diciendo cosas distintas.

*Se comprueba*: una persona que entra por primera vez sabe, sin preguntar, en
cuál de las dos pantallas se dan de alta alumnos.
*Dónde*: `modules/training/FormacionOverview.jsx:31-51` (las dos secciones) y
`:65-70` (las métricas); `components/layout/Sidebar.jsx` (los hijos nuevos);
`modules/overrides/aumenta/FormacionOverview.jsx`.
*Comprobado en producción*: 12/08/2026 — en el menú de la demo salen los dos
nombres, «Usuarios» y «Alumnos por curso», uno debajo del otro.

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

### Analíticas de Aumenta: el módulo está, faltan las credenciales de su web · `aumenta`

Se le activó `analytics` el 13/08/2026 (venía de la tarea que proponía apagarle
los módulos vacíos y que Rodrigo dio la vuelta: los tres vacíos se quedan, lo que
faltaba era este). El menú y la pantalla ya están, pero enseñan «sin configurar»:
Analíticas lee Cloudflare Web Analytics con las credenciales DEL CLIENTE, no con
una nuestra, y Aumenta no las ha dado.

Hace falta pedirles dos cosas: el `accountId` de su cuenta de Cloudflare y un
token de API de solo lectura con permiso «Account Analytics: Read», que se pegan
en Configuración → Integraciones. Y que su web lleve el beacon de Cloudflare, o
no habrá visitas que contar. Nada de esto lo podemos hacer nosotros por ellos.

Mientras tanto, la captura diaria no pierde nada porque no hay nada que perder:
Cloudflare solo guarda 7 días, así que el histórico empieza el día que se
configure, no antes.

*Se comprueba*: entrar en `/analiticas` como Aumenta y ver visitas en vez de
«sin configurar».
*Dónde*: `lib/analytics/cloudflareConfig.js` (qué credenciales pide y por qué son
del cliente).
*Comprobado en producción*: 13/08/2026 — módulo activo y `web_visits_daily`
creada; de los siete clientes solo `spain_enzymes` tiene credenciales puestas.

---

## Pendiente de una decisión suya

Cosas que no se pueden hacer sin que Jorge o Rodrigo elijan. Van como tareas y
no como una lista suelta a propósito: así aparecen en el tablero. Cuando se
decida, la respuesta se escribe aquí y la tarea baja a su prioridad.

**Ahora mismo no hay ninguna.** Rodrigo contestó las seis que había el
12/08/2026; están en `resuelto.md` con la respuesta y con lo que se hizo después
de cada una. Un bloque vacío no se pinta en el Registro, así que esta sección
desaparece de la pantalla hasta que vuelva a haber algo que decidir.

