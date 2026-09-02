# Una semana aquí, dos fuera

**03/09/2026** · Toca a: `scripts/backup-db.sh`, `scripts/deploy/crm-backup.service` ·
Supera la caducidad por edad de [El borrado no viaja](2026-08-21-el-borrado-no-viaja.md)
(lo demás de aquella decisión —la copia externa SUMA, `rclone copy` y nunca
`sync`— sigue en pie).

## Qué pasaba

Desde el 26/08/2026 los ficheros subidos del CRM pesan 6,3 GB (la migración del
OneDrive de Aumenta). Ese archivo cuenta tres veces en el disco del VPS: en
`uploads/`, en su espejo dentro de `backups/` y en el paquete `.tar.gz` de cada
domingo (5,4 GB). Con 14 días de retención local había hasta tres paquetes a la
vez, y el 01 y el 02/09 llegaron dos correos de «al disco le quedan 14 GB» (de
99, cuando lo normal eran 85 libres). El grueso lo puso la caché de compilación
de Docker, que ya se poda en cada deploy, pero las copias antiguas eran los
otros 12 GB.

Rodrigo, al ver que los 85 GB de siempre no volvían, preguntó por qué, y al
saber que el paquete semanal es redundante con el espejo decidió cuánto
historial quiere pagar en disco.

## Qué se decidió (Rodrigo)

> «Baja la retención a una semana. […] Yo quiero en el servidor la copia de
> seguridad de la última semana y en Drive las dos últimas semanas.»

(Primero dijo «solo la última», entendiendo que la copia era la semanal del
correo del lunes; ese correo es un parte, la copia se hace cada noche, y lo
aclaró en cuanto se le dijo.)

En números, y por defecto en el script:

| Dónde | Qué se guarda | Ajuste |
| --- | --- | --- |
| Servidor (`backups/`) | **La última semana**: los 7 volcados nocturnos más nuevos y el último paquete de ficheros | `DIAS_EN_SERVIDOR=7` |
| Fuera (`gdrive:`) | **Las dos últimas semanas**: 14 volcados y 2 paquetes | `DIAS_FUERA=14` |
| Noches de cambios (`uploads-cambios/`) | Lo mismo que el servidor, nunca menos de 3 noches | `RETENCION_DIAS` (= `DIAS_EN_SERVIDOR`) |
| Espejo (`uploads-espejo/`) | No es una copia vieja, es el estado de hoy: no se toca | — |
| Copias manuales (`pre-deploy-*`) | No las toca el script | — |

**Se cuenta por número de copias, no por edad.** Los días se traducen a copias
(`copias_en_dias`: un volcado por noche, un paquete por semana) y «las N
últimas» se deciden por nombre (`auto-AAAAMMDD-HHMM.sql.gz` ordena solo) sobre
lo que hay. Así un reloj loco o un servidor parado un mes no pueden dejar el
destino vacío, y ya no hace falta el freno por proporción de agosto (existía
para cazar un `RETENCION_REMOTA_DIAS` mal puesto; con un recuento no hay
ventana que equivocar). Los frenos que quedan, todos «en la duda no borra»:

1. si `DIAS_*` no es un entero mayor que cero → no se borra nada y se avisa;
2. fuera solo se poda si la subida de esa noche salió bien **y** el volcado de
   esa noche aparece en la lista del destino;
3. si el destino no se deja listar, o contesta vacío → no se toca;
4. solo se miran `auto-*.sql.gz` y `uploads-*.tar.gz` de la raíz, y lo que se
   borra sale por nombre de la misma lista que se acaba de leer;
5. en el servidor se rota después del volcado de la noche: si `pg_dump` falla,
   el script termina antes y nada se toca.

## Lo que se pierde, dicho claro

Fuera hay dos semanas de historial, no noventa días. Una corrupción que se
descubra al mes ya no tiene copia sana a la que volver. Es una decisión de
negocio tomada sabiendo eso, y se cambia con dos números en `crm-backup.service`.

## Cómo se dejó el servidor ese día

A mano, antes del cambio del script: caché de Docker, de npm y de apt (8 GB) y
las copias locales y del Drive que sobraban. Hubo que borrar en los **dos**
sitios: como la subida es `rclone copy`, lo borrado solo en el Drive volvía a
subir la noche siguiente. Al aclararse la regla, el historial se recuperó de la
papelera del Drive (`rclone backend untrash`, que solo toca la carpeta del
remoto) y los volcados de la última semana se bajaron otra vez al servidor;
la primera ejecución del script nuevo dejó cada sitio con lo suyo.
El disco quedó en 28 GB usados (67 libres), que es el máximo alcanzable con
el archivo de Aumenta dentro; los 85 de antes eran de cuando `uploads/` pesaba
127 MB.
