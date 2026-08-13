# Módulo Fichaje (`fichaje`)

Control horario: se vuelca el Excel del reloj de fichar cada mes y queda el
registro por persona y día, con horas extra, avisos y correcciones justificadas.

Estado: **implementado** (13/08/2026). Tenant de referencia: `aumenta`.
Requiere `team` (las jornadas cuelgan de `team_members`).

---

## La frase que manda sobre todo el módulo

> **Un fichaje mal importado es una nómina mal pagada.**

De ahí salen las cuatro decisiones que no se negocian:

1. **Volcar el mismo mes dos veces no duplica horas.** Va a pasar: el primer mes
   lo suben mal, o el Excel llega corregido a mitad de mes.
2. **Se puede corregir a mano, y la corrección sobrevive al siguiente volcado**,
   con motivo obligatorio y con el original a la vista.
3. **El volcado se deshace entero**, no fila a fila.
4. **Nada se importa a ojo.** Una fila cuyo nombre no case con una persona del
   equipo no entra: sale en el preview y se mapea ahí.

---

## Universal por dentro, de cada cliente por fuera

El módulo es el mismo para todos —tablas, endpoints, pantallas, totales y
avisos— y lo único que cambia de un cliente a otro es **cómo se lee su Excel**.
Cada reloj de fichar escupe un formato distinto y cada centro lo retoca; pedirle
al cliente que cambie su hoja es pedirle lo que no va a hacer.

| Pieza | Dónde |
| --- | --- |
| Registro de lectores | `lib/fichaje/parsers/index.js` |
| Lector de Aumenta | `lib/fichaje/parsers/aumenta.js` |
| Lector genérico (el de la plantilla) | `lib/fichaje/parsers/generico.js` |

**Añadir un cliente nuevo = un fichero en esa carpeta y una línea en
`POR_TENANT`.** Ni migración, ni endpoint, ni pantalla. Quien no tenga lector
propio usa el genérico (`Persona · Fecha · Entrada · Salida · Horas · Nota`), así
que puede usar el módulo el primer día.

Un lector exporta `meta` y `parse(workbook, {periodo}) → {filas, anotaciones,
avisos, nombres}`, y su contrato es: **no lanza nunca**, devuelve lo que entendió
y lo que no, y jamás adivina de quién es una fila.

---

## El Excel de Aumenta, y por qué muerde

Un fichero por MES, una hoja por SEMANA con el rango de días en el nombre
(«02-6», «9-13», «16-20», «23-27 PENDIENTE»). Bloques por persona con L/M/X/J/V.

| Col | Qué |
| --- | --- |
| 1 | Nombre de la persona **o una anotación** |
| 2 | Día: `L`, `M`… y también `M-1`, `M-2` |
| 3 / 4 | Entrada según horario / entrada REAL |
| 6 / 7 | Salida según horario / salida REAL |
| 9 / 10 / 11 | Horas previstas / fichadas / extras (calculadas por el Excel) |

Tres trampas, todas encontradas en el fichero real y todas resueltas en el
lector:

**1. La columna de nombres también lleva anotaciones.** «BAJA», «MÉDICO»,
«*MÉDICO», «JUSTIFICANTE DE MÉDICO» y «REUNIÓN DE AITOR» están escritas donde
los nombres. La regla: una fila abre bloque de persona si tiene texto en C1 **y**
su día está vacío o es `L` **y** la persona anterior ya tiene días leídos. Esa
última condición no es teórica: `VICTORIA` va sola en una fila y el justificante
en la de abajo con día `L`; sin ella, el justificante se leía como una persona y
**se llevaba las 39 horas de Victoria**.

**2. Los bloques no son de tamaño fijo.** «ISA» está en la fila 13 en unas hojas
y en la 14 en otras. Se recorre de nombre a nombre; contar de cinco en cinco
desalinea el fichero entero a partir de la primera fila insertada, en silencio.

**3. Las fórmulas del Excel no sirven para pagar.** Devuelven cosas como
`21.000000000000245` minutos —restas de horas en coma flotante— y, cuando falta
una hora de salida, **duraciones negativas**: la fórmula resta contra una celda
vacía y da una fecha anterior a la época de Excel (−956 minutos). Los minutos se
recalculan de las horas reales; la columna del Excel solo se usa como respaldo y
se rechaza si sale negativa.

`lib/fichaje/parseHora.js` lee las cinco formas en que una hora llega en un
Excel (Date con época 1899, texto `13:50`, texto `8:30:00`, fracción de día,
fórmula) y devuelve siempre `{ok, valor, motivo}` — nunca lanza, nunca devuelve
un número a medias.

---

## Modelo de datos

**`fichajes`** — un TRAMO trabajado, no un día ni un marcaje suelto. Es lo que
permite guardar los dos turnos del martes de Rosa (`M-1`, `M-2`) y lo que aguanta
un reloj que solo dé el total del día.

Lo importante: `minutos` es lo único obligatorio; `minutosOriginal` guarda lo que
decía el Excel y **no lo pisa nadie**; `origen` (`import` / `manual` /
`corregido`) decide qué sobrevive a un re-volcado; `deletedAt` porque un registro
de jornada **no se borra**. La FK a `team_members` es **RESTRICT**: pasar a
alguien a inactivo no puede llevarse su histórico laboral.

