-- CreateEnum
CREATE TYPE "TripKind" AS ENUM ('one_way', 'round_trip', 'open_journey');

-- CreateEnum
CREATE TYPE "TripPaymentMode" AS ENUM ('tenant', 'traveler', 'split');

-- CreateEnum
CREATE TYPE "MeterPayerType" AS ENUM ('tenant', 'traveler');

-- CreateEnum
CREATE TYPE "ChainKind" AS ENUM ('arc', 'sol');

-- CreateEnum
CREATE TYPE "SlackInstallKind" AS ENUM ('tmc_internal', 'customer_account');

-- CreateEnum
CREATE TYPE "BucketListItemStatus" AS ENUM ('want_to_visit', 'visited', 'loved', 'skip', 'revisit');

-- CreateEnum
CREATE TYPE "GroupTripStatus" AS ENUM ('draft', 'inviting', 'active', 'completed', 'canceled');

-- CreateEnum
CREATE TYPE "GroupTripPassengerStatus" AS ENUM ('invited', 'claimed', 'declined', 'canceled');

-- CreateEnum
CREATE TYPE "KnowledgeGapKind" AS ENUM ('tool_input_mismatch', 'tool_not_found', 'tool_error_unrecoverable', 'instruction_missing', 'env_missing', 'schema_drift', 'runtime_constraint', 'other');

-- CreateEnum
CREATE TYPE "KnowledgeGapSeverity" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateEnum
CREATE TYPE "KnowledgeGapStatus" AS ENUM ('open', 'triaged', 'in_progress', 'resolved', 'duplicate', 'wontfix');

-- AlterEnum
ALTER TYPE "BillingTier" ADD VALUE 'basic';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BookingKind" ADD VALUE 'esim';
ALTER TYPE "BookingKind" ADD VALUE 'card';
ALTER TYPE "BookingKind" ADD VALUE 'insurance';

-- AlterEnum
ALTER TYPE "MeterStatus" ADD VALUE 'credit';

-- DropForeignKey
ALTER TABLE "workflow_runs" DROP CONSTRAINT "workflow_runs_tenantId_fkey";

-- DropIndex
DROP INDEX "circle_wallets_address_key";

-- DropIndex
DROP INDEX "nft_stamps_kind_primaryKey_key";

-- DropIndex
DROP INDEX "onchain_identities_kind_tenantId_key";

-- DropIndex
DROP INDEX "onchain_identities_kind_userId_key";

-- DropIndex
DROP INDEX "whatsapp_installs_kapsoConnectionId_key";

-- DropIndex
DROP INDEX "whatsapp_installs_phoneNumberId_key";

-- AlterTable
ALTER TABLE "booking_pay_tokens" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "destinationCountry" CHAR(2),
ADD COLUMN     "eTicketDocumentUrl" TEXT,
ADD COLUMN     "eTicketIssuedAt" TIMESTAMPTZ(6),
ADD COLUMN     "originCountry" CHAR(2),
ADD COLUMN     "payerWalletId" TEXT,
ADD COLUMN     "provisionedBy" "MeterPayerType";

-- AlterTable
ALTER TABLE "chat_messages" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "circle_wallets" ADD COLUMN     "scaDeployedAt" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "group_trip_passengers" ADD COLUMN     "broadcast_opted_out" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "status" "GroupTripPassengerStatus" NOT NULL DEFAULT 'claimed',
ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "group_trips" ADD COLUMN     "status" "GroupTripStatus" NOT NULL DEFAULT 'draft';

-- AlterTable
ALTER TABLE "meter_events" ADD COLUMN     "payerType" "MeterPayerType",
ADD COLUMN     "payerUserId" TEXT,
ADD COLUMN     "payerWalletId" TEXT;

-- AlterTable
ALTER TABLE "nft_stamps" ADD COLUMN     "chain" "ChainKind" NOT NULL DEFAULT 'arc';

-- AlterTable
ALTER TABLE "onchain_identities" ADD COLUMN     "chain" "ChainKind" NOT NULL DEFAULT 'arc';

-- AlterTable
ALTER TABLE "policies" ADD COLUMN     "customerAccountId" TEXT;

-- AlterTable
ALTER TABLE "slack_installs" ADD COLUMN     "customerAccountId" TEXT,
ADD COLUMN     "kind" "SlackInstallKind" NOT NULL DEFAULT 'tmc_internal',
ADD COLUMN     "revoked_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "dailyCreditBurnMicro" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "dailyWindowStartedAt" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "defaultPaymentMode" "TripPaymentMode" NOT NULL DEFAULT 'traveler',
ADD COLUMN     "primaryChain" "ChainKind" NOT NULL DEFAULT 'arc';

