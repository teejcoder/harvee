-- 002_clients_projects_tasks.sql — client/project/task hierarchy
-- per .memory/domain-model.md §10 and .memory/conventions.md §1 (ULIDs).

CREATE TABLE clients (
  id           TEXT    PRIMARY KEY,
  name         TEXT    NOT NULL,
  archived_at  TEXT,
  created_at   TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL
);

CREATE TABLE projects (
  id           TEXT    PRIMARY KEY,
  client_id    TEXT    NOT NULL REFERENCES clients(id),
  name         TEXT    NOT NULL,
  hourly_rate  INTEGER NOT NULL,  -- integer minor units per domain-model.md §2
  archived_at  TEXT,
  created_at   TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL
);

CREATE INDEX idx_projects_client_id ON projects(client_id);

CREATE TABLE tasks (
  id           TEXT    PRIMARY KEY,
  project_id   TEXT    NOT NULL REFERENCES projects(id),
  name         TEXT    NOT NULL,
  archived_at  TEXT,
  created_at   TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL
);

CREATE INDEX idx_tasks_project_id ON tasks(project_id);
