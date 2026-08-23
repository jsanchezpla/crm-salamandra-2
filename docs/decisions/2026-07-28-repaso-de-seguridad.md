# Repaso de seguridad del 28/07/2026: rol fresco, cerrojo por cuenta+IP, guard de la demo y auditoría con resumen

**Fecha:** 28/07/2026 · **Quién:** Jorge · **Módulos:** transversal (auth,
tenant, demo, auditoría; toca a todos) · **Lo que quedó en `CLAUDE.md`:**
las cuatro reglas de la sección «Seguridad».

## 1. El rol SIEMPRE se lee fresco de la base de datos

El middleware copia el rol del JWT (15 min de vida) a `x-user-role`, pero
`withTenant` reescribe esa cabecera con el rol real antes de llamar al handler,
mediante un proxy que delega todo lo demás (cuerpo, cookies, url) en el request
original. Así degradar o dar de baja a alguien surte efecto AL INSTANTE en los
~90 endpoints que gatean por esa cabecera, sin tocarlos uno a uno.

## 2. El cerrojo duro del login va por CUENTA+IP, nunca por cuenta a secas

`lib/auth/loginGuard.js`. El 429 salta ANTES de comprobar la contraseña, así
que un cerrojo global a la cuenta convertía 6 peticiones cada 15 min en un DoS
gratuito contra una persona concreta (los logins de Aumenta son adivinables:
`nombre_aumenta`). El cerrojo por cuenta global existe pero con umbral POR
ENCIMA del de IP, para que solo lo alcance un ataque distribuido.

## 3. La demo es pública y da sesión de ADMIN a visitantes anónimos

En la auditoría de ese día apareció el envío de facturas por correo desde la
demo, que salía con la clave global de Resend y desde nuestro dominio
verificado: cualquiera con el enlace podía usar el CRM como relé. De ahí la
regla: **un endpoint nuevo que envíe correo, gaste IA o escriba en master
necesita su guard de `lib/demo/isDemo.js`**. Desde el 13/08/2026 las demos por
oficio (`demo_clinica`, `demo_nutricion`, `demo_agencia`) son públicas igual y
llevan los mismos guards — cambiar `isDemo.js` las cubre a las cuatro.

## 4. Auditar SIEMPRE lo destructivo y lo que mueve dinero

Helper genérico `lib/utils/auditoria.js` (o el de cada módulo si ya existe:
citas, clínica, documentos, facturación). Reglas:

- Se llama DESPUÉS de la mutación y FUERA de la transacción: la auditoría
  escribe en master con otra conexión, y dentro dejaría rastro de un cambio que
  un rollback deshiciera.
- Se guarda un RESUMEN de la fila, nunca la fila entera: en clientes, tickets y
  pacientes hay datos personales (y de salud) que no deben duplicarse en la
  tabla de master, compartida por todos los clientes.
- Cada acción nueva necesita su frase en `lib/actividad/etiquetas.js`, o saldrá
  con el traductor genérico en Equipo → Actividad.
- **Los campos del resumen tienen que existir EN ESE modelo.** Sequelize solo
  hace SELECT de los atributos definidos, así que leer un campo que el modelo
  no expone devuelve `undefined` en silencio y la auditoría sale muda o con el
  `before` y el `after` idénticos. En el repaso fallaban **11 de 15 sitios**
  (p. ej. `Cost` no tiene `amount` —es legacy en BD, fuera del modelo a
  propósito— ni `date` ni `method`, así que borrar un gasto de 12.000 € no
  dejaba rastro del importe).
- Deliberadamente SIN auditar: la edición granular de un menú de nutrición
  (comidas, opciones, alimentos) — el plan ya audita created/updated y auditar
  cada alimento generaría cientos de filas sin valor.

Los logs de auditoría nunca se borran ni modifican, salvo la retención por
antigüedad de `scripts/podar-audit-logs.js`: demo 7 días, clientes reales 3
años con suelo de 1 año.
