# El diagnóstico es un expediente, y su bono no tiene tope

**Fecha:** 12/09/2026 (Rodrigo con Isa, de Aumenta). **Toca a:** `clinica`
(el apartado nuevo «Diagnósticos»), `citas` (el alta de una cita de
diagnóstico), `billing` (el bono sin tope y sus cobros pendientes),
configuración (los productos).

## Contexto

Aumenta vende el diagnóstico como un **producto cerrado de horas**: «simple»
(10 h: 1 de entrevista inicial + 9) y «completo» (20 h: 1 + 19), a 350 y
650 €. El CRM lo tenía a medias desde el 05/09 (AV-0045): existían el tipo de
cita DIAGNÓSTICO, el concepto del catálogo y el informe de valoración
diagnóstica, pero **nadie sabía por dónde iba cada niño** —cuántas horas se
han dado, cuántas están puestas en la agenda, cuántas quedan— ni había una
lista de «pacientes en diagnóstico». Isa lo llevaba a mano, y el día que a un
niño se le apuntaba la undécima hora de un producto de diez, se enteraban al
facturar.

Además, el dinero del diagnóstico tiene una forma que ninguna pieza del CRM
tenía: **no se cobra hasta que la familia decide**. La entrevista inicial se
da sin cobrar nada; después, o la familia para (y se le cobra la entrevista,
50 €) o sigue (y se le cobra el producto entero, con la entrevista dentro).

## Decisión

1. **Es un apartado de Clínica, no un módulo.** `/clinica/diagnosticos` con
   `moduleKey` `clinica`: se lo venderíamos a cualquier clínica que haga
   diagnósticos, y todas las piezas que necesita —pacientes, citas, bonos,
   conceptos— ya están en los módulos que un centro así tiene. No hay nada
   que vender aparte.

2. **Un expediente por diagnóstico** (`diagnosticos`): de UN paciente, de UN
   producto, con un terapeuta asignado y un estado. Es la fila que responde a
   «¿en qué punto va?» y a la que se enganchan la cita de la entrevista
   (`bookings.diagnostico_id` + `diagnostico_tramo`), las sesiones
   (`clinic_sessions.diagnostico_id`), el bono (`session_packs.diagnostico_id`)
   y, en la segunda entrega, el informe (`informe_id`). Sin FK duras, como
   `taller_grupo_id`: apunta a tablas de cuatro módulos y no todos los schemas
   las tienen.

3. **La barra de horas se CUENTA, nunca se guarda.** Igual que en los bonos: un
   contador hay que acordarse de moverlo en cada cancelación, reprogramación y
   falta, y basta olvidar uno para que mienta. Las citas son la verdad
   (`lib/clinica/diagnostico.js`, `horasDe`), con **la regla de los bonos**
   (`lib/citas/gastaSesion.js`): completada, falta injustificada y cancelación
   tardía cuentan; cancelada a tiempo o falta justificada no; las futuras
   RESERVAN y bloquean. Cada cita vale su duración; la entrevista vale 1 h
   dure lo que dure. Lo único que se guarda es el **tope** (`horas_max`), porque
   es una decisión de alguien: nace del producto y solo lo sube dirección o
   administración («Desbloquear horas», con quién y cuándo).

4. **El dinero nace al decidir, y por las puertas que ya había.** La entrevista
   se apunta `sin_coste` con «Diagnóstico: el cobro nace al decidir si sigue».
   «Parar» crea un cobro PENDIENTE de la entrevista (el concepto del tipo
   marcado como valoración inicial si tiene precio; si no, 50 €). «Seguir»
   crea **un bono del tipo DIAGNÓSTICO SIN TOPE** (`session_packs.total_sessions`
   a NULL) y su cobro PENDIENTE de 350/650 € por `crearBonoConSuCobro`, la
   misma transacción que un bono dado a mano. Quien decide es quien da bonos
   (`puedeDarBonos`: dirección o quien lleve Facturación).

5. **El bono no tiene tope porque el tope es del expediente.** Un diagnóstico
   se mide en horas y sus sesiones duran distinto —una tarde de pruebas son
   3 h—; un bono de N sesiones no puede decirlo. Así que el bono solo ata las
   citas a la familia y al tipo, y es `cabeHora` del expediente quien las
   frena (422 «El diagnóstico ya tiene sus N h: desbloquéalas desde
   Diagnósticos»). `estadoPack`, `elegirPack`, `cobroDeBono` y
   `/facturacion/bonos` aprenden a leer el null como «sin tope».

