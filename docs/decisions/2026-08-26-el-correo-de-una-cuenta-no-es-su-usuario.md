# El correo de una cuenta no es su usuario

**26/08/2026 · Jorge · `master.users`, login, las tres puertas de alta**

## Lo que pasaba

`master.users.email` se llama email y **no es un email**: es el identificador con
el que se entra. Las trece terapeutas de Aumenta entran con `nombre_aumenta`, sin
arroba, y por eso las tres puertas que crean usuarios llaman a `User.create` con
`validate: false` — la validación `isEmail` del modelo las rechazaría.

Medido en producción el 26/08/2026, antes de tocar nada:

| | cuentas |
| --- | --- |
| Total | **30** |
| Entran con un correo de verdad | **12** |
| Entran con un nombre de usuario | **18** |
| …de esas 18, con correo real en su ficha de equipo | **4** |
| …**sin ninguna dirección en ningún sitio del CRM** | **14** |

Esa columna hacía dos trabajos a la vez —identificador y buzón— y para 18 de 30
cuentas los dos no coincidían. Consecuencia práctica: **no había a dónde
escribirles**, así que la recuperación de contraseña no se podía construir.

Y el número que decide la prioridad: **12 de los 13 administradores sí tienen
correo**. El único que no lo tiene es el de `gm_alvar_alonso`, que además es uno
de los **11 clientes con un solo administrador** — o sea, exactamente la persona
a la que la recuperación tenía que salvar.

Es la misma confusión que ya costó una tarea del backlog un nivel más arriba, con
el cliente en vez de con la cuenta, y se resolvió igual: separándolo
(`lib/provisioning/contactoCliente.js`, 13/08/2026).

## Lo que se descartó

**Cambiar `users.email` por el correo de la persona.** Era lo primero que se
pensó, y le cambia el login a gente que está trabajando: trece de golpe en
Aumenta, el cliente que más usa el CRM. Un dato que se puede arreglar no vale una
mañana de teléfono.

**Leer el correo de la ficha de equipo cuando haga falta.** Solo rescata 4 de 18,
obliga a una consulta a otro schema desde un endpoint anónimo, y las cuentas de
back-office no tienen ficha. Se usa, pero como origen del relleno, no como sitio
donde vive el dato.

## Lo que se hizo

**`master.users.email_contacto`**, nullable, único. `email` sigue siendo el
identificador y no se toca.

```
email          → CON QUÉ SE ENTRA. Puede no llevar arroba.
emailContacto  → A DÓNDE SE LE ESCRIBE. Un correo de verdad, siempre.
```

La regla vive entera en `lib/auth/correoCuenta.js`, **sin ni un import** — como
`lib/auth/contrasena.js`, y por el mismo motivo: la usa también el navegador, así
que no puede arrastrar Sequelize al bundle. Lo que necesita la base de datos está
al lado, en `correoCuentaDb.js`.

### La caída a `email`

`correoDeCuenta(usuario)` devuelve `emailContacto` y, si está vacío, `email`
cuando este sí tiene forma de correo. Con eso **las 12 cuentas que ya entran con
su correo funcionan sin tocarles una fila**, y el relleno solo se ocupa de las
demás.

### Se entra con los dos

Jorge, el mismo día: «además de utilizar el usuario para entrar puedan utilizar
su correo». Eso obliga a dos cosas que no son opcionales:

1. **El correo es único contra las DOS columnas.** Si `admin@aumenta.es` es el
   `email` de alguien, no puede ser el `emailContacto` de otro: teclearlo
   señalaría a dos cuentas. Lo sujeta el índice único
   `users_email_contacto_uniq` y, por delante, `correoLibre()` para poder
   contestar con una frase en vez de con un 500.
2. **Cuando algo empata, manda `email`.** `elegirCuenta()` da siempre la
   preferencia al identificador. No es cosmético: mientras el identificador gane,
   ni un dato mal metido puede desviar el login de alguien hacia otra cuenta.

### Y dos identificadores NO son el doble de intentos

Esta es la parte que había que hacer bien. El cerrojo (`lib/auth/loginGuard.js`)
cuenta por lo que se **teclea**, y tiene que seguir haciéndolo porque corre antes
de tocar la base de datos. Pero con dos nombres válidos por cuenta, alternarlos
daría 6 intentos con el usuario y otros 6 con el correo: el doble de presupuesto,
gratis.

