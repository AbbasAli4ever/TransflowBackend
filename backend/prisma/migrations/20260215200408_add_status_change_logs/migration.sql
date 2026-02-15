-- CreateTable
CREATE TABLE "status_change_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "previous_status" TEXT NOT NULL,
    "new_status" TEXT NOT NULL,
    "reason" TEXT,
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "status_change_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "status_change_logs_tenant_id_entity_type_entity_id_idx" ON "status_change_logs"("tenant_id", "entity_type", "entity_id");
