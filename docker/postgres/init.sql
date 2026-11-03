-- Runs once as superuser when the Postgres container is first created.
-- The application role is deliberately NOT a superuser and has no BYPASSRLS,
-- so Row Level Security applies to it (see docs/adr/0002-mandanten-isolation-rls.md).

CREATE ROLE nexus WITH LOGIN PASSWORD 'nexus' NOSUPERUSER NOBYPASSRLS NOCREATEROLE;

CREATE DATABASE nexus OWNER nexus;
CREATE DATABASE nexus_test OWNER nexus;

\connect nexus
CREATE EXTENSION IF NOT EXISTS vector;

\connect nexus_test
CREATE EXTENSION IF NOT EXISTS vector;
