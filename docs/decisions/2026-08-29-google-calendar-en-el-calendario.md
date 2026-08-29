# 2026-08-29 — El Calendario se espeja en Google Calendar (y convoca a una lista)

**Quién decidió**: Rodrigo, 29/08/2026.

## Qué pidió

Dos cosas que son una:

1. **«Afecta a»**: un evento del Calendario puede señalar a qué miembros del
   equipo afecta, en un desplegable múltiple con una opción **«Todos»** que los
   marca de golpe. Es la lista que la decisión de la videollamada (27/08) dejó
   anunciada — «convocar a una lista pide un modelo aparte» — y el modelo aparte
   es `calendar_task_attendees`.
2. **Google Calendar**: si el tenant tiene comprado el módulo **Calendario**, a
   Equipo básico se le desbloquea conectar su cuenta de Google. El CRM le crea
   un calendario llamado **«CRM Salamandra»** (renombrable allí: guardamos el
   id, no el nombre) y los eventos donde esa persona aparece salen en su Google
   directamente.

## Las decisiones que alguien preguntará

- **La puerta es `calendar` + `team`** (básico, nunca `team_avanzado`): el
  Calendario es lo que se compra; el Equipo es quien pone a las personas. Vive
  en `googleCalendarDisponible()` (`lib/calendar/googleCalendar.js`), un `if`
  con nombre, no suelto por el JSX (regla 16, los tres peros).
- **Se sincroniza a quien está en «Afecta a», y solo a esa lista.** El
  responsable que no esté en ella no recibe el evento: una sola regla explica
  todo lo que aparece en un Google, y «y además el responsable» la rompería.
- **«Todos» es una foto, no una regla viva**: marca a todos los miembros de HOY.
  Quien entre en la plantilla mañana no se cuela en eventos viejos.
- **Credenciales BYOK**, como GoCardless y Stripe: la app OAuth es del tenant
  (Configuración → Conexiones, `googleCalendarClientId` a la vista +
  `googleCalendarClientSecret` cifrado). Sin fallback al `.env`: los tokens del
  equipo de un cliente no pasan por una app nuestra.
- **El scope es el mínimo que existe** (`calendar.app.created`): el CRM solo
  puede tocar calendarios que él mismo creó. La agenda personal de nadie se
  puede leer ni queriendo. Hay una prueba que vigila que nadie lo ensanche.
- **La sincronización NUNCA tumba el guardado** (la regla de oro, escrita en
  `lib/calendar/googleSync.js`): el CRM es la verdad y Google un espejo
  best-effort. Copia que falla, copia que se reintenta en el siguiente guardado
  (el `googleEventId` a null la delata).
- **Cancelar borra la copia**: una reunión anulada que sigue pintada en una
  agenda es una mentira con hora. Reactivarla la vuelve a crear.
- **Desconectar no borra nada en Google**: el calendario y sus eventos son de
  la persona. Se revoca el token (best-effort), se borra la conexión y se
  limpian los ids remotos para que una reconexión empiece de cero (la
  reconexión crea calendario NUEVO: al viejo pudo pasarle cualquier cosa).
- **Al conectar se vuelca la agenda de hoy en adelante**, no el histórico: a
  nadie le sirve el pasado volcado en un calendario nuevo.
- **En la demo no se conecta**: es pública con sesión de admin, y guardarle a
  un visitante anónimo los tokens de SU Google sería regalarle su calendario al
  siguiente visitante.
- **Sin SDK de Google**: cuatro llamadas REST con `fetch`, como
  `lib/banco/gocardless.js`. El paquete `googleapis` pesa más que todo `lib/`.

## Migración

`migrate-calendar-google` (CORE, criterio de `migrate-banco-conciliacion`: los
modelos se registran para todos los tenants). Crea `calendar_task_attendees` y
`google_calendar_connections` donde existan `calendar_tasks` Y `team_members`,
con FKs `ON DELETE CASCADE` explícitas (la lección del 26/08). **Va ANTES del
despliegue**: el listado de /calendario incluye los asistentes en cuanto el
tenant tiene `team`.

## Comprobado (local, 29/08/2026)

Pruebas en `scripts/_smoke-calendario-google.mjs` (fin exclusivo de los
eventos de día entero, la fecha que no se desplaza por zona horaria, el bloque
de una hora por defecto, el scope mínimo, offline+consent, la config BYOK y la
puerta de módulos). Circuito completo probado en local contra la demo y las
pantallas de Configuración y Calendario.
