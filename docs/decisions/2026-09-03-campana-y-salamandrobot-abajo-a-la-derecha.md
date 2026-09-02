# La campana y el Salamandrobot van abajo a la derecha, y estuvieron un mes ocultos (03/09/2026)

## Qué pasó

Rodrigo, 03/09/2026: «la campana de avisos debería salir abajo a la derecha;
creo que está oculta ahora mismo para todo el mundo. Además de los círculos de
la pantalla de Inicio, tiene que estar habilitada la campana abajo a la
derecha, igual que el Salamandrobot, que ya debería estar funcional. Los dos se
esconden siempre que se abre un modal o una vista lateral».

Tenía razón en todo. En la demo local, en escritorio y en Inicio, los dos
widgets estaban montados y con `display: none`. La causa es de un solo commit,
`4d72baa1` (02/08/2026), que hizo dos cosas a la vez:

1. Subió la campana y el Salamandrobot de abajo-derecha a arriba-derecha
   (Rodrigo: «a veces chocan con los botones» de los paneles).
2. Añadió `z-40` a la regla de `app/globals.css` que esconde los widgets
   mientras hay un panel abierto, porque la convención del CRM es fondo `z-40`
   + panel `z-50` y ningún panel moderno los escondía.

Lo segundo llevaba un aviso escrito en el propio comentario de la regla, que
se pasó por alto: el fondo del menú móvil (`Sidebar.jsx`, `lg:hidden fixed
inset-0 z-40`) está **siempre en el DOM** y cerrado solo se apaga con
`opacity-0`, y `:has()` lo detecta igual aunque `lg:hidden` lo esconda en
escritorio. Desde ese día la regla acertaba en todas las pantallas, para todo
el mundo, todo el tiempo. Nadie lo vio porque los widgets simplemente no
estaban: las 18 respuestas del Buzón de esa noche hablaban de «la campana» y
la campana no existía en pantalla.

## Qué se decidió

- **Abajo a la derecha**, como pide Rodrigo y como estaban antes del 02/08:
  el Salamandrobot en la esquina (`bottom-4 right-4`) con el chat abriéndose
  hacia arriba, y la campana a su izquierda (`bottom-[1.375rem]
  right-[5.25rem]`) con el desplegable hacia arriba. En móvil, el desplegable
  de la campana sigue anclado a la pantalla y no al botón, que se salía.
- **Se esconden mientras hay un panel abierto**, por la regla `.crm-flotante`
  de siempre: fondo `z-40`, panel `z-50` o los `z-[60..90]` puntuales. Bajar
  su `z-index` no basta (los paneles se montan dentro de `main` y el widget
  seguía recibiendo el clic), y esconderlos es además lo correcto.
- **La regla ignora los fondos apagados**: `:not(.opacity-0)` en los tres
  selectores. El menú móvil cerrado ya no cuenta; abierto (`opacity-100`) sí,
  y los widgets desaparecen bajo él como bajo cualquier panel.
- Ningún componente cambia de sitio en el árbol: los dos se siguen montando en
  `DashboardShell` para todo el mundo, sin `moduleKey`.

## Cómo se comprueba

- `scripts/_smoke-widgets-flotantes.mjs` (en `npm test`) fija las tres cosas:
  los selectores llevan `:not(.opacity-0)`, el fondo del menú sigue apagándose
  con `opacity-0`, y los dos widgets se montan abajo a la derecha.
- En el navegador: en Inicio se ven los dos botones abajo a la derecha; al
  abrir cualquier panel lateral o modal desaparecen y al cerrarlo vuelven; en
  móvil, al abrir el menú desaparecen y al cerrarlo vuelven.

## Lo que enseña

Una regla `:has()` sobre clases de utilidad es frágil por definición: mira el
DOM, no la intención. Cuando un fondo se apaga en vez de desmontarse (por el
fundido), hay que decirle a la regla cómo distinguir apagado de abierto, y
dejar una prueba que lo diga si alguien lo toca. Y un widget que «no molesta»
puede llevar un mes sin estar: lo que se ve en la demo local es lo que ven los
clientes, y merece una mirada de vez en cuando.
