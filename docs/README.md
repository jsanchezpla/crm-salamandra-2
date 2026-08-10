# Documentación del CRM Salamandra

Índice general. Empieza por [`CLAUDE.md`](../CLAUDE.md) en la raíz si es tu
primer contacto con el proyecto; esto es el siguiente nivel de detalle.

---

## Mapa

```mermaid
flowchart LR
    CM["CLAUDE.md<br/><i>reglas y contexto</i>"] --> BASE
    CM --> MODS

    subgraph BASE["docs/base/ — cómo funciona"]
        ARQ["arquitectura.md"]
        ROUT["routing-overrides.md ★"]
        TEN["tenant-resolver.md"]
        ACC["module-access.md"]
        FICHAS["20 fichas de módulo<br/><i>inventario de ficheros</i>"]
    end

    subgraph MODS["docs/modules/ — qué hace"]
        NEG["16 docs funcionales<br/><i>negocio, endpoints, reglas</i>"]
    end

    subgraph OTROS["histórico y trabajo en curso"]
        DEC["decisions/"]
        REF["refactor-base-override/"]
        QA["qa/"]
        INT["integrations/"]
        TUT["tutoriales/"]
    end

    BASE -.enlaza a.-> MODS
```

## Carpetas

| Carpeta | Qué contiene |
| --- | --- |
| [`base/`](base/) | **Cómo funciona el CRM por dentro**: arquitectura, resolución de tenant, mecanismo de overrides, acceso a módulos, convenciones, patrones, despliegue, y una ficha técnica por módulo con su inventario de ficheros. |
| [`modules/`](modules/) | **Qué hace cada módulo**: negocio, endpoints, reglas de validación, decisiones de implementación. Es el detalle funcional. |
| [`decisions/`](decisions/) | Decisiones arquitectónicas históricas, con su porqué. |
| [`refactor-base-override/`](refactor-base-override/) | Trabajo en curso: refactor que da a cada tenant un override propio por módulo. Diagnóstico, plan y estado del loop. |
| [`qa/`](qa/) | Sprints de QA y sus hallazgos. |
| [`integrations/`](integrations/) | Integraciones con terceros. |
| [`tutoriales/`](tutoriales/) | Guías paso a paso. |

## Atajos

**Voy a tocar un módulo** → [`base/{modulo}.md`](base/) para saber qué
ficheros lo forman, y [`modules/{modulo}.md`](modules/) para saber qué hace.

**Voy a crear un override de tenant** →
[`base/routing-overrides.md`](base/routing-overrides.md). Sin excepción: el
mecanismo tiene trampas que no dan error, solo dejan de funcionar en silencio.

**Alguien no ve un módulo que sí tiene contratado** →
[`base/module-access.md`](base/module-access.md). Son tres puertas y casi
siempre es la segunda.

**Voy a escribir un script o un smoke test** →
[`base/tenant-resolver.md §5`](base/tenant-resolver.md) para autenticarse, y
[`base/patterns.md §1`](base/patterns.md) para la plantilla.

**Voy a desplegar** → [`base/deploy.md`](base/deploy.md), con el checklist y
los dos errores clásicos de `docker exec`.

## Reglas que no están en la doc porque están en el código

- Si el código y un doc discrepan, **manda el código**. Actualiza el doc.
- Los slugs se escriben **como están en BD** (con underscore) en toda
  documentación nueva.
- Nada de TypeScript, nada de `src/`, terminal PowerShell en local.
