# Resolución de tenant

> Cómo sabe el CRM a qué cliente pertenece cada petición.
> Verificado contra código el 2026-08-07 (commit `030a35e`).

---

## 1. El recorrido completo

```
petición
   │
   ├─ middleware.js ──────────────────────────────────────────────
   │    1. reparto por HOST (back-office vs CRM)
   │    2. OPTIONS → 204 con CORS
   │    3. /widget/c/* → público + CSP frame-ancestors
   │    4. rutas públicas → pasan sin token
   │    5. jwtVerify(cookie access_token)
   │    6. ¿el token nació en este host? (claim `bo`)
   │    7. inyecta x-user-id · x-user-role · x-tenant · x-user-email
   │
   ├─ withTenant(handler) ────────────────────────────────────────
   │    8. getTenantContext(request)
   │    9. REESCRIBE x-user-role con el rol fresco de BD
   │
   └─ handler(request, routeContext, tenantContext)
```

## 2. `middleware.js` — la primera puerta

Solo verifica el JWT e inyecta cabeceras. **No consulta la BD** (corre en el
edge runtime, sin Sequelize). Por eso la lista de dominios que pueden
incrustar el widget vive en una variable de entorno y no en una tabla.

Cabeceras que inyecta (`middleware.js:259-267`):

| Cabecera | Origen | Uso |
| --- | --- | --- |
| `x-user-id` | `payload.userId` | Identidad. `getTenantContext` la usa para cargar el usuario. |
| `x-user-role` | `payload.role` | **Se reescribe después** (§4). |
| `x-tenant` | `payload.tenantSlug` | Slug del tenant. Lo leen las páginas para los overrides. |
| `x-user-email` | `payload.email` | Autoría en notas y adjuntos. |

Rutas sin token: `PUBLIC_API_PATHS` (`middleware.js:10-20`). Ojo, el matcher
usa `startsWith`: **`/api/leads` cubriría toda la API privada del módulo**.
La forma pública correcta va bajo `/api/public/`.

## 3. `getTenantContext()` — la segunda puerta

`lib/tenant/tenantResolver.js:155`. Orden de resolución del slug
(`resolveRequestSlug`, línea 151):

```
JWT (cookie access_token)  >  cabecera x-tenant  >  subdominio
```

- El slug se valida contra `/^[a-z0-9_]+$/` — la misma regex que `tenantDb`.
- Los subdominios de **infraestructura** están excluidos
  (`lib/tenant/slugsReservados.js`): sin ese filtro,
  `admin.salamandrasolutions.com` resolvería un tenant llamado `admin`, y
  bastaría dar de alta un cliente con ese slug para apoderarse del panel.
- `resolveRequestSlug` se exporta porque los webhooks necesitan saber a qué
  tenant dice ir la petición **antes** de tocar la BD, para validar la firma
  HMAC contra el secreto de ese tenant. **Si las dos resoluciones divergieran,
  se podría firmar como un tenant y escribir en otro.**

### Caché

La config del tenant se cachea 60 s (`lib/tenant/tenantCache.js`). El
**usuario NO se cachea nunca** (`loadUserAccess`, línea 75): los cambios de
ACL tienen que aplicar al instante. Cuesta una query a `master.users` por
petición autenticada.

Tras cambiar la config de un tenant → `invalidateTenantCache(slug)`.

### Falla en cerrado

Dos decisiones deliberadas, ambas de seguridad:

1. `loadUserAccess` **propaga** los errores de BD. Antes los tragaba y
   devolvía `null`, y `null` significa "petición sin usuario" → `hasModule`
   concedía **todos** los módulos. Un error transitorio de master daba *más*
   acceso, no menos.
2. Si hay `x-user-id` pero el usuario ya no existe en `master.users` → 401
   (`tenantResolver.js:179`). Un usuario borrado con token aún válido (TTL 15
   min) entraba como "modo infraestructura".

## 4. `withTenant()` — el rol fresco

`lib/tenant/withTenant.js`. El wrapper obligatorio de todo Route Handler:

```js
export const GET = withTenant(async (request, routeContext, tenantContext) => {
  const { tenantModels, hasModule } = tenantContext;
  if (!hasModule("clients")) return forbidden();
  // …
});
```

Hace dos cosas:

1. Inyecta el `tenantContext`.
2. **Reescribe `x-user-role` con el rol real de BD.** El JWT dura 15 minutos y
   ~90 endpoints deciden permisos leyendo esa cabecera: sin esto, degradar a
   alguien de admin a usuario no surtía efecto hasta que caducaba su pase —
   durante ese cuarto de hora seguía emitiendo facturas y cambiando sueldos.

   Se hace con un **Proxy**, no clonando el request: clonarlo obligaría a
   arrastrar el cuerpo (`json`/`formData`) y rompería los handlers que lo
   leen. El proxy delega todo en el request real y solo sustituye `headers`.
   Los métodos se re-atan al request original (`withTenant.js:48`) porque
   atados al proxy perderían su estado interno.

## 5. Cómo autenticarse en un script o smoke test

El `x-tenant` sale del JWT, así que **mandar la cabecera a secas no basta**:
hay que firmar un token. Patrón establecido en los 56 smoke tests del repo:

```js
import { signAccessToken } from "../lib/auth/jwt.js";

const cabeceras = {
  "Content-Type": "application/json",
  "x-tenant": SLUG,
  Cookie: `access_token=${await signAccessToken({
    userId: admin.id,
    email: admin.email,
    role: "admin",        // ← cambiar a "user" para probar el otro rol
    tenantSlug: SLUG,
  })}`,
};
```

Referencia completa: `scripts/_smoke-dinero-solo-direccion.mjs:54-66`.
Se ejecuta con `node --env-file=.env.local scripts/…` y necesita el servidor
de desarrollo levantado.

## 6. Separación back-office / CRM

Dos hosts, una sola app, **el mismo `JWT_SECRET`**. `ADMIN_HOST` en el entorno.

- En el host del back-office rige una **lista blanca**
  (`SOLO_ESTO_EN_BACKOFFICE`, `middleware.js:62`): solo existe el panel y lo
  justo para entrar. Lo demás devuelve 404. Se cambió de lista negra a blanca
  el 2026-08-01, porque quitando solo la superficie anónima lo que quedaba
  era el CRM entero.
- Sin `ADMIN_HOST` configurado, el back-office **no se sirve en ningún
  sitio**. Una variable ausente nunca debe abrir una puerta.
- El token va **sellado con el host donde nació** (claim `bo`) y se exige que
  coincida en ambas direcciones. Sin eso, una cookie del CRM valía en el panel
  copiándola con curl — y quien tiene la contraseña es exactamente la amenaza
  de la que el panel se defiende.

## 7. Reglas

1. **Nunca conectar directo a PostgreSQL.** Siempre `getTenantContext`.
2. **Nunca fiarse del slug de la URL** sin verificar el JWT.
3. Todo Route Handler va envuelto en `withTenant`.
4. Validar el módulo con `hasModule()` en cada endpoint — ver
   `docs/base/module-access.md`.
5. Verificar que el recurso pertenece al tenant activo, además del schema.
