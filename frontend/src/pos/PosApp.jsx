import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import { useCompanies } from "../wired/useCompanies";
import { listWarehouses } from "../api/warehouses";
import { loadPosWarehouseId, savePosWarehouseId } from "./posWarehouseSettings";
import LanguageSwitcher from "../wired/shared/LanguageSwitcher";
import PosLoginScreen from "./screens/PosLoginScreen";
import SaleScreen from "./screens/SaleScreen";
import PaymentScreen from "./screens/PaymentScreen";
import ReceiptScreen from "./screens/ReceiptScreen";
import PosSettingsScreen from "./screens/PosSettingsScreen";

function PosShell() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const { companies, companyId, setCompanyId, loading: companiesLoading } = useCompanies();

  const [screen, setScreen] = useState("sale"); // sale | payment | receipt | settings
  const [cart, setCart] = useState([]); // [{ itemId, name, unitPrice, quantity, accountId, vatApplicable }]
  const [customer, setCustomer] = useState(null); // null = عميل نقدي افتراضي
  const [lastSale, setLastSale] = useState(null); // { invoice, payments }

  // المستودع المرتبط بهذا الجهاز لهذه الشركة تحديداً — يُحمَّل من إعدادات الجهاز المحلية، ويُعاد
  // تحميله كلما تغيّرت الشركة النشطة (كل شركة لها إعداد مستودع مستقل). لو للشركة مستودع واحد بس،
  // يُختار تلقائياً بلا أي تدخّل، ويُحفَظ محلياً فوراً حتى لا يتكرر هذا الاستعلام كل مرة.
  const [warehouses, setWarehouses] = useState(null); // null = جارٍ التحميل، [] = لا يوجد مستودع
  const [warehouseId, setWarehouseIdState] = useState(null);

  useEffect(() => {
    if (!companyId) return;
    setWarehouses(null);
    setWarehouseIdState(loadPosWarehouseId(companyId));
    listWarehouses(companyId)
      .then((list) => {
        const active = list.filter((w) => !w.isArchived);
        setWarehouses(active);
        if (active.length === 1 && !loadPosWarehouseId(companyId)) {
          savePosWarehouseId(companyId, active[0].id);
          setWarehouseIdState(active[0].id);
        }
      })
      .catch(() => setWarehouses([]));
  }, [companyId]);

  const refreshWarehouseId = () => setWarehouseIdState(loadPosWarehouseId(companyId));

  if (companiesLoading) return <div className="pos-loading">{t("common.loading")}</div>;
  if (!companyId) {
    return (
      <div className="pos-loading">
        <p>{t("pos.noCompany")}</p>
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

  const closeSettings = () => {
    refreshWarehouseId();
    setScreen("sale");
  };

  const warehouseReady = warehouses !== null && warehouses.length > 0 && Boolean(warehouseId);
  const warehouseMissing = warehouses !== null && warehouses.length > 0 && !warehouseId;
  const noWarehouseAtAll = warehouses !== null && warehouses.length === 0;

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
          <LanguageSwitcher className="pos-icon-btn" />
          <button className="pos-icon-btn" title={t("pos.settingsIconTitle")} onClick={() => setScreen("settings")}>⚙</button>
          <button className="pos-icon-btn" title={t("pos.logoutIconTitle")} onClick={logout}>⎋</button>
        </div>
      </div>

      <div className="pos-body">
        {screen !== "settings" && warehouses === null && <div className="pos-loading">{t("common.loading")}</div>}

        {screen !== "settings" && noWarehouseAtAll && (
          <div className="pos-loading">
            <p>{t("pos.noWarehouseAtAll")}</p>
          </div>
        )}

        {screen !== "settings" && warehouseMissing && (
          <div className="pos-loading">
            <p>{t("pos.warehouseMissing")}</p>
            <button className="pos-big-btn" onClick={() => setScreen("settings")}>{t("pos.openSettingsBtn")}</button>
          </div>
        )}

        {screen === "sale" && warehouseReady && (
          <SaleScreen
            companyId={companyId}
            cart={cart}
            setCart={setCart}
            customer={customer}
            setCustomer={setCustomer}
            onProceedToPayment={() => setScreen("payment")}
          />
        )}
        {screen === "payment" && warehouseReady && (
          <PaymentScreen
            companyId={companyId}
            warehouseId={warehouseId}
            cart={cart}
            customer={customer}
            onBack={() => setScreen("sale")}
            onCompleted={onSaleCompleted}
          />
        )}
        {screen === "receipt" && lastSale && (
          <ReceiptScreen company={activeCompany} sale={lastSale} onNewSale={startNewSale} />
        )}
        {screen === "settings" && <PosSettingsScreen companyId={companyId} onClose={closeSettings} />}
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
