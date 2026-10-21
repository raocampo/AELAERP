-- El formulario permite 50 caracteres y varios números pueden superar los 20.
-- Solo ampliar: conservar instalaciones que ya usan un campo mayor o TEXT.
DO $$
DECLARE
  campo RECORD;
BEGIN
  FOR campo IN
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND data_type = 'character varying'
      AND character_maximum_length < 50
      AND ((table_name = 'facturas' AND column_name = 'telefonoComprador')
        OR (table_name IN ('clientes', 'directorio_global') AND column_name = 'telefono'))
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN %I TYPE VARCHAR(50)',
      current_schema(), campo.table_name, campo.column_name);
  END LOOP;
END $$;
