import React from "react";
import ReactDOM from "react-dom/client";
import StoreApp from "./store/StoreApp.jsx";
import "./store/store.css";

// واجهة المتجر الإلكتروني العام — نقطة دخول مستقلة (store.html) بلا AuthProvider ولا i18n التطبيق:
// زائر المتجر ليس مستخدماً في أثر، ولا تُحمَّل له شيفرة النظام المحاسبي.
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <StoreApp />
  </React.StrictMode>,
);
