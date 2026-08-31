-- CreateEnum
CREATE TYPE "PermissionLevel" AS ENUM ('none', 'read', 'edit', 'approve', 'full');

-- CreateTable
CREATE TABLE "position_action_permissions" (
    "id" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "level" "PermissionLevel" NOT NULL DEFAULT 'none',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "position_action_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_action_permission_overrides" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "level" "PermissionLevel" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_action_permission_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "position_action_permissions_positionId_moduleId_actionId_key" ON "position_action_permissions"("positionId", "moduleId", "actionId");

-- CreateIndex
CREATE UNIQUE INDEX "user_action_permission_overrides_userId_moduleId_actionId_key" ON "user_action_permission_overrides"("userId", "moduleId", "actionId");

-- AddForeignKey
ALTER TABLE "position_action_permissions" ADD CONSTRAINT "position_action_permissions_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "positions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_action_permission_overrides" ADD CONSTRAINT "user_action_permission_overrides_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
