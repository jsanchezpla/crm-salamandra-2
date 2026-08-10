# Convenciones de código

> Verificado contra código el 2026-08-07 (commit `030a35e`).

---

## 1. Lenguaje y estructura

- **JavaScript puro.** Nada de TypeScript.
- **`app/` en la raíz.** Nada de `src/`.
- ESLint 9 flat config (`eslint.config.mjs`) + Prettier 3 (`.prettierrc`).
- Terminal: **PowerShell** (Windows). Para curl usar `curl.exe` — el alias
  `curl` de PowerShell es `Invoke-WebRequest`, con otra sintaxis. En el VPS es
  bash normal.

## 2. Idioma

**El código en inglés, lo que ve el usuario en español.**

| Cosa | Idioma | Ejemplo |
| --- | --- | --- |
| `moduleKey`, tablas, modelos, campos | inglés | `clients`, `bookings`, `teamMemberId` |
| Rutas del dashboard | **español** | `/clientes`, `/facturacion`, `/equipo` |
| Rutas de API | inglés (con excepciones) | `/api/clients`, pero `/api/citas`, `/api/nutricion` |
| Componentes y variables | mezcla histórica | `LeadsModule`, `PanelVacaciones` |
| Comentarios y docs | **español** | — |

No es coherente y no se va a unificar: renombrar rutas rompe enlaces
guardados. Al añadir algo, **mira el vecino**.

⚠️ **`leads` vs `sales`**: hay dos moduleKey para el área comercial
(`leads` → `/leads`, `sales` → `/comercial`). En producción todos activan
`leads`. Inconsistencia heredada.

## 3. Endpoints

```js
export const GET = withTenant(async (request, routeContext, tenantContext) => {
  const { tenantModels, hasModule } = tenantContext;
  if (!hasModule("clients")) return forbidden();

  const rows = await tenantModels.Client.findAll({ /* … */ });
  return apiResponse({ ok: true, data: rows });
});
```

- Siempre `withTenant`.
- Siempre `hasModule()`.
- Respuestas con `lib/utils/apiResponse.js`; errores con `lib/utils/errors.js`.
- Forma: `{ ok: true, data }` / `{ ok: false, error }`.
- **Sin stack traces en producción** — error genérico al cliente, detalle en
  los logs.
- CORS explícito. Nunca `origin: *` en producción (salvo las públicas, que ya
  lo llevan en el middleware).

⚠️ `lib/utils/errorTypes.js` existe aparte de `errors.js` porque este último
arrastra `next/server`, que Node no resuelve fuera del empaquetador de Next.
**Los scripts de línea de comandos importan de `errorTypes.js`.**

## 4. Frontend

- **Mobile-first** con Tailwind: diseñar móvil y escalar con `sm:`/`md:`/`lg:`.
  El CRM en escritorio es lo prioritario, pero el móvil no puede romperse.
- Los colores de marca salen de `var(--color-primary)` / `var(--color-secondary)`,
  inyectadas en el layout desde `tenant.settings.brand`.

### Drawers y modales

Todo panel lateral o modal debe respetar la **barra superior móvil** del
dashboard (`h-14`, ~56px, `lg:hidden`) que lleva el botón de menú:

```jsx
// ✅  respeta la barra
className="fixed top-14 lg:top-0 right-0 bottom-0 w-full max-w-md"

// ❌  la tapa, y el usuario no puede abrir el menú
className="fixed top-0 right-0 h-full"
```

### Capas (z-index) — decisión del socio, 2026-07-27

| Elemento | z-index |
| --- | --- |
| Panel de drawer o modal | `z-50` |
| Backdrop | `z-40` |
| **Widgets flotantes** (campana, Salamandrobot) | **`z-30`** |

Los flotantes van **por debajo**: al abrir cualquier drawer quedan tapados y
no pisan botones. Todo modal nuevo sigue esa escala.

## 5. Overrides de UI

Ver `docs/base/routing-overrides.md`. Lo imprescindible:

- Clave del mapa en **underscore**, carpeta con **guión**.
- El `// eslint-disable-next-line react-hooks/static-components` es
  obligatorio y es un falso positivo.
- No quitar nunca el `|| DefaultXModule`: es lo que protege al resto.

## 6. Git

- Commits **directos a `master`**, sin PRs (desde 2026-07-19).
- **Claude no commitea salvo que se lo pidan explícitamente.**
- Conventional Commits + trailer `Co-Authored-By`.
- **`npm run build` en verde ANTES del push** — ya no hay CI que lo pare.
- Revisar que no entren `.env*` ni secretos.
- **Prohibido reescribir historia en master**: nada de `push --force` ni
  `reset --hard` sobre lo ya subido. Los errores se arreglan con un commit
  nuevo o `git revert`.

## 7. Seguridad

- bcrypt **mínimo 12 rounds**. Nunca devolver `passwordHash` en una API.
- JWT en cookies **httpOnly** — nunca en localStorage.
- Rate limiting en auth: el cerrojo duro va por **CUENTA+IP**
  (`lib/auth/loginGuard.js`), nunca por cuenta a secas — el 429 salta antes de
  comprobar la contraseña, así que un cerrojo global por cuenta convertía 6
  peticiones cada 15 min en un DoS gratuito contra una persona concreta (los
  logins de Aumenta son adivinables: `nombre_aumenta`).
- Inputs siempre validados. Métodos de Sequelize, nunca SQL crudo con input
  del usuario; si es inevitable, `sequelize.escape()`.
- **Secrets de producción NUNCA por chats con LLMs.** Si uno se ha visto en un
  chat, se considera comprometido y se rota.
- Endpoint nuevo que **envíe correo, gaste IA o escriba en master** →
  guard de `lib/demo/isDemo.js`.
