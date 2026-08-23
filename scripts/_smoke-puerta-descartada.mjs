// @prueba ligera — se fabrica un sequelize de mentira; no abre ninguna conexión.
/**
 * _smoke-puerta-descartada.mjs — descartar SÍ cuenta, y se puede reintentar
 * tres veces (12/08/2026, Rodrigo).
 *
 * Lógica pura, sin base de datos ni servidor:
 *   node scripts/_smoke-puerta-descartada.mjs
 *
 * DOS REGLAS, y las dos salieron de una solicitud real de nutri_laura.
 *
 * 1. MANDA LA DECISIÓN MÁS RECIENTE. «Una aceptada manda sobre el resto» estaba
 *    tomado al pie de la letra, así que descartar a alguien no surtía efecto si
 *    en su día se le había admitido: la fila descartada se quedaba debajo de una
 *    aceptada más vieja. Una solicitud admitida el 03/08 y descartada el 05/08
 *    seguía leyéndose «aceptada». Allí no se notó porque además le faltaba la
 *    ficha, pero CON ficha habría podido reservar después de que la descartaran.
 *
 * 2. TRES REENVÍOS Y SE LE DICE. Descartar no es una puerta cerrada —el primer
 *    formulario puede estar mal rellenado, y las circunstancias cambian— pero a
 *    la cuarta, devolverle el mismo enlace es mandarle a una noria. A partir de
 *    ahí se le dice que no y se le da un correo al que escribir.
 *
 * Y lo que NO puede pasar por el camino: que a un anónimo se le confirme que un
 * correo concreto ha sido descartado. Eso convertiría el endpoint en un buscador
 * de pacientes de la consulta.
 */

import {
  estadoDeAdmision,
  mensajeDePuerta,
  emailDeContacto,
  urlDeLaWeb,
  RECHAZOS_ANTES_DE_CERRAR,
} from "../lib/citas/puertaFormulario.js";

let fallos = 0;
function check(etiqueta, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  process.stdout.write(`${ok ? "✓" : "✗"} ${etiqueta}\n`);
  if (!ok) process.stdout.write(`    esperado ${JSON.stringify(esperado)}, salió ${JSON.stringify(real)}\n`);
}

const FICHA = { id: "cli-1", name: "Paciente" };

function modelos({ solicitudes = [], ficha = null, fichas = {} }) {
  return {
    FormSubmission: { findAll: async () => solicitudes },
    Client: {
      findOne: async () => ficha,
      findByPk: async (id) => fichas[id] ?? null,
      sequelize: { literal: (s) => s, escape: (s) => `'${s}'` },
    },
  };
}
const estado = (opts) => estadoDeAdmision(modelos(opts), "paciente@ejemplo.com");

const admitida = (fecha, clientId = null) => ({ status: "accepted", clientId, acceptedAt: fecha, rejectedAt: null });
const descartada = (fecha) => ({ status: "rejected", clientId: null, acceptedAt: null, rejectedAt: fecha });
const enCola = () => ({ status: "pending", clientId: null, acceptedAt: null, rejectedAt: null });

process.stdout.write("\n▶ Manda la decisión más reciente\n");
check(
  "descartada DESPUÉS de admitir → descartada, aunque tenga ficha",
  await estado({ solicitudes: [admitida("2026-08-03"), descartada("2026-08-05")], ficha: FICHA }),
  "descartada"
);
check(
  "readmitida después del descarte → aceptada",
  await estado({ solicitudes: [descartada("2026-08-03"), admitida("2026-08-05")], ficha: FICHA }),
  "aceptada"
);
check(
  "el caso real de nutri_laura (descartada y además sin ficha) → descartada",
  await estado({ solicitudes: [admitida("2026-08-03", "cli-borrada"), descartada("2026-08-05")], ficha: null, fichas: {} }),
  "descartada"
);
check(
  "sin fechas que comparar, sigue mandando la aceptada (no se echa a nadie a ciegas)",
  await estado({
    solicitudes: [{ status: "accepted", clientId: null, acceptedAt: null, rejectedAt: null }, descartada(null)],
    ficha: FICHA,
  }),
  "aceptada"
);
check(
  "una descartada VIEJA no tumba una admisión posterior",
  await estado({ solicitudes: [descartada("2026-07-01"), admitida("2026-08-05")], ficha: FICHA }),
  "aceptada"
);

