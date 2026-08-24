"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { vocabularioCliente } from "../../lib/clients/vocabulario.js";
import { EVENTO_SIN_VER } from "../../lib/buzon/buzon.js";
import { esFormacionAbierta, HIJOS_OCULTOS_FORMACION_ABIERTA } from "../../lib/training/formacionAbierta.js";
import { esSlugDemo } from "../../lib/demo/demos.js";

const navigation = [
  // Áreas reorganizadas 2026-07-27 (pedido del socio): Inicio suelto arriba y
  // luego Comercial / Tareas / Gestión / Salud / Educación / Operaciones.
  // "Configuración" ya NO es entrada del menú: es el engranaje del pie del
  // sidebar, junto a "Cerrar sesión".
  //
  // ⚠️ RETIRADO 2026-07-27 el grupo "Inteligencia" (analytics, ai, automations,
  // integrations): eran entradas de menú SIN página detrás. Si un comercial
  // activaba uno en una demo, el enlace llevaba a un 404 delante del cliente.
  // Cuando alguno se construya de verdad, se vuelve a añadir aquí junto con su
  // página en app/(dashboard)/.
  //
  // `analytics` YA cumple esa condición desde 2026-07-31: tiene página
  // (/analiticas) y endpoint (/api/analiticas), así que vuelve al menú — dentro
  // de Comercial, no en un grupo "Inteligencia" que ya no existe. Siguen fuera
  // `ai`, `automations` e `integrations`.
  {
    label: "",
    items: [
      {
        key: "inicio",
        label: "Inicio",
        href: "/",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955a1.126 1.126 0 011.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
          </svg>
        ),
      },
      /*
       * ── AYUDA SUBE AL MENÚ (24/08/2026) ─────────────────────────────────
       * Era un interrogante de 16 px sin rótulo, al 30% de opacidad, en el pie
       * del sidebar y en fila con otros tres iconos mudos. Medido: 24×24 px de
       * caja clicable, el elemento más pequeño de la portada —una tarjeta de
       * acceso rápido es 163 veces mayor— y 2,51:1 de contraste, por debajo del
       * 3:1 que pide la WCAG para un control sin texto. En móvil, además,
       * dentro del cajón.
       *
       * El resultado, medido: el Buzón se desplegó el 13/08 y once días después
       * `master.buzon_avisos` tenía DOS avisos, los dos nuestros y del día de la
       * prueba. Cero de los diez clientes vivos. Mientras, la última incidencia
       * real entró por WhatsApp al móvil de Jorge.
       *
       * `always: true` es la bandera que el filtro de abajo ya soportaba y que
       * no usaba ningún item: Ayuda no es un módulo que se contrate, es nuestra
       * puerta y la ve todo el mundo.
       *
       * ⚠️ El icono del pie SE QUEDA. No es un duplicado gratuito: quien ya
       * sabe dónde estaba lo sigue encontrando ahí, y quitarlo obligaría a
       * recolocar los otros tres. Si algún día molesta, se quita ese, no este.
       */
      {
        key: "ayuda",
        label: "Ayuda",
        href: "/ayuda",
        always: true,
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
          </svg>
        ),
      },
    ],
  },
  {
    label: "Comercial",
    items: [
      {
        key: "clients",
        label: "Clientes",
        href: "/clientes",
        // Lista de espera de ADMISIÓN (sprint 2026-07, punto 9): gente
        // esperando plaza. La "lista de espera" de Citas es otra cosa —
        // solicitudes de reserva— y por eso esta lleva apellido.
        // Lleva `moduleKey` porque no la tiene todo el que tiene Clientes: un
        // centro de nutrición no admite por cola (01/08/2026).
        children: [
          { key: "clients-waitlist", label: "Lista de espera", href: "/clientes/lista-espera", moduleKey: "clients_avanzado" },
          // Huecos de datos de las fichas (03/08/2026). Va con `clients_avanzado`
          // desde el 04/08/2026 (Rodrigo): nació con `clients` a secas y le
          // apareció a TODOS los clientes con fichas, incluido nutri_laura. La
          // pantalla resuelve el problema de un centro que importó 1.083
          // familias, no el de una consulta que conoce a sus pacientes por el
          // nombre. La pantalla y el endpoint gatean igual.
          { key: "clients-urgentes", label: "Fichas a completar", href: "/clientes/urgentes", moduleKey: "clients_avanzado" },
          // WhatsApp de números que no están en ninguna ficha (17/08/2026). SIN
          // `moduleKey`: WhatsApp no es un módulo, es una integración universal
          // (regla #14). Lo que la esconde es no tener trabajo — ver
          // `waSueltos` abajo —, así que quien no use WhatsApp no la ve nunca.
          { key: "clients-whatsapp", label: "WhatsApp sin asignar", href: "/clientes/whatsapp" },
        ],
        badge: null,
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-4.5 0 2.625 2.625 0 014.5 0z" />
          </svg>
        ),
      },
      {
        key: "leads",
        label: "Leads",
        // El padre son las ESTADÍSTICAS (01/08/2026): es lo único que mira los
        // dos orígenes a la vez. El embudo de siempre no se mueve de /leads —
        // tiene overrides por tenant colgando (cuatro hoy: aumenta, nutri-laura,
        // retorika y spain-enzymes; eran ocho)— y pasa a ser un hijo.
        href: "/leads/estadisticas",
        badge: null,
        // Leads tiene DOS orígenes y se llaman por su origen (01/08/2026):
        //   Profesionales → quien deriva (el embudo de siempre, /leads).
        //   Comerciales   → quien llega por la web (el antiguo Formularios).
        // En el menú van sin la palabra «Leads» delante, que ya la pone el
        // grupo; dentro de cada pantalla sí, completa. Llevan `moduleKey` porque
        // los hijos no gatean por módulo por defecto y estos solo existen en
        // algunos tenants.
        //
        // Hubo un tercer origen, «Referidos», que se retiró entero el
        // 12/08/2026 con el cliente para el que estaba hecho (abarcaia).
        children: [
          { key: "leads-profesionales", label: "Profesionales", href: "/leads", moduleKey: "leads" },
          { key: "leads-comerciales", label: "Comerciales", href: "/formularios", moduleKey: "formularios" },
        ],
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
          </svg>
        ),
      },
      {
        key: "outreach",
        label: "Captación",
        href: "/outreach",
        badge: null,
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
        ),
      },
      // Correo a mano, a mucha gente a la vez (24/08/2026, Rodrigo). Hasta hoy
      // el CRM solo mandaba correos AUTOMÁTICOS —una factura, un recordatorio—
      // o de uno en uno desde Captación; escribirle a cincuenta ayuntamientos
      // había que hacerlo fuera.
      //
      // No tiene módulo propio: no es algo que se venda, es una herramienta que
      // necesita cualquiera que tenga a quién escribir. `visibleModules` es el
      // OR que hace falta —Clientes O Captación—, y es la misma condición que
      // comprueba el endpoint, así que el menú y la API no pueden discrepar.
      {
        key: "correo",
        label: "Correo",
        href: "/correo",
        visibleModules: ["clients", "outreach"],
        badge: null,
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
          </svg>
        ),
      },
      // Visitas de la web (Cloudflare Web Analytics). Va en Comercial y no en un
      // área propia porque se lee junto a Leads: el embudo empieza en la visita
      // y acaba en el formulario. Reincorporado con página real (ver el aviso de
      // 2026-07-27 arriba): /analiticas existe, no es un enlace a un 404.
      {
        key: "analytics",
        label: "Analíticas",
        href: "/analiticas",
        badge: null,
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9 9 0 100-18 9 9 0 000 18zm0 0a8.949 8.949 0 004.951-1.488A3.987 3.987 0 0013 16h-2a3.987 3.987 0 00-3.951 3.512A8.949 8.949 0 0012 21zM3.6 9h16.8M3.6 15h16.8M12 3a13.5 13.5 0 000 18 13.5 13.5 0 000-18z" />
          </svg>
        ),
      },
    ],
  },
  {
    label: "Tareas",
    items: [
      {
        key: "projects",
        label: "Proyectos",
        href: "/proyectos",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zm0 9.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zm9.75-9.75A2.25 2.25 0 0115.75 3.75H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zm0 9.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
          </svg>
        ),
      },
      {
        key: "calendar",
        label: "Calendario",
        href: "/calendario",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5m-9-6h.008v.008H12v-.008zM12 15h.008v.008H12V15zm0 2.25h.008v.008H12v-.008zM9.75 15h.008v.008H9.75V15zm0 2.25h.008v.008H9.75v-.008zM7.5 15h.008v.008H7.5V15zm0 2.25h.008v.008H7.5v-.008zm6.75-4.5h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V15zm0 2.25h.008v.008h-.008v-.008zm2.25-4.5h.008v.008H16.5v-.008zm0 2.25h.008v.008H16.5V15z" />
          </svg>
        ),
      },
      {
        key: "citas",
        label: "Citas",
        href: "/citas",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ),
        // "Mi horario" = autoservicio del terapeuta (su horario + sus próximas
        // citas). Visible para todos (no adminOnly): cada uno gestiona el suyo.
        children: [
          { key: "citas-mi-horario", label: "Mi horario", href: "/mi-horario" },
          // Citas reservadas a las que les falta profesional (02/08/2026).
          // adminOnly: asignar a una compañera es cosa de dirección/recepción,
          // no de cada terapeuta.
          // `moduleKey: "team"` (10/08/2026): esta entrada no exigía NINGÚN
          // módulo, y aquí "ninguno" quiere decir "para todo el mundo"
          // —`exigidos.every` sobre un array vacío es true—. A Healim, que
          // tiene la agenda contratada y el equipo no, le salía en el menú una
          // pantalla cuyo único botón (asignar la cita a una compañera) se
          // surte de /api/team, que a ella le responde 403: el desplegable de
          // profesionales aparecía vacío y desde la pantalla no había manera
          // de entender por qué. Se exige `team` y no `citas` porque `citas`
          // ya lo pide el padre, y sin Equipo no hay a quién asignar nada.
          { key: "citas-sin-profesional", label: "Sin profesional", href: "/citas/sin-profesional", adminOnly: true, moduleKey: "team" },
          // Bloqueos (12/08/2026, Jorge pidió entrada propia).
          //
          // La PANTALLA es la que sacó Rodrigo ese mismo día a `/citas/bloqueos`
          // —él la dejó accesible desde los botones de las tres cabeceras del
          // módulo—; esto solo la pone también en el menú, que es donde Jorge la
          // pidió. Una pantalla, dos caminos, ningún duplicado.
          //
          // ⚠️ SE LLAMA «BLOQUEOS» EN TODAS PARTES (14/08/2026, Rodrigo). Nació
          // rotulado «Vacaciones y ausencias» aquí y «Bloqueos» en su botón, y
          // el comentario que había en su lugar dejaba la duda anotada para
          // cuando se decidiera cuál manda. Manda «Bloqueos»: es lo que dicen su
          // botón, su cabecera y el propio tramo que se pinta en el calendario,
          // y tener dos nombres para lo mismo es lo que hace que alguien busque
          // una pantalla que está delante. El MOTIVO por defecto sigue siendo
          // «Vacaciones», que es otra cosa: eso es lo que se apunta, no dónde.
          //
          // NO lleva adminOnly: lo apunta todo el equipo desde el 07/08, y cada
          // cual solo puede tocar los suyos — eso lo impone la API.
          { key: "citas-ausencias", label: "Bloqueos", href: "/citas/bloqueos" },
        ],
      },
    ],
  },
  {
    label: "Gestión",
    items: [
      {
        key: "billing",
        label: "Facturación",
        href: "/facturacion",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-5.25h5.25M7.5 15h3M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 010 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a2.999 2.999 0 010-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375z" />
          </svg>
        ),
      },
      {
        key: "team",
        label: "Equipo",
        href: "/equipo",
        // Visible para el CENTRO (módulo team) Y para las terapeutas (módulo
        // clinica, aunque no tengan `team` en su moduleAccess): el admin ve la
        // gestión completa, la terapeuta su mini-módulo (datos + docs + accesos).
        visibleModules: ["team", "clinica"],
        // Herramientas de GESTIÓN DE EQUIPO (las pidió Aumenta para gestionar
        // su equipo, no son clínicas): antes colgaban de Clínica. Desde
        // 2026-07-27 viven TAMBIÉN en /equipo/* (se movieron las páginas), para
        // que la URL y las migas no digan "Clínica" en algo que no lo es.
        // SEPARACIÓN EQUIPO BÁSICO / AVANZADO (2026-07-27, decisión de Rodrigo):
        // el módulo `team` es ahora solo la PRIMERA pantalla (plantilla, altas,
        // usuarios del CRM, módulos y roles) — lo que necesita cualquier cliente.
        // Los submenús de gestión viven en `team_avanzado`, que se vende aparte.
        // `requiresAll` exige AMBOS: el módulo avanzado Y el que aporta el
        // contenido (clinica o citas), porque un tenant con avanzado pero sin
        // clínica vería entradas que su API rechazaría.
        // adminOnly en Desempeño/Dirección/Productividad/Ocupación/Actividad
        // (decisión de Aumenta 2026-07-24); Incidencias y Bandeja las usa todo
        // el equipo, por eso van SIN adminOnly.
        children: [
          // Fichaje: control horario. `moduleKey: "fichaje"` a secas, SIN
          // `requiresAll` con `team_avanzado` — sus siete hermanos de abajo
          // exigen además `clinica`, y atar un control horario a un módulo
          // clínico lo dejaría invendible al cliente que solo quiere Equipo,
          // que es justo quien lo compra. adminOnly: son datos laborales.
          { key: "fichaje", label: "Fichaje", href: "/equipo/fichaje", adminOnly: true, moduleKey: "fichaje" },
          { key: "team-desempeno", label: "Desempeño", href: "/equipo/mi-desempeno", adminOnly: true, requiresAll: ["team_avanzado", "clinica"] },
          { key: "team-direccion", label: "Dirección", href: "/equipo/direccion", adminOnly: true, requiresAll: ["team_avanzado", "clinica"] },
          { key: "team-productividad", label: "Productividad", href: "/equipo/productividad", adminOnly: true, requiresAll: ["team_avanzado", "clinica"] },
          { key: "team-incidencias", label: "Incidencias", href: "/equipo/incidencias", requiresAll: ["team_avanzado", "clinica"] },
          { key: "team-bandeja", label: "Bandeja de trabajo", href: "/equipo/bandeja", requiresAll: ["team_avanzado", "clinica"] },
          // Actividad: registro legible de auditoría de TODO el CRM. Sin
          // moduleKey a propósito (hereda la visibilidad del grupo Equipo:
          // team O clinica); la API es solo-admin igualmente.
          // Ocupación depende de CITAS (no de clinica): un tenant con agenda
          // pero sin módulo clínico también quiere saber sus ausencias.
          { key: "team-ocupacion", label: "Ocupación", href: "/equipo/ocupacion", adminOnly: true, requiresAll: ["team_avanzado", "citas"] },
          { key: "team-actividad", label: "Actividad", href: "/equipo/actividad", adminOnly: true, moduleKey: "team_avanzado" },
        ],
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
          </svg>
        ),
      },
      {
        key: "documents",
        label: "Documentos",
        href: "/documentos",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
          </svg>
        ),
      },
    ],
  },
  {
    label: "Salud",
    items: [
      {
        // "Clínica" = solo lo CLÍNICO: Pacientes e Informes. Las herramientas
        // de gestión (Desempeño/Dirección/Productividad/Incidencias/Bandeja)
        // cuelgan de Equipo desde 2026-07-27 (eran de gestión de equipo, las
        // pidió Aumenta para su equipo). Gating del grupo: módulo `clinica`.
        key: "clinica",
        label: "Clínica",
        href: "/clinica",
        children: [
          { key: "pacientes", label: "Pacientes", href: "/pacientes" },
          { key: "clinica-informes", label: "Informes", href: "/clinica/informes" },
          // Coordinaciones con colegios, sanitarios y familias (sprint 2026-07,
          // punto 7): módulo propio con listado general, además del botón que
          // hay en la ficha del paciente.
          { key: "clinica-coordinaciones", label: "Coordinaciones", href: "/clinica/coordinaciones" },
          // Talleres (02/08/2026): actividades de grupo a las que se apunta
          // quien quiere. NO son especialidades — Habilidades Sociales venía de
          // Organízate marcada como tal y son 4.287 citas.
          { key: "clinica-talleres", label: "Talleres", href: "/clinica/talleres" },
          // Estadísticas del centro (sprint 2026-07, punto 10). adminOnly: son
          // datos agregados de TODO el equipo, y el endpoint también lo exige.
          { key: "clinica-estadisticas", label: "Estadísticas", href: "/clinica/estadisticas", adminOnly: true },
        ],
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 12h3.75l1.5-4.5 3 9 1.5-4.5h8.25" />
          </svg>
        ),
      },
      {
        key: "nutricion",
        label: "Nutrición",
        href: "/nutricion/alimentos",
        // Sub-entradas plegables debajo de Nutrición. Se muestran auto-
        // expandidas cuando la ruta empieza por /nutricion/.
        // «Recetario» y «Pautas» (04/08/2026, Rodrigo): en una consulta de
        // nutrición el menú de Clientes ya se llama «Pacientes», así que este
        // hijo no podía llamarse igual — eran dos «Pacientes» en el mismo
        // sidebar. Y lo que hay detrás no son pacientes, sino las PAUTAS que
        // tienen asignadas. Las rutas y las claves no se mueven.
        children: [
          { key: "nutricion-alimentos", label: "Alimentos", href: "/nutricion/alimentos" },
          { key: "nutricion-recetas", label: "Recetario", href: "/nutricion/recetas" },
          { key: "nutricion-plantillas", label: "Menús", href: "/nutricion/plantillas" },
          { key: "nutricion-asignados", label: "Pautas", href: "/nutricion/asignados" },
        ],
        icon: (
          // lucide-react Salad — combina con el tono terracota de nutri-laura
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
            <path d="M7 21h10" />
            <path d="M12 21a9 9 0 0 0 9-9H3a9 9 0 0 0 9 9Z" />
            <path d="M11.38 12a2.4 2.4 0 0 1-.4-4.77 2.4 2.4 0 0 1 3.2-2.77 2.4 2.4 0 0 1 3.47-.63 2.4 2.4 0 0 1 3.37 3.37 2.4 2.4 0 0 1-1.1 3.7 2.51 2.51 0 0 1 .03 1.1" />
            <path d="M11 12a3 3 0 0 0-3 3" />
          </svg>
        ),
      },
    ],
  },
  {
    label: "Educación",
    items: [
      {
        key: "training",
        label: "Formación",
        href: "/formacion",
        /*
         * LAS CINCO PANTALLAS, EN EL MENÚ (12/08/2026, Jorge).
         *
         * Formación era la única entrada grande SIN hijos: un enlace suelto a
         * `/formacion`, con sus secciones dentro como tarjetas. Para ir de
         * Cursos a Alumnos había que volver a la portada.
         *
         * ⚠️ ESTA LISTA Y LA DE LA PORTADA TIENEN QUE DECIR LO MISMO. Los
         * rótulos son literalmente los de `modules/training/FormacionOverview.jsx`:
         * quien cambie uno tiene que cambiar el otro.
         *
         * Y el 13/08/2026 hubo que cambiarlos los dos: decían «Usuarios» y
         * «Alumnos por curso» mientras las métricas de la portada decían
         * «Usuarios» y «Matrículas» y el override de Aumenta decía «Alumnos» —
         * tres pares de palabras para las mismas dos cosas. Ahora, en los tres
         * sitios: las PERSONAS son «Alumnos» y las inscripciones «Matrículas».
         */
        children: [
          { key: "formacion-empresas", label: "Empresas", href: "/formacion/empresas" },
          { key: "formacion-cursos", label: "Cursos", href: "/formacion/cursos" },
          // «Alumnos» son las PERSONAS y «Matrículas» las inscripciones
          // (13/08/2026). Antes decían «Usuarios» y «Alumnos por curso», que
          // con las métricas de la portada («Usuarios»/«Matrículas») hacían tres
          // pares de palabras para las mismas dos cosas. Las rutas no se tocan.
          { key: "formacion-usuarios", label: "Alumnos", href: "/formacion/usuarios" },
          { key: "formacion-alumnos", label: "Matrículas", href: "/formacion/alumnos" },
          { key: "formacion-cuestionarios", label: "Cuestionarios", href: "/formacion/cuestionarios" },
        ],
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5" />
          </svg>
        ),
      },
    ],
  },
  {
    label: "Operaciones",
    items: [
      {
        key: "orders",
        label: "Pedidos",
        href: "/pedidos",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
          </svg>
        ),
      },
      {
        key: "inventory",
        label: "Inventario",
        href: "/inventario",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 2.625c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
          </svg>
        ),
      },
    ],
  },
  // El alta de clientes YA NO está aquí (2026-07-28). Se movió al back-office
  // interno, en su propio subdominio: dar de alta un cliente no es una tarea DE
  // un cliente, y tenerla en el mismo menú donde se atiende a Aumenta o a Laura
  // invitaba a confundir el contexto. Vive en /admin/clientes de ADMIN_HOST, que
  // además tiene su propia puerta en nginx.
];

