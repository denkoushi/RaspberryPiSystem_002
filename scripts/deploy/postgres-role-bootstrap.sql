\set ON_ERROR_STOP on

SELECT format(
  'CREATE ROLE raspi_migrator LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION',
  :'migration_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'raspi_migrator')
\gexec

SELECT format(
  'ALTER ROLE raspi_migrator LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION',
  :'migration_password'
)
\gexec

SELECT format(
  'CREATE ROLE raspi_app LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION',
  :'app_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'raspi_app')
\gexec

SELECT format(
  'ALTER ROLE raspi_app LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION',
  :'app_password'
)
\gexec

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER DATABASE :"database_name" OWNER TO raspi_migrator;
ALTER SCHEMA public OWNER TO raspi_migrator;

DO $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT c.oid::regclass AS identity, c.relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
  LOOP
    IF item.relkind = 'S' THEN
      EXECUTE format('ALTER SEQUENCE %s OWNER TO raspi_migrator', item.identity);
    ELSIF item.relkind = 'v' THEN
      EXECUTE format('ALTER VIEW %s OWNER TO raspi_migrator', item.identity);
    ELSIF item.relkind = 'm' THEN
      EXECUTE format('ALTER MATERIALIZED VIEW %s OWNER TO raspi_migrator', item.identity);
    ELSIF item.relkind = 'f' THEN
      EXECUTE format('ALTER FOREIGN TABLE %s OWNER TO raspi_migrator', item.identity);
    ELSE
      EXECUTE format('ALTER TABLE %s OWNER TO raspi_migrator', item.identity);
    END IF;
  END LOOP;
END
$$;

DO $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT format('%I.%I', n.nspname, t.typname) AS identity
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typtype = 'e'
  LOOP
    EXECUTE format('ALTER TYPE %s OWNER TO raspi_migrator', item.identity);
  END LOOP;
END
$$;

DO $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT p.oid::regprocedure AS identity
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_depend d
        WHERE d.classid = 'pg_proc'::regclass
          AND d.objid = p.oid
          AND d.deptype = 'e'
      )
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO raspi_migrator', item.identity);
  END LOOP;
END
$$;

GRANT CONNECT ON DATABASE :"database_name" TO raspi_app;
GRANT USAGE ON SCHEMA public TO raspi_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO raspi_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO raspi_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO raspi_app;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public."_prisma_migrations" FROM raspi_app;

ALTER DEFAULT PRIVILEGES FOR ROLE raspi_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO raspi_app;
ALTER DEFAULT PRIVILEGES FOR ROLE raspi_migrator IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO raspi_app;
ALTER DEFAULT PRIVILEGES FOR ROLE raspi_migrator IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO raspi_app;
