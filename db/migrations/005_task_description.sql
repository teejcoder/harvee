-- 005_task_description.sql — add an editable free-text description to tasks.
-- Tasks previously carried only a name (002_clients_projects_tasks.sql); this
-- adds a description per .memory/domain-model.md §10. NOT NULL DEFAULT ''
-- matches the time_entries.notes convention, so existing rows backfill to ''.

ALTER TABLE tasks ADD COLUMN description TEXT NOT NULL DEFAULT '';
