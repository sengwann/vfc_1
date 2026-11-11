-- Post-migration, read-only deployment gate. Supply the REAL runtime login:
-- PGOPTIONS="-c vfc.runtime_role=<approved-role>" psql -X -v ON_ERROR_STOP=1 -f this-file
-- No roles, grants, credentials or persistent functions are created here.
BEGIN READ ONLY;
SET LOCAL search_path = pg_catalog, public, pg_temp;
DO $$
DECLARE runtime_name text := current_setting('vfc.runtime_role',true);
  runtime_oid oid; candidate record; object_row record; signature text; function_oid oid;
BEGIN
  SELECT oid INTO runtime_oid FROM pg_roles WHERE rolname=runtime_name;
  IF runtime_oid IS NULL THEN RAISE EXCEPTION 'VFC_PRIV_RUNTIME_ROLE_REQUIRED'; END IF;
  -- MEMBER is deliberately conservative: include roles reachable by SET ROLE,
  -- even if their privileges are not inherited by the login automatically.
  FOR candidate IN SELECT * FROM pg_roles WHERE oid=runtime_oid OR pg_has_role(runtime_oid,oid,'MEMBER') LOOP
    IF candidate.rolsuper OR candidate.rolcreaterole OR candidate.rolcreatedb
      OR candidate.rolreplication OR candidate.rolbypassrls THEN
      RAISE EXCEPTION 'VFC_PRIV_ELEVATED_ROLE: %',candidate.rolname;
    END IF;
    IF has_database_privilege(candidate.oid,current_database(),'CREATE') OR EXISTS (
      SELECT 1 FROM pg_namespace n WHERE left(n.nspname,3)<>'pg_' AND n.nspname<>'information_schema'
        AND (n.nspowner=candidate.oid OR has_schema_privilege(candidate.oid,n.oid,'CREATE')))
    THEN RAISE EXCEPTION 'VFC_PRIV_SCHEMA_CREATE: %',candidate.rolname; END IF;
    FOR object_row IN SELECT c.oid,c.relowner,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname IN ('Village','User','House','Fund','Payment','Receipt','AuditLog',
        'FundHouseAssessment','FundEndDateExtension','CollectorAssignment','VillageDeactivationRequest',
        'VillageFinancialWriteLock','FundFinancialValidationWork') LOOP
      IF object_row.relowner=candidate.oid OR has_table_privilege(candidate.oid,object_row.oid,'TRIGGER')
        OR has_table_privilege(candidate.oid,object_row.oid,'TRUNCATE')
      THEN RAISE EXCEPTION 'VFC_PRIV_TRIGGER_BYPASS: %.%',candidate.rolname,object_row.relname; END IF;
    END LOOP;
    FOREACH signature IN ARRAY ARRAY['public."VillageFinancialWriteLock"','public."FundFinancialValidationWork"'] LOOP
      IF to_regclass(signature) IS NULL THEN RAISE EXCEPTION 'VFC_PRIV_INTERNAL_TABLE_MISSING: %',signature; END IF;
      IF has_table_privilege(candidate.oid,to_regclass(signature),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR has_any_column_privilege(candidate.oid,to_regclass(signature),'SELECT,INSERT,UPDATE,REFERENCES')
      THEN RAISE EXCEPTION 'VFC_PRIV_INTERNAL_TABLE_ACCESS: %.%',candidate.rolname,signature; END IF;
    END LOOP;
    FOREACH signature IN ARRAY ARRAY['public.vfc_acquire_villages(text[])','public.vfc_bootstrap_village_scope()',
      'public.vfc_scope_change()','public.vfc_validate_work()'] LOOP
      function_oid:=to_regprocedure(signature);
      IF function_oid IS NULL THEN RAISE EXCEPTION 'VFC_PRIV_HELPER_MISSING: %',signature; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=function_oid AND p.prosecdef
        AND p.proowner<>candidate.oid AND EXISTS (SELECT 1 FROM unnest(p.proconfig) setting
          WHERE replace(setting,' ','')='search_path=pg_catalog,public,pg_temp'))
      THEN RAISE EXCEPTION 'VFC_PRIV_HELPER_CONFIGURATION: %',signature; END IF;
      IF signature<>'public.vfc_acquire_villages(text[])' AND has_function_privilege(candidate.oid,function_oid,'EXECUTE')
      THEN RAISE EXCEPTION 'VFC_PRIV_HELPER_EXECUTE: %.%',candidate.rolname,signature; END IF;
    END LOOP;
  END LOOP;
  IF NOT has_function_privilege(runtime_oid,'public.vfc_acquire_villages(text[])','EXECUTE')
  THEN RAISE EXCEPTION 'VFC_PRIV_ACQUIRE_EXECUTE_REQUIRED'; END IF;
  -- PostgreSQL 15+ can grant this parameter independently of superuser status.
  IF current_setting('server_version_num')::int>=150000 THEN
    FOR candidate IN SELECT oid,rolname FROM pg_roles WHERE oid=runtime_oid OR pg_has_role(runtime_oid,oid,'MEMBER') LOOP
      IF has_parameter_privilege(candidate.oid,'session_replication_role','SET')
      THEN RAISE EXCEPTION 'VFC_PRIV_REPLICATION_BYPASS: %',candidate.rolname; END IF;
    END LOOP;
  END IF;
END $$;
ROLLBACK;
