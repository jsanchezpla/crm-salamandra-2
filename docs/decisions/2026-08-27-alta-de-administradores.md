# 2026-08-27 — Una cuenta de administrador ya se crea desde una pantalla

**Quién decidió**: Rodrigo, 27/08/2026 — «la dos, y la uno como red».
**Qué había**: Equipo solo creaba `user`/`manager`. Una cuenta de dirección
nacía SOLO por SSH. Se vio con un caso real el 26/08: el alta de las dos
administradoras de Aumenta fue un script contra producción, con las
contraseñas en un fichero de `/root` y la entrega en persona.

## Las dos vías, y por qué son dos

| Vía | Quién la usa | Dónde |
| --- | --- | --- |
| **La normal** | El propio cliente: un admin da de alta a otra dirección de SU centro | Equipo → ficha → Acceso al CRM → «Tipo de cuenta: Administrador» |
| **La red** | Nosotros, cuando dentro no queda nadie que pueda | Back-office → Clientes → ficha → Administradores |

La red no sobra: **11 clientes tienen UN SOLO admin**. El día que esa persona
no puede entrar, la vía normal es inalcanzable — no hay nadie dentro para
usarla — y sin la red volveríamos al SSH.

## La asimetría, que parece un error y es la decisión

**Se puede CREAR un admin; NO se puede EDITAR.** `PATCH`, `DELETE` y
`/access/password` siguen rechazando cualquier cuenta admin, igual que antes
(`MANAGEABLE_ROLES` no cambió).

Son dos permisos distintos: dar de alta a la segunda directora de un centro es
una decisión suya, y hacerla pasar por nuestro SSH no protege a nadie. Pero
poder cambiarle la contraseña a otra directora desde una pantalla de RRHH es
entrar en su cuenta, y eso sigue prohibido. Lo que hace viable cerrar esa
puerta es la recuperación por correo estrenada el mismo día
(`docs/decisions/2026-08-27-recuperar-contrasena.md`): quien pierde la suya la
recupera sola, sin que nadie tenga que poder tocarla.

`scripts/_smoke-team-roles.mjs` fija la asimetría, para que meter `admin` en
`MANAGEABLE_ROLES` tenga que ser un acto deliberado y no un «esto estaba mal».

## Los detalles que importan

- Un admin nace con `moduleAccess: ["all"]`, el mismo valor que le pone el alta
  de cliente (`lib/provisioning/altaTenant.js`): creado por dos caminos, queda
  idéntico. La pantalla no pide marcar módulos y lo explica.
- `superadmin` no se puede crear por ninguna de las dos vías: es el rol del
  back-office, con alcance sobre todos los clientes.
- La red **no lee ni cambia** contraseñas existentes, ni borra cuentas. Crea, y
  ya. Mismo criterio que `credencialesCliente.js`, que escribe claves y no las
  lee nunca.
- Ni en demos por ninguna de las dos vías: son públicas y ya dan sesión de
  admin a cualquiera.
- Auditoría con acción propia (`team.admin_created`,
  `provisioning.admin_created`) y no mezclada con las altas de empleado: es lo
  que alguien buscará dentro de seis meses.
- La contraseña no vuelve en ninguna respuesta ni entra en la auditoría.

## Comprobado (local, 27/08/2026)

Crear admin desde Equipo sin marcar módulos → `moduleAccess: ["all"]`; la
cuenta entra con su usuario Y con su correo; PATCH, DELETE y `/password` sobre
ella responden «se gestiona aparte» los tres; desde el back-office el alta
funciona, la de una demo se rechaza, la contraseña floja se rechaza, y la
cuenta creada entra en el CRM pero NO en el back-office.