// Overrides de label de sidebar por tenant. Solo cambia el texto visible;
// el moduleKey en BD/backend no se toca. (`sandbox` salió de aquí el
// 18/08/2026 con su override de Leads: es el tenant local de pruebas «sin
// override», y con la pantalla base diciendo «Leads Profesionales» un menú que
// dijera «Interesados» sería una incoherencia gratuita.)
const TENANT_LABEL_OVERRIDES = {
  aumenta: { leads: "Interesados" },
};

/**
 * Hijos que un tenant NO ve, por `key`. Mismo espíritu que
 * `TENANT_LABEL_OVERRIDES`: cambia lo que se enseña, no lo que se puede.
 *
 * Nació con los hijos de Formación (12/08/2026) como una lista por slug: la
 * portada de Aumenta escondía a propósito **Empresas** y **Cuestionarios** —es
 * psicopedagogía, su formación es B2C: no hay empresas que matricular ni se
 * evalúa con tests— y sin esto, colgar las cinco pantallas del menú le habría
 * devuelto por el lateral las dos que su propia pantalla le quita.
 *
 * Desde el 18/08/2026 ya no es una lista por slug: lo decide el mismo
 * interruptor que la portada, `featureFlags.formacionAbierta` del módulo
 * `training` (`lib/training/formacionAbierta.js`). Así el menú y la portada no
 * pueden volver a contradecirse, y un centro B2C nuevo lo tiene de fábrica al
 * encender el interruptor, sin que nadie se acuerde de este fichero.
 *
 * NO es una barrera: el endpoint sigue siendo la puerta. Es no ofrecer una
 * pantalla que a ese cliente no le dice nada.
 */
