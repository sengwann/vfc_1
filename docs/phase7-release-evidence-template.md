# Phase 7 release evidence ledger

Initial status: NOT VERIFIED. Fill only from the exact authorized Replit run.
No secrets, connection URLs, tokens, passwords or real personal data.

- Authorized pushed SHA / actual SHA:
- Branch / clean-tree command and output / migration and lockfile hashes:
- Run ID / UTC start/end / operator / reviewer:
- Node / npm / Prisma client and CLI / PostgreSQL / browser / OS versions:
- Nonsecret Neon project / parent / owned child / endpoint ID / database name:
- Reference compute / regions / pool configuration / warm state:
- Reviewed expected-count file hash / parameterized case inventory:

| Gate | SHA | Exact command and opt-ins (no secrets) | Expected / actual counts | Pass / fail / skip; reasons | Artifact | Cleanup | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Static/build/dependencies | | | | | | | NOT VERIFIED |
| Units/safety | | | | | | | NOT VERIFIED |
| Migration/integrity | | | | | | | NOT VERIFIED |
| Restricted role | | | | | | | NOT VERIFIED |
| Operations/authorization | | | | | | | NOT VERIFIED |
| Concurrency/production deadlines | | | | | | | NOT VERIFIED |
| Reporting/history/reconciliation | | | | | | | NOT VERIFIED |
| Genuine-session browser | | | | | | | NOT VERIFIED |
| Historical behavior | | | | | | | NOT VERIFIED |
| Performance | | | | | | | NOT VERIFIED |
| Backup/restore/deployment | | | | | | | NOT VERIFIED |

For each failure/skip: sanitized case name, reason, SQLSTATE/Prisma codes,
expected/actual state, investigation and rerun revision. Do not publish raw adapter
errors or Vitest JSON without redaction. Count mismatch or skip blocks the gate.

Fixtures: run identifier, village/household/user/Fund/payment/receipt IDs, expected
metrics, timestamp basis, current statuses, historical provenance. Synthetic only.

Concurrency: actual lock dependency/barrier evidence, attempts <=4, final accepted
coverage, distinct receipt numbers, audit counts, rollback and connection recovery.

Performance: profile, people separately from households, history/boundary counts,
concurrency, raw sanitized samples, percentiles, SQL/parameters, acquisition/tx,
lock waits/retries, errors, throughput/memory; separate EXPLAIN and browser artifacts.
Targets and achieved measurements must occupy separate columns.

Browser: role/session identity, language, viewport, URL/action, expected fixture
IDs/values, actual result, screenshots, server-side denial evidence. Screenshots
alone do not establish authorization or money correctness.

Recovery: encrypted backup identity/hash, tool versions, verified empty restore
destination, restore results, schema/data/security/allocator comparisons, migration
checksums, role assertions, failure rehearsal, old-writer shutdown and recovery.

Cleanup: SQL/client/app shutdown, owned-branch delete confirmation, errors and
surviving exact branch IDs. Lost POST: unique name/project/parent/time and manual
resource verification. Do not guess-delete.

Exceptions: owner, date, precise scope, risk, compensating evidence, expiry and
reviewer. Exception is not PASS. Final decision / unresolved blockers / Qwen review:


Runner artifact contract after corrections: VFC_RELEASE_EVIDENCE_DIR contains
exclusive 0600 release-<uuid>.json files, retained for PASS and BLOCKED runs.
Expected inventory specifies SHA/mode/ordered files/expanded case identities with
per-file ordinal; record its independently approved SHA-256 as well as the actual
manifest hash. Include collection FAILED for missing/malformed JSON, individual
skipped identities, controlled reason codes and boolean reason availability, exit/signal, original execution and
cleanup failures, start/end timestamps and ownership breadcrumbs. Raw reports are
deleted; sanitized artifacts survive. A failed cleanup cannot become PASS.


Third correction publication contract:
- Record checkpoint and final artifact names and final successful publication output.
- A checkpoint has status BLOCKED and publication RAW_REPORT_CLEANUP_PENDING;
  it cannot establish PASS. The final artifact requires publication COMPLETE.
- Record rawReport REMOVED / RETAINED_PRIVATE / NOT_CREATED without a raw path.
- Publication failure: retain run ID/SHA and DURABLE_PUBLICATION_FAILED; BLOCKED.
- Atomic no-replace hard link, file/directory sync and readback must succeed.
- A colliding artifact is never overwritten; incomplete .tmp files are not evidence.
- Untrusted status/identity yields INCOMPLETE, UNKNOWN_STATUS and/or COLLECTION_ERROR.
- Approved reason codes: ASSERTION_OR_EXECUTION_FAILED, UNKNOWN_SKIP_REASON,
  COLLECTION_ERROR; passed reason is null. Never paste pendingReason, SQL parameters,
  personal data or raw driver diagnostics. Case identities come from reviewed inventory.
- Exact command records a <PRIVATE_REPORT> placeholder for the private output path.
All third-pass regressions remain authored and unexecuted.


Fourth correction storage evidence:
- Record canonical-storage preflight outcome, never a private raw-report path.
- RAW_STORAGE_UNSAFE blocks provisioning and subprocess launch; retain run ID/SHA.
- Confirm raw storage is external after realpath resolution, mode 0700 and owned
  by the current UID; unresolved/in-checkout/symlinked-in parents have no fallback.
- A publication failure retains raw output only under that validated private
  run directory; follow private recovery instructions, never upload raw output.
- Registry-reset, exclusive-open-failure and mismatched-readback regressions are
  authored only. No execution outcome is supplied by this preparation pass.
