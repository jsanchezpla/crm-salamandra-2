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

### Desde el panel interno no se puede cerrar sesión · producto

El enlace «salir» de la barra del back-office es un enlace normal a
`/api/auth/logout`, o sea un GET. Ese endpoint **solo entiende POST**: en la
imagen desplegada la ruta registra exactamente un método —`["POST",0,R]`— así
que el navegador se lleva un 405 y la sesión sigue abierta. El CRM de los
clientes sí cierra bien porque su menú lo llama con `fetch(..., {method:"POST"})`.

No es cosmético por dónde pasa: el back-office es la pantalla que crea clientes,
les cambia los módulos y suspende cuentas, y es la que se queda abierta en un
portátil al terminar el día.

Al arreglarlo, que salga por POST desde un botón, como hace el sidebar del CRM,
**y no añadiendo un GET** a ese endpoint: un cierre de sesión por GET lo dispara
cualquier página ajena con una etiqueta de imagen. Es molesto más que peligroso,
pero no hace falta abrir esa puerta cuando el patrón bueno ya está escrito dos
carpetas más allá.

*Se comprueba*: pulsar «salir» en el back-office devuelve al login y la sesión
deja de valer.
*Dónde*: `app/admin/layout.jsx:104-110` es el enlace; `app/api/auth/logout/route.js:4`
es el único método que hay; `components/layout/Sidebar.jsx:408-411` es cómo lo
hace bien el CRM.
✅ **ARREGLADO Y DESPLEGADO el 12/08/2026**, a falta de pulsarlo. Ahora es un
botón que hace POST (`components/admin/SalirBoton.jsx`) y va a `/login` con
`replace`, para que el botón de atrás no devuelva a una pantalla del panel. No
se arregló añadiendo un GET al endpoint —habría sido una línea— porque un cierre
de sesión por GET lo dispara cualquier página ajena con una etiqueta de imagen.

*Comprobado en producción*: 12/08/2026 — en el contenedor, el `<a href>` ha
desaparecido del HTML servido de `/admin` y el componente nuevo viaja en un
bundle de cliente. **Falta el clic**: la sesión del panel caducó al reiniciarse
el contenedor con el despliegue, y quien la abra tarda dos segundos en probarlo.
Si funciona, esta tarea se cierra sin tocar código.

### «Pedirle otra tarjeta» no lleva a ninguna parte · todos

El aviso recomienda pedir otra tarjeta y el botón se pinta, pero el endpoint
responde 409: `failed` está dentro de `PUEDE_HABER_DINERO`, así que una tarjeta
rechazada cuenta como «ya hay dinero reservado». Si una tarjeta falla, no hay
salida: o reintentar o cancelar.

Ojo al arreglarlo: esa lista está deliberadamente de más —«preguntar a Stripe de
más es barato; darlo por perdido, no»—. La salida no es sacar `failed` de la
lista, es que el botón sepa distinguir.

**La prueba de que ese 409 sobra está en el propio fichero.** Catorce líneas más
abajo de la guarda, el endpoint calcula `motivo = row.paymentStatus === "failed"
? "rechazada" : "caducada"` y se lo manda a Stripe. El camino de la tarjeta
rechazada está escrito, pensado y con su palabra propia — y es inalcanzable,
porque la guarda de arriba lo corta antes de llegar.

**Antes de escribir código hay que elegir una cosa, y es de Rodrigo.** El caso
que justifica que `failed` esté en la lista es que la retención vieja siga VIVA
en Stripe (`requires_capture`). Dos salidas:

- (a) Que el botón la suelte solo y cree la nueva en la misma pulsación. Un
  clic, pero libera dinero de un paciente sin que nadie lo haya pedido.
- (b) Que devuelva 409 SOLO en ese caso, con el mensaje bueno —«ese cobro sigue
  vivo: reintenta el cobro o recházalo para soltarlo»— y que decida ella.

Si la retención vieja está muerta o cancelada, que es lo normal, se crea la
nueva sin más y el 409 desaparece con las dos opciones. Esto lo decide Rodrigo
porque en este repo la política de qué hace el CRM con el dinero de alguien está
reservada a humanos a propósito: en `lib/citas/reembolsoCita.js` se BORRÓ el
código de devoluciones automáticas en vez de dejarlo detrás de un interruptor,
justo para que nadie lo encendiera sin querer.

