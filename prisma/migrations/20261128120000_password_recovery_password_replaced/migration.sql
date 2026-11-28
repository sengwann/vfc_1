-- Preserve existing revocation reasons and allow credential replacement to end
-- an open request without implying that the account is ineligible for recovery.
BEGIN;

ALTER TABLE "PasswordRecoveryRequest"
  DROP CONSTRAINT "PasswordRecoveryRequest_revocation_reason_check",
  ADD CONSTRAINT "PasswordRecoveryRequest_revocation_reason_check"
    CHECK (
      "revocationReason" IS NULL
      OR "revocationReason" IN (
        'WITHDRAWN', 'TOO_MANY_ATTEMPTS', 'TARGET_INELIGIBLE', 'PASSWORD_REPLACED'
      )
    );

COMMIT;
