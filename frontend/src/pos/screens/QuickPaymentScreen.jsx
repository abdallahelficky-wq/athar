import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { createPosSale } from "../../api/pos";
import { fmt2 } from "../../legacy/constants";

const FALLBACK_DUE_DAYS = 30;

// تاريخ استحقاق مقترح دائماً بلا حقل فارغ: مدة الشركة الافتراضية إن كانت مضبوطة، وإلا 30 يوماً —
// رفض الخادم على البيع الآجل بلا dueDate (pos.schemas.ts) خط دفاع أخير، لا سلوكاً يُفترض أن يراه
// الكاشير في الاستخدام الطبيعي؛ الحقل يبقى قابلاً للتعديل لكنه لا يبدأ فارغاً أبداً.
function computeDefaultDueDate(company) {
  const days = company?.defaultDueDays || FALLBACK_DUE_DAYS;
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * خطوة الدفع الخاصة بشاشة البيع السريعة فقط — مكوّن منفصل تماماً عن PaymentScreen.jsx (لا تعديل
 * عليها ولا خطر على SaleScreen الحالية). يضيف خيار "آجل" (بلا أي دفعة، يُقيَّد على ذمة العميل)
 * بجانب "دفع كامل الآن" (نفس منطق PaymentScreen: نقدي/بطاقة، تحقق تطابق المجموع، حساب الباقي).
 * الآجل متاح فقط لعميل حقيقي محدَّد (customer غير null) — مطابقةً لقاعدة pos.service.ts نفسها.
 */
export default function QuickPaymentScreen({ company, companyId, warehouseId, cart, customer, onBack, onCompleted }) {
  const { t } = useTranslation();
  const METHOD_LABEL = { cash: t("pos.payment.methodCash"), bank: t("pos.payment.methodBank") };
  const total = cart.reduce((s, l) => s + l.unitPrice * l.quantity, 0);

  const hasRealCustomer = Boolean(customer?.id);

  const [mode, setMode] = useState("full"); // full | deferred
  const [cashAmount, setCashAmount] = useState(String(total.toFixed(2)));
  const [bankAmount, setBankAmount] = useState("0");
  const [cashReceived, setCashReceived] = useState("");
  const [dueDate, setDueDate] = useState(() => computeDefaultDueDate(company));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const cashNum = Number(cashAmount) || 0;
  const bankNum = Number(bankAmount) || 0;
  const paymentsSum = cashNum + bankNum;
  const remaining = Math.round((total - paymentsSum) * 100) / 100;
  const sumMatches = Math.abs(remaining) < 0.01;

  const receivedNum = Number(cashReceived) || 0;
  const change = cashNum > 0 ? Math.max(0, receivedNum - cashNum) : 0;
  const receivedTooLittle = cashNum > 0 && cashReceived !== "" && receivedNum < cashNum;

  const setFullCash = () => { setCashAmount(total.toFixed(2)); setBankAmount("0"); };
  const setFullBank = () => { setCashAmount("0"); setBankAmount(total.toFixed(2)); };

  const canSubmit = mode === "full" ? (sumMatches && !receivedTooLittle) : (hasRealCustomer && Boolean(dueDate));

  const submit = async () => {
    if (mode === "full" && !sumMatches) {
      setError(t("pos.payment.sumMismatchError", { sum: fmt2(paymentsSum), total: fmt2(total) }));
      return;
    }
    if (mode === "deferred" && !hasRealCustomer) {
      setError(t("pos.quickPayment.deferredRequiresCustomer"));
      return;
    }
    if (mode === "deferred" && !dueDate) {
      setError(t("pos.quickPayment.dueDateRequiredError"));
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const payments = [];
      if (mode === "full") {
        if (cashNum > 0) payments.push({ method: "cash", amount: cashNum });
        if (bankNum > 0) payments.push({ method: "bank", amount: bankNum });
      }

      const result = await createPosSale({
        companyId,
        warehouseId,
        customerId: customer?.id || undefined,
        lines: cart.map((l) => ({
          accountId: l.accountId, itemId: l.itemId, description: l.name,
          quantity: l.quantity, unitPrice: l.unitPrice, vatApplicable: l.vatApplicable,
        })),
        payments,
        dueDate: mode === "deferred" ? dueDate : undefined,
      });
      onCompleted({
        ...result,
        payments,
        receivedCash: mode === "full" && cashNum > 0 ? receivedNum : null,
        change: mode === "full" && cashNum > 0 ? change : null,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="pos-payment-screen">
      <div className="pos-payment-total">
        <span>{t("pos.payment.totalDue")}</span>
        <strong>{fmt2(total)}</strong>
      </div>

      <div className="pos-payment-mode-row">
        <button
          className={`m-btn ${mode === "full" ? "" : "secondary"}`}
          onClick={() => setMode("full")}
        >
          {t("pos.quickPayment.fullPaymentTab")}
        </button>
        <button
          className={`m-btn ${mode === "deferred" ? "" : "secondary"}`}
          onClick={() => setMode("deferred")}
          disabled={!hasRealCustomer}
        >
          {t("pos.quickPayment.deferredTab")}
        </button>
      </div>

      {!hasRealCustomer && <p className="pos-payment-mode-hint">{t("pos.quickPayment.selectCustomerToDefer")}</p>}

      {mode === "full" && (
        <>
          <div className="pos-payment-quick-row">
            <button className="m-btn secondary" onClick={setFullCash}>{t("pos.payment.allCash")}</button>
            <button className="m-btn secondary" onClick={setFullBank}>{t("pos.payment.allBank")}</button>
          </div>

          <label className="m-field">
            {METHOD_LABEL.cash}
            <input type="number" inputMode="decimal" value={cashAmount} onChange={(e) => setCashAmount(e.target.value)} />
          </label>
          <label className="m-field">
            {METHOD_LABEL.bank}
            <input type="number" inputMode="decimal" value={bankAmount} onChange={(e) => setBankAmount(e.target.value)} />
          </label>

          {!sumMatches && (
            <p className="m-error">
              {remaining > 0 ? t("pos.payment.remainingNote", { amount: fmt2(remaining) }) : t("pos.payment.overpaidNote", { amount: fmt2(-remaining) })}
            </p>
          )}

          {cashNum > 0 && (
            <div className="pos-cash-tender-box">
              <label className="m-field">
                {t("pos.payment.receivedCashLabel")}
                <input type="number" inputMode="decimal" value={cashReceived} onChange={(e) => setCashReceived(e.target.value)} placeholder={cashAmount} />
              </label>
              {receivedTooLittle && <p className="m-error">{t("pos.payment.receivedTooLittle")}</p>}
              {!receivedTooLittle && cashReceived !== "" && (
                <div className="pos-change-row"><span>{t("pos.payment.changeLabel")}</span><strong>{fmt2(change)}</strong></div>
              )}
            </div>
          )}
        </>
      )}

      {mode === "deferred" && hasRealCustomer && (
        <label className="m-field">
          {t("pos.quickPayment.dueDateLabel")}
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </label>
      )}

      {error && <p className="m-error">{error}</p>}

      <div className="pos-payment-actions">
        <button className="m-btn secondary" onClick={onBack} disabled={submitting}>{t("pos.payment.back")}</button>
        <button className="pos-big-btn" onClick={submit} disabled={submitting || !canSubmit}>
          {submitting ? t("pos.payment.submitting") : t("pos.payment.submitBtn")}
        </button>
      </div>
    </div>
  );
}
