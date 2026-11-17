\set ON_ERROR_STOP on
\set ECHO none
\set ECHO_HIDDEN off
\set VERBOSITY terse
\set SHOW_CONTEXT never
-- Caller uses psql -X, passes PI5_REPLICATION_PASSWORD via the environment
-- (from a protected file), or supplies replication_password as a psql variable.
-- Disable statement/error logging before interpolating the secret.
SET log_statement = 'none';
SET log_min_duration_statement = -1;
SET log_min_duration_sample = -1;
SET log_transaction_sample_rate = 0;
SET log_duration = off;
SET log_min_error_statement = 'panic';
SET password_encryption = 'scram-sha-256';
\if :{?replication_password}
\else
  \getenv replication_password PI5_REPLICATION_PASSWORD
\endif

-- Existing roles are never silently repurposed, re-granted or re-passworded.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_authid r WHERE r.rolname = 'raspi_replicator'
      AND (NOT r.rolcanlogin OR NOT r.rolreplication OR r.rolsuper OR
           r.rolcreatedb OR r.rolcreaterole OR r.rolinherit OR r.rolbypassrls OR
           r.rolpassword IS NULL OR r.rolpassword NOT LIKE 'SCRAM-SHA-256$%' OR
           EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = r.oid))
  ) THEN
    RAISE EXCEPTION 'Existing replication role has incompatible privileges; refusing to change it';
  END IF;
END
$$;
SELECT format(
  'CREATE ROLE raspi_replicator LOGIN REPLICATION NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD %L',
  :'replication_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'raspi_replicator')
\gexec
\unset replication_password
