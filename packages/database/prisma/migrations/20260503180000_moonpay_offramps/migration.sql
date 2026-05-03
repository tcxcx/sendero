-- CreateTable
CREATE TABLE "moonpay_offramps" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "moonpay_sell_transaction_id" TEXT NOT NULL,
    "moonpay_customer_id" TEXT,
    "base_currency_amount" DECIMAL(38,18) NOT NULL,
    "base_currency_code" TEXT NOT NULL,
    "quote_currency_amount" DECIMAL(18,2),
    "quote_currency_code" TEXT NOT NULL DEFAULT 'usd',
    "refund_wallet_address" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "failure_reason" TEXT,
    "crypto_transaction_hash" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "moonpay_offramps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "moonpay_offramps_moonpay_sell_transaction_id_key" ON "moonpay_offramps"("moonpay_sell_transaction_id");

-- CreateIndex
CREATE INDEX "moonpay_offramps_user_id_created_at_idx" ON "moonpay_offramps"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "moonpay_offramps_status_created_at_idx" ON "moonpay_offramps"("status", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "moonpay_offramps" ADD CONSTRAINT "moonpay_offramps_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "moonpay_webhook_events" ADD COLUMN "off_ramp_id" TEXT;
