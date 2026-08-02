import type { AccessTokenPayload, EmployeePortalTokenPayload } from "../lib/jwt";

declare global {
  namespace Express {
    interface Request {
      auth?: AccessTokenPayload;
      /** هوية موظف عبر بوابة الجوال المنفصلة — لا علاقة لها بـ req.auth الإداري */
      employeeAuth?: EmployeePortalTokenPayload;
    }
  }
}

export {};