6. **Citas recibe el expediente por una URL con contrato**
   (`lib/citas/altaDesdeDiagnostico.js`, con prueba):
   `/citas?nueva=1&diagnostico=<id>&tramo=entrevista|horas&paciente=<id>&duracion=60`.
   El cajón de alta pone el tipo DIAGNÓSTICO, fija al paciente, esconde el
   bono y el bloque de cobro y, en las horas, pregunta la duración (múltiplos
   de 30). El POST comprueba en el servidor que la cita es del paciente del
   expediente y que cabe; la duración del cuerpo solo se escucha con
   `diagnosticoId`.

7. **Los productos son un dato del centro** (`settings.clinica.diagnosticos`),
   con caída a simple/completo y el concepto buscado por nombre si nadie lo
   fija. Nada de Aumenta a fuego: sus conceptos «Diagnóstico Simple» y
   «Diagnóstico Completo» se encuentran solos.

## Alternativas descartadas

- **Un módulo `diagnosticos` aparte.** Es la pregunta de la regla 16:
  «¿se lo venderíamos a un segundo cliente?» Sí, pero solo a uno que ya tenga
  Clínica, Citas y Facturación, y no añade nada que se cobre aparte. Un módulo
  más sería una puerta más que abrir en `enable-module.js` y en
  `users.module_access` para lo que es una pantalla de Clínica.
- **Guardar `horas_hechas` en el expediente** y sumarlas al completar cada
  cita. Es lo que se descartó en los bonos el 07/09 y por lo mismo: un
  contador que se mueve desde cinco sitios (completar, cancelar, falta,
  justificar, reprogramar) miente a la primera que se olvida uno.
- **Un bono de 10 o 20 sesiones** en vez de sin tope. Las sesiones de
  diagnóstico no duran igual, y el producto se mide en horas: un bono de 10
  sesiones de 3 h son 30 h. Y desbloquear horas obligaría a editar el bono.
- **Un tipo de cita por producto** («DIAGNÓSTICO SIMPLE», «DIAGNÓSTICO
  COMPLETO») con su `sessionsCount`. Duplica tipos, fija la duración por
  tipo (que es justo lo que no vale) y el catálogo de Aumenta ya tiene 63.
- **Cobrar la entrevista al apuntarla** y descontarla del producto al seguir.
  Nace un cobro que la mitad de las veces hay que anular, y el descuento
  sería un tercer camino en Cobros; con «el cobro nace al decidir» no hay
  nada que deshacer.
- **Dejar que `no_continua` vuelva a `en_curso`.** Ya nació el cobro de la
  entrevista y seguir después obligaría a decidir qué pasa con él. Si la
  familia cambia de idea, se abre otro diagnóstico; si alguien lo pide, se
  abre la transición en `puedePasarA`, no en un endpoint.

## Consecuencias

- `session_packs.total_sessions` pasa a admitir NULL en TODOS los schemas con
  bonos (`migrate-diagnosticos`, por tabla y ANTES del despliegue, como
  `bookings.diagnostico_id`); todo lo que lea un bono tiene que tratar el
  null como «sin tope» y no como 0. Hoy lo hacen `estadoPack`, `elegirPack`,
  `cobroDeBono`, `bonoSinTope`/`rotuloDelBono` y la pantalla de Bonos, que
  además no ofrece «Renovar» ni «Volver a darlo» sobre uno (copiaría el null y
  nacería con tope).
- La regla «qué cita gasta sesión» vive en `lib/citas/gastaSesion.js` y
  `packs.js` la re-exporta: si cambia la frontera de 24 h, cambia en bonos y
  en diagnósticos a la vez.
- Una cita con `diagnosticoId` **ignora `packId` y `cobro` del cuerpo**: el
  bono lo dice el expediente y el dinero lo pone el servidor. El widget
  público y los clientes viejos no mandan `diagnosticoId`, así que para ellos
  no cambia nada.
- El registro de la entrevista de un diagnóstico se escribe con la plantilla
  `entrevista_inicial` aunque su tipo de cita sea DIAGNÓSTICO
  (`lib/clinica/plantillaDeLaCita.js`): la regla dejó de ser un ternario del
  modal y tiene nombre y prueba.
- El cobro de la entrevista no tiene columna que lo ate al expediente: la
  lista lo reconoce por paciente + nota + fecha. Reescribir esa nota a mano lo
  desengancha de la lista (el cobro sigue en Cobros). `entrevista_payment_id`
  es candidato para la segunda entrega, junto con los registros de
  diagnóstico por fecha y «Unir en informe».
