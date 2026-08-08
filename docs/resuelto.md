# Resuelto

Lo que ya está hecho, de quién era, cuándo se cerró y cómo se comprobó.

Existe por dos motivos. Uno, para no volver a arreglar lo mismo: cuando algo
reaparece, aquí está qué se hizo la vez anterior y por qué. Y dos, para poder
mirar atrás y ver qué se ha entregado a cada cliente sin reconstruirlo del
historial de git.

---

## Cómo se usa esto

**Nada entra aquí sin haberse comprobado contra PRODUCCIÓN.** No basta con que
el código esté subido, ni con que el despliegue haya terminado: hay que ver el
comportamiento nuevo funcionando en el VPS. Si no se puede comprobar, no se
cierra — se queda en el backlog con una nota de qué se intentó.

Cada entrada lleva **cómo se comprobó**, no solo que se comprobó. Esa línea es
la que permite repetir la verificación dentro de seis meses.

Cuando una tarea sale de `backlog.md`, entra aquí **en el mismo commit**. Así no
hay un momento en que algo no esté en ninguno de los dos ficheros.

Lo más reciente arriba.

---

## 08/08/2026

### El equipo ya no ve el dinero de las citas · `nutri_laura` (y todos con `citas`)

Laura se quejó de que su empleada veía en la agenda el chip «No se pudo cobrar ·
360,00 €» de una clienta. Se cortó en el SERVIDOR, no en la pantalla: el precio
de los tipos de cita ya se escondía en la interfaz desde el 06/08 y el endpoint
lo seguía devolviendo, así que la tarifa entera estaba a un clic derecho.

Un solo `lib/citas/dinero.js` decide qué es dinero y lo aplican los seis puntos
de salida. Se quitan importes y estado de cobro; Laura lo sigue viendo todo.
Quién puede confirmar una cita no cambia.

*Cómo se comprobó*: llamando a los endpoints en producción con la cuenta real de
la empleada. Antes le llegaban las 9 tarifas y las 15 citas con importe; después,
ninguna. Y en el navegador, con las dos sesiones: ella ve la solicitud entera sin
el chip, Laura la ve con sus botones de cobro.
*Commits*: `89e735e`, `6c1bae0`, `e0bb7af`.

### Pantalla de módulos y personalizaciones · interno

No se podía saber qué tenía contratado cada cliente sin abrir la base de datos:
CLAUDE.md decía que Aumenta tenía 13 módulos, local 12, los docs del sprint ~17
y en realidad eran 20. Nueva pestaña en el back-office, en tabla, con filtro por
módulo y una columna que separa los cuatro tipos de personalización según lo que
cuesta mantener cada uno.

*Cómo se comprobó*: abierta en el navegador con sesión de back-office; sale la
tabla con los 8 clientes y sus personalizaciones. En producción, `/admin/modulos`
responde y el endpoint está en el código desplegado.
*Commit*: `483de53`.

### La portada enseña el trabajo del cliente · todos

Aumenta —centro de psicología, 20 módulos, quince personas— abría el CRM cada
mañana sin atajo a Pacientes ni a Clínica, y con uno a «Inventario · Materia
prima y producto». Y con una tarjeta de «0 pedidos» todos los días.

Los accesos rápidos eran una lista escrita a mano paralela al menú, que se quedó
en los nueve de la primera versión. Ahora están los clínicos, equipo,
solicitudes, documentos y soporte. Y un bloque del resumen sin nada que contar ya
no se pinta: tener un módulo encendido no es usarlo.

*Cómo se comprobó*: en el navegador con el tenant de Aumenta — Citas, Pacientes
y Clínica encabezan los accesos y los bloques vacíos desaparecen. En producción,
el código desplegado tiene el atajo a `pacientes` y ya no tiene `sales`.
*Commit*: `faf77fc`.

### El correo de Aumenta funciona · `aumenta`

Era el bloqueo de todo: sin correo no se puede dar de alta a una familia, porque
el alta se hace mandando un enlace. Cuenta de Resend creada, dominio verificado
con DKIM y SPF (el CNAME de rastreo se dejó fuera a propósito: no se quieren
rastrear clics de pacientes), y clave y remitente puestos en el CRM.

*Cómo se comprobó*: dos correos enviados desde producción con la misma tubería
que usan las citas, a `info@salamandrasolutions.com` (id `060ac459…`) y a
`jsanchezpla@gmail.com` (id `e1b0f53e…`). Los dos salieron.

### El portal de citas de Aumenta, montado · `aumenta`

Secreto SSO generado y cargado, y las URLs del portal y del acceso configuradas
(`/mi-espacio/` y `wp-login.php`). El tema de su WordPress ya estaba bien: firma
un JWT HS256 con los mismos campos que espera el CRM.

*Cómo se comprobó*: firmando en producción un pase exactamente como lo firma
`aumenta-portal.php` y pasándolo por el verificador real — aceptado. Y un pase
firmado con otro secreto, rechazado. Las dos páginas del widget responden.

### Rotado el secreto SSO de Laura · `nutri_laura`

Se expuso en un chat por un error mío al enmascararlo. Se rotó de forma
coordinada con el `wp-config.php` de su web para que el corte durase segundos.

*Cómo se comprobó*: el CRM usa el secreto nuevo y un pase firmado con él se
acepta; el portal de Laura sigue dejando entrar.

### Borrado el rastro de pruebas en el cliente de Laura · `nutri_laura`

Dos filas de una cuenta de pruebas —una solicitud del formulario y un usuario de
formación— en la base de datos de una clienta real. Borradas en una transacción,
con respaldo previo. No se tocó ni la cuenta de acceso ni la auditoría.

*Cómo se comprobó*: volviendo a buscar ese correo en los 20 sitios donde podía
estar. Cero filas.

---

## 06–07/08/2026

### Botones de ayuda «?» en todo el CRM · todos

53 globos en unas 76 pantallas. Explican lo que sorprende de verdad la primera
vez, sacado de leer los endpoints: que el trimestre del IVA es el en curso y no
el que se declara; que «Compartidos» no es lo que sube el equipo sino el archivo
central, y borrar ahí borra también de la ficha; que el aviso de SLA ignora los
filtros; que marcar «Inactivo» borra el usuario del CRM.

Lo que costó fue no escribir de más: Facturación salió con 44 y hubo que quitar
24. Con el criterio dado de entrada, Equipo salió a una por pantalla y a la
primera. El detalle y los ocho bugs que aparecieron de camino están al final de
`runbook-ayudas-crm.md`.

*Cómo se comprobó*: recuento de `<HelpTooltip>` por módulo, lint y build en
verde, y desplegado.

### A la primera visita solo se llega por el formulario · `nutri_laura`

La valoración inicial se había quedado sin ninguna puerta: no firma contrato
(por diseño), no pasa por caja cuando es gratis, y lo único que quedaba era el
«una sola vez por persona», que cruza por un correo que escribe quien manda la
petición. Puerta propia, apagada de fábrica, que solo aplica a la primera visita
para no cerrarle la agenda al paciente de siempre.

*Cómo se comprobó*: 12 comprobaciones automáticas, incluida la que asegura que
un seguimiento sigue reservándose sin formulario. Encendida en producción.

### El DNI se pide una vez y llega a la ficha · `nutri_laura`

Campo en el formulario de primer contacto que aterriza en la ficha, para no
volver a pedirlo al firmar el contrato. Es el DNI de quien firma —el paciente
puede ser menor— y no es obligatorio: la puerta de entrada no es sitio para un
trámite.

*Cómo se comprobó*: 10 comprobaciones de punta a punta contra el endpoint real,
y el campo servido por el formulario público en producción.
