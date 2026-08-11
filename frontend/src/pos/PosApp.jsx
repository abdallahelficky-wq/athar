import React, { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useCompanies } from "../wired/useCompanies";
import PosLoginScreen from "./screens/PosLoginScreen";
import SaleScreen from "./screens/SaleScreen";
import PaymentScreen from "./screens/PaymentScreen";
import ReceiptScreen from "./screens/ReceiptScreen";
import PrinterSettingsScreen from "./screens/PrinterSettingsScreen";

function PosShell() {
  const { user, logout } = useAuth();
  const { companies, companyId, setCompanyId, loading: companiesLoading } = useCompanies();

  const [screen, setScreen] = useState("sale"); // sale | payment | receipt | settings
  const [cart, setCart] = useState([]); // [{ itemId, name, unitPrice, quantity, accountId, vatApplicable }]
  const [customer, setCustomer] = useState(null); // null = عميل نقدي افتراضي
  const [lastSale, setLastSale] = useState(null); // { invoice, payments }

  if (companiesLoading) return <div className="pos-loading">جارٍ التحميل...</div>;
  if (!companyId) {
    return (
      <div className="pos-loading">
        <p>أنشئ شركة أولاً من التطبيق الرئيسي قبل استخدام نقطة البيع.</p>
      </div>
    );
  }

  const activeCompany = companies.find((c) => c.id === companyId);

  const resetCart = () => {
    setCart([]);
    setCustomer(null);
  };

  const onSaleCompleted = (result) => {
    setLastSale(result);
    setScreen("receipt");
  };

  const startNewSale = () => {
    resetCart();
    setLastSale(null);
    setScreen("sale");
  };

  return (
    <div className="pos-app">
      <div className="pos-topbar">
        <div className="pos-topbar-company">
          {activeCompany?.name}
          {companies.length > 1 && (
            <select className="pos-company-select" value={companyId} onChange={(e) => { setCompanyId(e.target.value); resetCart(); }}>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
        </div>
        <div className="pos-topbar-actions">
          <span className="pos-user-name">{user?.name}</span>
          <button className="pos-icon-btn" title="إعدادات الطابعة" onClick={() => setScreen("settings")}>⚙</button>
          <button className="pos-icon-btn" title="تسجيل الخروج" onClick={logout}>⎋</button>
        </div>
      </div>

      <div className="pos-body">
        {screen === "sale" && (
          <SaleScreen
            companyId={companyId}
            cart={cart}
            setCart={setCart}
            customer={customer}
            setCustomer={setCustomer}
            onProceedToPayment={() => setScreen("payment")}
          />
        )}
        {screen === "payment" && (
          <PaymentScreen
            companyId={companyId}
            cart={cart}
            customer={customer}
            onBack={() => setScreen("sale")}
            onCompleted={onSaleCompleted}
          />
        )}
        {screen === "receipt" && lastSale && (
          <ReceiptScreen company={activeCompany} sale={lastSale} onNewSale={startNewSale} />
        )}
        {screen === "settings" && <PrinterSettingsScreen onClose={() => setScreen("sale")} />}
      </div>
    </div>
  );
}

// نفس نمط App.jsx الرئيسي: useCompanies (وأي نداء API آخر يعتمد على وجود جلسة) لا يُستدعى إلا
// بعد التأكد فعلياً من تسجيل الدخول — مكوّن منفصل بدل مجرد "if" داخل نفس المكوّن، حتى لا يُستدعى
// hook الشركات أصلاً قبل توفّر رمز الدخول (كان يسبّب طلب GET /companies فاشلاً بـ401 لحظة أول
// تحميل للصفحة، قبل ظهور شاشة الدخول حتى).
export default function PosApp() {
  const { isAuthenticated, initializing } = useAuth();
  if (initializing) return null;
  if (!isAuthenticated) return <PosLoginScreen />;
  return <PosShell />;
}
