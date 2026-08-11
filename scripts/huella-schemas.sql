-- Huella de TODOS los schemas: estructura (tablas, columnas, tipos, nullabilidad,
-- defaults) y contenido (filas por tabla). Solo lectura.
--
-- Una línea por schema: nombre | nº tablas | nº columnas | filas totales | md5 de
-- la estructura completa. Si el alta de un cliente nuevo toca a alguien, cambia
-- su md5 o su recuento de filas.
WITH cols AS (
  SELECT c.table_schema AS esquema,
         c.table_name || '.' || c.column_name || ':' || c.data_type ||
         ':' || c.is_nullable || ':' || COALESCE(c.column_default, '-') AS firma
    FROM information_schema.columns c
   WHERE c.table_schema LIKE 'crm\_%' OR c.table_schema = 'master'
),
estructura AS (
  SELECT esquema,
         count(*) AS n_columnas,
         md5(string_agg(firma, '|' ORDER BY firma)) AS md5_estructura
    FROM cols GROUP BY esquema
),
tablas AS (
  SELECT t.table_schema AS esquema,
         t.table_name,
         (xpath(
            '/row/c/text()',
            query_to_xml(format('SELECT count(*) AS c FROM %I.%I', t.table_schema, t.table_name),
                         false, true, '')
          ))[1]::text::bigint AS filas
    FROM information_schema.tables t
   WHERE (t.table_schema LIKE 'crm\_%' OR t.table_schema = 'master')
     AND t.table_type = 'BASE TABLE'
),
conteo AS (
  SELECT esquema, count(*) AS n_tablas, COALESCE(sum(filas), 0) AS filas_totales,
         md5(string_agg(table_name || '=' || filas, '|' ORDER BY table_name)) AS md5_filas
    FROM tablas GROUP BY esquema
)
SELECT e.esquema,
       COALESCE(c.n_tablas, 0),
       e.n_columnas,
       COALESCE(c.filas_totales, 0),
       e.md5_estructura,
       COALESCE(c.md5_filas, '-')
  FROM estructura e LEFT JOIN conteo c USING (esquema)
 ORDER BY e.esquema;
