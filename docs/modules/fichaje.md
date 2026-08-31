# Módulo Fichaje (`fichaje`)

## Mapa

> Verificado contra el código el 19/08/2026 (lo desplegado en producción es este mismo commit). Si algo no cuadra, manda el código: corrige esta tabla. **Quién tiene el módulo NO se lista aquí** (una lista a mano se queda vieja): `/admin/modulos` en el back-office o `node scripts/inspect-tenant-modules.js <slug>`.

| | |
| --- | --- |
| **moduleKey** | `fichaje` · requiere `team` (`lib/provisioning/catalogo.js`; las jornadas cuelgan de `team_members`). A propósito NO requiere `team_avanzado`. En el menú es `adminOnly` (`components/layout/Sidebar.jsx`). |
| **Reina** | `aumenta`: el doc la llama «tenant de referencia». El módulo se escribió sobre su Excel real de marzo de 2026 y los únicos lectores a medida que existen son los suyos: la hoja semanal a mano (`lib/fichaje/parsers/aumenta.js`) y, desde julio de 2026, el volcado mensual del reloj de fichar (`parsers/aumentaReloj.js`, un `.xls`); el lector `aumenta` reconoce cuál de los dos le han subido y delega solo. |
| **Pantallas** | `app/(dashboard)/equipo/fichaje/page.jsx` (`/equipo/fichaje`): server component que hace `notFound()` si el rol no es admin/superadmin o el tenant no tiene `fichaje` (segunda de las tres puertas), y monta `modules/fichaje/FichajeModule.jsx`. |
| **Endpoints** | `app/api/fichaje/**` — 7 `route.js`, todos con `hasModule("fichaje")` + solo admin/superadmin: `route.js` (GET del mes con filas + resumen + avisos; POST alta manual), `[id]/route.js` (PATCH corregir, DELETE baja blanda), `export/route.js` (xlsx con los mismos totales que la pantalla). |
| | `import/preview/route.js` (no escribe nada), `import/route.js` (commit en una transacción; en la demo devuelve 403 por `lib/demo/isDemo.js`), `imports/route.js` (histórico de volcados), `imports/[id]/revertir/route.js`. Sin públicos ni webhooks. |
| **Lógica** | `lib/fichaje/importar.js` (`previsualizar`, `aplicar`, `revertir`, `hashDeFichero`: las tres garantías del volcado; desde el 31/08/2026 `previsualizar` acepta los `mapeos` ya elegidos en el modal y recuenta con ellos EN MEMORIA, sin guardar alias — sin eso, un fichero cuyos nombres no casan con NADIE, como el primer volcado del reloj, dejaba `listas` en 0 y el botón apagado por mucho que se asignaran los nombres) · `mapeo.js` (nombre del Excel → persona del CRM: exacto con UNA persona, sugerencia, o pendiente sin sugerencia si el nombre o el alias apuntan a DOS —19/08/2026, antes casaba en silencio con la primera/última—; alias en `team_members.custom_fields.fichajeNombres`) · `totales.js` (`resumirPorPersona`, `totalesDelMes`, `avisosDelMes`, `rangoDelPeriodo`: puras, nada se guarda; desde el 20/08/2026 un tramo con `deletedAt` tampoco suma en `resumirPorPersona` —lo ignoraba solo `avisosDelMes`— y el aviso «sin fichajes», que no lleva fecha, se ordena DETRÁS de los errores con día) · `parseHora.js` (las cinco formas en que llega una hora en un Excel) · `puntualidad.js` (31/08/2026: llegó tarde / salió pronto contra la AGENDA — la primera y última cita o bloqueo de esa persona ese día, tolerancia 10 min; pura, el endpoint aplana las citas a hora de Madrid; sus avisos se mezclan con los de `avisosDelMes` con `ordenarAvisos`, extraído para que el orden sea uno) |
| | `lib/fichaje/parsers/index.js` (`POR_TENANT`: qué lector usa cada cliente; `parserDeTenant`, `describirParser`) · `parsers/aumenta.js` (el Excel semanal a mano de Aumenta, y quien detecta el formato) · `parsers/aumentaReloj.js` (el volcado mensual del reloj de fichar de Aumenta: solo la hoja «Registro asistencia», los marcajes en crudo; el resto de hojas se ignoran a propósito) · `parsers/generico.js` (`Persona · Fecha · Entrada · Salida · Horas · Nota`, el de quien no tiene lector propio). Los festivos los pide a `lib/citas/festivos.js` si el tenant tiene Citas. |
| | `lib/fichaje/leerLibro.js` (31/08/2026): abre el fichero por sus BYTES —`.xls` binario del reloj con SheetJS (dependencia `xlsx`, anclada al tarball del CDN oficial: el paquete de npm está congelado en 0.18.5 con CVEs) y lo convierte a Workbook de ExcelJS; `.xlsx` por el camino de siempre—. Las dos rutas de import lo usan en vez de `workbook.xlsx.load`. |
| | Auditoría desde los endpoints: `fichaje.volcado`, `fichaje.corregido`, `fichaje.creado_a_mano`, `fichaje.dado_de_baja`, `fichaje.volcado_deshecho`, siempre con resumen y nunca la fila. Con frase propia y módulo «Fichaje» en `lib/actividad/etiquetas.js` desde el 19/08/2026 (antes salían por el traductor genérico); lo vigila `_smoke-actividad-etiquetas.mjs`. |
| **UI** | `modules/fichaje/FichajeModule.jsx` (lista por persona, día a día debajo, avisos `error`/`revisar`) · `ImportarFichajeModal.jsx` (preview → mapeo → aplicar) · `CorregirFichajeModal.jsx` · `ApuntarExtraModal.jsx` (31/08/2026: horas extra a mano por el POST manual con `tipo: "extra"`, nota obligatoria; chip verde en la persona y etiqueta en el tramo). No hay `components/fichaje/`. |
| **Modelos** | `models/tenant/Fichaje.model.js` (`fichajes`: un TRAMO, `tipo` trabajo/pausa/ausencia/festivo/**extra** —horas extra apuntadas a mano, 31/08/2026: suman como trabajo y se cuentan aparte (`extrasApuntadas`), migración `migrate-fichaje-tipo-extra` (las fotos doradas usan el enum de su vivo)—, `origen` import/manual/corregido, `minutosOriginal`, `deletedAt`; FK a `team_members` **RESTRICT**). |
| | `models/tenant/FichajeImport.model.js` (`fichaje_imports`: el lote, con `periodo`, `fileHash`, `status` applied/superseded/reverted y `resumen`, la foto de los totales del día que se pagó). Asociaciones en `lib/db/tenantDb.js`, bloque `TeamMember.hasMany(Fichaje…)`. |
| **Interruptores y parámetros** | ninguno que lea el código. Lo que cambia por cliente es el LECTOR del Excel, y se declara en `lib/` (`POR_TENANT` en `lib/fichaje/parsers/index.js`), no en `featureFlags`. |
| **Pantallas propias** | ninguna (nunca las ha habido: el módulo es el mismo para todos y solo cambia el lector) |
| **Scripts** | Activación: `node scripts/enable-module.js <slug> fichaje` (corre `migrate-fichaje-module`, declarada en `scripts/_module-migrations.js`; `scripts/_migration-order.js` la pone DESPUÉS de `migrate-team-fields` porque `fichajes.team_member_id` apunta a `team_members`) · después, `npm run db:check-access`. |
| | Semilla del escaparate: `scripts/seed-fichaje-demo.js` (el mes en curso y el anterior, con los seis casos que la pantalla detecta; está en la lista de `scripts/reset-demo-tenant.js`), y luego `scripts/demo-golden-snapshot.js demo` para que la foto dorada no lo vacíe. Sin cron ni ONE_OFF. |
| **Pruebas** | `scripts/_smoke-fichaje-horas.mjs` (`node:test`, 19/08/2026, en `npm test`): lo que devuelven `parseHora.js` (celdas de ExcelJS, Date en UTC, fracción de día, «8:30»/«8.30»/«8,5»/«7.5» —la regla del punto—, duraciones negativas rechazadas, turno de noche) y `totales.js` (resumen por persona, totales del mes, los seis avisos, rango del periodo; y desde el 20/08/2026 que un tramo dado de baja no aporta ni minutos ni día ni corrección, y que el aviso «sin fichajes» sale detrás de los errores con fecha y delante de los `revisar`). · `scripts/_smoke-fichaje-mapeo.mjs` (`node:test`, 19/08/2026, en `npm test`): `mapeo.js` —exacto, alias de `custom_fields.fichajeNombres`, sugerencia, «APELLIDO, NOMBRE», dos personas con el mismo nombre de pila→nadie, el mismo nombre o alias en dos personas→pendiente sin sugerencia—. · `scripts/_smoke-fichaje-preview-mapeos.mjs` (`node:test`, 31/08/2026, en `npm test`): `previsualizar` con modelos falsos — sin mapeos el nombre que no casa bloquea y no se puede aplicar; con el mapeo puesto las mismas filas quedan listas y `puedeAplicarse` se enciende; un mapeo a alguien de fuera del equipo se ignora; un mapeo no pisa un nombre que ya casaba exacto—. · `scripts/_smoke-fichaje-parser-reloj.mjs` (`node:test`, 31/08/2026, en `npm test`): el lector del volcado del reloj —emparejar marcajes en orden (dos = un tramo, cuatro = mañana y tarde), el marcaje suelto que entra con 0 min y su nota, el mes del fichero (americano) contra el periodo, la hoja que falta, el texto ilegible que bloquea diciendo qué ponía, quien está en el reloj sin marcajes avisa pero no exige mapeo, marcajes sin nombre se saltan, medianoche y jornadas de más de 16 h, la delegación desde `aumenta.js`— y `leerLibro` con un `.xls` BINARIO de verdad (round-trip con SheetJS, comprobando los bytes `D0 CF 11 E0`), un `.xlsx`, y lo que no es un Excel. · `scripts/_smoke-fichaje-parsers.mjs` (`node:test`, 19/08/2026, en `npm test`): los dos lectores originales de `parsers/`, con libros de ExcelJS fabricados a mano (sin abrir ningún fichero, fechas en UTC) —`aumenta.js`: `diasDeLaHoja` saca los días del nombre de la hoja («02-6», «9-13»), el periodo lo pone quien importa y el primer día tiene que caer en lunes, los bloques van de nombre a nombre y una anotación en la columna de nombres («BAJA», «MÉDICO», una con día L bajo un nombre) no es una persona, los minutos se recalculan de las horas reales y el total del Excel solo vale cuando no hay horas (y se dice de dónde salió), «M-1»/«M-2» son dos tramos del mismo día; `generico.js`: la cabecera se busca por NOMBRE en las diez primeras filas, una fila de otro mes se rechaza, dos filas del mismo día son dos tramos; y desde el 19/08, en los dos, una salida anterior a la entrada ENTRA como jornada que cruza la medianoche (turno de noche) pero con un aviso en el preview de que la salida es anterior a la entrada (lo más probable: celdas cambiadas). Desde el 21/08/2026 fija además: que un total que no se entiende («abc», «8 horas») **no** hace desaparecer la jornada —la fila sale con el error, diciendo qué celda, y el texto va recortado para que una celda enorme no infle la respuesta—, que lo mismo vale para las columnas de entrada y salida, que un horario PREVISTO con la salida antes que la entrada suma 24 h pero **avisa** igual que su gemelo de las horas reales (y un horario normal no avisa, y uno de noche de verdad avisa una sola vez), que una anotación de una semana que se sale del mes NO se guarda con una fecha que no existe (y la que sí cabe se sigue guardando), y —en el genérico— que una fila sin persona cuya fecha son solo espacios se salta como fila en blanco, mientras que con una de las dos cosas sigue saliendo con su error—. |
| **Decisiones** | — |
| **En este doc** | La frase que manda sobre todo el módulo · Universal por dentro, de cada cliente por fuera · El Excel de Aumenta, y por qué muerde · Modelo de datos · Identificar a la persona · Pantallas y endpoints · Alta en un cliente · Lo que queda fuera de esta primera versión |

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

En el genérico, una fila se considera **en blanco** si no tiene persona NI
fecha, mirando las dos **recortadas** (21/08/2026). Un espacio suelto en la celda
de Fecha —lo normal en las filas del final de cualquier Excel— ya no convierte
una fila vacía en tres errores del preview («falta la persona», «falta la
fecha», «no hay horas…») ni en una unidad más de `rowsError`, que es justo lo que
hace desconfiar del lote entero. Con una de las dos cosas presente, la fila sigue
saliendo con su error.

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

Tres más, cerradas el 21/08/2026:

**4. «Este día no se trabajó» no es lo mismo que «este día no se entiende».**
Una fila sin entrada, sin salida y sin total se descarta en silencio: es un día
libre. Pero si alguna de esas tres celdas lleva **TEXTO** que no se sabe leer
(«8 horas», «abc», escritos a mano por quien rellena la hoja), la fila sale al
preview bloqueada y el error dice qué celda: «no se ha podido leer ninguna hora
(el total de horas dice «8 horas»)». Antes se descartaba antes de mirarlo y la
jornada entera desaparecía del control horario sin un solo aviso. Solo cuenta el
texto: los ceros y las fechas anteriores a la época que devuelve la fórmula del
Excel cuando le falta una hora son su forma de decir «en blanco», y siguen
descartándose sin ruido. El texto se recorta a 40 caracteres en el mensaje, para
que una celda enorme pegada por error no convierta la respuesta del preview en
varios megas.

**5. La salida anterior a la entrada se avisa en los DOS pares de columnas.** No
solo en las horas reales: también en el **HORARIO previsto**. La fila entra igual
(un turno de noche es legítimo), pero el preview lo dice, porque los minutos
previstos se guardan en la fila del fichaje y las horas extra del mes se restan
contra ellos (`lib/fichaje/totales.js`): la misma errata de dos celdas cambiadas
daba 23 h previstas calladas.

**6. Una anotación que caiga en un día que no existe en el mes no se guarda.** La
hoja «30-31» de marzo tiene J y V, que serían los días 33 y 34: la anotación se
descarta y la fila sale con su aviso «Fila saltada». Antes se escribía
«2026-03-33» en el resumen del lote, que se persiste (`importar.js`).

`lib/fichaje/parseHora.js` lee las cinco formas en que una hora llega en un
Excel (Date con época 1899, texto `13:50`, texto `8:30:00`, fracción de día,
fórmula) y devuelve siempre `{ok, valor, motivo}` — nunca lanza, nunca devuelve
un número a medias.

---

## El volcado del reloj (desde julio de 2026)

Desde julio Aumenta ya no rellena la hoja semanal a mano: sube TAL CUAL el
fichero que exporta su máquina de fichar («Julio 2026.xls»). Dos cosas cambian
y una no:

- **Es un `.xls`**, el formato binario de Excel 97-2003, que ExcelJS no abre.
  Lo abre `lib/fichaje/leerLibro.js` (SheetJS, solo para esto) y lo convierte a
  un Workbook de ExcelJS: los lectores siguen hablando un solo idioma. El
  formato se decide por los primeros bytes, no por la extensión.
- **Trae cinco hojas y solo una dice la verdad.** `parsers/aumentaReloj.js` lee
  ÚNICAMENTE «Registro asistencia»: un bloque por persona (fila de días 1..31,
  fila `ID :`/`Nombre :`, y debajo los marcajes en crudo del día separados por
  saltos de línea, `08:46\n14:05`). Las otras cuatro —«Resum. de asis.»,
  «Anormal», «Detalle de formulario», «Tabla de información»— son CÁLCULOS del
  reloj contra su cuadro de turnos, y se ignoran a propósito porque se
  equivocan: en el fichero real de julio, a Estefanía el día 3 la hoja
  «Anormal» le pone «salida: Falta» cuando los marcajes en crudo dicen 09:00 y
  14:20, y a Rosa la hoja de resumen le cuenta 37 h en un mes en que sus
  marcajes suman 85. **Los totales del CRM saldrán distintos (y mayores) que
  los del reloj, y es lo correcto**: el reloj descarta marcajes que no le casan
  con el turno; el CRM cuenta lo que se fichó.
- **La regla de siempre no cambia**: los minutos se recalculan de los marcajes.
  Se emparejan EN ORDEN (1º-2º un tramo, 3º-4º otro: mañana y tarde son dos
  tramos, como el «M-1/M-2» del formato antiguo).

Tres decisiones que conviene saber defender:

**1. El marcaje suelto entra con 0 minutos, no se bloquea ni se adivina.** El
día de UN solo fichaje (olvidó fichar la salida: en julio hay 7) entra como
jornada de 0 min con la hora suelta como entrada y una nota, y la pantalla del
mes la pinta en rojo («Entrada sin salida») para corregirla ahí con motivo.
Bloquearla en el preview la escondería del sitio donde se repasa el mes;
inventarle horas sería peor. El preview lo cuenta en un aviso agregado.

**2. El mes del fichero se comprueba.** El reloj escribe su rango en la
cabecera —`07/01/2026 ~ 07/31/2026`, EN FORMATO AMERICANO, el 07/31 lo
delata—. Si no cuadra con el periodo elegido al importar, no se lee nada. La
hoja semanal no sabía su mes; este fichero sí, y se aprovecha.

**3. Quien está en el reloj sin un solo marcaje avisa, pero no exige mapeo.**
En julio: `cristina`, `isa` y `laura barrionue` (el reloj trunca los nombres a
15 caracteres). No aportan horas que proteger, y exigir mapearlas bloquearía el
volcado entero. Quien SÍ tiene horas sigue sin entrar hasta que su nombre esté
mapeado, como siempre.

El mismo tenant tiene ahora dos formatos según la época que se re-importe, así
que `parsers/aumenta.js` detecta cuál le han subido (la hoja «Registro
asistencia» solo existe en el del reloj) y delega. `POR_TENANT` sigue diciendo
`aumenta: "aumenta"`; `aumenta_reloj` está en `PARSERS` pero ningún tenant
apunta ahí directo.

Este formato no trae horario previsto por día, así que `minutosPrevistos` va a
NULL, la columna «Previstas» de la pantalla enseña «—» y las horas extra no se
calculan (sin horario teórico no hay «de más»). Las anotaciones («BAJA»,
«MÉDICO») tampoco existen aquí; el cuadro de turnos de «Tabla de información»
(25 licencia, 26 viaje) podría dar algo parecido el día que traiga algo más que
turno normal.

Texto con punto, la regla desde el 19/08/2026 (`trozosDeReloj`): punto + DOS
dígitos es reloj (`8.30` = 8:30, `8.05`), punto + uno o tres o más es decimal
(`7.5` = 7 h 30, como promete la plantilla genérica), y la coma es siempre decimal
(`8,30` = 8,3 h). Antes «7.5» se leía como 7 h 05: 25 minutos de menos por celda;
lo sacó `_smoke-fichaje-horas.mjs` el día que se escribió.

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

⚠️ **Un tramo dado de baja no suma, y la garantía está en la FUNCIÓN, no en la
consulta** (20/08/2026). `resumirPorPersona` se salta ella misma las filas con
`deletedAt`, igual que ya hacía `avisosDelMes`: lo que se borró no se paga, ni
en minutos, ni en días, ni en el recuento de correcciones, ni para decidir si
alguien tiene fichajes este mes. Los dos endpoints que la llaman (`GET
/api/fichaje` y `/api/fichaje/export`) filtran `deletedAt: null` en la consulta,
así que esto nunca se vio en pantalla; pero hasta esa fecha el `where` era la
ÚNICA garantía, y una función que decide horas de nómina no puede depender de
que el tercero que la llame se acuerde de escribirlo —el informe que se añada
mañana, o el smoke que le pasa filas a mano—. La baja blanda existe justamente
para que la fila se conserve sin contar; ahora las dos funciones lo entienden
igual.

### Los dos cerrojos contra el duplicado

1. **Índice UNIQUE parcial** `fichajes_import_unico` sobre
   `(team_member_id, fecha, entrada_at, tipo) WHERE deleted_at IS NULL AND
   origen = 'import'`. La base de datos lo impide aunque falle la lógica.
   `entrada_at` puede ser NULL y en Postgres dos NULL no chocan: ese caso lo
   cubre el reemplazo por periodo, no el índice.
2. **Reemplazo por periodo**: aplicar el mes M marca el lote anterior como
   `superseded` y da de baja **solo sus filas `origen='import'`**. Las `manual` y
   `corregido` sobreviven, y el preview lo dice antes de tocar nada.

⚠️ **RE-VOLCAR y REVERTIR no siguen la misma regla, y es a propósito.** Re-volcar
es «aquí está el fichero bueno»: las correcciones a mano SOBREVIVEN, porque
siguen siendo válidas. Revertir es «este fichero entero no debería existir»: se
va todo lo que nació de él, corregido o no — una corrección sobre una fila que no
debió entrar solo hereda el error con mejor letra. Por eso `revertir` devuelve
`correcciones`: quien pulse el botón tiene que ver «esto se lleva 3 correcciones
que hiciste» antes de hacerlo.

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

**El orden de esa lista es lo que se lee** (20/08/2026): la pantalla la pinta
tal cual sale de `avisosDelMes`. Primero los `error` con fecha —los días
concretos que se pueden arreglar hoy: una entrada sin salida, una salida sin
entrada—; detrás, «Sin ningún fichaje este mes», que no lleva fecha porque es
de la persona y no de una fila (y varios de esos se ordenan entre ellos por
nombre); y al final los `revisar`, que son de otra gravedad. Hasta esa fecha el
«sin fichajes» salía el PRIMERO —al no tener fecha, su cadena vacía ganaba la
comparación por día—, justo al revés de lo que prometía su propio comentario:
la lista arrancaba por lo único que no se arregla en la pantalla, sino hablando
con el cliente o mapeando un nombre.

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
cualquiera. Se ven los datos sembrados por `scripts/seed-fichaje-demo.js`, que
siembra el mes en curso y el anterior con los seis casos que la pantalla sabe
detectar (un día sin salida, una jornada de 14 h, un día partido en dos tramos,
una corrección a mano, alguien que hace de más y alguien sin ningún fichaje). Los
meses se calculan al vuelo, así que el seed no caduca, y está en la lista de
`reset-demo-tenant.js`.

⚠️ **Sembrar la demo no basta: hay que re-hacer su foto dorada.** La demo se
restaura desde `crm_demo_golden` en cada recarga dura, y el `TRUNCATE` de ese
restore es **CASCADE**: `fichajes` apunta a `team_members`, así que se vaciaba en
cada recarga aunque la tabla ni siquiera estuviera en la foto. Después de
sembrar, `scripts/demo-golden-snapshot.js demo`. Vale para cualquier módulo que
estrene tablas con clave ajena hacia una tabla de la demo.

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