**`fichaje_imports`** — el lote. Es lo que hace el volcado reversible y no
duplicable: `periodo`, `fileHash` (sha256, para avisar de «este fichero ya lo
has subido»), `status` (`applied` / `superseded` / `reverted`) y `resumen`, la
FOTO de los totales por persona y las anotaciones del fichero en el momento del
volcado — si dentro de tres meses alguien discute una nómina, ahí está lo que
decía el sistema el día que se pagó.

**No se guarda ningún total.** Se cuentan al leer, en `lib/fichaje/totales.js`,
como el stock del inventario se suma de sus movimientos.

### Los dos cerrojos contra el duplicado

1. **Índice UNIQUE parcial** `fichajes_import_unico` sobre
   `(team_member_id, fecha, entrada_at, tipo) WHERE deleted_at IS NULL AND
   origen = 'import'`. La base de datos lo impide aunque falle la lógica.
   `entrada_at` puede ser NULL y en Postgres dos NULL no chocan: ese caso lo
   cubre el reemplazo por periodo, no el índice.
2. **Reemplazo por periodo**: aplicar el mes M marca el lote anterior como
   `superseded` y da de baja **solo sus filas `origen='import'`**. Las `manual` y
   `corregido` sobreviven, y el preview lo dice antes de tocar nada.

---

## Identificar a la persona

El Excel trae `ARACELI`, `ISA`, `DANIA`, `LAURA ARROYO`. El CRM tiene «Isabel
Alberca Bolaños» y «Daniela de la Cruz Esteban». Ninguno casa por igualdad.

`lib/fichaje/mapeo.js` solo asigna sola una fila cuyo nombre case **exacto**
(sin mayúsculas, acentos ni espacios de más) con un alias guardado o con el
nombre completo. Todo lo demás es una **sugerencia** que confirma una persona con
un clic; al confirmarla, el alias se guarda en
`team_members.custom_fields.fichajeNombres` y el mes siguiente ya casa solo.

Y se calla cuando debe: con el equipo real de Aumenta sugiere 9 de 14 y **no
sugiere** `ISA` (hay dos Isabeles), `RAQUEL` (dos Raqueles), `DANIA` (existe
además `DANIELA`) ni `LAURA ARROYO` (dos Lauras). Una sugerencia se acepta a
ciegas, y ahí serían las horas de otra persona.

⚠️ En el fichero de marzo de 2026 hay dos nombres —`VICTORIA` y `LAURA ARROYO`—
**que no están en el equipo del CRM**, y una persona del CRM (`Arantxa Garrote`)
que no está en el Excel. Eso se resuelve hablando con el cliente, no en código.

---

## Pantallas y endpoints

`/equipo/fichaje` — solo admin, y gateando **las tres puertas** (menú, página y
endpoint), como «Fichas a completar»: con la URL guardada se llegaría igual, y
aquí hay datos laborales.

La pantalla manda la **lista por persona** y abre el día a día debajo de quien
se pida. Una cuadrícula personas × días son 434 celdas que no caben y que no
contestan la pregunta de fin de mes, que es «cuántas horas le pago a cada una y
hay algo raro». Encima van los **avisos**, separados en lo que casi seguro está
mal (`error`) y lo que es raro pero puede ser correcto (`revisar`) — mezclarlos
hace que no se mire ninguno.

```
GET    /api/fichaje?mes=YYYY-MM        filas + resumen + avisos
GET    /api/fichaje/export?mes=        xlsx (mismos totales que la pantalla)
POST   /api/fichaje/import/preview     NO ESCRIBE NADA
POST   /api/fichaje/import             commit en UNA transacción
GET    /api/fichaje/imports            histórico de volcados
POST   /api/fichaje/imports/[id]/revertir
POST   /api/fichaje                    alta manual (nota obligatoria)
PATCH  /api/fichaje/[id]               corregir (nota obligatoria)
DELETE /api/fichaje/[id]               baja blanda (motivo obligatorio)
```

**En la demo el volcado está deshabilitado**: es pública y da sesión de admin a
cualquiera. Se ven los datos sembrados.

Auditoría: `fichaje.volcado`, `fichaje.corregido`, `fichaje.creado_a_mano`,
`fichaje.dado_de_baja`, `fichaje.volcado_deshecho`, con **resumen** y nunca la
fila entera — `master.audit_log` es un schema compartido por todos los clientes
y esto son datos laborales. Sus frases están en `lib/actividad/etiquetas.js`.

---

## Alta en un cliente

```bash
docker exec crm-salamandra-app-1 node scripts/enable-module.js <slug> fichaje
```

Después, `npm run db:check-access`. El módulo es **adminOnly** en el menú, así
que los usuarios normales no lo ven y eso es lo correcto.

---

## Lo que queda fuera de esta primera versión

- **`/mi-fichaje`**: que cada persona vea lo suyo. Es una decisión de producto
  (¿pueden ver sus horas? ¿pueden avisar de un error?) y no se ha tomado.
- **Vacaciones y festivos como aviso**: el aviso de «fichaje en día festivo» está
  escrito y funciona si el tenant tiene Citas; el de «día de ausencia» necesita
  cruzar `team_blocks` y todavía no está enganchado.
- **Plantilla descargable** del formato genérico.