process.stdout.write("\n▶ El reenvío que se le permite a quien fue descartado\n");
check("un descarte → descartada (puede volver a mandarlo)", await estado({ solicitudes: [descartada("2026-08-01")] }), "descartada");
check("dos descartes → sigue pudiendo", await estado({ solicitudes: [descartada("2026-08-01"), descartada("2026-08-02")] }), "descartada");
check(
  `${RECHAZOS_ANTES_DE_CERRAR} descartes → se cierra`,
  await estado({ solicitudes: [descartada("2026-08-01"), descartada("2026-08-02"), descartada("2026-08-03")] }),
  "descartada_final"
);
check(
  "y con una solicitud nueva esperando manda esa, aunque haya agotado los tres",
  await estado({
    solicitudes: [descartada("2026-08-01"), descartada("2026-08-02"), descartada("2026-08-03"), enCola()],
    ficha: null,
  }),
  "pendiente"
);
check(
  "descartada tras admitirla cuenta para el tope junto a las demás",
  await estado({
    solicitudes: [admitida("2026-07-01"), descartada("2026-08-01"), descartada("2026-08-02"), descartada("2026-08-03")],
    ficha: FICHA,
  }),
  "descartada_final"
);

process.stdout.write("\n▶ Lo que ve en pantalla\n");
{
  const suyo = mensajeDePuerta("descartada_final", {
    identificado: true,
    nombre: "tunutrilaura",
    emailContacto: "info@tunutrilaura.com",
  });
  check("se le dice que no", suyo.codigo, "ADMISION_CERRADA");
  check("con el título que pidió Rodrigo", suyo.titulo, "Has alcanzado el número máximo de formularios");
  check("y el texto", suyo.texto, "Contacta por correo a info@tunutrilaura.com para más información.");
  check("ya NO se le ofrece el formulario", suyo.mostrarEnlace, false);
  check("pero sí una salida a la web", suyo.mostrarVolver, true);

  const sinCorreo = mensajeDePuerta("descartada_final", { identificado: true });
  check("sin correo del cliente, no se inventa una dirección", /@/.test(sinCorreo.texto), false);
  check("pero se le sigue mandando a escribir", sinCorreo.texto.includes("Contacta por correo"), true);

  const anonimo = mensajeDePuerta("descartada_final", { identificado: false, emailContacto: "info@tunutrilaura.com" });
  check("a un ANÓNIMO no se le confirma el descarte", anonimo.codigo, "ADMISION_REQUERIDA");
  check("ni se le filtra el correo de contacto", anonimo.texto.includes("info@"), false);
  check("y no se le pinta el botón de volver", !anonimo.mostrarVolver, true);

  const aunPuede = mensajeDePuerta("descartada", { identificado: true, emailContacto: "hola@tunutrilaura.com" });
  check("por debajo del tope se le sigue ofreciendo el formulario", aunPuede.mostrarEnlace, true);
  check("con el mensaje de siempre", aunPuede.codigo, "ADMISION_REQUERIDA");
}

process.stdout.write("\n▶ De dónde sale el correo de contacto\n");
check(
  "el replyTo del cliente manda",
  emailDeContacto({ settings: { integrations: { resendReplyTo: " hola@cliente.com ", resendFromEmail: "no-reply@cliente.com" } } }),
  "hola@cliente.com"
);
check(
  "y si no lo hay, el remitente",
  emailDeContacto({ settings: { integrations: { resendFromEmail: "no-reply@cliente.com" } } }),
  "no-reply@cliente.com"
);
check("sin nada del cliente, null (NUNCA nuestra dirección)", emailDeContacto({ settings: {} }), null);
check("y sin tenant tampoco revienta", emailDeContacto(null), null);

process.stdout.write("\n▶ Y a dónde vuelve\n");
check(
  "la web sale del ORIGEN de lo que ya hay configurado",
  urlDeLaWeb({ settings: { citas: { portalUrl: "https://tunutrilaura.com/mi-perfil/" } } }),
  "https://tunutrilaura.com"
);
check(
  "si falta el portal, tira de la agenda",
  urlDeLaWeb({ settings: { citas: { reservaUrl: "https://tunutrilaura.com/citas/" } } }),
  "https://tunutrilaura.com"
);
check(
  "una dirección torcida no rompe: se prueba la siguiente",
  urlDeLaWeb({ settings: { citas: { portalUrl: "no-es-una-url", reservaUrl: "https://tunutrilaura.com/citas/" } } }),
  "https://tunutrilaura.com"
);
check("sin ninguna configurada, null", urlDeLaWeb({ settings: {} }), null);

process.stdout.write(
  fallos === 0 ? "\n✓ Todo correcto\n\n" : `\n✗ ${fallos} comprobacion(es) fallidas\n\n`
);
process.exit(fallos === 0 ? 0 : 1);