**Y no se toca `PUEDE_HABER_DINERO`.** Su envoltorio `tieneRetencionPendiente`
lo usan otros cuatro sitios que sí quieren la lista ancha: confirmar la cita
(dos veces), pasarla a confirmada o completada, y el reembolso. El arreglo
mínimo es una comprobación NUEVA al lado, que solo use este botón.

⚠️ Si se abre la guarda sin liquidar antes la retención vieja, al paciente le
quedan DOS retenciones a la vez sobre la misma cita —el doble del importe
bloqueado en su tarjeta hasta que la vieja caduque sola— y el CRM pierde el
rastro de la primera, porque `paymentSessionId` se pisa con la nueva. Eso
alcanza a todos los clientes con citas y cobro online.

*Se comprueba*: pulsarlo en una cita `failed` manda el correo en vez de dar 409,
y el paciente no acaba con dos retenciones.
*Dónde*: `app/api/citas/bookings/[id]/pedir-tarjeta/route.js:77-82` es la guarda
y `:91` el código que no se alcanza; `lib/citas/cobroCita.js:37` es la lista. Los
otros cuatro consumidores: `bookings/[id]/confirm/route.js:152` y `:161`,
`bookings/[id]/route.js:347` y `lib/citas/reembolsoCita.js:72`.
*Repasado en el código*: 12/08/2026 — la guarda, el código inalcanzable y los
cuatro consumidores siguen exactamente donde dice. Esto es lectura del repo, no
del VPS: lo que se añade hoy es la decisión que faltaba, no un hecho nuevo de
producción.
*Comprobado en producción*: 09/08/2026 — `failed` sigue en la lista.

---

## P2 — cuando se pueda

### «Fichas a completar» sale en el menú de quien no tiene nada que completar · `somos`, `demo`

En producción `somos` tiene esa pantalla en su menú y **cero filas en las ocho
carpetas**. Un cliente que acaba de entrar la abre el primer día, la encuentra
vacía y no vuelve a mirarla. A Aumenta le pasará lo mismo el día que termine la
campaña: hoy tiene 173 que bloquean y 1.800 por completar, pero la pantalla no
sabe desaparecer cuando ya no hace falta.

Lo que impide que esto sea de cinco minutos: **saber si hay algo cuesta cuatro
segundos**. Obliga a correr las seis consultas de `carpetasCon()`, que cruzan
pacientes, citas y el JSONB de tutores. Medido en el VPS: 3.997 ms en Aumenta,
23 ms en la demo, 18 ms en Somos. Meterlo tal cual en el menú añade cuatro
segundos a CADA carga de página del cliente que más lo necesita.

Salidas razonables: contar solo el bloque que bloquea, que son tres consultas y
las tres baratas; cachear el número; o cargarlo aparte y esconder la entrada
cuando ya se sepa. El hueco donde encajaría ya existe: cada entrada del menú
tiene un campo `badge` que hoy vale `null` en las cuatro que lo declaran.

*Se comprueba*: en un cliente con `clients_avanzado` y cero huecos la entrada no
sale; en Aumenta sale, y con su número al lado.
*Dónde*: `components/layout/Sidebar.jsx:60` es la entrada y `:542` el badge sin
usar; `lib/clients/urgentes.js:253` es `carpetasCon()`.
✅ **ARREGLADO Y DESPLEGADO el 12/08/2026**, a falta de verlo en un menú.
`lib/clients/urgentes.js` se partió en `cuerpoDe()` —el FROM y el WHERE de cada
carpeta, escritos UNA sola vez— y encima se montan las dos consultas: la que
lista y la que cuenta. Escribir el WHERE dos veces habría roto sola la regla de
la cabecera. El menú pide `/api/clients/urgentes?soloTotales=1` y esconde la
entrada si sale cero; enseña además cuántas BLOQUEAN, no las 1.800 por
completar, que sería un número que no baja nunca.

*Comprobado en producción*: 12/08/2026 — las **24 cuentas** de aumenta, demo y
somos cuadran al registro con lo que devuelve el listado, incluida la resta de lo
archivado, y Aumenta pasa de **3.340 ms a 16 ms**. **Falta verlo en un menú**:
para eso hace falta entrar como Somos (para que NO salga) o como Aumenta (para
que salga con su 173), y no hay motivo para abrir esas sesiones solo por esto —
se verá la próxima vez que alguien entre.

