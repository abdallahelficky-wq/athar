import React, { useState } from "react";
import { createPosSale } from "../../api/pos";
import { fmt2 } from "../../legacy/constants";

const METHOD_LABEL = { cash: "نقدي", bank: "بطاقة/تحويل بنكي" };

export default function PaymentScreen({ companyId, warehouseId, cart, customer, onBack, onCompleted }) {
  const total = cart.reduce((s, l) => s + l.unitPrice * l.quantity, 0);

  // payments[method] = المبلغ المُدخَل لهذه الطريقة (نص خام أثناء الكتابة، يُحوَّل رقماً عند الإرسال)
  const [cashAmount, setCashAmount] = useState(String(total.toFixed(2)));
  const [bankAmount, setBankAmount] = useState("0");
  const [cashReceived, setCashReceived] = useState("");
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

  const submit = async () => {
    if (!sumMatches) { setError(`مجموع الدفعات (${fmt2(paymentsSum)}) لا يطابق الإجمالي (${fmt2(total)})`); return; }
    setSubmitting(true);
    setError("");
    try {
      const payments = [];
      if (cashNum > 0) payments.push({ method: "cash", amount: cashNum });
      if (bankNum > 0) payments.push({ method: "bank", amount: bankNum });

      const result = await createPosSale({
        companyId,
        warehouseId,
        customerId: customer?.id || undefined,
        lines: cart.map((l) => ({
          accountId: l.accountId, itemId: l.itemId, description: l.name,
          quantity: l.quantity, unitPrice: l.unitPrice, vatApplicable: l.vatApplicable,
        })),
        payments,
      });
      onCompleted({ ...result, payments, receivedCash: cashNum > 0 ? receivedNum : null, change: cashNum > 0 ? change : null });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="pos-payment-screen">
      <div className="pos-payment-total">
        <span>الإجمالي المطلوب</span>
        <strong>{fmt2(total)}</strong>
      </div>

      <div className="pos-payment-quick-row">
        <button className="m-btn secondary" onClick={setFullCash}>الكل نقدي</button>
        <button className="m-btn secondary" onClick={setFullBank}>الكل بطاقة/بنك</button>
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
          {remaining > 0 ? `متبقٍّ ${fmt2(remaining)} لم يُدخَل بعد` : `المُدخَل أكثر من الإجمالي بمقدار ${fmt2(-remaining)}`}
        </p>
      )}

      {cashNum > 0 && (
        <div className="pos-cash-tender-box">
          <label className="m-field">
            المبلغ المستلم من العميل نقداً
            <input type="number" inputMode="decimal" value={cashReceived} onChange={(e) => setCashReceived(e.target.value)} placeholder={cashAmount} />
          </label>
          {receivedTooLittle && <p className="m-error">المبلغ المستلم أقل من قيمة الدفعة النقدية</p>}
          {!receivedTooLittle && cashReceived !== "" && (
            <div className="pos-change-row"><span>الباقي للعميل</span><strong>{fmt2(change)}</strong></div>
          )}
        </div>
      )}

      {error && <p className="m-error">{error}</p>}

      <div className="pos-payment-actions">
        <button className="m-btn secondary" onClick={onBack} disabled={submitting}>رجوع</button>
        <button className="pos-big-btn" onClick={submit} disabled={submitting || !sumMatches || receivedTooLittle}>
          {submitting ? "جارٍ الإتمام..." : "إتمام البيع"}
        </button>
      </div>
    </div>
  );
}
