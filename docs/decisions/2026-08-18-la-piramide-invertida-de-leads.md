# La pirámide invertida de Leads, y de dónde sale la escalera (regla #16)

**Fecha:** 17–18/08/2026 · **Quién:** Jorge · **Módulos:** leads, clients,
training (y la política de `modules/overrides/` para todos) · **Lo que quedó en
`CLAUDE.md`:** la regla #16 (la escalera) y el bloque corto «Overrides».

## Qué se midió el 18/08

El módulo base de Leads tenía 94 líneas y era una tabla pobre; cada uno de los
seis overrides tenía entre 600 y 1.060, y eran el producto de verdad, copiado
seis veces. El comentario del base decía «hoy no lo ve nadie» — ya no era
cierto: en producción lo veían `somos`, `gm_alvar_alonso` y las tres demos por
oficio. **Los clientes más nuevos veían la peor pantalla.** Y
`overrides/nutri-laura/` (6 ficheros, 3.855 líneas, 41 commits en un mes) no
era un override: era la ficha de cliente entera.

Pasó porque copiar era el seguro más barato cuando no había ni pruebas ni forma
de ver las pantallas. Desde el 18/08 sí las hay (`npm test`, la prueba de
deriva de etapas, sesión de demo pública para mirar).

## Qué se decidió

- **Nada nuevo entra en `modules/overrides/`** salvo comportamiento propio de
  UN cliente. Lo genérico va al módulo base, gateado por módulo o feature flag.
- **Un dato que el servidor necesita se declara en `lib/`**, no dentro del
  componente: `lib/leads/embudos.js` es el modelo (declara las etapas de cada
  tenant, y `scripts/_smoke-leads-etapas.mjs` vigila que las copias no se
  separen).
- **Los seis overrides NO se unifican de golpe** (Jorge, 17/08). Se encogen por
  oportunidad, cuando se toque uno por otro motivo, sacando la pieza compartida
  al base con su prueba. Nunca un «sprint de refactor».
- El objetivo es un módulo base digno que lean todos los clientes nuevos, no
  borrar carpetas.
- **Cuando un cliente pide algo, se sube LA ESCALERA** (regla #16 de
  `CLAUDE.md`): palabras → dato en `lib/` → interruptor → parámetro → y solo al
  final pantalla propia. Es la regla que decide qué entra en `overrides/` y qué
  no.

## Lo que ya encogió (18/08/2026, la misma tarde)

- El base de Leads pasó a ser el de aumenta parametrizado (775 líneas: color
  del tenant, embudo de `lib/leads/embudos.js`), y con eso los overrides de
  `demo` y `sandbox` —copias del de aumenta sin nada propio— se borraron; la
  demo enseña el embudo por defecto (cinco etapas). Aumenta conserva el suyo a
  propósito: lo único que la separa del base es el rosa `#FF1F96`, y no se le
  cambia sin que lo pida.
- Los tres paneles de la ficha de Laura (Historia clínica, Documentos,
  Sesiones) pasaron a `components/clients/`; el base los monta por módulos
  según `lib/clients/piezasFicha.js` —**Aumenta no gana ninguno**, decisión de
  Jorge— y la ficha de Laura los importa de ahí con sus palabras de siempre.
  Su override queda en cabecera + tarjeta + pestañas.
- La portada de Formación de Aumenta dejó de ser override: es la base con el
  interruptor «formación abierta» (`featureFlags.formacionAbierta` de
  `training`, `lib/training/formacionAbierta.js`), que también esconde
  Empresas y Cuestionarios del menú. Se encendió en producción ANTES de
  desplegar para que Aumenta no viera nunca la portada completa.
- `/admin/modulos` cuenta desde entonces **pantallas propias** (ficheros) y en
  cuántos clientes, y habla el idioma de la escalera (`parámetro`,
  `interruptor`, `pantalla propia`, `campos`).

Quedan **cinco pantallas propias en cuatro clientes** (comprobado en producción
el 19/08/2026 contra el letrero `ui_override`): Leads de `aumenta`,
`nutri_laura`, `retorika` y `spain_enzymes`, y la ficha de cliente de
`nutri_laura`. Spain Enzymes **sigue siendo cliente**: su override no se toca.

## El letrero

La columna `ui_override` de `master.tenant_modules` es un LETRERO: el código no
la lee (la pantalla se elige con el mapa `UI_OVERRIDES` por slug de cada
página); solo la enseña `/admin/modulos`. Se mantiene fiel con
`scripts/sincronizar-ui-override.mjs`, que lee la verdad de esos mapas — se
relanza tras añadir, mover o borrar un override, y en producción va con
`docker run` montando el repo (la imagen no lleva `app/`; ver su cabecera).

## Lo que esto deja atrás

`docs/refactor-base-override/` (07/08/2026) planificaba lo contrario: clonar
los 40 pares tenant × módulo. Esa decisión queda **superada** por esta; la
carpeta se conserva como histórico y su README lo dice.