### Las cinco pantallas de Formación solo se encuentran desde su portada · `retorika`, `aumenta`, `nutri_laura`, `demo`, `somos`

Formación es la única entrada grande del menú **sin hijos**. Clientes, Citas,
Leads o Equipo despliegan sus pantallas en el propio menú; Formación es un enlace
suelto a `/formacion`, y sus cinco secciones —Empresas, Cursos, Usuarios, Alumnos
por curso y Cuestionarios— viven dentro como tarjetas. Para ir de Cursos a
Alumnos hay que volver a la portada.

Encima los nombres se pisan: **«Usuarios» son las personas y «Alumnos por curso»
son las matrículas**, y la tarjeta de Usuarios se describe justamente como
«alumnos privados y de empresa». Arriba, el recuadro de métricas vuelve a decir
«Usuarios» y «Matrículas», que es un tercer par de palabras para lo mismo. La
prueba de que no se entiende está escrita en la propia ayuda de Empresas, en
mayúsculas: «IMPORTANTE: los alumnos de empresa se importan desde aquí» — porque
quien quiere dar de alta alumnos entra en Usuarios, que es donde no se hace.

*Se comprueba*: desde cualquier pantalla de Formación se llega a las demás sin
pasar por la portada, y nadie tiene que preguntar en qué se diferencian dos
secciones.
*Dónde*: `components/layout/Sidebar.jsx:304-316` es la entrada sin hijos,
`modules/training/FormacionOverview.jsx:7-63` son las cinco secciones y
`modules/overrides/aumenta/FormacionOverview.jsx` es la versión de Aumenta, que
solo ve tres.
✅ **ARREGLADO Y DESPLEGADO el 12/08/2026**, a falta de verlo en un menú. Las
cinco pantallas cuelgan ya de la entrada de Formación. **Los rótulos NO se han
tocado**: renombrar «Usuarios» y «Alumnos por curso» le cambia el vocabulario a
cinco clientes de golpe y es otra tarea, que es lo que queda de esta.

Nació de paso `TENANT_HIDDEN_CHILDREN` en el sidebar: la portada de Aumenta
esconde a propósito Empresas y Cuestionarios —es psicopedagogía, su formación es
B2C— y sin eso el menú le habría devuelto por el lateral las dos pantallas que
su propia pantalla le quita.

*Comprobado en producción*: 12/08/2026 — los hijos nuevos viajan en los bundles
desplegados. **Falta verlo en un menú** (hace falta una sesión de un cliente con
Formación), y falta decidir lo de los nombres.

### Custodia sabe qué claves le faltan a cada cliente, pero no puede ponérselas · producto

La portada del back-office ya dice, cliente por cliente, qué credenciales tiene
puestas y cuáles le faltan — hasta con la frase «Ya tiene todas las claves
puestas. No hay nada que pedirle». Lo que no puede hacer es ponerlas: hoy la
única forma es que entre el cliente, en su propia Configuración.

Y no entran. 1 de 9 clientes tiene clave de Anthropic —y somos nosotros— y 0 de
9 la de OpenAI, con once disparadores de IA desplegados y sin usar por nadie.

Jorge, 12/08: que las pueda poner el cliente **o** nosotros desde Custodia.

⚠️ Esto NO rompe la regla escrita de ese endpoint, y conviene decirlo porque
parece que sí. La regla es que **no descifra nada** —«no existe un caso legítimo
en el que haga falta LEER la clave de Stripe de un cliente»— y sigue en pie tal
cual: escribir una clave no obliga a leer la anterior. El campo tiene que ser de
solo escribir: se pega, se cifra con `secretBox` igual que lo hace la
Configuración del cliente, y no se devuelve nunca, ni enmascarado.

Y falta el otro medio recado del mismo día: **no hay dónde apuntar el correo de
contacto de un cliente**. El alta pide un `adminEmail`, pero eso es el USUARIO
con el que entra —si se deja vacío se inventa `admin_{slug}`—, no a quién se le
escribe cuando hay que pedirle algo.

