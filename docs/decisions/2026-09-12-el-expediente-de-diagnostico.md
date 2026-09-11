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
