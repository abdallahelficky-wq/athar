import type { AccessTokenPayload, EmployeePortalTokenPayload } from "../lib/jwt";

declare global {
  namespace Express {
    interface Request {
      auth?: AccessTokenPayload;
      /** هوية موظف عبر بوابة الجوال المنفصلة — لا علاقة لها بـ req.auth الإداري */
      employeeAuth?: EmployeePortalTokenPayload;
      /** لغة الاستجابة، مُحدَّدة عبر middleware/language.ts من رأس Accept-Language — تُضبَط دائماً
       * (بافتراض "ar") قبل وصول أي راوت، فلا حاجة لتصريحها اختيارية */
      lang: "ar" | "en";
    }
  }
}

export {};
