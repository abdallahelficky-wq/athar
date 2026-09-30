import type { RequestHandler } from "express";
import { prisma } from "../lib/prisma";
import { forbidden, unauthorized } from "../lib/httpError";
import { MATRIX_MARKER, POSITION_RESOURCES, type MatrixAction } from "../lib/positionMatrix";
import { matrixAuthorizedRequests, matrixHrAccess } from "../lib/matrixAuthorization";
import { isTenantOwner } from "./auth";

/** Explicit route-level checks: never infer accounting approval from an HTTP verb. */
export function requirePositionAction(resourceId: string, action: MatrixAction): RequestHandler {
  if (!POSITION_RESOURCES.some((r) => r.id === resourceId && r.actions.includes(action))) {
    throw new Error(`Unregistered position permission: ${resourceId}/${action}`);
  }
  return async (req, _res, next) => {
    matrixAuthorizedRequests.delete(req);
    const auth = req.auth;
    if (!auth) throw unauthorized();
    if (auth.role === "super_admin" || await isTenantOwner(auth)) {
      matrixAuthorizedRequests.add(req);
      return next();
    }
    // Read the current assignment on every request; a stale token cannot retain a removed grant.
    const user = await prisma.user.findFirst({
      where: { id: auth.sub, tenantId: auth.tenantId },
      select: { position: { select: { tenantId: true, permissions: {
        where: { moduleId: { in: [MATRIX_MARKER, `matrix:${resourceId}`, "matrix:hrSensitiveData"] } },
      } } } },
    });
    if (!user) throw unauthorized();
    const position = user.position;
    if (position && position.tenantId !== auth.tenantId) throw forbidden();
    // Existing positions remain on their old policy until their owner explicitly saves a matrix.
    if (!position?.permissions.some((p) => p.moduleId === MATRIX_MARKER)) return next();
    matrixHrAccess.set(auth, position.permissions.some((p) => p.moduleId === "matrix:hrSensitiveData" && p.canRead));
    const permission = position.permissions.find((p) => p.moduleId === `matrix:${resourceId}`);
    const allowed = action === "edit"
      ? (permission?.extra as Record<string, unknown> | null)?.edit === true
      : permission?.[({ read: "canRead", create: "canCreate", delete: "canDelete", approve: "canApprove" } as const)[action]] === true;
    if (!allowed) throw forbidden("المنصب المسند لحسابك لا يسمح بهذا الإجراء");
    // Replaces only legacy role checks on this explicitly protected request.
    // Company scopes, read-only subscriptions, owner checks, and special grants still apply.
    matrixAuthorizedRequests.add(req);
    next();
  };
}

export function requirePositionPosting(resourceId: string, defaultPost = false): RequestHandler {
  const check = requirePositionAction(resourceId, "approve");
  return (req, res, next) => {
    const posts = defaultPost ? req.body?.post !== false : req.body?.post === true || req.body?.status === "posted";
    return posts ? check(req, res, next) : next();
  };
}