-- AlterTable
ALTER TABLE "trips" ADD COLUMN     "customerAccountId" TEXT,
ADD COLUMN     "destinationCountry" CHAR(2),
ADD COLUMN     "kind" "TripKind" NOT NULL DEFAULT 'one_way',
ADD COLUMN     "originCountry" CHAR(2),
ADD COLUMN     "paymentMode" "TripPaymentMode";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "customerAccountId" TEXT,
ADD COLUMN     "homeIata" TEXT;

-- AlterTable
ALTER TABLE "wallets" ADD COLUMN     "accountType" TEXT,
ADD COLUMN     "circleWalletId" TEXT,
ADD COLUMN     "circleWalletSetId" TEXT,
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "provisioner" TEXT NOT NULL DEFAULT 'msca';

-- DropTable
DROP TABLE "workflow_runs";

-- CreateTable
CREATE TABLE "customer_accounts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "primaryDomain" TEXT,
    "status" TEXT NOT NULL DEFAULT 'invited',
    "createdByOperatorId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customer_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "traveler_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dietary" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allergies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pace" TEXT,
    "voicePreferred" BOOLEAN NOT NULL DEFAULT false,
    "preferredCabin" TEXT,
    "redEyeOK" BOOLEAN NOT NULL DEFAULT true,
    "layoverMaxMin" INTEGER,
    "preferredLang" TEXT,
    "visitedCities" JSONB NOT NULL DEFAULT '[]',
    "totalTrips" INTEGER NOT NULL DEFAULT 0,
    "lastTripAt" TIMESTAMPTZ(6),
    "loyaltyAccounts" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "traveler_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "traveler_taste_entries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "notes" TEXT,
    "avoid" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "preferred_time_of_day" TEXT,
    "preferred_budget" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "traveler_taste_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "city_bucket_list_items" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "place_id" TEXT,
    "url" TEXT,
    "status" "BucketListItemStatus" NOT NULL DEFAULT 'want_to_visit',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "city_bucket_list_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anticipation_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "traveler_user_id" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'fired',
    "fired_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "anticipation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_gateway_signers" (
    "userId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "encryptedPrivateKey" TEXT NOT NULL,
    "kekVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_gateway_signers_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "tenant_gateway_signers" (
    "tenantId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "encryptedPrivateKey" TEXT NOT NULL,
    "kekVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenant_gateway_signers_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "tenant_solana_gateway_signers" (
    "tenantId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "encryptedPrivateKey" TEXT NOT NULL,
    "kekVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenant_solana_gateway_signers_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "tenant_gateway_configs" (
    "tenantId" TEXT NOT NULL,
    "evmDepositorAddress" TEXT NOT NULL,
    "solanaDepositorAddress" TEXT,
    "enabledDomains" INTEGER[] DEFAULT ARRAY[26]::INTEGER[],
    "sweepPolicy" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenant_gateway_configs_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "gateway_deposit_logs" (
    "id" UUID NOT NULL,
    "tenantId" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "domain" INTEGER NOT NULL,
    "amountMicroUsdc" BIGINT NOT NULL,
    "depositTxHash" TEXT,
    "approveTxHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "webhookEventId" TEXT,
    "triggeredBy" TEXT NOT NULL DEFAULT 'auto',
    "errorMessage" TEXT,
    "confirmedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "gateway_deposit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gateway_transfer_logs" (
    "id" UUID NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceDomain" INTEGER,
    "destinationDomain" INTEGER NOT NULL,
    "destinationChain" TEXT NOT NULL,
    "amountMicroUsdc" BIGINT NOT NULL,
    "recipientAddress" TEXT NOT NULL,
    "burnSignature" TEXT,
    "attestation" TEXT,
    "circleTransferId" TEXT,
    "mintTxHash" TEXT,
    "circleDestinationTxHash" TEXT,
    "forwardingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "forwardingFailureReason" TEXT,
    "feesTotalMicroUsdc" BIGINT,
    "feesForwardingMicroUsdc" BIGINT,
    "feesPerIntent" JSONB,
    "status" TEXT NOT NULL DEFAULT 'attesting',
    "lastReconciledAt" TIMESTAMPTZ(6),
    "initiatedByUserId" TEXT,
    "triggeredBy" TEXT NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMPTZ(6),
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "gateway_transfer_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_access_logs" (
    "id" UUID NOT NULL,
    "tenantId" TEXT NOT NULL,
    "callerSurface" TEXT NOT NULL,
    "callerUserId" TEXT,
    "kekVersion" INTEGER NOT NULL,
    "context" TEXT,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_session_verifications" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channelIdentityId" UUID NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'session_verify',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "nonce" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "sentAt" TIMESTAMPTZ(6),
    "verifiedAt" TIMESTAMPTZ(6),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "providerMessageId" TEXT,
    "failureReason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "whatsapp_session_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_flow_registrations" (
    "id" UUID NOT NULL,
    "tenantId" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "flowKey" TEXT NOT NULL,
    "kapsoFlowId" TEXT NOT NULL,
    "metaFlowId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "mode" TEXT NOT NULL DEFAULT 'draft',
    "name" TEXT,
    "dataEndpointId" TEXT,
    "lastError" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "whatsapp_flow_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_webhook_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signature_valid" BOOLEAN NOT NULL,
    "replay_window_ok" BOOLEAN,
    "payload_hash" TEXT NOT NULL,
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "identity_change_count" INTEGER NOT NULL DEFAULT 0,
    "status_update_count" INTEGER NOT NULL DEFAULT 0,
    "dropped_replay_count" INTEGER NOT NULL DEFAULT 0,
    "dropped_duplicate_count" INTEGER NOT NULL DEFAULT 0,
    "dispatched_count" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER,
    "trace_id" TEXT,
    "raw_envelope" JSONB,

    CONSTRAINT "whatsapp_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_api_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "called_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "target" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "status_code" INTEGER NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "error_message" TEXT,
    "trace_id" TEXT,

    CONSTRAINT "whatsapp_api_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_outbound_messages" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "wamid" TEXT NOT NULL,
    "phone_number_id" TEXT NOT NULL,
    "recipient_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "template_name" TEXT,
    "preview" TEXT,
    "sent_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivery_status" TEXT NOT NULL DEFAULT 'sent',
    "failure_reason" TEXT,
    "delivered_at" TIMESTAMPTZ(6),
    "read_at" TIMESTAMPTZ(6),
    "failed_at" TIMESTAMPTZ(6),
    "trace_id" TEXT,
    "group_trip_id" TEXT,
    "broadcast_id" TEXT,

    CONSTRAINT "whatsapp_outbound_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slack_webhook_events" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "tenant_id" TEXT,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "team_id" TEXT NOT NULL,
    "enterprise_id" TEXT,
    "event_id" TEXT,
    "event_type" TEXT,
    "event_subtype" TEXT,
    "channel_id" TEXT,
    "thread_ts" TEXT,
    "slack_user_id" TEXT,
    "signature_valid" BOOLEAN NOT NULL,
    "replay_window_ok" BOOLEAN,
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "dropped_duplicate_count" INTEGER NOT NULL DEFAULT 0,
    "dropped_busy_count" INTEGER NOT NULL DEFAULT 0,
    "dispatched_count" INTEGER NOT NULL DEFAULT 0,
    "dispatch_status" TEXT NOT NULL DEFAULT 'processed',
    "dispatch_error" TEXT,
    "duration_ms" INTEGER,
    "trace_id" TEXT,
    "payload_hash" TEXT,
    "raw_envelope" JSONB,

    CONSTRAINT "slack_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slack_agent_events" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "tenant_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trace_id" TEXT,
    "event_id" TEXT,
    "turn_id" TEXT,
    "team_id" TEXT NOT NULL,
    "enterprise_id" TEXT,
    "channel_id" TEXT NOT NULL,
    "thread_ts" TEXT NOT NULL,
    "slack_user_id" TEXT,
    "sendero_user_id" TEXT,
    "trip_id" TEXT,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "kind" TEXT NOT NULL,
    "tool_name" TEXT,
    "ok" BOOLEAN,
    "duration_ms" INTEGER,
    "status_text" TEXT,
    "error_message" TEXT,
    "metadata" JSONB,

    CONSTRAINT "slack_agent_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_policies" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "travelerId" TEXT,
    "toolName" TEXT,
    "guardKind" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "hardCap" BOOLEAN NOT NULL DEFAULT true,
    "alertWebhookUrl" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "transfer_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_attempts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "travelerId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'spend',
    "amountMicroUsdc" BIGINT NOT NULL,
    "recipient" TEXT NOT NULL,
    "destinationChain" TEXT NOT NULL,
    "sourceAllocations" JSONB,
    "status" TEXT NOT NULL DEFAULT 'passed',
    "txHash" TEXT,
    "blockReason" TEXT,
    "policyTrace" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "transfer_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_handoffs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tripId" TEXT,
    "channelIdentityId" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "inboundMessageId" TEXT,
    "question" TEXT NOT NULL,
    "summary" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "liveblocksRoomId" TEXT NOT NULL,
    "answer" TEXT,
    "answeredByUserId" TEXT,
    "answeredAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "channel_handoffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "esims" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "travelerId" TEXT,
    "tripId" TEXT,
    "provider" TEXT NOT NULL,
    "providerOrderId" TEXT NOT NULL,
    "iccid" TEXT,
    "activationCode" TEXT NOT NULL,
    "lpaCode" TEXT NOT NULL,
    "qrTokenHash" TEXT,
    "destinationCountries" JSONB NOT NULL,
    "dataMb" INTEGER NOT NULL,
    "validityDays" INTEGER NOT NULL,
    "wholesaleMicroUsdc" BIGINT NOT NULL,
    "markupMicroUsdc" BIGINT NOT NULL DEFAULT 0,
    "senderoTakeMicroUsdc" BIGINT NOT NULL DEFAULT 0,
    "retailMicroUsdc" BIGINT NOT NULL,
    "provisionedBy" "MeterPayerType",
    "payerWalletId" TEXT,
    "payerUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ordered',
    "installedAt" TIMESTAMPTZ(6),
    "activatedAt" TIMESTAMPTZ(6),
    "expiresAt" TIMESTAMPTZ(6),
    "usageMb" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "esims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "super_org_treasuries" (
    "id" TEXT NOT NULL,
    "chain" "ChainKind" NOT NULL,
    "network" TEXT NOT NULL,
    "multisigAddress" TEXT NOT NULL,
    "vaultAddress" TEXT NOT NULL,
    "threshold" INTEGER NOT NULL,
    "members" JSONB NOT NULL,
    "createKey" TEXT,
    "provisioningTxRef" TEXT,
    "multisigInstallTxRef" TEXT,
    "multisigInstalledAt" TIMESTAMPTZ(6),
    "platformOwnerRemovedAt" TIMESTAMPTZ(6),
    "platformOwnerRemovalTxRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "provisionedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "super_org_treasuries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treasury_proposals" (
    "id" TEXT NOT NULL,
    "treasuryId" TEXT NOT NULL,
    "txIndex" INTEGER NOT NULL,
    "transactionPda" TEXT NOT NULL,
    "proposalPda" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "proposalTxRef" TEXT,
    "executedTxRef" TEXT,
    "approvedCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "proposedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "treasury_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_dispatch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "eventKind" TEXT NOT NULL,
    "dedupKey" TEXT NOT NULL,
    "channelKind" TEXT NOT NULL,
    "recipients" JSONB NOT NULL,
    "snapshotPrefs" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "triggeredBy" TEXT NOT NULL,
    "dispatchedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_dispatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_notification_pref" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "eventKind" TEXT NOT NULL,
    "channels" TEXT[],
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_notification_pref_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "moonpay_webhook_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "top_up_id" TEXT,
    "off_ramp_id" TEXT,
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

-- CreateTable
CREATE TABLE "knowledge_gaps" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "trace_id" TEXT,
    "kind" "KnowledgeGapKind" NOT NULL,
    "severity" "KnowledgeGapSeverity" NOT NULL DEFAULT 'medium',
    "status" "KnowledgeGapStatus" NOT NULL DEFAULT 'open',
    "tool_name" TEXT,
    "error_message" TEXT NOT NULL,
    "attempted_input" JSONB,
    "hypothesis" TEXT NOT NULL,
    "suggested_fix" TEXT,
    "blocking_traveler" BOOLEAN NOT NULL DEFAULT false,
    "channel_kind" TEXT,
    "surface" TEXT,
    "reported_by_user_id" TEXT,
    "resolved_at" TIMESTAMPTZ(6),
    "resolution_note" TEXT,
    "resolution_pr_url" TEXT,
    "dedup_key" TEXT NOT NULL,
    "occurrence_count" INTEGER NOT NULL DEFAULT 1,
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "knowledge_gaps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_accounts_tenantId_status_idx" ON "customer_accounts"("tenantId", "status");

-- CreateIndex
CREATE INDEX "customer_accounts_tenantId_createdAt_idx" ON "customer_accounts"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "customer_accounts_tenantId_primaryDomain_key" ON "customer_accounts"("tenantId", "primaryDomain");

-- CreateIndex
CREATE UNIQUE INDEX "traveler_profiles_userId_key" ON "traveler_profiles"("userId");

-- CreateIndex
CREATE INDEX "traveler_profiles_tenantId_lastTripAt_idx" ON "traveler_profiles"("tenantId", "lastTripAt");

-- CreateIndex
CREATE INDEX "traveler_taste_entries_tenantId_key_idx" ON "traveler_taste_entries"("tenantId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "traveler_taste_entries_userId_key_key" ON "traveler_taste_entries"("userId", "key");

-- CreateIndex
CREATE INDEX "city_bucket_list_items_userId_city_idx" ON "city_bucket_list_items"("userId", "city");

-- CreateIndex
CREATE INDEX "city_bucket_list_items_tenantId_status_idx" ON "city_bucket_list_items"("tenantId", "status");

-- CreateIndex
CREATE INDEX "anticipation_events_tenantId_fired_at_idx" ON "anticipation_events"("tenantId", "fired_at" DESC);

-- CreateIndex
CREATE INDEX "anticipation_events_tenantId_kind_fired_at_idx" ON "anticipation_events"("tenantId", "kind", "fired_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "user_gateway_signers_address_key" ON "user_gateway_signers"("address");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_gateway_signers_address_key" ON "tenant_gateway_signers"("address");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_solana_gateway_signers_address_key" ON "tenant_solana_gateway_signers"("address");

-- CreateIndex
CREATE UNIQUE INDEX "gateway_deposit_logs_webhookEventId_key" ON "gateway_deposit_logs"("webhookEventId");

-- CreateIndex
CREATE INDEX "gateway_deposit_logs_tenantId_chain_status_idx" ON "gateway_deposit_logs"("tenantId", "chain", "status");

-- CreateIndex
CREATE INDEX "gateway_deposit_logs_tenantId_createdAt_idx" ON "gateway_deposit_logs"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "gateway_deposit_logs_status_createdAt_idx" ON "gateway_deposit_logs"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "gateway_transfer_logs_circleTransferId_key" ON "gateway_transfer_logs"("circleTransferId");

-- CreateIndex
CREATE INDEX "gateway_transfer_logs_tenantId_status_idx" ON "gateway_transfer_logs"("tenantId", "status");

-- CreateIndex
CREATE INDEX "gateway_transfer_logs_tenantId_createdAt_idx" ON "gateway_transfer_logs"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "gateway_transfer_logs_status_createdAt_idx" ON "gateway_transfer_logs"("status", "createdAt");

-- CreateIndex
CREATE INDEX "wallet_access_logs_tenantId_occurredAt_idx" ON "wallet_access_logs"("tenantId", "occurredAt");

-- CreateIndex
CREATE INDEX "wallet_access_logs_occurredAt_idx" ON "wallet_access_logs"("occurredAt");

-- CreateIndex
CREATE INDEX "whatsapp_session_verifications_tenantId_channelIdentityId_c_idx" ON "whatsapp_session_verifications"("tenantId", "channelIdentityId", "createdAt");

-- CreateIndex
CREATE INDEX "whatsapp_session_verifications_tenantId_status_expiresAt_idx" ON "whatsapp_session_verifications"("tenantId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "whatsapp_flow_registrations_tenantId_idx" ON "whatsapp_flow_registrations"("tenantId");

-- CreateIndex
CREATE INDEX "whatsapp_flow_registrations_phoneNumberId_idx" ON "whatsapp_flow_registrations"("phoneNumberId");

-- CreateIndex
CREATE INDEX "whatsapp_flow_registrations_flowKey_idx" ON "whatsapp_flow_registrations"("flowKey");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_flow_registrations_tenantId_phoneNumberId_flowKey_key" ON "whatsapp_flow_registrations"("tenantId", "phoneNumberId", "flowKey");

-- CreateIndex
CREATE INDEX "whatsapp_webhook_events_tenant_id_received_at_idx" ON "whatsapp_webhook_events"("tenant_id", "received_at" DESC);

-- CreateIndex
CREATE INDEX "whatsapp_webhook_events_trace_id_idx" ON "whatsapp_webhook_events"("trace_id");

-- CreateIndex
CREATE INDEX "whatsapp_api_logs_tenant_id_called_at_idx" ON "whatsapp_api_logs"("tenant_id", "called_at" DESC);

-- CreateIndex
CREATE INDEX "whatsapp_api_logs_target_called_at_idx" ON "whatsapp_api_logs"("target", "called_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_outbound_messages_wamid_key" ON "whatsapp_outbound_messages"("wamid");

-- CreateIndex
CREATE INDEX "whatsapp_outbound_messages_tenant_id_sent_at_idx" ON "whatsapp_outbound_messages"("tenant_id", "sent_at" DESC);

-- CreateIndex
CREATE INDEX "whatsapp_outbound_messages_tenant_id_delivery_status_idx" ON "whatsapp_outbound_messages"("tenant_id", "delivery_status");

-- CreateIndex
CREATE INDEX "whatsapp_outbound_messages_tenant_id_source_idx" ON "whatsapp_outbound_messages"("tenant_id", "source");

-- CreateIndex
CREATE INDEX "whatsapp_outbound_messages_group_trip_id_broadcast_id_idx" ON "whatsapp_outbound_messages"("group_trip_id", "broadcast_id");

-- CreateIndex
CREATE INDEX "slack_webhook_events_tenant_id_received_at_idx" ON "slack_webhook_events"("tenant_id", "received_at" DESC);

-- CreateIndex
CREATE INDEX "slack_webhook_events_trace_id_idx" ON "slack_webhook_events"("trace_id");

-- CreateIndex
CREATE INDEX "slack_webhook_events_event_id_idx" ON "slack_webhook_events"("event_id");

-- CreateIndex
CREATE INDEX "slack_webhook_events_team_id_channel_id_thread_ts_received__idx" ON "slack_webhook_events"("team_id", "channel_id", "thread_ts", "received_at" DESC);

-- CreateIndex
CREATE INDEX "slack_agent_events_tenant_id_created_at_idx" ON "slack_agent_events"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "slack_agent_events_trace_id_sequence_idx" ON "slack_agent_events"("trace_id", "sequence");

-- CreateIndex
CREATE INDEX "slack_agent_events_team_id_channel_id_thread_ts_created_at_idx" ON "slack_agent_events"("team_id", "channel_id", "thread_ts", "created_at" DESC);

-- CreateIndex
CREATE INDEX "slack_agent_events_kind_created_at_idx" ON "slack_agent_events"("kind", "created_at" DESC);

-- CreateIndex
CREATE INDEX "transfer_policies_tenantId_scope_enabled_idx" ON "transfer_policies"("tenantId", "scope", "enabled");

-- CreateIndex
CREATE INDEX "transfer_policies_tenantId_travelerId_enabled_idx" ON "transfer_policies"("tenantId", "travelerId", "enabled");

-- CreateIndex
CREATE INDEX "transfer_policies_tenantId_toolName_enabled_idx" ON "transfer_policies"("tenantId", "toolName", "enabled");

-- CreateIndex
CREATE INDEX "transfer_attempts_tenantId_status_createdAt_idx" ON "transfer_attempts"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "transfer_attempts_tenantId_travelerId_createdAt_idx" ON "transfer_attempts"("tenantId", "travelerId", "createdAt");

-- CreateIndex
CREATE INDEX "transfer_attempts_tenantId_kind_createdAt_idx" ON "transfer_attempts"("tenantId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "channel_handoffs_tenantId_status_createdAt_idx" ON "channel_handoffs"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "channel_handoffs_tenantId_tripId_idx" ON "channel_handoffs"("tenantId", "tripId");

-- CreateIndex
CREATE INDEX "channel_handoffs_channelIdentityId_idx" ON "channel_handoffs"("channelIdentityId");

-- CreateIndex
CREATE UNIQUE INDEX "esims_iccid_key" ON "esims"("iccid");

-- CreateIndex
CREATE INDEX "esims_tenantId_createdAt_idx" ON "esims"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "esims_tripId_idx" ON "esims"("tripId");

-- CreateIndex
CREATE INDEX "esims_travelerId_idx" ON "esims"("travelerId");

-- CreateIndex
CREATE INDEX "esims_status_idx" ON "esims"("status");

-- CreateIndex
CREATE INDEX "esims_provisionedBy_idx" ON "esims"("provisionedBy");

-- CreateIndex
CREATE UNIQUE INDEX "esims_provider_providerOrderId_key" ON "esims"("provider", "providerOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "super_org_treasuries_multisigAddress_key" ON "super_org_treasuries"("multisigAddress");

-- CreateIndex
CREATE INDEX "super_org_treasuries_chain_network_idx" ON "super_org_treasuries"("chain", "network");

-- CreateIndex
CREATE INDEX "super_org_treasuries_status_idx" ON "super_org_treasuries"("status");

-- CreateIndex
CREATE INDEX "treasury_proposals_treasuryId_status_idx" ON "treasury_proposals"("treasuryId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "treasury_proposals_treasuryId_txIndex_key" ON "treasury_proposals"("treasuryId", "txIndex");

-- CreateIndex
CREATE INDEX "notification_dispatch_tenantId_eventKind_dispatchedAt_idx" ON "notification_dispatch"("tenantId", "eventKind", "dispatchedAt");

-- CreateIndex
CREATE INDEX "notification_dispatch_tenantId_sourceKind_sourceId_idx" ON "notification_dispatch"("tenantId", "sourceKind", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "notification_dispatch_tenantId_dedupKey_channelKind_key" ON "notification_dispatch"("tenantId", "dedupKey", "channelKind");

-- CreateIndex
CREATE INDEX "user_notification_pref_tenantId_eventKind_idx" ON "user_notification_pref"("tenantId", "eventKind");

-- CreateIndex
CREATE UNIQUE INDEX "user_notification_pref_userId_tenantId_eventKind_key" ON "user_notification_pref"("userId", "tenantId", "eventKind");

-- CreateIndex
CREATE UNIQUE INDEX "moonpay_topups_moonpay_transaction_id_key" ON "moonpay_topups"("moonpay_transaction_id");

-- CreateIndex
CREATE INDEX "moonpay_topups_user_id_created_at_idx" ON "moonpay_topups"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "moonpay_topups_status_created_at_idx" ON "moonpay_topups"("status", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "moonpay_offramps_moonpay_sell_transaction_id_key" ON "moonpay_offramps"("moonpay_sell_transaction_id");

-- CreateIndex
CREATE INDEX "moonpay_offramps_user_id_created_at_idx" ON "moonpay_offramps"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "moonpay_offramps_status_created_at_idx" ON "moonpay_offramps"("status", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "moonpay_webhook_events_moonpay_event_id_key" ON "moonpay_webhook_events"("moonpay_event_id");

-- CreateIndex
CREATE INDEX "moonpay_webhook_events_user_id_received_at_idx" ON "moonpay_webhook_events"("user_id", "received_at" DESC);

-- CreateIndex
CREATE INDEX "moonpay_webhook_events_event_type_received_at_idx" ON "moonpay_webhook_events"("event_type", "received_at" DESC);

-- CreateIndex
CREATE INDEX "moonpay_webhook_events_dispatch_status_received_at_idx" ON "moonpay_webhook_events"("dispatch_status", "received_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "short_links_code_key" ON "short_links"("code");

-- CreateIndex
CREATE INDEX "short_links_tenant_id_created_at_idx" ON "short_links"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "short_links_user_id_created_at_idx" ON "short_links"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "short_links_expires_at_idx" ON "short_links"("expires_at");

-- CreateIndex
CREATE INDEX "knowledge_gaps_tenant_id_status_severity_last_seen_at_idx" ON "knowledge_gaps"("tenant_id", "status", "severity", "last_seen_at" DESC);

-- CreateIndex
CREATE INDEX "knowledge_gaps_tenant_id_kind_status_idx" ON "knowledge_gaps"("tenant_id", "kind", "status");

-- CreateIndex
CREATE INDEX "knowledge_gaps_tool_name_status_idx" ON "knowledge_gaps"("tool_name", "status");

-- CreateIndex
CREATE INDEX "knowledge_gaps_trace_id_idx" ON "knowledge_gaps"("trace_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_gaps_tenant_id_dedup_key_key" ON "knowledge_gaps"("tenant_id", "dedup_key");

-- CreateIndex
CREATE INDEX "bookings_provisionedBy_idx" ON "bookings"("provisionedBy");

-- CreateIndex
CREATE INDEX "bookings_tenantId_destinationCountry_idx" ON "bookings"("tenantId", "destinationCountry");

-- CreateIndex
CREATE INDEX "circle_wallets_address_idx" ON "circle_wallets"("address");

-- CreateIndex
CREATE UNIQUE INDEX "circle_wallets_tenantId_kind_chain_key" ON "circle_wallets"("tenantId", "kind", "chain");

-- CreateIndex
CREATE INDEX "group_trip_passengers_groupTripId_status_idx" ON "group_trip_passengers"("groupTripId", "status");

-- CreateIndex
CREATE INDEX "group_trips_tenantId_status_idx" ON "group_trips"("tenantId", "status");

-- CreateIndex
CREATE INDEX "meter_events_payerType_at_idx" ON "meter_events"("payerType", "at");

-- CreateIndex
CREATE INDEX "meter_events_payerUserId_at_idx" ON "meter_events"("payerUserId", "at");

-- CreateIndex
CREATE INDEX "nft_stamps_chain_idx" ON "nft_stamps"("chain");

-- CreateIndex
CREATE UNIQUE INDEX "nft_stamps_kind_primaryKey_chain_key" ON "nft_stamps"("kind", "primaryKey", "chain");

-- CreateIndex
CREATE INDEX "onchain_identities_chain_idx" ON "onchain_identities"("chain");

-- CreateIndex
CREATE UNIQUE INDEX "onchain_identities_kind_tenantId_chain_key" ON "onchain_identities"("kind", "tenantId", "chain");

-- CreateIndex
CREATE UNIQUE INDEX "onchain_identities_kind_userId_chain_key" ON "onchain_identities"("kind", "userId", "chain");

-- CreateIndex
CREATE INDEX "policies_customerAccountId_idx" ON "policies"("customerAccountId");

-- CreateIndex
CREATE INDEX "slack_installs_revoked_at_idx" ON "slack_installs"("revoked_at");

-- CreateIndex
CREATE INDEX "slack_installs_customerAccountId_idx" ON "slack_installs"("customerAccountId");

-- CreateIndex
CREATE INDEX "trips_tenantId_destinationCountry_idx" ON "trips"("tenantId", "destinationCountry");

-- CreateIndex
CREATE INDEX "trips_customerAccountId_status_idx" ON "trips"("customerAccountId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_circleWalletId_key" ON "wallets"("circleWalletId");

-- CreateIndex
CREATE INDEX "wallets_userId_provisioner_idx" ON "wallets"("userId", "provisioner");

-- CreateIndex
CREATE INDEX "whatsapp_installs_kapsoConnectionId_idx" ON "whatsapp_installs"("kapsoConnectionId");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_installs_tenantId_phoneNumberId_key" ON "whatsapp_installs"("tenantId", "phoneNumberId");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_installs_tenantId_kapsoConnectionId_key" ON "whatsapp_installs"("tenantId", "kapsoConnectionId");

-- AddForeignKey
ALTER TABLE "customer_accounts" ADD CONSTRAINT "customer_accounts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "customer_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "traveler_profiles" ADD CONSTRAINT "traveler_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "traveler_profiles" ADD CONSTRAINT "traveler_profiles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "traveler_taste_entries" ADD CONSTRAINT "traveler_taste_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "traveler_taste_entries" ADD CONSTRAINT "traveler_taste_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "city_bucket_list_items" ADD CONSTRAINT "city_bucket_list_items_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "city_bucket_list_items" ADD CONSTRAINT "city_bucket_list_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anticipation_events" ADD CONSTRAINT "anticipation_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "customer_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "customer_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_gateway_signers" ADD CONSTRAINT "user_gateway_signers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_gateway_signers" ADD CONSTRAINT "tenant_gateway_signers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_solana_gateway_signers" ADD CONSTRAINT "tenant_solana_gateway_signers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_gateway_configs" ADD CONSTRAINT "tenant_gateway_configs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gateway_deposit_logs" ADD CONSTRAINT "gateway_deposit_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gateway_transfer_logs" ADD CONSTRAINT "gateway_transfer_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_access_logs" ADD CONSTRAINT "wallet_access_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_session_verifications" ADD CONSTRAINT "whatsapp_session_verifications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_session_verifications" ADD CONSTRAINT "whatsapp_session_verifications_channelIdentityId_fkey" FOREIGN KEY ("channelIdentityId") REFERENCES "channel_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slack_installs" ADD CONSTRAINT "slack_installs_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "customer_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_flow_registrations" ADD CONSTRAINT "whatsapp_flow_registrations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_outbound_messages" ADD CONSTRAINT "whatsapp_outbound_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slack_webhook_events" ADD CONSTRAINT "slack_webhook_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slack_agent_events" ADD CONSTRAINT "slack_agent_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slack_agent_events" ADD CONSTRAINT "slack_agent_events_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_policies" ADD CONSTRAINT "transfer_policies_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_policies" ADD CONSTRAINT "transfer_policies_travelerId_fkey" FOREIGN KEY ("travelerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_attempts" ADD CONSTRAINT "transfer_attempts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_attempts" ADD CONSTRAINT "transfer_attempts_travelerId_fkey" FOREIGN KEY ("travelerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_handoffs" ADD CONSTRAINT "channel_handoffs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_handoffs" ADD CONSTRAINT "channel_handoffs_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_handoffs" ADD CONSTRAINT "channel_handoffs_channelIdentityId_fkey" FOREIGN KEY ("channelIdentityId") REFERENCES "channel_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_handoffs" ADD CONSTRAINT "channel_handoffs_answeredByUserId_fkey" FOREIGN KEY ("answeredByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_proposals" ADD CONSTRAINT "treasury_proposals_treasuryId_fkey" FOREIGN KEY ("treasuryId") REFERENCES "super_org_treasuries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moonpay_topups" ADD CONSTRAINT "moonpay_topups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moonpay_offramps" ADD CONSTRAINT "moonpay_offramps_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

