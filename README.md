# VFC

VFC is a full-stack web application for village administration and financial management. It brings village, household, fund, payment collection, receipt, and reporting workflows into one application.

> **Project status:** This README describes the current repository structure and available scripts. It does not guarantee that every feature is production-ready. Check the implementation and tests before relying on a workflow.

## Main Features

- **Authentication and users** — user sign-in, account management, and role-based access.
- **Village management** — manage village records and village membership.
- **Household and house management** — organize households, houses, and their members.
- **Fund management** — create and manage village funds.
- **Payment collection** — record and manage contributions.
- **Collector assignments** — assign users to collection duties.
- **Receipts** — view payment receipt records.
- **Analytics and audit logs** — review operational information and recorded actions.
- **Password recovery** — a member who forgot their password asks for a reset; their village Chief (or a System Admin) confirms who they are and issues a one-time code. See [Password recovery](#password-recovery).

The application defines three user roles: `SYSTEM_ADMIN`, `CHIEF`, and `VILLAGER`. Access to village data must remain properly isolated between villages.

## Technology Stack

- Next.js 16 — React framework using the App Router
- React 19 — user interface
- TypeScript 5 — application language
- PostgreSQL — relational database
- Prisma 7 — database ORM and migrations
- Tailwind CSS 4 — styling
- Vitest — automated tests
- jose — JWT-related functionality
- bcryptjs — password hashing

## Prerequisites

Install the following before starting:

- Node.js (compatible with the installed Next.js release)
- npm
- PostgreSQL

You also need access to a PostgreSQL database for local development.

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/sengwann/VFC.git
cd VFC
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure the database

Create a `.env` file in the project root and add your PostgreSQL connection string:

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DATABASE?schema=public"
```

Replace the example values with your own database username, password, host, port, and database name.

**Security:** Never commit your real `.env` file or database credentials to Git.

### 4. Set up the database

For local development, apply migrations with:

```bash
npm run db:migrate
```

Generate the Prisma Client if needed:

```bash
npm run db:generate
```

The repository configures a Prisma seed command. If the project has seed data to load, run:

```bash
npx prisma db seed
```

Only run seed commands against a database where you are comfortable inserting the project's seed data.

### 5. Start the development server

```bash
npm run dev
```

Open [http://localhost:5000](http://localhost:5000) in your browser.

## Available Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the development server on port 5000 |
| `npm run build` | Build the application for production |
| `npm run start` | Start the production server on port 5000 |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run the TypeScript type checker |
| `npm test` | Run the Vitest test suite once |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run admin:reset-password -- --email <admin email> --yes` | Last-resort reset for a System Admin (temporary password, forced change) |
| `npm run db:generate` | Generate Prisma Client |
| `npm run db:migrate` | Run development database migrations |
| `npm run db:deploy` | Apply pending migrations in a deployment environment |
| `npm run db:studio` | Open Prisma Studio |

## Project Structure

The repository uses a feature-oriented organization under `src/features`. The exact contents may change as the project evolves.

| Path | Purpose |
| --- | --- |
| `src/app/` | Next.js App Router pages, layouts, and route handlers |
| `src/features/` | Feature-specific application code |
| `src/lib/` | Shared application utilities and infrastructure |
| `prisma/schema.prisma` | Database models, relations, and enums |
| `prisma/migrations/` | Database migration history |
| `prisma/seed.ts` | Database seed entry point |
| `AGENTS.md` | Repository-specific instructions for coding agents |
| `CLAUDE.md` | Instructions for Claude Code |

## Development and Quality Checks

Before submitting a change, run the checks relevant to that change:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

A command may require a configured database or environment variables. Report any check that was not run; do not assume it passed.

## Important Security and Data Rules

VFC handles user accounts and financial records. Changes in these areas require extra care:

- Enforce authorization on the server, not only in the user interface.
- Verify village ownership and scope for every operation involving village data.
- Validate all client-provided input on the server.
- Never store plain-text passwords or expose secrets.
- Use database transactions when a business operation changes multiple related records.
- Prevent duplicate or inconsistent payment and receipt records.
- Preserve financial history; use the established voiding and audit mechanisms instead of silently deleting records.
- Do not run destructive database commands against shared or production data without explicit approval.

## Password recovery

There is no email or SMS reset. Recovery is vouched for by a person:

1. The member opens **Forgot password?** on the sign-in page and files a request. The answer is always the same, whether or not the account exists.
2. Their village Chief is notified. A Chief's own request, or a request from a village with no active Chief, goes to the System Admins. A System Admin's request goes to a different System Admin.
3. The approver confirms who the member is in person or by phone, re-enters their own password, and issues a one-time code (valid 72 hours, shown once). They can also reject the request or withdraw a live code.
4. The member enters the code on **Reset password** and chooses a new password. All their sessions end, and a notice tells them their password changed, when, and by whom.

A request that nobody answers expires after 7 days. The **last** System Admin has nobody to approve them, so use `npm run admin:reset-password` on the server instead.

## Contributing

1. Read `AGENTS.md` and `CLAUDE.md` before using an AI coding assistant.
2. Inspect existing patterns before adding or changing code.
3. Keep changes focused and include tests where appropriate.
4. Run relevant quality checks.
5. Explain schema, authentication, authorization, and financial logic changes in the pull request.

## License

No license information is currently specified in this repository. Contact the project owner before reusing or distributing this code.
