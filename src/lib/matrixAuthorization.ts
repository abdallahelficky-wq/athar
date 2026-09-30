import type { Request } from "express";
// Server-only evidence. Cannot be supplied through a body, query, or JWT claim.
export const matrixAuthorizedRequests = new WeakSet<Request>();

export const matrixHrAccess = new WeakMap<object, boolean>();