- Auditoría: una línea por acción (`diagnostico.abierto`, `.parado`,
  `.seguido`, `.horas_desbloqueadas`, `.cerrado`, `.terapeuta_cambiado`,
  `.editado`), con resumen y sin datos clínicos, bajo «Clínica».
- Detalle de pantallas, endpoints, fila y pruebas en `docs/modules/clinica.md`
  («Diagnóstico: el expediente con su barra de horas» y «Diagnósticos: la
  lista y lo visible») y `docs/modules/citas.md` («La cita de un diagnóstico»).

## Segunda entrega (12/09/2026, tras las respuestas de Aumenta)

La misma tarde, Aumenta contestó a las preguntas del PDF y Rodrigo pidió lo
que faltaba: «Informe de diagnóstico por paciente: entradas por fecha y título
(registros de diagnóstico, con IA como un registro de sesión) que al final se
unen con IA en el informe completo». Tres respuestas de Isa cambiaron además
lo ya decidido: **(A)** los apartados del registro son los cinco que se les
propuso menos «notas internas» («ese informe es el que se entrega al
paciente»); **(B)** las citas de «INFORME PARA DIAGNOSTICO» SON horas del
diagnóstico, y una entrevista inicial de terapia hecha antes de decidir cuenta
como la primera hora y **sus 50 € ya cobrados se descuentan del producto**;
**(C)** los seis pacientes que ya están en diagnóstico los dan de alta ellos,
«lo único que hay que saber cómo hacerlo».

12. **Un registro de diagnóstico es una `clinic_sessions` con `diagnostico_id`,
    y el informe es un `clinical_reports`.** Ni módulo ni tabla nuevos: es el
    mismo registro de sesión de siempre —apartados de plantilla, audio →
    Whisper → IA, firma con desplegable— escrito con la plantilla de fábrica
    `sesion_diagnostico` (los cinco apartados de la respuesta A) y con un
    TÍTULO, porque es una entrada de un índice. Solo dos columnas:
    `clinic_sessions.titulo` VARCHAR(160) y
    `diagnosticos.entrevista_payment_id` UUID. **A qué expediente se ata lo
    decide el SERVIDOR**, nunca el navegador: con cita, el de la cita (si la
    cita es de este paciente); sin ella, el del cuerpo solo si existe y es del
    MISMO paciente; y el `PATCH` lo escribe una vez y no lo pisa, como
    `bookingId`. Atar una nota clínica al expediente de otro niño no es un
    error de formulario.

13. **«Unir en informe» son dos pasos y ninguno inventa.** `POST
    /[id]/informe` crea el informe de valoración diagnóstica del expediente
    una sola vez (`informe_id`, con cerrojo en la transacción), firmado por el
    terapeuta asignado; `POST /[id]/unir` junta el texto de los registros
    TERMINADOS (`registered`/`published`: un borrador no es material) y se lo
    da a `structureInforme`, que devuelve la propuesta **SIN guardar**, con
    los mismos gates y el mismo contrato que el dictado
    (`reports/[id]/desde-material`, que es su molde). La profesional acepta
    apartado por apartado en `PropuestaIA`. Al material no viajan nunca
    `prepText`, `prepFiles`, `internalNotes` ni `aiTranscription` —la
    consulta ni siquiera los pide—, ni el nombre del paciente.

14. **El expediente tiene ficha propia** (`/clinica/diagnosticos/[id]`) con
    tres bloques —Registros, Citas e Informe— y las MISMAS acciones que la
    lista, compartidas por un hook (`useAccionesDeDiagnostico.js`) y no
    copiadas. El enlace «Informe» de la lista deja de llevar a la ficha del
    paciente con `?informe=diagnostico`: ahora solo existe cuando el informe
    existe, y el informe nace desde el expediente.

15. **La entrevista ya cobrada se DESCUENTA del producto** (respuesta B), no
    se anula ni se vuelve a cobrar: `cobroDelProducto(producto, concepto, {
    descuentoEuros })` da `max(0, precio − descuento)` y la nota lo dice
    («Diagnóstico Completo (descontada la entrevista inicial de 50 €)»). El
    cobro se ata por `entrevista_payment_id` —`parar` lo escribe, y el alta
    que adopta también—, así que deja de reconocerse por nota + fecha; un
    cobro pendiente descuenta igual que uno cobrado (la familia debe la
    entrevista, no la entrevista más el producto entero), y uno devuelto no
    descuenta nada. Cada fila dice su propio `cobroAlSeguir`, que es lo que
    la pantalla anuncia en la confirmación.