function hijosOcultosSegunModulos(modules) {
  const training = modules.find((m) => m.moduleKey === "training" && m.enabled);
  return esFormacionAbierta(training?.featureFlags) ? HIJOS_OCULTOS_FORMACION_ABIERTA : [];
}

export default function Sidebar({ tenant, user, modules = [], mobileOpen, onClose }) {
  const pathname = usePathname();
  const router = useRouter();

  // Cierra el menú al navegar en móvil
  useEffect(() => {
    onClose?.();
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  const primaryColor = tenant?.settings?.brand?.primaryColor ?? "#1B3A2D";

  const enabledModules = new Set(modules.filter((m) => m.enabled).map((m) => m.moduleKey));

  /**
   * Cuántas fichas quedan a medias, para poder ESCONDER «Fichas a completar»
   * cuando no queda ninguna (12/08/2026, Jorge).
   *
   * En producción `somos` tenía la pantalla en el menú y cero filas en las ocho
   * carpetas: la abría el primer día, la encontraba vacía y no volvía. A Aumenta
   * le pasará lo mismo el día que termine su campaña de 1.800 huecos.
   *
   * `null` = TODAVÍA NO SE SABE, y entonces la entrada SE VE. El error cae del
   * lado de enseñar de más: esconderle a Aumenta su lista de trabajo porque una
   * petición tardó es mucho peor que enseñar una entrada vacía un segundo.
   *
   * Va a `?soloTotales=1`, que cuenta en la base de datos en vez de traerse las
   * filas: lo segundo son 3.997 ms en Aumenta y esto se pide en cada carga.
   */
  const [urgentes, setUrgentes] = useState(null);
  const tieneClientesAvanzado = enabledModules.has("clients_avanzado");

  /**
   * Conversaciones de WhatsApp sin ficha. Mismo criterio que arriba: una lista
   * de trabajo vacía no es una entrada de menú, y aquí importa más todavía —
   * la mayoría de los clientes no tienen WhatsApp conectado y para ellos esto
   * estaría siempre a cero.
   *
   * `null` = todavía no se sabe, y entonces NO se enseña. Aquí el error cae del
   * lado contrario que en «Fichas a completar»: allí esconder la lista de
   * trabajo de Aumenta por una petición lenta sería grave, y aquí enseñar una
   * entrada vacía a los ocho clientes que no usan WhatsApp, solo ruido.
   */
  const [waSueltos, setWaSueltos] = useState(null);
  const tieneClientes = enabledModules.has("clients");

  useEffect(() => {
    if (!tieneClientes) return undefined;
    let vivo = true;
    fetch("/api/whatsapp/sin-asignar?soloTotales=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (vivo && j?.ok) setWaSueltos(j.data.total ?? 0);
      })
      .catch(() => {});
    return () => { vivo = false; };
  }, [tieneClientes]);

  useEffect(() => {
    if (!tieneClientesAvanzado) return undefined;
    let vivo = true;
    fetch("/api/clients/urgentes?soloTotales=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!vivo || !j?.ok) return;
        setUrgentes({
          bloquea: j.data.totalBloquea ?? 0,
          total: (j.data.totalBloquea ?? 0) + (j.data.totalCompletar ?? 0),
        });
      })
      .catch(() => {});
    return () => { vivo = false; };
  }, [tieneClientesAvanzado]);

  /**
   * Respuestas nuestras que esta persona todavía no ha abierto, para poner un
   * punto en el icono de Ayuda.
   *
   * Esto SUSTITUYE a la campana, y a propósito: avisarle por la campana obliga a
   * escribir en el schema de su tenant desde el back-office, y hoy ningún
   * endpoint de `/api/admin` abre el schema de un cliente. Un contador leído de
   * master, desde su propio host y con su propia sesión, da el mismo aviso sin
   * cruzar nada.
   *
   * Sin `moduleKey`: Ayuda la ve todo el mundo.
   */
  const [ayudaSinVer, setAyudaSinVer] = useState(0);

  useEffect(() => {
    let vivo = true;
    fetch("/api/ayuda", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!vivo || !j?.ok) return;
        setAyudaSinVer(j.data.sinVer ?? 0);
      })
      .catch(() => {});
    return () => { vivo = false; };
  }, []);

  /**
   * Y se le hace caso a la propia pantalla de Ayuda cuando dice que ya está
   * leído.
   *
   * El contador de arriba se pide UNA vez, al montar el menú, y el menú no se
   * vuelve a montar al navegar dentro del CRM. O sea que sin esto el punto se
   * quedaba encendido hasta una recarga completa (F5): quien abría la respuesta
   * la leía, salía y seguía viendo el punto, así que volvía a entrar a buscar
   * qué se le había escapado (Jorge, 13/08/2026).
   *
   * El número viene contado de la lista que la persona tiene delante, no de otra
   * consulta: ver `sinLeer` en `modules/buzon/AyudaModule.jsx`.
   */
  useEffect(() => {
    const alCambiar = (e) => {
      const cuantas = e?.detail?.sinVer;
      if (typeof cuantas === "number") setAyudaSinVer(cuantas);
    };
    window.addEventListener(EVENTO_SIN_VER, alCambiar);
    return () => window.removeEventListener(EVENTO_SIN_VER, alCambiar);
  }, []);

  // «Clientes» pasa a «Pacientes» donde el cliente ES el paciente (consulta de
  // nutrición, 04/08/2026). Por MÓDULOS y no por slug —ver
  // lib/clients/vocabulario.js—, y desde el mismo sitio que lo dice la
  // pantalla, para que menú y pantalla no puedan discrepar. El override por
  // tenant sigue mandando encima, que es su razón de ser.
  const labelOverrides = {
    clients: vocabularioCliente((k) => enabledModules.has(k)).plural,
    ...(TENANT_LABEL_OVERRIDES[tenant?.slug] ?? {}),
  };

  // ── Filtro por USUARIO (además del filtro por tenant) ─────────────────────
  // Espejo de la lógica de hasModule() en lib/tenant/tenantResolver.js: el menú
  // solo enseña lo que el usuario podrá abrir de verdad. Wildcard = superadmin
  // o moduleAccess que incluye "all"; si no, se intersecta con moduleAccess.
  // Sin user (edge SSR) no se restringe: el backend sigue siendo el gate real.
  const role = user?.role ?? null;
  const isAdminRole = role === "admin" || role === "superadmin";
  const userAccess = Array.isArray(user?.moduleAccess) ? user.moduleAccess : null;
  const userWildcard = !user || role === "superadmin" || (userAccess?.includes("all") ?? false);
  const userCanSee = (moduleKey) =>
    userWildcard || (userAccess !== null && userAccess.includes(moduleKey));

  // Visibilidad de un sub-ítem. Hijos con `moduleKey` gatean por módulo del
  // tenant (p.ej. Comerciales/Referidos bajo Leads: solo salen donde el módulo
  // está activo). `requiresAll`: el hijo necesita TODOS esos módulos (p.ej.
  // Desempeño = avanzado + clínica).
  const ocultosDelTenant = hijosOcultosSegunModulos(modules);

  const puedeVerHijo = (child) => {
    if (ocultosDelTenant.includes(child.key)) return false;
    // Una lista de trabajo terminada deja de ser una entrada de menú.
    if (child.key === "clients-urgentes" && urgentes && urgentes.total === 0) return false;
    // Sin conversaciones sueltas (o sin saberlo todavía), no hay entrada.
    if (child.key === "clients-whatsapp" && !waSueltos) return false;
    if (child.adminOnly && !isAdminRole) return false;
    const exigidos = child.requiresAll || (child.moduleKey ? [child.moduleKey] : []);
    return exigidos.every((k) => {
      const tenantHasIt = enabledModules.has(k) || enabledModules.size === 0;
      return tenantHasIt && userCanSee(k);
    });
  };

  const initials = user?.email ? user.email.slice(0, 2).toUpperCase() : "??";

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <>
      {/* Backdrop (solo móvil) */}
      <div
        className={`lg:hidden fixed inset-0 bg-black/60 z-40 transition-opacity duration-300 ${
          mobileOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sidebar */}
      <aside
        className={`
          fixed lg:sticky top-0 left-0 h-screen z-50 lg:z-auto
          w-[260px] lg:w-[220px] flex flex-col shrink-0
          transition-transform duration-300 ease-in-out
          ${mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
        `}
        style={{ backgroundColor: primaryColor }}
      >
        {/* Logo + tenant + close button (móvil) */}
        <div className="px-5 pt-6 pb-5">
          <div className="flex items-center justify-between mb-7">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-7 h-7 rounded-md bg-white/[0.10] border border-white/15 flex items-center justify-center shrink-0 overflow-hidden p-[3px]">
                <img src="/salamandrobot-blanco.png" alt="Salamandra Solutions" className="w-full h-full object-contain" />
              </div>
              <span className="font-display text-white text-[13.5px] leading-[1.12] tracking-tight">Salamandra<br />Solutions</span>
            </div>

            {/* Cerrar (solo móvil) */}
            <button
              onClick={onClose}
              className="lg:hidden text-white/40 hover:text-white/70 transition-colors p-1"
              aria-label="Cerrar menú"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Tenant activo */}
          <div className="bg-black/[0.18] rounded-lg px-3 py-2.5 flex items-center gap-2.5 border border-white/[0.04]">
            <span className="relative flex shrink-0 w-2 h-2">
              <span className="absolute inset-0 rounded-full bg-white/40 animate-ping" />
              <span className="relative w-2 h-2 rounded-full bg-white/60" />
            </span>
            {/* Aquí debajo salía el PLAN del cliente en mayúsculas (PRO,
                STARTER). Se quitó el 12/08/2026 (Jorge) porque no significaba
                nada: no gatea ni un módulo, ni un límite, ni un precio, y lo que
                cada uno tenía escrito venía de cómo se sembró — Somos, con los
                21 módulos, ponía STARTER; Retorika, con tres, PRO. La columna
                sigue en `master.tenants`; lo que se retiró es enseñarla. */}
            <div className="min-w-0 flex-1">
              <div className="text-white text-[13px] font-medium truncate">{tenant?.name ?? "Sin tenant"}</div>
            </div>
          </div>

        </div>

        {/* Navegación */}
        <nav className="flex-1 overflow-y-auto px-3 space-y-4 pb-4 slim-scroll">
          {navigation.map((section) => {
            // Un item es visible si el tenant tiene el módulo Y el usuario puede verlo.
            // `visibleModules` permite un OR de módulos (p.ej. Equipo se muestra a
            // quien tenga `team` O `clinica`: el admin gestiona el equipo, la
            // terapeuta ve su mini-módulo aunque no tenga acceso a `team`).
            const canSeeModule = (key) =>
              (enabledModules.has(key) || enabledModules.size === 0) && userCanSee(key);
            const visibleItems = section.items.filter((item) => {
              if (item.adminOnly && !isAdminRole) return false;
              // Las cuatro demos son PÚBLICAS y dan sesión de admin a cualquiera
              // (lib/demo/isDemo.js). Una fila «Ayuda» ahí sería una puerta a
              // Salamandra delante de un visitante anónimo, y encima el endpoint
              // corta la demo igual: sería un enlace que no lleva a ningún sitio.
              if (item.key === "ayuda" && esSlugDemo(tenant?.slug)) return false;
              if (item.key === "inicio" || item.always) return true;
              const keys = item.visibleModules || [item.key];
              return keys.some(canSeeModule);
            });
            if (visibleItems.length === 0) return null;

            return (
              <div key={section.label || "top"}>
                {/* La sección de Inicio va sin rótulo de área */}
                {section.label && (
                  <div className="px-2.5 mb-2 text-[10px] font-semibold text-white/30 uppercase tracking-[0.16em]">
                    {section.label}
                  </div>
                )}
                <div className="space-y-0.5">
                  {visibleItems.map((item) => {
                    const isActive = pathname === item.href;
                    // Para items con children, "activo" también cubre cualquier
                    // ruta hija (p.ej. /nutricion/* mientras estás en plantillas).
                    const hasChildren = Array.isArray(item.children) && item.children.length > 0;
                    const branchActive =
                      hasChildren &&
                      (isActive ||
                        item.children.some(
                          (c) => pathname === c.href || pathname?.startsWith(c.href + "/")
                        ));
                    // Sub-ítems SIEMPRE visibles bajo su grupo (antes solo al
                    // estar dentro de la rama). Así "Mi desempeño", "Dirección",
                    // etc. se descubren sin tener que entrar primero en Clínica.
                    const hijosVisibles = hasChildren ? item.children.filter(puedeVerHijo) : [];
                    const showChildren = hijosVisibles.length > 0;
                    const parentVisuallyActive = hasChildren ? branchActive : isActive;
                    return (
                      <div key={item.key}>
                        <Link
                          href={item.href}
                          className={`relative flex items-center gap-2.5 pl-3 pr-2.5 py-2 rounded-md transition-all group ${
                            parentVisuallyActive ? "bg-white/[0.08]" : "hover:bg-white/[0.04]"
                          }`}
                        >
                          {parentVisuallyActive && (
                            <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-white" />
                          )}
                          <span
                            className={`shrink-0 transition-colors ${
                              parentVisuallyActive
                                ? "text-white"
                                : "text-white/35 group-hover:text-white/65"
                            }`}
                          >
                            {item.icon}
                          </span>
                          <span
                            className={`text-[13px] transition-colors flex-1 truncate ${
                              parentVisuallyActive
                                ? "text-white font-medium"
                                : "text-white/50 group-hover:text-white/80"
                            }`}
                          >
                            {labelOverrides[item.key] ?? item.label}
                          </span>
                          {item.badge != null && (
                            <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-white/10 text-white/70 tabular">
                              {item.badge}
                            </span>
                          )}
                        </Link>
                        {showChildren && (
                          <div className="ml-7 mt-0.5 mb-1 space-y-0.5 border-l border-white/[0.08] pl-2.5">
                            {hijosVisibles.map((child) => {
                              const childActive = pathname === child.href;
                              // Solo lo que BLOQUEA el trabajo lleva número: son
                              // decenas y se pueden terminar. Poner ahí los
                              // 1.800 «por completar» sería un número que no
                              // baja nunca, y un contador que no baja se deja de
                              // mirar en dos días.
                              const cuenta =
                                child.key === "clients-urgentes" && urgentes?.bloquea
                                  ? urgentes.bloquea
                                  : child.key === "clients-whatsapp" && waSueltos
                                    ? waSueltos
                                    : null;
                              return (
                                <Link
                                  key={child.key}
                                  href={child.href}
                                  className={`flex items-center gap-2 px-2 py-1.5 rounded text-[12px] transition-colors ${
                                    childActive
                                      ? "text-white bg-white/[0.05] font-medium"
                                      : "text-white/45 hover:text-white/80 hover:bg-white/[0.03]"
                                  }`}
                                >
                                  <span className="flex-1 truncate">
                                    {labelOverrides[child.key] ?? child.label}
                                  </span>
                                  {cuenta != null && (
                                    <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-white/10 text-white/70 shrink-0">
                                      {cuenta}
                                    </span>
                                  )}
                                </Link>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {/* Usuario + acciones debajo, en horizontal y a la derecha. Orden
            pedido por el socio (2026-07-27): Soporte · Configuración (solo
            admin) · Cerrar sesión.
            13/08/2026: entra AYUDA la primera. Son dos cosas distintas y por eso
            son dos iconos: la llave inglesa es el helpdesk del cliente hacia SUS
            clientes (módulo `support`); el interrogante es su línea con
            NOSOTROS. Va delante porque la ve todo el mundo —no depende de ningún
            módulo— y porque hasta hoy los clientes que sí tenían Soporte no
            tenían ninguna forma de escribirnos. */}
        <div className="px-4 py-3 border-t border-white/[0.08]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-white/[0.08] border border-white/15 flex items-center justify-center font-display text-[13px] text-white/70 shrink-0">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-white/65 text-[11px] font-mono truncate">{user?.email ?? "Usuario"}</div>
              <div className="text-white/30 text-[10px] uppercase tracking-wider mt-0.5">{user?.role ?? "—"}</div>
            </div>
          </div>
          <div className="flex items-center justify-end gap-1 mt-1.5">
            <Link
              href="/ayuda"
              className={`relative p-1 rounded transition-colors hover:bg-white/[0.06] ${
                pathname?.startsWith("/ayuda") ? "text-white" : "text-white/30 hover:text-white/70"
              }`}
              title="Ayuda de Salamandra"
              aria-label="Ayuda de Salamandra"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
              </svg>
              {/* Le hemos contestado y todavía no lo ha abierto. */}
              {ayudaSinVer > 0 && (
                <span
                  className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-400"
                  aria-label={`${ayudaSinVer} respuesta(s) sin leer`}
                />
              )}
            </Link>
            <Link
              href="/soporte"
              className={`p-1 rounded transition-colors hover:bg-white/[0.06] ${
                pathname?.startsWith("/soporte") ? "text-white" : "text-white/30 hover:text-white/70"
              }`}
              title="Soporte"
              aria-label="Soporte"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75a4.5 4.5 0 01-4.884 4.484c-1.076-.091-2.264.071-2.95.904l-7.152 8.684a2.548 2.548 0 11-3.586-3.586l8.684-7.152c.833-.686.995-1.874.904-2.95a4.5 4.5 0 016.336-4.486l-3.276 3.275a3.004 3.004 0 002.25 2.25l3.276-3.276c.256.565.398 1.192.398 1.853z" />
              </svg>
            </Link>
            {/*
              CONFIGURACIÓN LA VE TODO EL MUNDO DESDE EL 24/08/2026, y no porque
              se haya abierto nada: `GET /api/tenant/settings` sigue siendo solo
              de admin —devuelve pistas enmascaradas de las claves de IA— y a
              quien no lo sea le sigue diciendo que no.

              Lo que cambió es que ahí dentro vive ahora «Tu cuenta», con su
              contraseña, y eso SÍ es de cada uno. Con este `if` puesto, la
              función que se hizo para las 15 personas de Aumenta que no son
              admin era inalcanzable justo para ellas: ni entraba en su menú.
              Quien no sea admin abre la pantalla y ve una sola pestaña, la suya.
            */}
            {(
              <Link
                href="/configuracion"
                className={`p-1 rounded transition-colors hover:bg-white/[0.06] ${
                  pathname?.startsWith("/configuracion") ? "text-white" : "text-white/30 hover:text-white/70"
                }`}
                title={isAdminRole ? "Configuración" : "Tu cuenta"}
                aria-label={isAdminRole ? "Configuración" : "Tu cuenta"}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a6.932 6.932 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.431l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.542-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.759 6.759 0 010-.255c.007-.378-.138-.75-.43-.991l-1.004-.827a1.125 1.125 0 01-.26-1.431l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.147-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </Link>
            )}
            <button
              onClick={handleLogout}
              className="text-white/30 hover:text-white/70 transition-colors cursor-pointer p-1 rounded hover:bg-white/[0.06]"
              title="Cerrar sesión"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
              </svg>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
