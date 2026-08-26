# La agenda importada iba dos horas tarde (y nadie la había vivido aún)

**Fecha**: 2026-08-26 · **Tenant**: aumenta · **Disparador**: la incidencia de
las 1.827 citas sin terapeuta. Al revisarla entera aparecieron dos fallos más
graves que la propia incidencia. Los tres quedaron resueltos el mismo día,
seis días antes del arranque del curso.

## 1. Las 12.030 citas importadas tenían la hora desplazada

La importación de la agenda (02/08) corrió cuando el contenedor iba en **UTC**:
`new Date("2026-09-01T15:45:00")` guardó la hora del reloj de Organízate como
si fuera UTC. La agenda pinta en hora de Madrid, así que **cada cita importada
salía 2 horas tarde** (1 en invierno, con el salto en mitad del curso). El
17/08 el contenedor pasó a Europe/Madrid (commit `8d89d70`), lo que no arregló
lo ya guardado pero sí cambió cómo fallaba.

Nadie lo había visto porque **ninguna cita migrada se había vivido**: todas son
del 1 de septiembre en adelante. La pista que lo delató: la distribución de
horas «UTC» iba de 10:00 a 20:00 — como reloj español de un centro infantil,
normal; como UTC de verdad, niños saliendo de terapia a las 22:00. Había 798
citas pintadas a las 21:00 o más tarde.

**Arreglo**: `scripts/_hechos/corregir-horas-citas-importadas.js` —
`(scheduled_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Madrid'`, fila a fila
(cada fecha con su horario de verano), solo sobre `additional_data LIKE
'Importada de Organízate%'`, con marca «hora corregida» que lo hace
idempotente. Verificado: 0 citas a las 21:00+, y la agenda de Raquel Mesones
del 01/09 coincide minuto a minuto con Organízate.

**La trampa que enseña**: una importación con fechas se comprueba contra la
PANTALLA (¿a qué hora la ve el usuario?), no contra la base. Y apuntarse la
zona del contenedor el día que se importa: cambiarla después convierte datos
buenos en malos sin tocar una sola fila.

## 2. El backfill de cobros ponía a 0 € lo cobrado de las 14.243 facturas

`migrate-billing-rework.js` recalculaba `paid_amount = SUM(payments)` en TODAS
las facturas. Las importadas se marcaron pagadas SIN filas en `payments`
(decisión de la importación: Organízate no da el desglose de cobros por
factura), así que cada pasada de migraciones las devolvía a «0 € cobrado» y
**Cobros/Morosidad contaba 2 M€ como pendientes** de familias que pagaron hace
años. La auditoría de la migración lo cazó: «facturas con el cobro
descuadrado: 14.243» — cuando falla el 100%, lo roto es la comprobación o
quien tocó los datos después; aquí era lo segundo.

**Arreglo**: el backfill ahora lleva `WHERE EXISTS (payments de esa factura)`,
y las 14.243 se restauraron a `paid_amount = total`. La auditoría quedó en
verde.

## 3. Las 1.827 citas sin terapeuta (la incidencia original)

**No fue un fallo de emparejamiento**: el cuadre por terapeuta es exacto
nombre a nombre. Son la agenda de tres profesionales que YA NO ESTÁN (Dania
955, Victoria Losada 38, Laura A. Arroyo 12 — bajas confirmadas el 01/08, por
eso no están en el equipo) más 822 de logopedia que venían sin nadie TAMBIÉN
en Organízate. Las 3.886 sesiones sin terapeuta son historia clínica de esas
mismas bajas y se quedan así a propósito (el texto original, con su firma, va
en `observations.textoOriginal`).

**Lo hecho**: `scripts/_hechos/marcar-origen-citas-organizate.js` reconstruyó
del volcado de quién era cada una y lo anotó en `additionalData`; la pantalla
de citas sin profesional lo enseña («Era de») y pulsándolo se marca el bloque
entero, igual que pulsando el paciente. **Lo pendiente es una decisión del
centro**: quién hereda cada agenda (las dos terapeutas ocupacionales nuevas y
la logopeda nueva tienen la agenda vacía esperándolas). Con los bloques, son
tres o cuatro decisiones, no 1.827 casillas.

## El resto de la revisión

Auditoría completa (`auditar-migracion-aumenta.js`) contra producción el
26/08: recuentos exactos, dinero al céntimo año a año (2.062.884,96 € facturado
· 1.922.960,55 € gastado), cero huérfanos, muestreo de 60 registros uno a uno
sin una desviación. Dos avisos benignos: el tipo de cita nº 57 es «Sesión
(importada)», que creó la propia migración, y una pareja de tutores casi
idénticos que es una errata de origen y revisa el centro.
