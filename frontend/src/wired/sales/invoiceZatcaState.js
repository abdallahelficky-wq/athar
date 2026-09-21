// Compliance alone is not clearance/reporting acceptance.
const retryStatuses = new Set(["not_submitted", "rejected", "submission_failed", "certificate_error", "compliance_checked"]);
export function invoiceZatcaState(invoice) {
  const raw = invoice.zatcaResponseRaw;
  const validation = raw && typeof raw === "object" ? raw.validationResults : null;
  const messages = (kind) => (Array.isArray(validation?.[kind]) ? validation[kind] : [])
    .map((item) => typeof item === "string" ? { message: item } : item)
    .filter((item) => item && (typeof item.message === "string" || typeof item.code === "string"))
    .map((item) => ({ code: typeof item.code === "string" ? item.code : "", message: typeof item.message === "string" ? item.message : "" }));
  const warnings = messages("warningMessages");
  const errors = messages("errorMessages");
  const status = ["pending_clearance", "pending_reporting"].includes(invoice.zatcaStatus) ? "not_submitted" : invoice.zatcaStatus;
  const accepted = status === "cleared" || status === "reported";
  const key = accepted ? (warnings.length ? "sent_with_notes" : "sent") : status === "not_applicable" ? "not_applicable" : "not_sent";
  return { key, status, warnings, errors, canResend: invoice.status === "posted" && retryStatuses.has(invoice.zatcaStatus),
    className: `status-badge ${key === "sent" ? "status-posted" : key === "not_applicable" ? "status-neutral" : "status-warning"}` };
}
