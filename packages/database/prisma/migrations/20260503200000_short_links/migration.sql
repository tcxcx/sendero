-- CreateTable
CREATE TABLE "short_links" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "target_url" TEXT NOT NULL,
    "tenant_id" TEXT,
    "user_id" TEXT,
    "purpose" TEXT,
    "click_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "first_click_at" TIMESTAMPTZ(6),
    "last_click_at" TIMESTAMPTZ(6),
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "short_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "short_links_code_key" ON "short_links"("code");

-- CreateIndex
CREATE INDEX "short_links_tenant_id_created_at_idx" ON "short_links"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "short_links_user_id_created_at_idx" ON "short_links"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "short_links_expires_at_idx" ON "short_links"("expires_at");
