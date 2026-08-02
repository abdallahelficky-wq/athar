import React from "react";
import ReactDOM from "react-dom/client";
import MobileApp from "./mobile/MobileApp.jsx";
import { EmployeePortalAuthProvider } from "./mobile/context/EmployeePortalAuthContext.jsx";
import "./mobile/mobile.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <EmployeePortalAuthProvider>
      <MobileApp />
    </EmployeePortalAuthProvider>
  </React.StrictMode>,
);
