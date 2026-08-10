# Acceso a módulos

> Quién ve qué. **Hay tres puertas y las tres tienen que estar abiertas.**
> Verificado contra código el 2026-08-07 (commit `030a35e`).

---

## 1. Las tres puertas

Un módulo se ve **solo si pasa las tres**. Olvidar una es el error más
repetido del proyecto: pasó con `analytics` en spain_enzymes (31/07) y con
`documents` en nutri_laura (01/08), y **las dos veces lo detectó el cliente**.

| # | Puerta | Dónde | Qué comprueba |
| --- | --- | --- | --- |
| 1 | **El cliente lo tiene contratado** | `master.tenant_modules.enabled` | El tenant pagó ese módulo. |
| 2 | **El usuario tiene acceso** | `master.users.module_access` | Ese empleado concreto puede entrar. |
| 3 | **El endpoint lo comprueba** | `hasModule()` en cada handler | La API no sirve datos de un módulo cerrado. |

El menú (`components/layout/Sidebar.jsx`) refleja 1 y 2. **El menú por sí solo
no basta**: con la URL guardada se llegaría igual, por eso hace falta la 3.

## 2. `hasModule()` — el cross-check

`lib/tenant/tenantResolver.js:109`:

```js
hasModule(moduleKey) {
  const mod = moduleMap.get(moduleKey);
  if (!mod || !mod.enabled) return false;   // puerta 1: el tenant
  if (!user) return true;                   // sin usuario → solo se valida el tenant
  if (isUserWildcard) return true;          // superadmin o moduleAccess incluye "all"
  return userAccess !== null && userAccess.includes(moduleKey);  // puerta 2
}
```

Dos matices que hay que entender:

- **`!user → true`** es para peticiones **sin usuario**: webhooks,
  `/api/public/*`, `/api/external/*`. No es un agujero: si hay `x-user-id` y
  el usuario no existe, `getTenantContext` ya ha lanzado un 401 antes de
  llegar aquí (`tenantResolver.js:179`).
- **`userAccess === null`** (el campo `moduleAccess` no es un array) significa
  "sin lista explícita" → **deniega**. Solo pasa quien tenga wildcard.

### `tenantHasModule()` — la variante sin usuario

`tenantResolver.js:120`. Para gates condicionales entre módulos: *"si el
tenant tiene `inventory`, descontar stock"*. Pregunta solo por el contrato del
cliente, no por el permiso del empleado. **No sirve para autorizar** un
endpoint.

## 3. `module_access` del usuario

Columna `master.users.module_access`. Tres estados:

| Valor | Significado |
| --- | --- |
| `["all"]` | Wildcard: todos los módulos del tenant. |
| `["clients","citas"]` | Lista explícita: **solo** esos. |
| `null` / no-array | Sin lista → `hasModule` deniega salvo wildcard. |

`role === "superadmin"` también es wildcard, mire lo que mire la lista.

⚠️ **Esta es la puerta que se olvida.** Activar el módulo en
`tenant_modules` y no tocar `module_access` deja al cliente con el módulo
contratado, invisible en su menú y con la API devolviéndole 403.

## 4. Herramientas

```bash
node --env-file=.env.local scripts/enable-module.js <slug> <moduleKey>
```

Da acceso a los **admin** automáticamente (`--sin-admins` para evitarlo) y
avisa de los usuarios normales, que se conceden con `--grant-users`.

```bash
npm run db:check-access
```

Solo lectura. Lista **quién no ve qué en todos los clientes**. Lanzarlo tras
activar módulos y en cada despliegue que los toque.

```bash
node --env-file=.env.local scripts/inspect-tenant-modules.js <slug>
```

Radiografía de un tenant: activos con/sin override y deshabilitados.
⚠️ La columna `uiOverride` que muestra **no la lee la app** — ver
`docs/base/routing-overrides.md §4`.

## 5. Submódulos: básico vs avanzado

Patrón `X` / `X_avanzado`: lo que necesita cualquier cliente vs lo que se
vende aparte.

| Básico | Avanzado |
| --- | --- |
| `team` — plantilla, altas, roles | `team_avanzado` — Desempeño, Dirección, Productividad, Incidencias, Bandeja, Ocupación, Actividad |
| `documents` — solo el contrato del centro | `documents_avanzado` — carpetas, buscador, subida general, cuota |
| `clients` — fichas | `clients_avanzado` — lista de espera de admisión, fichas a completar |

En el sidebar los hijos usan **`requiresAll`**: exigen el avanzado **y** el
módulo que aporta el contenido.

```js
{ key: "team-direccion", href: "/equipo/direccion", adminOnly: true,
  requiresAll: ["team_avanzado", "clinica"] }
```

Los 16 endpoints de `team_avanzado` lo comprueban también.

### Dependencias entre módulos

`formularios` **requiere `leads`**: una bandeja de leads comerciales sin
embudo donde caer no es un producto.

## 6. Gates en las páginas (server components)

Las páginas sensibles hacen `notFound()` si el tenant no tiene el módulo —
`/clientes/lista-espera` y `/clientes/urgentes` son el ejemplo. Es la puerta
que impide llegar con una URL guardada aunque el menú no lo enseñe.

## 7. Reglas al añadir un módulo o un endpoint

1. **`hasModule()` en todos los endpoints del módulo.** Sin excepción.
2. Si la pantalla es sensible, **`notFound()` en el server component** además
   del menú.
3. Tras activar un módulo, **`npm run db:check-access`**.
4. Un endpoint nuevo que **envíe correo, gaste IA o escriba en master**
   necesita su guard de `lib/demo/isDemo.js`. La demo es pública y da sesión
   de **admin** a visitantes anónimos: sin el guard, cualquiera con el enlace
   usa el CRM como relé.
5. La **Configuración es universal** (decisión de Rodrigo, 01/08/2026): las
   tarjetas de integración —WhatsApp, Cloudflare, Anthropic, OpenAI, Google
   Places, Resend— se muestran a todos los clientes, usen o no el servicio.
   Lo que depende del módulo es la **función**, no dónde se pegan las claves.
