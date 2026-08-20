import React from "react";
import ReactDOM from "react-dom/client";
import PosApp from "./pos/PosApp.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import "./i18n";
import "./pos/pos.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AuthProvider>
      <PosApp />
    </AuthProvider>
  </React.StrictMode>,
);
