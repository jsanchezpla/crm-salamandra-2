-- Corrección de datos [SOLO AUMENTA] — sprint 2026-07-29, punto 11.
--
-- La terapeuta figura como «Silvia Pérez Fernández» y su apellido real es
-- HERNÁNDEZ. Es corrección de DATOS en producción, no de código: el seed
-- (scripts/seed-aumenta-equipo-real.js) ya queda corregido para futuras
-- reejecuciones, pero el seed NO reescribe filas existentes.
--
-- OJO con el nombre: es «Silvia», sin tilde. En una versión previa de este
-- sprint se escribió «Sílvia», que habría cambiado un error por otro.
--
-- No toca el login (`silvia_aumenta` en master.users) porque el username no
-- lleva apellido: la terapeuta sigue entrando igual.
--
-- LO EJECUTA JORGE en producción:
--   docker exec -i crm-salamandra-db-1 psql -U crm_user -d salamandra \
--     < scripts/sql/2026-07-29-aumenta-silvia-apellido.sql

BEGIN;

-- Comprobación previa: debe devolver exactamente 1 fila.
SELECT id, display_name
  FROM crm_aumenta.team_members
 WHERE display_name = 'Silvia Pérez Fernández';

UPDATE crm_aumenta.team_members
   SET display_name = 'Silvia Pérez Hernández',
       updated_at   = now()
 WHERE display_name = 'Silvia Pérez Fernández';

-- Verificación: debe devolver la fila ya con Hernández.
SELECT id, display_name
  FROM crm_aumenta.team_members
 WHERE display_name = 'Silvia Pérez Hernández';

COMMIT;
