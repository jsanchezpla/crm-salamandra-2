# La portada se compone con los módulos (y el Calendario clasifica y reparte)

**01/09/2026 · Rodrigo.** Cuatro cosas pedidas de una vez, y todas salen de la
misma frase: *«el inicio universal tiene una gráfica gigante y ya porque no hay
agenda»*. Tres tocan el Calendario y una la portada; van juntas porque la
portada nueva se surte, entre otros, del Calendario.

---

## 1. La IA de Proyectos no funcionaba, y no decía por qué

**Qué pasaba.** «Crear con IA» y «Reorganizar con IA» son las dos llamadas más
largas del CRM con diferencia: planificar un proyecto entero son ~12.000 tokens
de JSON (fases, tareas, hitos, miembros) frente a los 700–3.000 que pide
cualquier otro sitio. Tres cosas les caían encima, y las tres salían por
pantalla como **«Error interno del servidor»**:

1. **El timeout de la petición.** `lib/outreach/analysis/anthropic.js` pedía los
   12.000 tokens de golpe, sin `stream`, contra un tope de 120 s. A la
   velocidad normal del modelo eso no llega nunca.
2. **nginx.** `proxy_read_timeout` vale **60 s** de fábrica. Aunque el CRM
   aguantara, la conexión estaba muda todo ese rato y el proxy la cortaba
   antes: 504 en el navegador y el plan generándose para nadie.
3. **El parser.** Se le pide al modelo «solo JSON, sin markdown» y casi siempre
   obedece. Cuando no —una frase delante, una despedida detrás—, `normalizePlan`
   tiraba la respuesta ENTERA y el usuario leía «La IA no ha devuelto un plan
   válido» sin que la IA hubiera hecho nada mal.

Y por debajo, un cuarto problema que hacía invisibles a los otros tres: **el
error de Anthropic no se traducía**. Clave caducada, modelo retirado, cuenta sin
saldo y proveedor saturado llegaban todos como el mismo «Error interno del
servidor», con el motivo real solo en los logs del contenedor. Nadie podía
arreglarlo sin entrar por SSH.

**Qué se hizo.**

| Pieza | Qué hace |
| --- | --- |
| `complete({ stream, timeoutMs })` | La respuesta llega por trozos y se junta dentro; el caller recibe el mismo string. Los dos endpoints de Proyectos la piden con `stream: true` y 5 min de margen. |
| `lib/ai/respuestaConLatido.js` | La respuesta empieza a viajar A LA VEZ que el trabajo y suelta un espacio cada 15 s. JSON admite espacios delante, así que el `res.json()` del navegador parsea igual — y el contador de nginx se reinicia con cada uno. |
| `lib/ai/errorLegible.js` | Traduce el error del SDK a una frase que dice qué pasa y dónde se toca («la clave ha caducado, revísala en Configuración → IA»). Reconoce por pato (`status`, `name`), sin importar el SDK, para poder probarlo sin Next. |
| `extraerJson()` en `parsePlan.js` | Busca el JSON dentro de lo que escribió el modelo: tal cual, dentro de la valla, o el primer `{…}` con las llaves equilibradas (saltando lo que va entre comillas). |
| `nginx/nginx.conf` | `proxy_read_timeout`/`proxy_send_timeout` a 310 s y `proxy_buffering off`, como cinturón por si algún día se quita el latido. |

⚠️ **El código HTTP se manda antes que el cuerpo.** Como la respuesta arranca
de inmediato, esos dos endpoints contestan **siempre 200** y el fallo viaja
dentro (`{ ok: false, error }`). Todo lo que puede responder otro código
—permisos, validación, falta de clave— se comprobó ARRIBA, antes del latido.
Quien llame a un endpoint así tiene que mirar `j.ok`, no solo `res.ok`; los dos
modales de Proyectos ya lo hacen.

