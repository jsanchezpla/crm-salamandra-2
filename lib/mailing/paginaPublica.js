import { escaparTodo } from "./bloques.js";

/**
 * lib/mailing/paginaPublica.js — la página mínima que ve quien pincha «darme
 * de baja» o «confirmar» desde su buzón. Sin sesión, sin React, sin nada que
 * cargar: HTML con la marca del centro y una frase.
 */
const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;

export function paginaPublica({ centro, titulo, cuerpo, boton = null }) {
  const color = HEX_RE.test(String(centro?.brand?.primaryColor ?? "")) ? centro.brand.primaryColor : "#1B3A2D";
  const nombre = escaparTodo(centro?.nombre || "");
  const form = boton
    ? `<form method="post" action="${escaparTodo(boton.action)}" style="margin-top:20px;">
         <button type="submit" style="background:${color};color:#fff;border:0;border-radius:8px;padding:12px 22px;font-size:16px;font-weight:600;cursor:pointer;">${escaparTodo(boton.texto)}</button>
       </form>`
    : "";
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${escaparTodo(titulo)}</title></head>
<body style="margin:0;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1F2937;">
<div style="max-width:520px;margin:48px auto;padding:0 16px;">
  <div style="background:#fff;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.06);border-top:5px solid ${color};">
    ${nombre ? `<div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#6B7280;margin-bottom:12px;">${nombre}</div>` : ""}
    <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;">${escaparTodo(titulo)}</h1>
    <p style="margin:0;font-size:16px;line-height:1.55;">${escaparTodo(cuerpo)}</p>
    ${form}
  </div>
</div>
</body></html>`;
}
