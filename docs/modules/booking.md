# Módulo Booking (`booking`)

**moduleKey:** `booking` · **Estado:** implementado en local (24/08/2026), sin
desplegar · **Cliente de referencia:** `laura_ubeda` (Laura Úbeda, cantante)

Contratación de actuaciones: lo que hace una agencia de management o la
representante de un artista. Vender un bolo no es vender un servicio, y el
embudo estándar del CRM no sabía contarlo.

---

## La decisión de fondo: no trae pantallas, cambia las que hay

`booking` **no tiene ni una ruta propia**. No hay `/booking`. Lo que hace es
cambiar tres cosas en pantallas que ya existían:

| Qué | Dónde | Sin booking | Con booking |
| --- | --- | --- | --- |
| El embudo | `lib/leads/embudos.js` | Las cinco por defecto | `EMBUDO_BOOKING`, siete etapas |
| El rótulo del embudo | `app/(dashboard)/leads/page.jsx` | «Leads Profesionales» | «Propuestas» |
| El rótulo de Clientes | `lib/clients/vocabulario.js` | «Clientes» | «Contratantes» |

Por eso **exige `clients` y `leads`**: sin ellos no hay nada que cambiar, y
quien lo comprara suelto se encontraría un menú vacío.

## Se decide por MÓDULO, nunca por slug

Es la primera vez en el repo que el embudo y el rótulo de Leads dependen de un
módulo y no de una lista de clientes. Fue una decisión explícita de Rodrigo el
24/08/2026 al elegir «módulo `booking`» frente a «overrides del tenant»: la
siguiente agencia de management que se dé de alta tiene que salir con su embudo
y su vocabulario **de fábrica**, sin que nadie se acuerde de escribir su slug en
ningún fichero.

Consecuencia técnica: `etapasDe(slug, tieneModulo)` acepta un segundo argumento
opcional. El mapa por slug (`EMBUDOS`) sigue mandando sobre el módulo, por si
algún día un cliente con embudo propio compra `booking`.

## El embudo

```
new → propuesta_enviada → respuesta_recibida → negociando_cache
    → fecha_confirmada → actuacion_realizada        (+ lost)
```

Sale directamente del Excel `CORREOS ENVIADOS.xlsx` con el que trabajaba la
representante: sus columnas eran *Enviado sí/no · Fecha envío · Respuesta sí/no
· Observaciones*.

Dos etapas piden explicación:

- **`respuesta_recibida`** existe porque en booking **el silencio es la respuesta
  más común y no es un «no»**. Sin esta etapa, «me han contestado» y «no me han
  contestado» acaban los dos en `contacted`, y entonces no se puede saber a
  quién hay que insistir ni a quién volver a escribir el año que viene. Un «no»
  explícito sí va a `lost`.
- **`fecha_confirmada`** es el GANADO de este embudo, no `won`: lo que se cierra
  es una fecha concreta. `actuacion_realizada` es lo que viene DESPUÉS de ganar
  (el bolo ya se tocó), no otra forma de ganar.

Las dos están en `GANADAS` y en `CLOSED_STAGES` (`lib/home/summary.js`). Si solo
lo estuviera `fecha_confirmada`, **la conversión bajaría el día del concierto**,
que es justo cuando el trabajo salió bien.

## Qué NO hace todavía

Escrito aquí para que nadie lo prometa:

- **El presupuesto no tiene los bloques del sector.** Facturación →
  Presupuestos funciona, pero es una lista de líneas plana. La plantilla de una
  actuación son tres bloques con subtotales (honorarios artísticos, producción y
  técnica, desplazamientos y dietas) y trece conceptos.
- **La ficha del contratante no habla de música.** Faltan aforo, tipo de
  espacio, si ponen sonido y luces, backline, contacto técnico aparte del
  administrativo y el caché de la última vez.
- **No hay convocatorias en el calendario.** Un objetivo tiene DOS fechas —la
  del festival y el plazo para mandar la propuesta— y hoy solo cabe una. Es lo
  que más se echa de menos: un festival de julio se cierra en enero.
- **Un lead ganado no crea la ficha ni el presupuesto.** Es la limitación del
  módulo Leads (ver `docs/modules/leads.md`), y aquí duele más que en otros
  sitios porque cerrar la fecha es el momento importante del proceso.

## Activarlo

```
node scripts/enable-module.js <slug> booking
```

Exige `clients` y `leads` activos. No trae migraciones propias: no tiene tablas.
