# Las terapeutas ven la ficha, pero no el dinero

**10/09/2026 · ticket de Raquel Torralbo (Aumenta) · `clients` + `billing` + Correo**

## De qué petición nace

> «Nosotras las terapeutas no tenemos acceso a los clientes. Como idea, se podría
> abrir el acceso, pero capado a una serie de datos de carácter informativo:
> contacto, correo… los datos del contrato; el tema económico que solo lo vean
> oficina y dirección.»

Rodrigo lo aprobó tal cual el mismo día: «que tengan acceso a clientes pero no a
datos económicos del mismo».

En producción, las **catorce** cuentas de terapeuta de Aumenta (rol `user`)
tenían `calendar`, `citas`, `clinica`, `pacientes`, `team_avanzado`,
`documents` y `documents_avanzado`. **`clients` no.** Abrir la ficha de la
familia desde el paciente les daba un 403.

## Lo primero que se comprobó: casi todo el dinero ya se escondía solo

La ficha tiene una pestaña «Facturación» que se pinta con
`/api/clients/[id]/billing-summary`, y ese endpoint gatea por
`hasModule("billing")` —que es módulo del centro ∩ acceso de la persona—. Sin
Facturación devuelve 403, la sección se declara vacía y `PanelPestana` **quita
la pestaña del menú**. Lo mismo pasa con el dinero de las citas, tapado desde el
07/08/2026 en `lib/citas/dinero.js`.

O sea que el grueso del trabajo no era esconder: era encontrar **qué se colaba**.
Se colaban dos cosas, las dos gateadas por `clients` a secas:

1. **Los meses del área privada** (`/api/clients/[id]/portal-months`). Dicen,
   mes a mes, si la familia ha pagado: los meses se abren solos al registrar el
   cobro. Eso es la morosidad de la familia contada de otra manera.
2. **El plan de cuotas de un bono a plazos** (`bonos[].cuotas` de
   `/api/clients/[id]` y de `/api/citas/packs`): cuántas van cobradas, cuál
   rebotó, qué dijo el banco y cuándo lo reintenta Stripe.

Las **sesiones que le quedan** de un bono no son dinero y se quedan a la vista de
todo el equipo: son justo lo que hace falta para atender.

La regla vive en `lib/clients/quienVeElDinero.js` y es la de siempre
(`lib/auth/permisos.js`): **el dinero se gatea con `hasModule("billing")` y nunca
con el rol**, porque quien administra no siempre dirige —Olga y Rosa llevaron la
contabilidad de Aumenta con rol `user` hasta el 09/09/2026—. Con una excepción
escrita: en un centro **sin** módulo de Facturación no hay «quien lo lleve», así
que cerrarlo por ahí dejaría esas dos secciones sin dueño y desaparecerían para
todo el mundo; allí se quedan como estaban.

## Lo que Rodrigo decidió que SÍ ven

- **Editar la ficha**, no solo mirarla: corregir un teléfono o un correo es el
  trabajo, no un privilegio (la regla de `permisos.js`). Borrar una ficha sigue
  siendo de dirección, y el botón ya se escondía.
- **Los datos de facturación** de la ficha (nombre fiscal, NIF, dirección de la
  factura). No llevan importes y son, en la práctica, los datos del contrato.
  Se quedan donde estaban, gateados por el módulo del CENTRO.

## Y el efecto colateral: Correo

**Correo no tiene `moduleKey`.** Se ve con `clients` **o** con `outreach`, así
que darle Clientes a catorce terapeutas les habría puesto de propina la pantalla
de escribirle a las 1.083 familias de golpe. Rodrigo: eso lo manda oficina.

Cerrarlo para todos habría sido una regresión silenciosa —en producción hay dos
cuentas, una en `laura_ubeda` y otra en `nutri_laura`, con Clientes y sin
Facturación, y en una consulta de dos personas quien escribe a las pacientes es
justo esa—. Así que es el **peldaño 3 de la regla #16**: un «esto sí / esto no»
del centro.

- Regla: `lib/correo/quienEscribe.js`. De fábrica, como siempre. Con
  `clients.correoSoloOficina` puesto, además hay que ser **oficina**: dirección
  o quien lleve Facturación (la misma frontera que los bonos,
  `lib/citas/quienDaBonos.js`).
- Se aplica en **tres capas y con la misma función**: el menú
  (`components/layout/Sidebar.jsx`), la pantalla (`app/(dashboard)/correo/page.jsx`,
  que ahora lee también quién mira y hace `notFound()`) y los **siete** endpoints
  de `/api/correo/*` —donde además se recogió la función `puedeUsarCorreo(ctx)`
  que estaba copiada a mano en cuatro de ellos—.
- Se enciende sin desplegar: `node scripts/correo-solo-oficina.js <slug> --poner`.

## Lo que se hizo en producción

1. `node scripts/grant-module-access.js aumenta clients` — añade `clients` al
   `module_access` de las cuentas que llevan lista propia (las de dirección
   tienen `["all"]` y no se tocan).
2. `node scripts/correo-solo-oficina.js aumenta --poner`.

## Prueba

`scripts/_smoke-correo-quien-escribe.mjs` (`node:test`, en `npm test`): que de
fábrica **no cambia nada**, que con el interruptor solo pasan dirección y quien
lleve Facturación, que la bandera solo se lee de la fila `clients`, y que un bono
podado conserva las sesiones y pierde las cuotas.
