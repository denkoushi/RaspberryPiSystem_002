-- Explicit site scope (docs/plans/explicit-site-scope-execplan.md, Milestone 3b).
-- The Mac-only web site pickers used to hard-code 第2工場, トークプラザ and 第1工場.
-- They now read the Site table, so register the two planned sites to keep the
-- same choices. No device is assigned to them.
INSERT INTO "Site" ("key", "displayName", "sortOrder", "updatedAt")
VALUES
  ('トークプラザ', 'トークプラザ', 1, CURRENT_TIMESTAMP),
  ('第1工場', '第1工場', 2, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
