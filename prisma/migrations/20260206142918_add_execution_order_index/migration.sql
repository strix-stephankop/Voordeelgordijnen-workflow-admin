-- CreateTable
CREATE TABLE "ExecutionOrder" (
    "executionId" TEXT NOT NULL PRIMARY KEY,
    "orderNumber" TEXT,
    "workflowId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" DATETIME,
    "stoppedAt" DATETIME,
    "mode" TEXT
);

-- CreateIndex
CREATE INDEX "ExecutionOrder_orderNumber_idx" ON "ExecutionOrder"("orderNumber");
