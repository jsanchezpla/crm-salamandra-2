# 2026-08-27 — El Calendario convoca: enlace de videollamada y correo

**Quién decidió**: Rodrigo, 27/08/2026.

## Antes: la tarea decía «quizá sobra»

El backlog tenía apuntado que `/calendario` estaba encendido en siete clientes
con CERO tareas reales, y proponía decidir si retirarlo. Rodrigo lo cerró al
revés:

> «Es un calendario de reuniones entre profesionales y no de citas con un
> cliente. Me da igual si lo usan o no; está ahí, va pagado, y lo importante es
> que esté conectado con el resto del CRM para que, en caso de que quieran
> usarlo, puedan hacerlo de la mejor manera posible.»

O sea: no se retira y no se redecora, **se conecta**. Y el primer cable que
faltaba es el que pidió a continuación: poder crear el enlace de la
videollamada y mandárselo por correo a quien se convoca.

## El enlace se PEGA, no se genera

Se valoró generar salas al vuelo (Jitsi crea una sala pública sin cuenta) y se
descartó: el CRM no tiene integración con Google ni Zoom, y meter un servicio
público de terceros en las reuniones de coordinación de una clínica es una
decisión de otro calibre. Se sigue el patrón que ya existe en Citas
(`lib/citas/videollamada.js`): quien convoca abre la sala donde quiera —Meet,
Zoom, Teams, la del colegio profesional— y pega el enlace.

**La validación no lleva lista blanca de dominios**, a propósito: solo se exige
que sea una URL `http(s)`. Rechazar el enlace bueno de un proveedor que no
habíamos previsto es peor que el problema que evitaría (mismo razonamiento que
los prefijos de credenciales en `credencialesCliente.js`).

## El correo NO sale solo

En Citas, el enlace se manda automáticamente al detectar la transición
`meetUrl` null→valor. **Aquí no**, y es deliberado: un evento del calendario se
arrastra, se estira y se reajusta muchas veces, y un correo por cada roce sería
ruido para alguien que no lo ha pedido. En Citas el destinatario es la familia
que espera ese enlace; aquí es un colega al que se convoca a propósito.

Manda quien guarda, con la casilla «Mandarle la convocatoria al guardar»
(`enviarInvitacion: true`). Se puede reenviar volviendo a marcarla, y la
pantalla dice cuándo salió la última vez.

## Lo que no se repite

- **El «✓ enviado» mentiroso** (incidente del 03/08/2026, en
  `lib/email/resendClient.js`): si el cliente no tiene Resend configurado, el
  envío se queda en simulacro y devuelve `ok`. Aquí se pasa por
  `envioRealizado`, el servidor devuelve `envio: {enviado, motivo}` y la
  pantalla **no cierra el modal** cuando el correo no salió: dice que el evento
  sí se guardó y que el correo no, con el motivo.
- **La fecha desplazada un día** (la agenda importada del 26/08/2026):
  `startDate` es un DATEONLY y `new Date("2026-08-27")` es medianoche UTC. La
  plantilla compone la fecha a mano desde `YYYY-MM-DD` sin pasar por la zona
  horaria, y hay una prueba que lo fija.

## Detalles

- El correo sale con las credenciales **del tenant**: es su reunión, no
  nuestra (al revés que el buzón o la recuperación de contraseña).
- Un solo destinatario. Convocar a una lista pide un modelo aparte que hoy no
  hace falta.
- La migración es CORE y no del módulo `calendar`: el modelo `CalendarTask`
  declara las tres columnas para TODOS los tenants, así que Sequelize las pide
  en cada SELECT tenga el módulo o no — dentro del módulo sería un 42703
  esperando (el incidente del 21/07/2026).
- De regalo: al migrar por `LIKE 'crm_%'`, las columnas entran también en los
  schemas `_golden` de las demos, así que **esta vez las fotos doradas no se
  quedan atrás** — el problema recurrente que está apuntado como decisión de
  Jorge.

## Comprobado (local, 27/08/2026)

Enlace mal pegado → 422 con frase en cristiano; correo mal → 422; guardar sin
marcar la casilla → `envio: null` (no se manda nada); marcarla sin Resend
configurado → `{enviado:false, motivo:"sin_configurar"}` y `inviteSentAt` sigue
vacío; con remitente del tenant → el correo se compone con su dirección, el
asunto lleva «jueves 3 de septiembre de 2026, de 10:30 a 11:30» (sin desfase) y
el enlace dentro. Nueve pruebas en `scripts/_smoke-calendario-invitacion.mjs`.
