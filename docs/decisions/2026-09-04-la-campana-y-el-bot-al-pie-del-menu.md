# La campana y el Salamandrobot dejan de flotar: al pie del menú (04/09/2026)

Supera a [Abajo a la derecha, y un mes ocultos](2026-09-03-campana-y-salamandrobot-abajo-a-la-derecha.md),
de la víspera: aquello devolvió los dos widgets a la esquina y los hizo
visibles otra vez; esto los saca de la esquina para siempre.

## Qué pasó

Rodrigo, 04/09/2026: «el salamandrobot y la campana tienen un problema. Se
ubican a veces delante de botones, así que lo que vamos a hacer va a ser
ponerlos debajo del nombre de usuario de cada persona junto a los iconitos: la
ayuda, la llave inglesa, la configuración y salir. Y así quedan estéticos y no
molestan».

Es la tercera vez que se mueven por el mismo motivo. El 02/08 subieron a
arriba-derecha porque «a veces chocan con los botones», y de paso se quedaron
un mes invisibles. El 03/09 volvieron abajo-derecha, con la regla CSS ya
arreglada… y con el choque intacto: abajo a la derecha es exactamente donde los
69 paneles del CRM ponen su Guardar/Crear. Lo único que lo frenaba era una
regla `:has()` que los esconde mientras hay un panel abierto — un parche que
funciona, pero que hay que mantener vivo en cada pantalla nueva.

## Qué se decidió

- **Los botones dejan de flotar.** La campana y el Salamandrobot son ahora dos
  iconos más de la fila del pie del menú, delante de ayuda · soporte ·
  configuración · salir (delante, para no mover de sitio a los cuatro de
  siempre). Ahí no pueden ponerse delante de nada: con un panel abierto, el
  menú entero queda debajo del backdrop, como los otros cuatro.
- **Los desplegables sí flotan, y salen por un portal a `<body>`.** Un panel de
  320 px y un chat de 22 rem no caben en una columna de 220. Se anclan a la
  pantalla: abajo a la izquierda, y en escritorio al lado del menú
  (`lg:left-[232px]` = 220 de menú + 12 de aire). El portal no rompe el SSR
  porque `open` solo se pone a true desde un clic, y las vars de marca llegan
  igual, que para eso `DashboardShell` las escribe en `<html>`.
- **La regla `.crm-flotante` se conserva, colgada del `body`.** Antes colgaba
  de `.dashboard-shell`; con los desplegables fuera de ese árbol, `:has()` no
  los alcanzaría. Sigue con su `:not(.opacity-0)`, que es lo que costó un mes.
- **Abrirlos cierra el cajón del móvil.** En móvil el botón vive dentro del
  cajón, y el fondo `z-40` del cajón abierto es justo lo que la regla lee para
  esconder lo flotante: sin cerrarlo, pulsar la campana no enseñaría nada.
- Los componentes se montan ahora en `Sidebar.jsx` y ya no en
  `DashboardShell.jsx`. Siguen sin `moduleKey`: los ve todo el mundo.

## Cómo se comprueba

- `scripts/_smoke-widgets-flotantes.mjs` (en `npm test`): que no vuelvan a
  montarse en la shell, que estén en la fila del pie y en ese orden, que sus
  paneles salgan por `createPortal` a `document.body` anclados abajo a la
  izquierda, y —lo de siempre— que los tres selectores de la regla lleven
  `:not(.opacity-0)` y el fondo del menú siga apagándose con `opacity-0`.
- En el navegador: los dos iconos bajo el correo de la persona; el desplegable
  y el chat salen al lado del menú sin tapar el contenido; al abrir un panel
  lateral desaparecen; en móvil, pulsarlos cierra el cajón y el panel se ve a
  lo ancho.

## Lo que enseña

Cuando un elemento choca con los botones y la respuesta es «lo escondo cuando
estorbe», el problema sigue ahí y encima ahora hay una regla que mantener. Tres
mudanzas en un mes lo dicen: el sitio malo no se arregla con CSS defensivo, se
cambia de sitio. La regla se queda igualmente —los desplegables sí flotan—,
pero ya no es lo único que separa al asistente del botón de Guardar.
