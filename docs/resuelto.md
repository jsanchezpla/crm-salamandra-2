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

## 13/08/2026

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
