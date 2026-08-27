# Partir las cuatro pantallas más grandes, y con qué red se hizo

**27/08/2026 · Jorge** · `modules/config/`, `modules/default/citas/`,
`modules/nutricion/planEditor/`, `modules/overrides/nutri-laura/`

---

## De dónde viene

La tarea llevaba en el Registro desde el 20/08: las cuatro pantallas más
grandes del proyecto no cabían en la cabeza de nadie y cualquier arreglo
pequeño obligaba a leer miles de líneas ajenas. La decisión del 19/08 era
partirlas «la próxima vez que un cambio real obligue a entrar»; el 27/08 Jorge
pidió hacerla entera, «con muchísimo cuidado».

| Pantalla | Antes | Después |
| --- | --- | --- |
| `modules/config/ConfigModule.jsx` | 3.284 (y creciendo: 2.464 al apuntarse) | 972 + 8 piezas en `tarjetas/` (una por pestaña) |
| `modules/default/CitasModule.jsx` | 2.672 | 869 + 4 piezas en `citas/` |
| `modules/nutricion/PlanEditorModal.jsx` | 2.510 | 1.037 + 4 piezas en `planEditor/` |
| `modules/overrides/nutri-laura/LeadsModule.jsx` | 1.877 | 826 + 2 piezas al lado |

Las piezas se llaman como lo que el usuario ve (la pestaña, el modal, la
columna), no como capas técnicas: quien busque «la tarjeta de Stripe» abre
`tarjetas/Conexiones.jsx` sin leer nada más.

## El peligro real, y la red que se montó

En JSX de cliente, **ni el lint del proyecto ni `npm run build` cazan un
identificador sin definir**: `eslint-config-next` no lleva `no-undef` (eso lo
hace TypeScript, que aquí no hay) y el build no ejecuta las páginas con
cookies. Un `usaEstado` suelto compila limpio y revienta la pantalla al
pintar. Es exactamente el «ir a ciegas» que decía la tarea — este fichero ya
lo avisaba a cuenta del `domicilio` del 04/08.

La red: una config de ESLint aparte, solo para el refactor, con `no-undef` +
`react/jsx-no-undef` + `react/jsx-uses-vars` y los globals del navegador.
Cada pieza extraída se pasó por ella hasta quedar a cero, y encima fueron
`npm test`, `npm run build` y cada pantalla abierta y USADA en las demos en
local (guardar de verdad, no solo pintar). No está montada en el lint del
proyecto a propósito: el código viejo está lleno de falsos positivos de
`no-undef` que no son fallos (variables de módulo, patrones raros), y
limpiarlos no es de esta tarea.

**La red cazó un fallo de producción que nadie había visto**: el selector de
estado del «No vino» (26/08) quedó dentro de `PatientCard` usando una variable
del componente de arriba. Editar la ficha de un paciente de Laura tiraba la
pantalla con un `ReferenceError`. Lo arregló `dfdead9` el mismo día, antes de
que Laura lo pisara.

## Las reglas que se siguieron (por si hay una quinta pantalla algún día)

- **Mover, no reescribir.** Los componentes de nivel raíz se extraen tal cual:
  ganan `export` y sus imports, y nada más. Donde el componente estaba
  ENCERRADO en el principal (el modal de detalle y el alta manual de Citas),
  se sacó con su estado dentro y un contrato mínimo de callbacks (`onChanged`,
  `onCreated`, `onDeleted`): el padre conserva el calendario y los contadores,
  la pieza no sabe que existen.
- **El remontaje por `key` sustituye a los resets.** El modal de una cita se
  monta con `key={booking.id}`: abrir otra cita estrena el estado (notas,
  propuestas, fecha tecleada) sin la lista de `setXxx(...)` que había en
  `handleEventClick` y que era fácil dejar coja.
- **Las pruebas que leen el fuente mandan sobre el reparto.** `STAGES` y
  `STAGE_STYLE` se quedan en el `LeadsModule.jsx` de Laura porque
  `_smoke-leads-etapas.mjs` los lee de ahí; las tres cadenas literales que
  vigila `_smoke-citas-visibilidad.mjs` siguen en `CitasModule.jsx`; la de
  `correo-cuenta` pasó a mirar `tarjetas/Cuenta.jsx`, que es donde vive ahora
  la regla.
- **El corte fue por script, no a mano**, con un guardia que aborta si el
  rango arrastra una definición ajena — que pasó (el componente principal de
  Laura vivía ENTRE las piezas) y el guardia lo paró.

## Lo que NO cambió

Ningún comportamiento. Los diálogos siguen siendo los del `useDialogo` del
padre (se pasan como props, no se duplica la instancia), los embudos siguen
declarados donde estaban, y el `minimo` sin usar de `ContrasenaCard` sigue sin
usar: limpiar cosas que ya estaban así no era de esta tarea.
