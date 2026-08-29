# El dinero se sabe por facturas, y las gráficas nuevas no se esconden

**Fecha**: 2026-08-29 · **Decidió**: Rodrigo · **Módulos**: billing, citas, home, demos

## Qué pasaba

Las dos vistas que estrenó la portada el 29/08 —«Ingresos por servicio» y
«Ocupación del equipo»— no salían en NINGUNA de las cuatro demos. Las dos se
escondían solas cuando no había con qué pintarse, y en las demos no lo había:
los tipos de cita estaban sin precio y el equipo sin objetivo semanal de horas.
El escaparate de ventas no enseñaba dos de las gráficas más vendibles.

La primera propuesta fue poner precios a los tipos de cita en los seeds.
Rodrigo la tumbó, y con motivo:

> El dinero no se va a conseguir saber a través de precios de las citas. Solo
> se sabe a través de las facturas. Las facturas tienen que tener aparejado el
> tipo de cita que han comprado, aunque sea internamente. Y que no desaparezcan
> las gráficas ni se escondan, sino que salgan vacías.

## Las dos reglas que quedan

**1 · Los ingresos por servicio salen de las FACTURAS.** La primera versión de
la vista multiplicaba citas del mes × precio del tipo de cita: valor de agenda,
no caja (y Aumenta, la reina de facturación, tiene los precios vacíos a
propósito). Ahora hay un enlace interno factura→tipo de cita
(`invoices.event_type_id`, nullable, migración `migrate-invoice-tipo-cita.js`)
y la vista agrupa por él las facturas activas del mes, con el mismo criterio
que la cifra de «Facturado» (base imponible, emitidas entre el día 1 y hoy).
Una factura sin tipo no cuenta: la gráfica enseña lo ATRIBUIBLE, el total ya lo
dice Facturado. La rectificativa hereda el enlace, para que reste lo anulado.
El enlace lo aceptan crear/editar factura (`eventTypeId`, opcional y validado
contra los tipos del tenant); de momento lo ponen los seeds de las demos, sin
pantalla — «aunque sea internamente».

**2 · Una vista nueva sin datos SALE VACÍA, no desaparece.** `vista()` acepta
`{ vacio: "…" }`: quien lo lleva se enseña siempre, y sin datos la tarjeta
pinta ese texto, que dice por qué está vacía y qué falta por rellenar («Aún no
hay facturas de este mes ligadas a un tipo de cita», «Nadie del equipo tiene
objetivo semanal de horas; se pone en su ficha de Equipo»). Una gráfica que
desaparece no se puede vender ni echar de menos; una vacía que dice qué falta
es una instrucción. Las siete vistas de siempre conservan la regla vieja (una
serie a cero no informa): `vacio` es solo para las dos nuevas.

## Y las demos, con datos de verdad

Los seeds (`seed-sandbox-data.js`, que usan las cuatro demos) siembran ahora:

- **Objetivo semanal** (`weeklyDirectHours`) por miembro, desigual a mano y con
  Administración SIN objetivo a propósito: la demo también enseña que quien no
  lo tiene no sale en la ocupación.
- **Citas con profesional y del mes en curso** (antes: sin `teamMemberId` y
  desperdigadas ±15 días): sin eso la ocupación no tiene numerador.
- **Facturas de citas ligadas a su tipo**, emitidas este mes, con reparto e
  importes desiguales (48/70/35 €). Y un tercer tipo de cita («Sesión online»)
  en `lib/demo/tiposCitaDemo.js`, que con dos barras la gráfica quedaba coja.

Cambio de DATOS → re-foto dorada (la única causa que queda para re-fotografiar
desde [las fotos doradas se migran solas](2026-08-29-las-fotos-doradas-se-migran-solas.md)).

## Dónde vive

- `models/tenant/Invoice.model.js` (`eventTypeId`) + `scripts/migrate-invoice-tipo-cita.js`
  (⚠️ va ANTES del despliegue; registrada en `_module-migrations.js` → billing).
- `lib/home/summary.js` (`vistaIngresosServicio`, `vistaOcupacion`, `vista()` con `vacio`).
- `components/home/GraficaRotatoria.jsx` (la tarjeta vacía).
- `app/api/billing/invoices/route.js`, `[id]/route.js`, `[id]/rectify/route.js`.
- Prueba: `scripts/_smoke-portada-sin-facturacion.mjs` (el caso vacío y el lleno).
