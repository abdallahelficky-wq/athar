import { Router, RequestHandler } from "express";
import { authenticateEmployeePortal, authenticateStationUser } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { employeePortalLoginSchema } from "./employeePortal.schemas";
import { login, me, stationMe } from "./employeePortal.controller";
import { portalTokenKind } from "../../lib/jwt";

export const employeePortalRoutes = Router();

employeePortalRoutes.post("/login", validateBody(employeePortalLoginSchema), login);

// /me لنفس تطبيق الجوال: رمز مستخدم محطات ← ملفه (kind=station)، وإلا ملف الموظف. كل فرع يتحقق من رمزه بوسيطه المختص
const byTokenKind = (station: RequestHandler[], employee: RequestHandler[]): RequestHandler => (req, res, next) => {
  const header = req.headers.authorization ?? "";
  const chain = header.startsWith("Bearer ") && portalTokenKind(header.slice(7)) === "station" ? station : employee;
  const run = (i: number): unknown => (i < chain.length ? Promise.resolve(chain[i](req, res, (err?: unknown) => (err ? next(err) : run(i + 1)))).catch(next) : undefined);
  run(0);
};
employeePortalRoutes.get("/me", byTokenKind([authenticateStationUser, stationMe], [authenticateEmployeePortal, me]));
