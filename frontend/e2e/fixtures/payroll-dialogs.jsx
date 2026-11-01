import React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import "../../src/i18n";
import "../../src/styles/global.css";
import { AuthProvider } from "../../src/context/AuthContext";
import PayrollTab from "../../src/wired/hr/PayrollTab";
createRoot(document.getElementById("root")).render(<MemoryRouter><AuthProvider><PayrollTab companyId="test-company" companies={[{id:"test-company",name:"شركة اختبار"}]}/></AuthProvider></MemoryRouter>);