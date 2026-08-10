# Método de testing por iteración

Cómo se ejecutan los 6 tests del runbook. **Probado y funcionando el
2026-08-07** contra `nutri_laura` en local.

---

## Preparación (una vez por sesión)

Servidor de desarrollo — **nunca con Bash**, siempre por `preview_start`
(config en `.claude/launch.json`, entrada `crm-dev`, puerto 3000).

## Autenticarse como cualquier tenant, sin contraseñas

El `x-tenant` sale del JWT, así que no basta con mandar una cabecera. Y no
hace falta ninguna credencial real: se firma un token con el mismo helper que
usa el login.

`scripts/_token-pruebas.mjs` (o el equivalente en el scratchpad):

```js
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { signAccessToken } from "../lib/auth/jwt.js";

const SLUG = process.argv[2] || "demo";
const ROL  = process.argv[3] || "admin";

const { Tenant, User } = getMasterModels();
const tenant = await Tenant.findOne({ where: { slug: SLUG } });
const user   = await User.findOne({ where: { tenantId: tenant.id, role: "admin" } });

process.stdout.write(await signAccessToken({
  userId: user.id, email: user.email, role: ROL, tenantSlug: SLUG,
}));
```

```bash
node --env-file=.env.local scripts/_token-pruebas.mjs nutri_laura
```

### En el navegador

La cookie del login es `httpOnly`, pero eso solo impide **leerla** desde JS.
Escribir una cookie con el mismo nombre sí funciona, y el servidor únicamente
mira el valor:

```js
document.cookie = `access_token=${TOKEN}; path=/`;
```

Luego navegar a la página. **Cambiar de tenant es cambiar de token**, lo que
hace trivial el test 3 (regresión de otros tenants).

### En un script

```js
const cabeceras = {
  "Content-Type": "application/json",
  "x-tenant": SLUG,
  Cookie: `access_token=${token}`,
};
```

> **No se usan las credenciales de Jorge ni el gestor de contraseñas.** El
> formulario de login queda intacto.

---

## Los 6 tests

| # | Test | Cómo |
| --- | --- | --- |
| 1 | Sintaxis y build | `npm run build` (o `node --check` en los ficheros nuevos si solo se busca rapidez). 0 errores. |
| 2 | El tenant nuevo sirve su override | Token del tenant → navegar a la página → comprobar que se ve la marca del override (un texto o elemento que solo esté en la copia). |
| 3 | Los demás tenants no cambian | Token de **otro** tenant → misma página → sigue viéndose el base (o su override anterior). |
| 4 | Smoke del módulo | Si existe `scripts/_smoke-*.mjs` o `smoke-*.mjs` del módulo, ejecutarlo entero. 100%. |
| 5 | Consola limpia | `read_console_messages` con `onlyErrors: true`. ⚠️ El tracking empieza al llamar la tool: **recargar la página después** para capturar los errores de carga. |
| 6 | Screenshot | `computer{action:"screenshot"}` en desktop (1568×778) y móvil (375×812 con `resize_window`). |

### Cómo distinguir override de base en el test 2

El clon es idéntico al base, así que a simple vista no se ve nada. Dos
opciones, por orden de preferencia:

1. **Comprobar el módulo servido**, no el píxel: añadir un `data-override`
   temporal, verificarlo, y quitarlo antes de cerrar la iteración.
2. Cambiar algo mínimo y visible en el override (un rótulo) y revertirlo.

Nunca dar por bueno el test 2 "porque la página carga": una página que carga
es exactamente lo que se ve si el override **no** se ha aplicado.

---

## Baseline capturado (2026-08-07, antes de tocar nada)

`nutri_laura` en `/clientes`:

- Módulo `clients` rotulado **«Pacientes»** — `lib/clients/vocabulario.js`
  funcionando por módulos.
- Sidebar: Comercial (Pacientes · Leads → Profesionales/Comerciales), Tareas
  (Citas → Mi horario · Sin profesional), Salud (Nutrición → Alimentos ·
  Recetario · Menús · Pautas), Educación (Formación).
- Marca rosa/marrón del tenant, distinta del verde de Salamandra.
- **Consola sin errores.**
