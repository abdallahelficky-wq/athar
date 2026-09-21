import { test } from "node:test";
import assert from "node:assert/strict";
import { invoiceZatcaState as state } from "./invoiceZatcaState.js";
test("accepted invoices with warnings are sent with notes and cannot be resent", () => {
 for (const zatcaStatus of ["cleared", "reported"]) {
  const result = state({ status: "posted", zatcaStatus, zatcaResponseRaw: { validationResults: { warningMessages: [{ code: "BR-1", message: "Check buyer" }] } } });
  assert.equal(result.key, "sent_with_notes"); assert.equal(result.canResend, false); assert.equal(result.warnings[0].message, "Check buyer");
  assert.equal(state({ zatcaStatus }).key, "sent");
 }
});
test("compliance and failures are not acceptance; only posted invoices can retry", () => {
 for (const zatcaStatus of ["not_submitted", "rejected", "submission_failed", "certificate_error", "compliance_checked"]) {
  assert.equal(state({ zatcaStatus, status: "posted" }).key, "not_sent");
  assert.equal(state({ zatcaStatus, status: "posted" }).canResend, true);
  assert.equal(state({ zatcaStatus, status: "draft" }).canResend, false);
 }
});
test("non-applicable and unknown statuses are never marked accepted", () => {
 assert.equal(state({ zatcaStatus: "not_applicable" }).key, "not_applicable");
 assert.equal(state({}).key, "not_sent");
 assert.equal(state({ status: "posted", zatcaStatus: "new_status" }).canResend, false);
 assert.equal(state({ zatcaStatus: "pending_reporting" }).key, "not_sent");
});
test("malformed messages cannot crash the view and rejection details remain readable", () => {
 const result = state({ zatcaStatus: "rejected", zatcaResponseRaw: { validationResults: { warningMessages: [null, {}, { message: {} }], errorMessages: ["Rejected", { code: "BR-2", message: "Invalid total" }] } } });
 assert.equal(result.warnings.length, 0); assert.equal(result.errors.length, 2);
 assert.equal(result.errors[1].code, "BR-2");
});
