"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { repartirSoltados, avisoDeRechazo } from "@/lib/utils/ficherosSoltados.js";

/**
 * useZonaSoltar — convierte cualquier trozo de pantalla en sitio donde soltar
 * ficheros, sin envolverlo en un div de más.
 *
 * Devuelve `{ arrastrando, props }`: los `props` se esparcen sobre el elemento
 * que ya existe y `arrastrando` sirve para pintarlo resaltado mientras el
 * fichero está encima.
 *
 * ── POR QUÉ UN GANCHO Y NO OTRO COMPONENTE (28/08/2026) ────────────────────
 * El CRM ya sabía soltar ficheros en tres sitios —Documentos, adjuntos de una
 * ficha y el importador de Leads de Laura—, pero cada uno con su propia copia
 * de los cuatro manejadores, y ninguno filtraba por tipo. Las zonas que faltan
 * (el audio de una sesión, sus adjuntos de preparación, los documentos de un
 * paciente) no son cajas vacías que se puedan sustituir por un recuadro: son
 * tarjetas con su contenido. Un gancho se les pega encima sin tocar su
 * maquetación; un componente obligaría a rehacerlas.
 *
 * Qué se acepta lo decide `lib/utils/ficherosSoltados.js`, que tiene prueba.
 */
export default function useZonaSoltar({
  accept = "",
  varios = false,
  apagada = false,
  queSeEspera = "este tipo de archivo",
  pegar = false,
  onFicheros,
  onAviso,
}) {
  const [arrastrando, setArrastrando] = useState(false);
  // dragenter/dragleave saltan también al pasar por CADA hijo. Sin contar la
  // profundidad, el resaltado parpadea al mover el ratón por dentro de la zona.
  const profundidad = useRef(0);

  const recibir = useCallback(
    (lista) => {
      const { aceptados, rechazados } = repartirSoltados(lista, accept);
      // Los ficheros ANTES que el aviso, y no al revés: quien recibe los
      // ficheros suele limpiar el error de la pantalla, y si el aviso fuera
      // primero se lo llevaría por delante. Soltar tres cosas de las que solo
      // valen dos tiene que quedarse con las dos Y decir lo de la tercera.
      if (aceptados.length > 0) onFicheros?.(varios ? aceptados : [aceptados[0]]);
      const aviso = avisoDeRechazo(rechazados, queSeEspera);
      if (aviso) onAviso?.(aviso);
    },
    [accept, varios, queSeEspera, onFicheros, onAviso]
  );

  /*
   * Pegar (Ctrl+V). Solo actúa si en el portapapeles hay FICHEROS: si lo que se
   * pega es texto no se toca nada, para no robarle el pegado a los campos de
   * texto de la misma pantalla, que es donde se escribe el informe.
   */
  useEffect(() => {
    if (!pegar || apagada) return undefined;
    const alPegar = (e) => {
      const ficheros = e.clipboardData?.files;
      if (!ficheros || ficheros.length === 0) return;
      e.preventDefault();
      recibir(ficheros);
    };
    window.addEventListener("paste", alPegar);
    return () => window.removeEventListener("paste", alPegar);
  }, [pegar, apagada, recibir]);

  const props = apagada
    ? {}
    : {
        onDragEnter: (e) => {
          e.preventDefault();
          profundidad.current += 1;
          setArrastrando(true);
        },
        onDragOver: (e) => {
          // Sin este preventDefault el navegador NO deja soltar: es el que
          // convierte al elemento en destino válido.
          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
        },
        onDragLeave: (e) => {
          e.preventDefault();
          profundidad.current -= 1;
          if (profundidad.current <= 0) {
            profundidad.current = 0;
            setArrastrando(false);
          }
        },
        onDrop: (e) => {
          e.preventDefault();
          // Que no lo recoja además el guardia de la ventana.
          e.stopPropagation();
          profundidad.current = 0;
          setArrastrando(false);
          recibir(e.dataTransfer?.files);
        },
      };

  return { arrastrando, props };
}

/**
 * Guardia de la ventana: soltar un fichero FUERA de una zona no debe hacer que
 * el navegador se vaya a abrirlo.
 *
 * Es lo que pasa por defecto, y en una pantalla con un formulario a medias —el
 * registro de una sesión, sin guardar— significa perder lo escrito por fallar
 * la puntería al soltar. Se llama una vez por pantalla que tenga zonas.
 */
export function useEvitarSoltarFuera() {
  useEffect(() => {
    const parar = (e) => e.preventDefault();
    window.addEventListener("dragover", parar);
    window.addEventListener("drop", parar);
    return () => {
      window.removeEventListener("dragover", parar);
      window.removeEventListener("drop", parar);
    };
  }, []);
}