⚠️ **nginx del VPS es nativo**, no el del repo (`docs`: «VPS propio, Docker
Compose, nginx nativo`). El fichero de aquí queda correcto, pero el que corre en
producción hay que tocarlo a mano si algún día se quita el latido.

**Cambio de criterio anotado**: la prueba de Proyectos afirmaba que un texto
alrededor del JSON *no se rescata, se pide JSON y solo JSON*. Se le da la vuelta:
se sigue PIDIENDO solo JSON, pero cuando no llega así se busca en vez de tirar
el trabajo hecho. La prueba nueva lo dice con esas palabras.

---

## 2. El Calendario tiene categorías, con la pantalla de los tipos de cita

`calendar_categories`: nombre, color, descripción, activa y orden. Lo pone cada
centro en **`/calendario/categorias`**, que es *a propósito* la misma pantalla
que `/citas/tipos` —cabecera con sus botones, tabla con una fila por elemento,
drawer a la derecha al pulsar la fila—: quien sepa mantener el catálogo de una
agenda sabe mantener el de la otra sin que se lo expliquen.

**No es un `EventType`.** Un tipo de cita es un SERVICIO que se reserva: tiene
duración, precio, modalidades, reglas de antelación y sale en la agenda pública.
Una categoría del Calendario clasifica una reunión interna: ni se vende ni se
reserva. En la misma tabla, media docena de campos obligatorios no significarían
nada aquí y el widget público tendría que aprender a esconderlas.

Al borrar una categoría **en uso** se desactiva en vez de borrarse (mismo
criterio que los tipos de cita): borrarla dejaría media agenda sin clasificar y
sin forma de saber qué era cada cosa. Una desactivada no se ofrece al apuntar
algo nuevo, pero los eventos que ya la tenían la conservan —y su color—; por eso
el desplegable del formulario ofrece las activas **más la que ya tuviera ese
evento**, o abrir y guardar una reunión vieja se la borraría sin avisar.

---

## 3. Varios responsables por evento, además de a quién afecta

`calendar_task_owners`, patrón `TaskAssignee` / `IncidenciaAssignee`. Son **dos
listas distintas y hacen falta las dos**:

- **Responsables** — quién lo hace. Ya no es uno solo: una coordinación la
  preparan dos terapeutas, y hasta hoy había que elegir a una y acordarse de la
  otra.
- **Afecta a** (`calendar_task_attendees`, 29/08) — a quién le toca verlo. Es lo
  que decide en qué Google Calendar aparece una copia.

Estar en una no mete en la otra: un responsable que no quiera el evento en su
Google no tiene por qué tenerlo.

`calendar_tasks.team_member_id` **se queda como espejo del principal** (el
primero de la lista), igual que `Incidencia.assignedToId`, porque hay tres
sitios que leen por esa columna: «Mi trabajo» de la portada, el reparto de
«Reorganizar la semana» y el filtro `?teamMemberId=` del listado. El espejo lo
escribe `reconciliarResponsables()` en la misma llamada que la lista: son dos
escrituras que tienen que ir juntas, y separarlas es la forma segura de que un
día una se quede sin la otra.

La migración **rescata el responsable que ya había**: sin ese backfill, abrir un
evento viejo tras el despliegue lo enseñaría «sin responsable» —el dato seguiría
en su columna, pero la pantalla ya lee la lista— y bastaría con guardar una vez
para perderlo de verdad.

---

## 4. Colorear por prioridad o por categoría

Dos botones arriba, a la izquierda del de Google Calendar (donde los pidió
Rodrigo). Son dos lecturas de la misma semana: **prioridad** dice qué corre más,
**categoría** dice en qué se va el tiempo.

- Los **dos colores viajan en cada evento** desde el servidor (`colorPrioridad`,
  `colorCategoria`): cambiar de modo es repintar, no una petición.
- En modo categoría, un evento **sin** categoría se va a gris. Es lo honesto —no
  es de ninguna— y de paso se ve de un vistazo lo que queda por clasificar, en
  vez de colarlo en el color de la de al lado.
- Los eventos de **Proyectos** conservan el suyo: no son nuestros.
- La elección se guarda **en el navegador de cada uno**: es una preferencia de
  cómo mirar, no un ajuste del centro. Guardarla en el tenant obligaría a que
  todo el equipo mirara igual.
- Sin categorías creadas los botones **no salen**: un botón que solo puede
  pintarlo todo de gris no es una opción, es una trampa. Y si quien mira dejó
  elegido «categoría» y el centro se quedó sin ninguna, vuelve a prioridad solo
  —o el calendario entero se pintaría de gris con los botones para arreglarlo ya
  fuera de la pantalla.

La paleta (`PALETA_CATEGORIAS`, diez colores) **no comparte ninguno con los de
prioridad**, y hay una prueba que lo fija: si se solaparan, las dos lecturas se
confundirían.

---

## 5. La portada se compone con los módulos del cliente

**Qué pasaba.** La portada solo sabía dibujar DOS cosas: la agenda de **Citas** a
la izquierda y las gráficas de **Facturación** a la derecha. Un cliente sin Citas
perdía la mitad izquierda entera y la gráfica se estiraba a lo ancho de la
pantalla para tapar el hueco — la «gráfica gigante». Y de sus proyectos, sus
tickets o sus cursos, ni una palabra.

**Qué se hizo.** Dos fuentes más, y ninguna opcional para el reparto:

- **La izquierda tiene dos agendas posibles.** Citas y **Calendario**
  (`buildAgendaCalendario`). Un cliente sin Citas pero con Calendario ya tiene su
  «hoy»: reuniones, coordinaciones y lo que cada uno se apunta. Enseña hoy y, si
  hoy está vacío, lo que viene en dos semanas — un panel que contesta «no hay
  nada» un viernes por la tarde y se calla lo del lunes no sirve para
  organizarse. La caja se devuelve **aunque esté vacía**, como ya hacía la de
  Citas: la pantalla tiene que ser la misma todos los días.
- **La derecha lleva una tarjeta por módulo** (`portada.tarjetas`): Proyectos,
  Soporte, Leads, Formación y Fichas. Todas con la MISMA forma —dos cifras de
  titular y hasta cuatro líneas de detalle— para que la portada tenga un solo
  componente (`TarjetaModulo`) y no cinco parecidos, y para que se lea como UNA
  pantalla y no como widgets pegados.

**La gráfica es una caja más de esa rejilla**, no el suelo donde cae lo que
sobra: solo ocupa el ancho entero cuando de verdad es lo único que ese cliente
tiene. Y cuando no hay mitad izquierda, la derecha reparte en tres columnas en
vez de estirar dos.

Lo que **no** cambia: el gate sigue siendo `hasModule` (módulo del tenant ∩
acceso del usuario), cada bloque corre dentro de `safeBlock` (una tarjeta que
falla no se pinta y la portada nunca da 500), la agenda de Citas conserva su
regla de visibilidad, y quien no está adherido a facturación sigue sin ver
gráficas de ningún tipo (29/08).

---

## Qué hay que lanzar al desplegar

```bash
docker exec crm-salamandra-app-1 node scripts/migrate-calendar-categorias.js
```

CORE (`scripts/_module-migrations.js`), por el mismo criterio que
`migrate-calendar-google`: `CalendarCategory` y `CalendarTaskOwner` están
registrados en `lib/db/tenantDb.js` para TODOS los tenants, y `CalendarTask`
declara `category_id`, así que Sequelize la pide en CADA `SELECT` de
`calendar_tasks` —tenga el tenant el módulo o no—. Aditiva, idempotente, decide
por existencia de tabla y entra también en las fotos doradas de las demos (sin
FKs allí, que no tienen claves).

## Pruebas

`_smoke-ia-respuesta.mjs` (error legible, `extraerJson`, latido) y
`_smoke-calendario-categorias.mjs` (normalización del catálogo y el color).
`_smoke-projects-ai-parsePlan-editOps.mjs` cambia el caso del texto alrededor
del JSON, con el porqué escrito al lado.
