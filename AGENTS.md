# Agent Instructions for VFC

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## 1. Project Overview

VFC is a village fund collection and management application.

Tech stack:
- Next.js 16 (App Router)
- React 19
- TypeScript 5
- PostgreSQL
- Prisma 7
- Tailwind CSS 4
- Vitest
- jose
- bcryptjs

Treat repository source code and Prisma schema as the source of truth. Do not assume a feature, route, model, or folder exists until inspected.

## 2. Working Rules

Before making changes:
1. Read this file and any more specific AGENTS.md files.
2. Read README.md and inspect relevant source files.
3. Inspect related routes, components, services, database models, and tests.
4. For Next.js work, read relevant documentation under `node_modules/next/dist/docs/`.
5. Explain the problem and propose a small plan before risky changes.

Prefer small, focused changes. Avoid unrelated refactoring.

## 3. Code Quality

- Follow the installed Next.js version's App Router conventions.
- Use TypeScript. Avoid `any`.
- Keep UI components focused on presentation.
- Keep business logic and database access on the server where possible.
- Use Server Components by default. Add `"use client"` only when necessary.
- Keep secrets and database access server-side.
- Validate all untrusted input.
- Follow existing project patterns.
- Handle loading, empty, success, and error states.
- Never silence errors just to make checks pass.

## 4. Authentication and Authorization

Security is a core requirement.

- Never trust user ID, role, or village ID sent by the browser.
- Get authenticated user information from the trusted server-side authentication flow.
- Check authentication and authorization on every protected server operation.
- Follow existing roles: `SYSTEM_ADMIN`, `CHIEF`, and `VILLAGER`.
- Enforce village-level data isolation.
- Users must not access another village's data unless explicitly authorized.
- Check ownership, village membership, and permissions for reads and writes.
- Never expose password hashes, JWT secrets, or tokens.
- Follow existing password hashing and token verification mechanisms.
- Hiding a UI button is not authorization.

## 5. Financial and Data Integrity

VFC handles fund and payment records. Treat financial data as sensitive.

- Never use floating-point arithmetic for money.
- Follow the existing database representation for monetary values.
- Validate amounts on the server.
- Never trust totals or payment statuses calculated by the client.
- Use database transactions when multiple writes must succeed together.
- Prevent duplicate payments and receipts.
- Do not silently modify or delete financial history.
- Preserve audit logs for sensitive operations.
- Consider concurrent requests that may update the same record.

## 6. Prisma and Database

- Inspect `prisma/schema.prisma` and existing migrations before schema changes.
- Use Prisma migrations for schema changes.
- Never delete, rewrite, or reorder existing migrations.
- Review generated SQL for important data or constraint changes.
- Never reset or delete database data without explicit approval.
- Never run production migrations without approval.
- Preserve relations, indexes, unique constraints, and data integrity.
- Regenerate Prisma Client after schema changes.

## 7. Testing and Verification

Run relevant checks after changes:

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`

Add or update tests for changed behavior, especially:
- Authentication and permissions
- Village data isolation
- Payment and fund calculations
- Duplicate submissions
- Invalid input and error handling

Never claim a test passed unless it was actually run. Clearly report failures and checks that could not be run.

## 8. Environment and Commands

Use scripts defined in `package.json`.

Known commands:
- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run test:watch`
- `npm run db:generate`
- `npm run db:migrate`
- `npm run db:deploy`
- `npm run db:studio`

Development server uses port `5000`.

Never print or commit real `.env` values. Never overwrite environment files.

## 9. Beginner-Friendly Teaching Mode

The project owner is learning software development.

When implementing a feature or fixing a bug:

1. Explain the problem in simple language.
2. Explain the proposed solution.
3. Identify the files that need to change.
4. Make the smallest correct implementation.
5. Explain important code decisions and concepts.
6. Show how to test the result.
7. Mention limitations and risks.

Explain unfamiliar technical terms. Do not overwhelm the user with unnecessary theory.

## 10. Git Safety

- Do not commit or push unless explicitly asked.
- Do not discard uncommitted user changes.
- Avoid destructive Git commands.
- Do not modify unrelated files.
- Summarize changed files and tests before finishing.
- Ask before changes that may affect security, money, user data, or architecture.

## 11. Completion Checklist

Before declaring a task complete, verify:

- Requested behavior is implemented.
- Server-side authentication and authorization are enforced.
- Village-level data isolation is preserved.
- Financial and database integrity are preserved.
- Relevant tests and checks were run.
- No secrets or unrelated changes were introduced.
- The user understands what changed and how to test it.