16. **«Empezar desde lo que ya hay»** (respuesta C): `GET
    /api/clinica/diagnosticos/candidatos` lista, con buscador y ventana de
    meses, los pacientes con citas de diagnóstico o entrevista hecha y sin
    expediente, y el alta (`POST /api/clinica/diagnosticos` con `adoptar`)
    mete todo eso dentro en la MISMA transacción que el `create`. Qué es una
    cita de diagnóstico se decide **por columnas** (`event_types.informe_tipo
    = 'diagnostico'`, `is_initial_assessment`) y jamás por el nombre del tipo
    ni por un id de Aumenta.

### Alternativas descartadas (segunda entrega)

- **Guardar el número del registro** («Sesión de diagnóstico 3») en una
  columna, o un contador en el expediente. Es la misma trampa que las horas
  (decisión 3): borrar el segundo registro dejaría un índice que salta del 1
  al 3, y corregir una fecha no lo reordenaría. El número se CUENTA por orden
  de fecha entre los que no son la entrevista (`registrosPorFecha`), y un
  título escrito a mano conserva su sitio pero no su número. Lo único que se
  guarda es lo que una persona escribió.
- **Anular el cobro de la entrevista al seguir**, o cobrar el producto entero
  y devolver 50 €. Las dos dejan rastro en Cobros de algo que nunca pasó —una
  devolución que la familia no vio, o un cobro anulado que sí facturó— y
  obligan a mirar dos filas para saber cuánto se ha cobrado. Descontar es una
  sola fila, con el motivo escrito en su propia nota.
- **Que el navegador mande la lista de citas que se adoptan.** Sería el
  camino corto: la tabla de candidatos ya las tiene calculadas. Pero una
  lista de ids desde el navegador es una lista de ids: bastaría cambiar una
  para meter en el expediente de un niño la cita de otro. El servidor las
  RECALCULA con las mismas reglas y del cliente solo acepta
  `entrevistaBookingId` —y lo comprueba contra el paciente antes de
  escribirlo—; cada UPDATE exige además `diagnostico_id IS NULL` y el
  paciente, para no robarle una cita a otro expediente.
- **Que «Unir» escriba el informe.** Es lo que pediría el botón, y es justo
  lo que no puede hacer: un informe clínico lo firma una persona, y una IA
  que sobrescribe lo ya redactado borra trabajo sin preguntar. `/unir`
  devuelve la propuesta y lo único que guarda es `sourceSessionIds`
  —metadatos: el anexo del PDF—. Tampoco se dispara sola al llegar con
  `?unir=1`: cada llamada la paga el centro.
- **Cambiar la regla de `gastaSesion` para las citas pasadas en
  `confirmed`.** En Aumenta nadie las marca como hechas, así que un
  expediente recién adoptado enseña como RESERVADAS horas que ya se dieron.
  Tentador, y no: es la regla de los BONOS, y tocarla cambiaría lo que cuenta
  y lo que se cobra en todos los bonos del CRM. Se dice en la doc y en la
  guía: marcar la cita como «hecha» es lo que la mueve de tramo.

### Consecuencias (segunda entrega)

- `scripts/migrate-diagnosticos-2.js` **VA ANTES del despliegue** (los modelos
  ya declaran `titulo` y `entrevista_payment_id`), registrada en los bloques
  `clinica` y `pacientes` —no en `citas`: `bookings` no cambia—.
- `PATCH /api/clinica/reports/[id]` admite `therapistId` (del equipo): la
  cabecera del editor del informe gana el desplegable «Firma».
- `GET /api/clinica/diagnosticos/[id]` ESCRIBE en un caso: si `informe_id`
  apunta a un informe borrado o de otro paciente, limpia la columna y
  devuelve `informe: null`, para que la ficha vuelva a ofrecer «Unir en
  informe» en vez de un botón que abre un 404.
- Auditoría nueva: `diagnostico.informe_creado` y `diagnostico.informe_unido`
  (ids y recuentos, nunca texto clínico); `.abierto` gana `adoptadas`,
  `.seguido` el `descuento`, `.parado` el `yaExistia`.
- Detalle en `docs/modules/clinica.md` («Diagnóstico, segunda entrega: los
  registros por fecha, «Unir en informe» y empezar desde lo que ya hay»).
