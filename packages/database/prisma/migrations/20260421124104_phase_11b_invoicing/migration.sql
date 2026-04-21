-- CreateEnum
CREATE TYPE "InvoiceKind" AS ENUM ('booking', 'platform_bill', 'credit_note');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('draft', 'issued', 'sent', 'viewed', 'paid', 'overdue', 'void');

-- AlterTable
ALTER TABLE "meter_events" ADD COLUMN     "invoiceRef" TEXT;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "billingAddress" JSONB,
ADD COLUMN     "billingContactEmail" TEXT,
ADD COLUMN     "brandColors" JSONB,
ADD COLUMN     "brandLogoUrl" TEXT,
ADD COLUMN     "legalName" TEXT,
ADD COLUMN     "taxId" TEXT;

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "InvoiceKind" NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'draft',
    "number" TEXT NOT NULL,
    "issuedAt" TIMESTAMPTZ(6),
    "dueAt" TIMESTAMPTZ(6),
    "paidAt" TIMESTAMPTZ(6),
    "fromName" TEXT NOT NULL,
    "fromAddress" JSONB,
    "fromTaxId" TEXT,
    "fromLogoUrl" TEXT,
    "toName" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "toAddress" JSONB,
    "toTaxId" TEXT,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "subtotalMicro" BIGINT NOT NULL DEFAULT 0,
    "discountMicro" BIGINT NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "taxAmountMicro" BIGINT NOT NULL DEFAULT 0,
    "vatRate" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "vatAmountMicro" BIGINT NOT NULL DEFAULT 0,
    "totalMicro" BIGINT NOT NULL DEFAULT 0,
    "template" JSONB NOT NULL,
    "bookingId" TEXT,
    "periodStart" TIMESTAMPTZ(6),
    "periodEnd" TIMESTAMPTZ(6),
    "cfdiRef" TEXT,
    "pdfBlobUrl" TEXT,
    "pdfRenderedAt" TIMESTAMPTZ(6),
    "publicToken" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_line_items" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL DEFAULT 1,
    "unitPriceMicro" BIGINT NOT NULL,
    "amountMicro" BIGINT NOT NULL,
    "sourceKind" TEXT,
    "sourceRef" TEXT,

    CONSTRAINT "invoice_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_payments" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "paidAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amountMicro" BIGINT NOT NULL,
    "method" TEXT NOT NULL,
    "txHash" TEXT,
    "reference" TEXT,

    CONSTRAINT "invoice_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_sequences" (
    "tenantId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "nextSeq" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "invoice_sequences_pkey" PRIMARY KEY ("tenantId","year")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoices_bookingId_key" ON "invoices"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_publicToken_key" ON "invoices"("publicToken");

-- CreateIndex
CREATE INDEX "invoices_tenantId_status_createdAt_idx" ON "invoices"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "invoices_kind_periodStart_idx" ON "invoices"("kind", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_tenantId_number_key" ON "invoices"("tenantId", "number");

-- CreateIndex
CREATE INDEX "invoice_line_items_invoiceId_position_idx" ON "invoice_line_items"("invoiceId", "position");

-- CreateIndex
CREATE INDEX "invoice_payments_invoiceId_paidAt_idx" ON "invoice_payments"("invoiceId", "paidAt");

-- CreateIndex
CREATE INDEX "meter_events_tenantId_status_invoiceRef_idx" ON "meter_events"("tenantId", "status", "invoiceRef");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

