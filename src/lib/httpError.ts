export class HttpError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, details);
export const unauthorized = (message = "غير مصرح") => new HttpError(401, message);
export const forbidden = (message = "لا تملك صلاحية تنفيذ هذا الإجراء") => new HttpError(403, message);
export const notFound = (message = "العنصر غير موجود") => new HttpError(404, message);
export const conflict = (message: string) => new HttpError(409, message);
