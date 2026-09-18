# Cuando el CRM y Organízate no dicen lo mismo, manda el CRM

**18/09/2026 · Rodrigo.** Aplica a `aumenta` mientras siga con un pie en cada
sistema, y a cualquier centro que venga de una migración parecida.

## De dónde sale

AV-0196 de Aumenta, escrito por Isabel Alberca: además de preguntar por dos
pacientes concretos, dejaba caer la pregunta de fondo — «¿hay que pasar los
cobros por el importe que marca Organízate?».

No era un fallo del CRM: era una regla que no estaba escrita en ninguna parte, y
mientras no lo estuviera, cada persona (y cada script nuestro) podía resolverlo
de una manera distinta. Aumenta lleva desde julio trabajando en el CRM y todavía
apunta cosas en Organízate, así que los dos sistemas se separan todos los días.

## La decisión

> «A partir de hoy, el CRM. Igualmente puede darse que registren algo en
> Organízate y haya que cambiarlo aquí, así que si viene de Organízate lo marcas
> y nos lo preguntas.»

Dos mitades, y la segunda es la que la hace segura:

1. **El CRM es la fuente buena.** Si un importe, un cobro o una factura no
   coinciden, el bueno es el del CRM. No se reescribe el CRM para que se parezca
   a Organízate.
2. **Pero lo que llega de Organízate no se descarta: se MARCA y se pregunta.**
   Puede que allí hayan apuntado algo de verdad —un pago en efectivo en
   recepción, una cuota nueva— que aquí todavía no está. Eso no lo decide un
   script: se identifica, se le enseña al centro y ellos dicen.

## Cómo se aplica

- **Ningún pase de datos corrige importes «según Organízate».** Un script puede
  ENGANCHAR lo que cuadra al céntimo (como hizo
  `conciliar-facturas-organizate.js` el 18/09 con 29 facturas), y lo que no
  cuadra lo deja quieto y lo lista. Adivinar ahí es inventar dinero.
- **Lo importado se reconoce por su nota.** Las filas que vinieron del volcado
  llevan escrito «Importado de Organízate el …» en `notes`, y por ahí se separan
  de lo que ha tecleado el centro. Esa nota es lo que hace posible esta regla:
  sin ella no se sabría de dónde viene cada cifra.
- **La pregunta se hace por el Buzón, con la lista delante.** No «revisad
  Organízate», sino «estas 64 facturas de septiembre no tienen cobro detrás:
  decidnos cuáles se han pagado».

## Lo que no cambia

El dinero de verdad sigue siendo el del banco. Esta regla dice cuál de los dos
programas manda cuando discrepan, no que el CRM tenga razón contra un extracto:
si aparece un pago en la cuenta que aquí no está, eso es un cobro que falta y se
apunta.

Ver también: `docs/modules/billing.md` y la ficha `cnuyfb` del Registro.
