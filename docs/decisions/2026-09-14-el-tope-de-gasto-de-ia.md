# El tope de gasto de IA: aviso al 80 %, freno al 100 % (14/09/2026)

## Qué pasó

El 10/09/2026, a las 16:26, la cuenta de Anthropic de Aumenta se quedó sin
saldo. Esa tarde doce personas usaron la IA (141 usos) y, desde el corte hasta
las 21:00, hubo 129 intentos fallidos. Nada avisó ANTES:

- `vetoAi` (`lib/ai/aiAccess.js`) solo miraba el rol y el candado
  `settings.aiAccess`; en un centro «libre» dejaba pasar a todo el equipo.
- Desde el 11/09 `master.ai_uso` guarda el coste estimado de cada llamada, pero
  solo lo leía la tarjeta de consumo de los admins. Nadie lo comparaba con nada.
- El único aviso (`ai_cuenta`, `lib/ai/avisoDeCuentaIa.js`) salta cuando el
  proveedor YA ha rechazado la llamada: para entonces no queda más que recargar.

Es la T3 del Registro: «Nada avisa antes de que se acabe el saldo de IA de un
centro».

## Qué se decidió

**Un tope mensual por centro sobre el coste estimado.** Dirección lo fija en
Configuración → Conexiones, debajo del consumo: un importe de 1 a 5.000 en € o
en $ (`settings.integrations.iaTopeMensual = { importe, moneda }`, en claro y
sin migración; es donde vive todo lo de Conexiones y la Configuración no tiene
fila en `tenant_modules`, así que no puede ser un `featureFlag` ni un
`logicOverride`). Se suma todo el `coste_usd` del mes de Madrid —Claude,
ChatGPT y Whisper juntos— y se compara en micro-dólares enteros.

- **Sin tope no cambia NADA**: ni se consulta la base. Así nacen todos los
  centros, y así están todos el día del despliegue.
- **Al 80 %**, campana `ia_tope` a los administradores, una por tramo, mes e
  importe (subir el tope rearma el aviso).
- **Al 100 %**, `vetoAi` responde **429 `{ motivo: "tope_ia" }`** a quien no es
  administrador, con la frase de hasta cuándo («La IA vuelve el 1 de …»), la
  campana del 100 % y la auditoría `ai.tope_frenada`. Sin cifras ni la palabra
  «saldo» para quien se frena: el gasto es cosa de dirección, y el saldo puede
  estar lleno.
- **Los administradores nunca se frenan**: son quienes pueden subir el tope. Su
  uso también dispara las campanas.
- **Ante un fallo, deja pasar.** Si la consulta del gasto falla o tarda más de
  500 ms, la llamada sigue; la campana tampoco la retiene más de 500 ms, y un
  intento fallido no se repite hasta pasado un minuto. `vetoAi` es la puerta de las 21 rutas con IA: un
  error ahí apagaría la IA de todo el CRM. El tope protege el gasto, no es un
  permiso (el candado sí cierra ante un fallo, y sigue igual).
- **La frenada se audita** (`ai.tope_frenada` con la acción), simétrica a
  `ai.uso`: los logs del contenedor se pierden en cada despliegue.
- **El tope no es el saldo.** Con clave propia no hay API para leerlo. No ve lo
  gastado con la misma clave fuera del CRM ni los modelos sin precio, y la
  caché de 60 s deja escapar céntimos. La tarjeta lo dice y recomienda poner
  también el límite en la consola del proveedor.

### Por qué freno por defecto y no «solo avisar»

La propuesta de trabajo sobre la IA (la «01 · tope de gasto») ponía «Solo
avisar» por defecto, con «Frenar al equipo» como opción. El Registro, que es
posterior y es la tarea, fija como opción por defecto «avisar al 80 % y, al
100 %, frenar a quien no es admin». Manda el Registro. Si un centro prefiere
solo avisar, se añade un `modo` a `iaTopeMensual` sin migrar: `topeParaGuardar`
descarta hoy las claves que no conoce, y `leerTope` las ignora.

### Por qué en `vetoAi` y no en los clientes centrales

El freno necesita los ajustes del centro y el ROL de quien pulsa, que tiene la
ruta y no el cliente que habla con el proveedor. Y un 429 lanzado desde un
cliente central (`lib/ai/trasFalloDeIa.js`) se tomaría por el «límite de uso»
del proveedor: dejaría una fila de fallo y avisaría a dirección como si su
cuenta estuviera mal. En `vetoAi` va en este orden: `marcarAccion` → tope →
puerta de los admins → candado. Antes del candado para no gastar un permiso de
un solo uso ni crear una solicitud que no serviría de nada.

### Lo que queda fuera de `vetoAi`

La clasificación automática del portal público de Soporte es la única IA sin
`vetoAi`. Mira el tope ella misma: quien abre un ticket nunca es admin, así que
al 100 % no se clasifica, el ticket se crea igual y la campana `ticket_new` lo
dice. Google Places (`buscar-nuevos`) sí pasa por `vetoAi` y también se frena,
aunque su gasto no está en `ai_uso`.

## Descartado

- **Leer el saldo real**: con clave propia (BYOK) no hay API que lo dé.
- **Tope por acción o por persona**: lo que se acaba es la cuenta del centro.
- **Correo al contacto del centro**: la campana llega a los administradores,
  que son quienes pueden subir el tope, en la misma pantalla donde se sube.
- **Vista global en el back-office**: fuera de esta tarea; el tope se ve y se
  fija por centro.
- **Sumar en memoria en `registrarUso`**: dos procesos o un despliegue la
  desalinearían de la base; una consulta con caché de 60 s basta.
- **Una fila de la frenada en `ai_uso`**: no es una llamada; ensuciaría el
  recuento de llamadas y fallidas de la tarjeta.

## Cómo se aplica hoy

- Reglas puras: `lib/ai/topeDeGasto.js` (la importa también la tarjeta, por
  eso no toca nada de servidor). Servidor: `lib/ai/frenoDeGasto.js`.
- Freno: `lib/ai/aiAccess.js` (`vetoAi`); portal:
  `app/api/public/c/[tenantSlug]/soporte/route.js`.
- Guardar: `PATCH /api/tenant/settings` (`iaTopeMensual`); ver:
  `GET /api/tenant/ia/consumo` (`tope`, `personasSinAdmin`) y
  `modules/config/tarjetas/TopeIA.jsx`.
- El Salamandrobot enseña la frase del 403/429 en ámbar en vez de «Inténtalo de
  nuevo en un momento».
- Prueba: `scripts/_smoke-tope-gasto-ia.mjs`. Doc: `docs/modules/configuracion.md`,
  «Tope mensual de gasto de IA (2026-09-14)».
- **Poner el tope a un cliente real (Aumenta, laura_ubeda) no lo hace el
  despliegue ni lo hacemos nosotros sin permiso**: es cambiar el comportamiento
  de su CRM. Lo pone dirección del centro en Configuración → Conexiones, o
  nosotros con su permiso por escrito.
