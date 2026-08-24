# El ancho de todas las pantallas, decidido en un sitio

**24/08/2026 · Jorge** — «haz lo mismo con todas las pantallas de facturación y
de todos los módulos, por si alguna tiene mucho padding».

## De dónde viene

El mismo día, Jorge se quejó del blanco a los lados en la portada de Formación.
Eso se arregló solo (`5064d01`) y al hacerlo salió lo de debajo: el ancho no
estaba decidido en ninguna parte, cada pantalla se copiaba el `max-w-` de la que
tuviera más cerca, y el CRM entero contestaba a la misma pregunta con cinco
respuestas.

`components/layout/anchoPantalla.js` existía desde el 14/08 pero **solo lo usaba
Formación**, y el propio fichero decía por qué: aplicarlo al resto «cambiaría el
ancho de cincuenta pantallas de siete clientes en un commit que nadie podría
revisar». Jorge pidió esa pasada y a la vez puso la condición que faltaba: **en
local, sin desplegar, mirándolo él**.

## Qué se midió (antes)

No a ojo: las 77 pantallas del panel se cargaron una a una en un iframe de
1600 px y se midió el contenedor real y el blanco a cada lado. Jorge trabaja en
1920, donde todo esto es aún más gordo.

Salieron **tres problemas distintos**, y solo uno era «mucho padding»:

**1 · Cinco anchos para la misma pregunta.** 896, 1024, 1152, 1280 y sin tope,
mezclados dentro de un mismo módulo. En Facturación, la barra de pestañas iba de
`/facturacion` (1024) a `/facturacion/facturas` (1280) a `/facturacion/cobros`
(1152): la página se movía de sitio en cada pestaña. Y mientras el contenido
desperdiciaba 420 px, la propia barra de pestañas no cabía y tenía scroll.

**2 · Pantallas sin centrar.** `max-w-` sin `mx-auto`: el contenido pegado a la
izquierda y TODO el blanco amontonado a la derecha. Medido a 1920:

| Pantalla | Izquierda | Derecha |
| --- | --- | --- |
| `/ayuda` | 32 px | **964 px** |
| `/clientes/whatsapp` | 32 px | 836 px |
| `/citas/bloqueos` | 40 px | 764 px |
| `/clientes/[id]` | 32 px | 545 px |

De 71 contenedores del CRM, 67 llevaban `mx-auto`. Estos no: es un descuido
copiado, no un criterio.

**3 · Pantallas demasiado estrechas.** `/pedidos/configuracion` enseñaba 672 px
de contenido con 554 de blanco a cada lado.

## Qué se hizo

46 contenedores de 42 ficheros pasan por `anchoPantalla()`. El helper gana un
cuarto nombre, `ajustes` (4xl):

| Nombre | Ancho | Cuándo |
| --- | --- | --- |
| `portada` | 7xl | Portada de módulo |
| `listado` | 7xl | Muchas cosas a la vez: tabla o rejilla |
| `ficha` | 3xl | El detalle de UNA cosa, leído como texto |
| `ajustes` | 4xl | La pantalla de configuración de un módulo |

El cuarto nombre parece romper la regla vieja («solo dos anchos; con tres, quien
duda elige mal»). No la rompe: ese ancho **ya existía**, copiado a mano en cuatro
pantallas de configuración, y sin nombre — que es justo lo que este fichero
existe para evitar. Lo peligroso del tercer ancho nunca fue el número, era tener
que adivinar; y «¿es la pantalla de ajustes de un módulo?» no se adivina.

### La lección de Formación, aplicada

Ensanchar sin más devuelve el problema del 14/08: tarjetas enormes con dos
líneas de texto dentro. Por eso, después de ensanchar, **se volvió a medir cada
rejilla** buscando tarjetas anchas y bajas. Saltó una de verdad:
`/facturacion/analitica`, tres accesos a dos columnas, tarjetas de 602 px y la
tercera sola en su fila. La palanca no es estrechar la página: es **más
columnas**. A tres caben en una fila de ~413 px.

Las demás que saltaron eran falsos positivos comprobados uno a uno: paneles de
barras en `/leads/estadisticas` y `/clinica/estadisticas`, donde el ancho se
convierte en barra más larga, y cabeceras con `col-span` en Presupuestos y
Cumplimiento.

## Qué se dejó fuera, y por qué

- **La portada `/`.** Es editorial a propósito: titular en serif, párrafo a
  `max-w-xl`, todo alineado a la izquierda. Ahí el blanco de la derecha es
  diseño. Se pregunta antes de tocarlo.
- **La ficha de cliente (`/clientes/[id]`).** Sus ~18 tarjetas llevan el
  `max-w-` copiado a mano una por una en `components/clients/`, y esos mismos
  paneles pintan **la ficha propia de `nutri_laura`**. Medido: al pasar por sus
  pestañas el contenido salta de 768 a 1024 a 1274. Arreglarlo bien es un
  trabajo con su decisión sobre Laura detrás, no una línea de una pasada.
- **`/proyectos` y `/outreach`**, que ya iban a 1400 px.

## Cómo se comprobó

- Las 77 pantallas medidas en el navegador antes y después, no leyendo clases.
- Rejillas revisadas tras ensanchar, buscando la tarjeta ancha y baja.
- A 375 px: ninguna pantalla desborda.
- `npm test` 79 bien · 0 mal. ESLint sobre los 46 ficheros: 0 errores.
- **`npm run build` no se lanzó**: el servidor de desarrollo tenía el cerrojo
  porque Jorge estaba mirándolo. Queda pendiente antes de cualquier push.

## Lo que hay que recordar

Que una pantalla esté mal de ancho casi nunca se arregla en esa pantalla. Si el
arreglo es escribir un `max-w-` a mano, el problema vuelve por otro sitio: eso
ya pasó cuatro veces en Formación. Se arregla donde vive la decisión.
