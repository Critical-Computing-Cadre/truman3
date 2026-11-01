# 4. Postgres with Drizzle

**Status:** Accepted

## Decision

Data lives in Postgres, accessed through Drizzle ORM. Migrations are plain SQL files in the repo.

## Why

Study data is relational: participants, conditions, worlds, and events all reference each other, and an event log benefits from constraints and transactions. Researchers can query the data directly with SQL. Drizzle's queries read like SQL, so what the code does stays visible.

## Alternatives

- **MongoDB:** what older Truman versions use. Its limits are a large part of why we're moving. There is no plan to migrate old study data.
- **Prisma:** popular, but it adds its own schema language and hides more of the SQL.
