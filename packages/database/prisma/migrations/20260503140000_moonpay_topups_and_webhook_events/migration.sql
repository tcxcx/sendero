-- CreateTable
CREATE TABLE "moonpay_topups" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "moonpay_transaction_id" TEXT NOT NULL,
    "moonpay_customer_id" TEXT,
    "base_currency_amount" DECIMAL(18,2) NOT NULL,
    "base_currency_code" TEXT NOT NULL DEFAULT 'usd',
    "quote_currency_amount" DECIMAL(38,18),
    "crypto_currency_code" TEXT NOT NULL,
    "wallet_address" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "failure_reason" TEXT,
    "crypto_transaction_hash" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "moonpay_topups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moonpay_webhook_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "top_up_id" TEXT,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "moonpay_event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "signature_valid" BOOLEAN NOT NULL,
    "replay_window_ok" BOOLEAN,
    "dispatch_status" TEXT NOT NULL DEFAULT 'processed',
    "dispatch_error" TEXT,
    "duration_ms" INTEGER,
    "raw_payload" JSONB NOT NULL,

    CONSTRAINT "moonpay_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "moonpay_topups_moonpay_transaction_id_key" ON "moonpay_topups"("moonpay_transaction_id");

-- CreateIndex
CREATE INDEX "moonpay_topups_user_id_created_at_idx" ON "moonpay_topups"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "moonpay_topups_status_created_at_idx" ON "moonpay_topups"("status", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "moonpay_webhook_events_moonpay_event_id_key" ON "moonpay_webhook_events"("moonpay_event_id");

-- CreateIndex
CREATE INDEX "moonpay_webhook_events_user_id_received_at_idx" ON "moonpay_webhook_events"("user_id", "received_at" DESC);

-- CreateIndex
CREATE INDEX "moonpay_webhook_events_event_type_received_at_idx" ON "moonpay_webhook_events"("event_type", "received_at" DESC);

-- CreateIndex
CREATE INDEX "moonpay_webhook_events_dispatch_status_received_at_idx" ON "moonpay_webhook_events"("dispatch_status", "received_at" DESC);

-- AddForeignKey
ALTER TABLE "moonpay_topups" ADD CONSTRAINT "moonpay_topups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
