-- WorkflowRun — persisted checkpoint for @sendero/workflows runs that may
-- pause (channel setup wizards, multi-step approval flows). The runner is
-- stateless; this table is the source of truth across resumes.

CREATE TABLE "workflow_runs" (
    "id"              TEXT NOT NULL,
    "tenantId"        TEXT NOT NULL,
    "workflowId"      TEXT NOT NULL,
    "status"          TEXT NOT NULL DEFAULT 'running',
    "scratchpad"      JSONB NOT NULL DEFAULT '{}'::jsonb,
    "trail"           JSONB NOT NULL DEFAULT '[]'::jsonb,
    "currentStepId"   TEXT,
    "pauseReason"     TEXT,
    "pausePayload"    JSONB,
    "surfaceKey"      TEXT,
    "startedByUserId" TEXT,
    "errorStepId"     TEXT,
    "errorMessage"    TEXT,
    "startedAt"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pausedAt"        TIMESTAMPTZ(6),
    "finishedAt"      TIMESTAMPTZ(6),
    "updatedAt"       TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "workflow_runs_pkey" PRIMARY KEY ("id")
);

-- One open run per (tenant, surface). Channel wizards rely on this to
-- resume the same WorkflowRun across navigations.
CREATE UNIQUE INDEX "workflow_runs_tenantId_surfaceKey_key"
    ON "workflow_runs"("tenantId", "surfaceKey");

CREATE INDEX "workflow_runs_tenantId_workflowId_status_idx"
    ON "workflow_runs"("tenantId", "workflowId", "status");

CREATE INDEX "workflow_runs_status_updatedAt_idx"
    ON "workflow_runs"("status", "updatedAt");

ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
