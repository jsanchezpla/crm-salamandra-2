# 2026-08-27 — «¿Olvidaste tu contraseña?» deja de ser un enlace muerto

**Quién decidió**: Rodrigo (el esquema entero, por chat, 27/08/2026).
**Qué había**: un `a` sin `href` en el login y ninguna ruta de recuperación.
Quien se quedaba fuera llamaba por teléfono; con 11 clientes de UN solo admin,
un olvido paraba el cliente entero hasta que uno de nosotros entrara por SSH.

## El esquema

La pantalla (`/recuperar`) pide primero el **usuario**, y el camino depende de
quién es:

| Quién | Qué pasa | Qué ve |
| --- | --- | --- |
| **Admin** del cliente | Correo a su `emailContacto` con un enlace de un solo uso (30 min) que abre `/recuperar/[token]`: contraseña dos veces y cambiada | «Mira tu correo» |
| Admin **sin** `emailContacto` | Incidencia al buzón de Salamandra (prioridad alta): restablecer a mano y pedirle un correo | «Mira tu correo» (no se delata qué cuentas no tienen) |
| **Empleado** (`user`/`manager`) | Campana a los admin de su cliente; se la restablecen desde Equipo | «Aviso enviado» |
| Usuario **inexistente** | Nada | «Aviso enviado» — idéntico al empleado, adrede |
| **Tampoco sabe el usuario** | Formulario (empresa, nombre, cargo y un correo donde escribirle) → incidencia al buzón + correo a info@ | «Recibido» |
| Demos y back-office | Excluidos: las demos son públicas; la cuenta de back-office sigue con `reset-tenant-admin-password.js` por SSH | como inexistente / 404 |

## Las decisiones dentro de la decisión

- **El remitente es el de `salamandra_solutions`** (info@…), como el buzón:
  9 de 12 clientes no tienen servicio de correo propio y con el suyo no
  podrían recuperar nada. Esto cierra también la tarea «El correo para
  recuperar la contraseña no tiene remitente decidido».
- **El caso admin SÍ se distingue del resto en la respuesta.** Rompe a
  sabiendas el «responde igual exista o no»: Rodrigo quiso que el admin sepa
  que tiene un correo esperando. Lo que NO se distingue es empleado real de
  usuario inventado.
- **El correo del formulario de «usuario olvidado» NO recibe nada automático**:
  lo tecleó un anónimo; se apunta en la incidencia y se usa DESPUÉS de
  comprobar que es quien dice ser. Mandar el enlace ahí directamente sería
  regalar cuentas.
- **Token**: 32 bytes aleatorios en el enlace; en `master.users` solo su
  sha256 (`reset_token_hash`) y la caducidad (`reset_token_expira`,
  `migrate-users-recuperacion.js`). Un solo uso; al usarlo se borra y se sube
  `tokenVersion` (las sesiones vivas mueren en su siguiente refresh). Los dos
  campos quedan fuera del `defaultScope`, como `passwordHash`.
- **Cerrojos propios** (puertas anónimas): 5/15 min por IP el paso 1 y el 2;
  3/hora el formulario de incidencia.

## Dónde vive

`lib/auth/recuperacion.js` (toda la lógica), `app/api/auth/recuperar/`
(las tres rutas, en `PUBLIC_API_PATHS`), `app/(auth)/recuperar/` (las dos
páginas, en `PUBLIC_PAGE_PATHS`), `lib/email/templates/auth/recuperacion.js`
(el correo). Requisitos de la contraseña: los MISMOS de Configuración
(`lib/auth/contrasena.js`), pintados marcándose mientras se escribe.

## Comprobado (local, 27/08/2026)

Usuario inexistente → respuesta neutral; admin → token guardado y correo
(simulado en local, sin clave); contraseña floja rechazada con las tres
reglas; token bueno cambia la contraseña y el login entra con la nueva; el
mismo token por segunda vez → «caducado o ya usado»; incidencia en el buzón
con empresa, nombre, cargo y correo.