*Se comprueba*: pegar la clave de Anthropic de un cliente desde `/admin`, que su
CRM la use, y que ninguna pantalla la devuelva.
*Dónde*: `app/api/admin/configuraciones/route.js:10-27` es la regla de no
descifrar y `app/admin/page.jsx:356` la frase de arriba; el guardado del lado del
cliente está en `app/api/tenant/settings/route.js` y el cifrado en
`lib/crypto/secretBox.js`.
*Comprobado en producción*: 12/08/2026 — 1 de 9 con Anthropic y 0 de 9 con
OpenAI; el endpoint del back-office es de solo lectura y en el alta no hay ningún
campo de contacto.

### Los paquetes de módulos están escritos en el código · producto

En el alta hay dos botones —«Paquete Nutrición» y «Paquete Clínica»— que marcan
de golpe sus módulos, y luego se añade o se quita a mano. Funciona, pero los dos
están escritos dentro de `lib/provisioning/catalogo.js`: inventar un tercero, o
cambiar qué lleva uno, es tocar código y desplegar.

✅ **HECHO Y DESPLEGADO el 12/08/2026**, a falta de crear uno con las manos.
Pestaña **Paquetes** en el back-office, tabla `master.paquetes_modulos` y los dos
de siempre sembrados por la migración.

Las dos preguntas que esta tarea tenía abiertas quedaron contestadas por Jorge:
«los clientes no tienen ningún paquete, solo módulos puestos a su gusto,
quédalo así, y que se puedan ambas formas». O sea que **ningún tenant guarda
paquete** —sin FK, sin columna, sin asociación— y editar o borrar uno no le
cambia nada a nadie. El alta lo dice ahora con un rótulo, «Cómo se monta», con
los paquetes y «Personalizado» al lado; en cuanto se toca una casilla vuelve a
Personalizado, que es como está dado de alta todo el mundo.

El freno que se perdía —«solo se escribe aquí un paquete cuando está DECIDIDO
qué lleva»— se rehízo en `lib/provisioning/paquetes.js`: no se guarda uno con
módulos que no existen ni con dependencias que no se sostienen, y NO se
completan solas (se dice qué falta y la pantalla ofrece añadirlo).

**Lo que queda de esta tarea es contenido, no código**: los dos paquetes de hoy
son los dos de salud, y sigue sin haber ninguno para el perfil comercial —el de
spain_enzymes, retorika y abarcaia—. Eso ya se puede hacer desde la pantalla, sin
tocar el repo.

*Se comprueba*: crear un paquete desde el back-office y verlo aparecer en el alta
sin desplegar.
*Dónde*: `app/admin/paquetes/page.jsx`, `app/api/admin/paquetes/`,
`lib/provisioning/{paquetes,paquetesStore}.js`.
*Comprobado en producción*: 12/08/2026 — la migración corrió y la tabla tiene los
dos paquetes; leídos desde dentro del contenedor con el mismo código que usa el
alta. Los frenos, probados contra los nombres que hay allí: nombre repetido
→ 409, `billing` suelto → 422 «hace falta también Clientes», módulo inventado
→ 422. Y `scripts/_smoke-paquetes.mjs` los fija sin base de datos, 24 de 24.
**Falta crear uno desde la pantalla**: la sesión del panel caducó al reiniciarse
el contenedor con el despliegue.
*Comprobado en producción*: 12/08/2026 — dos paquetes, ambos de salud, ambos
escritos en el código.

### Una sola demo para todos los oficios · `demo`

La demo pública entra siempre al mismo sitio: el slug está escrito en el código
(`DEMO_SLUG = "demo"`) y esa cuenta tiene **20 módulos activos a la vez** —
clínica, nutrición, inventario, pedidos, facturación, formación, captación,
proyectos y soporte. Una nutricionista que entra a verla se encuentra un centro
de psicología con almacén; un centro clínico se encuentra un recetario.

Jorge, 12/08: hacer demos por oficio, al menos una clínica y una de nutrición.

Lo que hay que resolver antes de sembrar nada es **cómo elige el visitante**. Hoy
el botón hace un POST a `/api/auth/demo` que no admite ningún parámetro, así que
o se abre a un slug pedido —con lista blanca, nunca el slug tal cual, que sería
la puerta para entrar en cualquier cliente— o hay un botón por demo.