Así que el login, cuando ya sabe a quién señalaba lo tecleado y resulta que era
el correo, vuelve a preguntar por el identificador de verdad
(`cerrojoDeCuenta`), y los fallos se apuntan en los dos cubos. El segundo va con
`barrido: false` para no contar dos veces en el cubo de la IP, que es el que
protege a las quince personas de Aumenta que salen por la misma línea.

Comprobado de verdad contra la base local: 3 fallos por usuario + 3 por correo
bloquean (429); 5 repartidos todavía no (200).

### La puerta que no se puede rodear

Jorge: «si hay alguna manera más de crear usuarios que se ponga el correo como
obligatorio». Pedirlo en cada formulario deja el agujero abierto en el siguiente
que se escriba, así que la exigencia va en un **hook `beforeCreate` del modelo**,
por debajo de las tres puertas, de los seeds y de cualquier script futuro.

Es un hook y no una `validate` porque las tres puertas crean con
`validate: false` a propósito, y una validación no se ejecutaría. Los hooks sí.

**Solo al crear.** Un `beforeSave` tumbaría a las 14 cuentas que hoy no tienen
correo en cuanto entraran —el login les escribe `lastLoginAt`—, que es justo lo
contrario de lo que se busca.

### Las tres puertas

| Dónde | Qué pide |
| --- | --- |
| Equipo → «Crear usuario de acceso» | Usuario, **correo** y contraseña. El correo se **propone solo** desde la ficha de empleado si la tiene rellena. |
| Back-office → alta de cliente | «Correo del administrador», obligatorio, aparte del usuario y del contacto de la empresa. Se cae con 422 **antes** de crear el tenant: si se validara después, un correo mal escrito dejaría un cliente a medias con schema y todo. |
| `scripts/crear-usuario-backoffice.js` | Su identificador ya es un correo; se comprueba que lo sea para dar una frase en vez de un volcado de pila. |

Y una cuarta cosa que no estaba pedida pero hacía falta: **se le puede poner o
cambiar el correo a una cuenta que ya existe** (`PATCH` con solo `correo`). Sin
eso, las 14 cuentas mudas se quedaban así para siempre y una errata al crear una
dejaba a alguien atrapado. La ficha avisa en ámbar cuando una cuenta no tiene
correo, porque eso hay que poder **ver**lo, no descubrirlo el día que se queda
fuera.

### Y quién puede ponérselo, que no era obvio

Un admin se lo pone a cualquiera desde Equipo, y para las trece terapeutas de
Aumenta con eso basta. Pero `loadManagedUser` rechaza a propósito **las cuentas
de administrador** y **la de uno mismo**, así que salió un agujero justo donde
más duele: el administrador ÚNICO de un cliente —y hay 11 clientes con uno
solo— no podía ponerse el correo ni él ni nadie. Era exactamente la persona a
la que esto tenía que salvar.

Por eso hay una segunda puerta: **Configuración → Tu cuenta → «El correo de tu
cuenta»** (`POST /api/auth/correo`), al lado de donde se cambia la contraseña y
con sus mismos frenos —la demo no, tope de peticiones, el cerrojo de la cuenta,
y **la contraseña siempre**—. Lo último no es ceremonia: el correo también sirve
para entrar y será a donde llegue el enlace de recuperación, así que sin pedir la
contraseña una sesión abierta sin vigilar en una sala de espera bastaría para
apuntar la cuenta a un buzón ajeno.

No sube `tokenVersion`: al revés que el cambio de contraseña, aquí no ha
cambiado ninguna credencial, y echar a alguien de sus otros dispositivos por
apuntar su correo sería un castigo sin motivo.

Si la cuenta no tiene correo, la tarjeta lo dice **en ámbar**, porque esa es la
única señal que verá esa persona antes del día en que se quede fuera.

### Y que se vea quién no lo tiene

Jorge, el mismo día: «un aviso en cada integrante que tenga una cuenta del CRM
diciendo que cuanto antes se le asigne un correo» y «un aviso en la cuenta de
cada usuario si no lo tienen puesto». Son dos avisos porque son dos personas
distintas mirando, y ninguna de las dos veía nada:

