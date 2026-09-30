import React from "react";
import { createRoot } from "react-dom/client";
import "../../src/i18n";
import "../../src/styles/global.css";
import { AuthProvider } from "../../src/context/AuthContext";
import UsersTab from "../../src/wired/UsersTab";
const companies = [{ id: "company-a", name: "شركة أ" }];
createRoot(document.getElementById("root")).render(<AuthProvider><div className="settings-page"><UsersTab realCompanies={companies} /></div></AuthProvider>);
