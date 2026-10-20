BEGIN;

DO $$ BEGIN
  IF (SELECT version_num FROM eduskills.alembic_version) IS DISTINCT FROM 'eduskills_0005' THEN
    RAISE EXCEPTION 'Expected eduskills_0005 before readable team codes migration';
  END IF;
END $$;

-- Running upgrade eduskills_0005 -> eduskills_0006

ALTER TABLE eduskills.teams ALTER COLUMN invite_code TYPE VARCHAR(60);

UPDATE eduskills.alembic_version SET version_num='eduskills_0006' WHERE eduskills.alembic_version.version_num = 'eduskills_0005';

COMMIT;