Y cada demo nueva se lleva consigo su copia dorada, que es lo que la deja
impecable para el siguiente visitante. Esa copia ya está desincronizada y su
restauración se abandona a medias (ver la tarea de la demo pública, más abajo):
multiplicar demos sin arreglar eso antes multiplica el problema por tres.

*Se comprueba*: desde la web se puede entrar a una demo de nutrición y a una
clínica, y cada una se limpia sola entre visitantes.
*Dónde*: `app/api/auth/demo/route.js:10` es el slug escrito a mano;
`scripts/demo-golden-snapshot.js` es la copia.
*Comprobado en producción*: 12/08/2026 — un solo tenant de demo, con 20 módulos
encendidos.

### Aumenta necesita el formulario de profesionales en su web · `aumenta`

Recado de Jorge, 12/08. Aumenta tiene los dos orígenes de leads encendidos
—Profesionales y Comerciales— y **un solo formulario público**: «familias»
(«Cuéntanos qué necesitáis»), que ya ha recogido 20 solicitudes. Falta el otro:
el de los profesionales que derivan pacientes —colegios, pediatras, otros
gabinetes— incrustado en su WordPress.

No es programar. Un formulario es una FILA de la tabla `forms` —las preguntas son
datos, no código— así que se hace con un seed como los que ya existen y se pega
el embed en su web, sin desplegar el CRM. El límite conocido de la v1 es que
Aumenta no podrá editarse las preguntas sola: las cambia quien administra,
relanzando ese script.

*Se comprueba*: el formulario de profesionales está publicado en la web de
Aumenta y sus solicitudes caen en la bandeja de Comerciales.
*Dónde*: `docs/modules/formularios.md`; los seeds de ejemplo son
`scripts/seed-formulario-*.js`.
*Comprobado en producción*: 12/08/2026 — Aumenta tiene 1 formulario activo
(«familias») y 20 solicitudes; nutri_laura tiene 2 formularios y 70 solicitudes.

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

✅ De aquí salió un cabo suelto que **ya está atado** (12/08/2026): `CLAUDE.md`,
`docs/modules/nutricion.md` y la decisión del sub-sprint 8.3 decían que había
media nutrición «pendiente de despliegue», y llevaba semanas desplegada. Se
comprobó listando los endpoints dentro del contenedor —los 23 de
`/api/nutricion/*` son exactamente los mismos que en local— y se corrigieron las
cuatro afirmaciones. Quien coja esta tarea ya no leerá que falta código por
subir; lo que falta es lo de abajo.

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

### La demo pública ya no se limpia sola · `demo`

La demo se rehace desde una copia «dorada» para que cada visitante la encuentre
impecable. Esa copia se quedó atrás respecto a la base: el estado de cobro de
las citas admite hoy nueve valores y la copia solo conoce cinco, así que al
restaurar choca y la restauración se abandona sin ruido. La demo sigue en pie,
pero lo que ensucie un visitante se lo encuentra el siguiente — y es la
herramienta con la que se enseña el CRM.

*Se comprueba*: el estado de cobro tiene los mismos valores en `crm_demo` y en
`crm_demo_golden`, y una restauración termina sin error.
*Dónde*: se regenera con `scripts/demo-golden-snapshot.js`, siempre después de
sembrar.
*Comprobado en producción*: 10/08/2026 — `enum_bookings_payment_status` tiene
**9 valores en `crm_demo` y 5 en `crm_demo_golden`**; a la copia le faltan
`authorized`, `authorizing`, `capturing` y `void`.

---

## P3 — deuda

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

---

## Pendiente de una decisión suya

Cosas que no se pueden hacer sin que Jorge o Rodrigo elijan. Van como tareas y
no como una lista suelta a propósito: así aparecen en el tablero. Cuando se
decida, la respuesta se escribe aquí y la tarea baja a su prioridad.

**Ahora mismo no hay ninguna.** Rodrigo contestó las seis que había el
12/08/2026; están en `resuelto.md` con la respuesta y con lo que se hizo después
de cada una. Un bloque vacío no se pinta en el Registro, así que esta sección
desaparece de la pantalla hasta que vuelva a haber algo que decidir.

