<?php
/**
 * REFERENCIA (no se ejecuta en el CRM) — Shortcode de la TIENDA para WordPress.
 *
 * Registra [crm_tienda]: incrusta la tienda del CRM en la página donde se
 * ponga el shortcode. Eso es «conectarse a la tienda de una URL elegida»:
 * la URL la elige quien crea la página en WordPress; el CRM no necesita
 * saberla.
 *
 * Instalación (Code Snippets tipo PHP o mu-plugin):
 *   1. Pega este código SIN la línea `<?php` si tu gestor de snippets ya
 *      ejecuta en contexto PHP (Code Snippets, WPCode).
 *   2. Ajusta CRM_TIENDA_TENANT al slug del cliente.
 *   3. Crea una página (p. ej. /tienda/) y pon [crm_tienda] en ella.
 *
 * A diferencia del portal de citas, AQUÍ NO HAY SSO NI LOGIN: la tienda es
 * pública y enseña lo mismo a todo el mundo, así que tampoco hace falta
 * pelearse con la caché. El pago salta a Stripe con la ventana entera (el
 * propio widget hace `window.top.location`), porque Stripe Checkout no se
 * deja pintar dentro de un iframe.
 *
 * El CSP del CRM solo permite incrustar sus widgets desde los dominios dados
 * de alta en WIDGET_FRAME_ANCESTORS del `.env.production`. Si el iframe sale
 * en blanco, falta añadir ahí el dominio de esta web.
 */

if (!defined('ABSPATH')) { exit; }

if (!defined('CRM_TIENDA_BASE'))   { define('CRM_TIENDA_BASE', 'https://crm.salamandrasolutions.com'); }
if (!defined('CRM_TIENDA_TENANT')) { define('CRM_TIENDA_TENANT', 'laura_ubeda'); }

/**
 * La tienda ocupa la ventana menos la cabecera del theme y hace scroll POR
 * DENTRO, como una app: así el catálogo, la ficha y el carrito se mueven sin
 * que la página de WordPress pegue saltos de alto.
 *
 * `$atts['alto']` deja ajustar el descuento de la cabecera por página:
 * [crm_tienda alto="200"] si el theme tiene un header más gordo.
 */
function crm_tienda_shortcode($atts = []) {
    $atts    = shortcode_atts(['alto' => '150'], $atts, 'crm_tienda');
    $resta   = max(0, (int) $atts['alto']);
    $src     = CRM_TIENDA_BASE . '/widget/c/' . CRM_TIENDA_TENANT . '/tienda';

    static $css_puesto = false;
    $css = '';
    if (!$css_puesto) {
        $css_puesto = true;
        // El mismo truco que el portal de citas: no se ensancha el iframe,
        // se ensancha la caja del theme que lo encierra.
        $css = '<style>'
            . 'main :has(> .crm-tienda-wrap),'
            . 'main :has(> * > .crm-tienda-wrap){'
            . 'max-width:1100px !important;width:100% !important;'
            . 'padding-top:0 !important;margin-top:0 !important}'
            . '.crm-tienda-wrap{width:100%;max-width:1100px;margin:0 auto;box-sizing:border-box}'
            . '.crm-tienda-wrap iframe{width:100%;border:0;display:block;'
            . 'height:calc(100vh - ' . $resta . 'px);min-height:640px}'
            . '</style>';
    }

    return $css
        . '<div class="crm-tienda-wrap">'
        . '<iframe src="' . esc_url($src) . '" title="Tienda" loading="lazy" '
        . 'allow="payment"></iframe>'
        . '</div>';
}
add_shortcode('crm_tienda', 'crm_tienda_shortcode');