- **Para la dirección, en Equipo.** Un rótulo arriba con el total —contado
  sobre TODAS las fichas con login del cliente, no sobre la página que se ve:
  paginar no puede cambiar cuántas faltan— y una marca en cada fila. Son dos
  preguntas distintas: «¿me queda trabajo?» se contesta de un vistazo, «¿a
  quién?» mirando la lista. Antes había que abrir la ficha de cada uno, de uno
  en uno. Es la misma idea que la marca de `tieneHorario` (07/08/2026) y por el
  mismo motivo, escrito allí: quien tiene que actuar necesita verlo ANTES, no
  cuando alguien llame diciendo que no puede entrar.
- **Para la persona, en el propio CRM.** Una barra sobre el contenido, en
  cualquier pantalla, con un enlace a Configuración → Tu cuenta. La tarjeta de
  Configuración ya lo avisaba, pero es una pantalla donde casi nadie entra: la
  mayoría de los usuarios de clientes reales tiene rol `user` y no administra
  nada. Un aviso que solo se ve si ya has ido a mirar no avisa de nada.

La barra **se puede cerrar, pero vuelve**: se calla en `sessionStorage`, no en
`localStorage`. Una que no se puede cerrar en la pantalla que alguien usa ocho
horas se deja de leer —y peor, es un motivo para no abrir el CRM—; una que se
calla para siempre no la arregla nadie. Una que vuelve mañana se acaba
arreglando. No sale en las demos: esa cuenta la comparte todo el mundo.

## Lo que esto NO hace todavía

**No es la recuperación de contraseña.** Es el suelo que le faltaba. Lo que queda
por decidir y construir está apuntado en el backlog («¿Olvidaste tu contraseña?»
no lleva a ninguna parte), y dos cosas de allí siguen en pie:

- **La clave de Resend de Salamandra.** Hoy `RESEND_API_KEY` va vacía a propósito
  en producción: cada cliente usa la suya (BYOK). Mandar desde
  `info@salamandrasolutions.com` necesita nuestra clave en `.env.production` y el
  dominio verificado. Va por SSH y no pasa por ningún chat (regla 15).
- **La respuesta del formulario tiene que ser siempre la misma**, exista la
  cuenta, no exista, o exista sin correo. Si cambia, es un comprobador gratuito
  de qué cuentas son reales — justo lo que el login se esfuerza en tapar
  ejecutando bcrypt contra un hash falso para que ni el tiempo delate nada.
- **Las cuatro demos son públicas y con sesión de admin**: el endpoint de
  recuperación tendrá que llevar el guard de `lib/demo/isDemo.js`, o cualquiera
  podrá disparar correos desde ellas.

## El relleno

`scripts/backfill-correo-cuenta.js` copia a `email_contacto` el correo que ya
está en la ficha de empleado. En seco por defecto; **no toca `users.email`
jamás**, no pisa un correo ya puesto y no copia uno que ya use otra cuenta.

En producción rescata 4 de las 18 cuentas sin correo. Las otras 14 no tienen
dirección en ninguna parte del CRM y no hay de dónde sacarla: o las escribe un
admin desde Equipo, o hay que pedírselas al cliente.

## Dónde está

| Qué | Dónde |
| --- | --- |
| La regla (pura, la usa también el navegador) | `lib/auth/correoCuenta.js` |
| Las consultas | `lib/auth/correoCuentaDb.js` |
| La puerta que no se rodea | `models/master/User.model.js` (hook `beforeCreate`) |
| El cerrojo por identificador | `lib/auth/loginGuard.js` → `cerrojoDeCuenta` |
| Entrar con los dos | `app/api/auth/login/route.js` |
| Que se vea quién no lo tiene | el rótulo y la marca de `app/api/team/route.js` + `app/(dashboard)/equipo/page.jsx`; la barra de `components/layout/AvisoCorreoCuenta.jsx`, montada en `DashboardShell.jsx` |
| Ponérselo uno mismo | `app/api/auth/correo/route.js` + la tarjeta de `modules/config/ConfigModule.jsx` (zona `correoCuenta` en `lib/configuracion/pestanas.js`) |
| Las tres puertas | `app/api/team/[id]/access/route.js`, `lib/provisioning/altaTenant.js`, `scripts/crear-usuario-backoffice.js` |
| La migración | `scripts/migrate-users-email-contacto.js` (`npm run db:migrate:correo-cuenta`) |
| El relleno | `scripts/backfill-correo-cuenta.js` |
| Las pruebas | `scripts/_smoke-correo-cuenta.mjs` (39 casos) |
