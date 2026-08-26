# Qué cuenta como «ganado» en Aumenta, y que lo marque el CRM solo

**26/08/2026 · Jorge** · Leads, `lib/leads/embudos.js`,
`modules/overrides/aumenta/LeadsModule.jsx`

---

## La pregunta que llevaba parada desde el 17/08

El embudo de Aumenta terminaba en **Nuevo → Contactado → Descartado**. No había
ninguna etapa de «ganado», así que a nadie se le podía marcar como tal y su
embudo **no podía medir si convierten**: `/leads/estadisticas` les escondía la
tarjeta de «Convertidos» a propósito, porque un 0 que no puede subir confunde más
que no enseñar nada.

Eso no era un fallo, era una pregunta de producto —**qué significa «ganado» en un
centro de psicología**— y se dejó abierta dos veces (17/08 y 20/08). El 26/08
Jorge la contesta y elige además cómo se marca: **que lo marque el CRM solo**.

## La respuesta: `paciente`, y no se inventa

Aumenta gana **`paciente`**, rotulada «Ya es paciente» en su pantalla. No es una
etapa nueva: es la que ya usa `nutri_laura`, ya está en la lista canónica y ya
cuenta como ganada en `GANADAS`. En un centro de psicología «ganado» es
exactamente que la persona entre como paciente.

El rótulo diverge del canónico del Excel («Paciente activo») a propósito y queda
declarado en `DIVERGENCIAS_ACEPTADAS` de `_smoke-leads-etapas.mjs`: en el embudo
se lee como el final del recorrido, no como el estado de una ficha.

## Que lo marque el CRM solo

Hasta hoy **lo decidía el navegador**: la pantalla de Laura mandaba `paciente` a
mano y la de spain_enzymes `won`, cada una escrita dentro de su componente. Eso
dejaba dos agujeros:

- una pantalla sin esa línea escrita —la de Aumenta— no podía marcar a nadie por
  bien que le fuera;
- y el navegador hace **dos llamadas** (crear la ficha y mover el interesado),
  con un fallo documentado en el propio código: si la segunda falla, la ficha
  queda creada y el embudo diciendo que aquello sigue pendiente.

Ahora la regla vive en el servidor. `etapaAlGanar(slug, tieneModulo)` dice a qué
etapa se mueve un interesado en ese embudo, y `PATCH /api/leads/[id]` la aplica
**en cuanto el interesado queda enlazado a una ficha**.

Tres condiciones, y las tres importan:

| | Por qué |
| --- | --- |
| Solo al **enlazar** | Desenlazar o guardar otra cosa no mueve nada |
| Solo si **no venía ya enlazado** | Reenlazar a otra ficha no rebobina a quien su equipo movió a mano después |
| Solo si quien llama **no manda etapa** | Las dos pantallas que ya convertían siguen mandando la suya: no se les cambia el comportamiento por debajo |

⚠️ **En `booking` no mueve nada, y no es un olvido.** Allí ganar es que se cierre
la FECHA, no que el contratante tenga ficha: un festival puede estar fichado en
el CRM sin haber contratado nada, y moverlo a «Fecha confirmada» por darle de
alta sería decir que hay bolo. `etapaAlGanar` devuelve `null` ahí.

De un embudo con varias ganadas se coge la **primera**, que es la más temprana.
En booking la última (`actuacion_realizada`) significa algo que todavía no ha
pasado.

## Enlazar la ficha, no crearla — y esto es lo que casi se hace mal

Las otras dos pantallas que convierten crean la ficha desde el lead con nombre,
correo y teléfono. **Aquí eso habría sido un mal negocio.** En un centro infantil
la ficha es la FAMILIA y necesita al menos un paciente y un tutor: una ficha
nacida de tres campos entraría directa en «Fichas a completar» — que es
exactamente el problema del que se venía el mismo día (118 fichas mudas, ver
`2026-08-26-no-vino-en-vez-de-borrar.md`).

En una clínica el alta de verdad se hace en el mostrador. Lo que faltaba no era
crear la ficha: era poder decir **«este interesado es esta familia»**. Así que la
pantalla de Aumenta gana un buscador de fichas, no un botón de crear. El resto
—mover el interesado a «Ya es paciente»— lo hace el servidor.

El buscador pregunta al SERVIDOR (`/api/clients?search=`) y no filtra lo pintado:
son 1.083 fichas.

## Lo que esto arrastra, sabido

- **Vuelve la tarjeta «Convertidos»** en `/leads/estadisticas` para Aumenta.
  Estuvo escondida del 17 al 26 de agosto y era correcto que lo estuviera.
- Dos pruebas tenían congelado lo contrario —«tres etapas y NINGUNA de ganado, es
  su embudo real, no un descuido» y `tieneEtapaGanada("aumenta") === false`— y se
  han reescrito con la fecha y el motivo del cambio, no borrado.
- **El cabo de `qualified` sigue abierto**: su pantalla tiene definido el color de
  una etapa que el embudo no ofrece. Se deja el estilo a propósito (sin él, un
  lead importado ahí perdería hasta el chip). Y al mirarlo se vio que **no es de
  Aumenta**: de las 20 etapas que el CRM acepta, **7 no las ofrece ningún
  embudo**, así que cualquier import puede colar una en cualquier cliente. El
  arreglo bueno es validar la etapa contra el embudo del cliente y no contra la
  lista general — pendiente y apuntado.

## El tamaño real

Aumenta tiene **2 leads** (1 nuevo, 1 contactado), ninguno con ficha, y el último
entró el 26 de julio. Frente a eso, **21 solicitudes** por el formulario web. O
sea que hoy su trabajo no pasa por aquí; esto no urgía y se hace porque la
pregunta ya tiene respuesta, no porque estuviera quemando.
