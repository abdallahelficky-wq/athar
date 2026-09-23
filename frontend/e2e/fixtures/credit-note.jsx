import React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Routes, Route, Link } from "react-router-dom";
import "../../src/i18n";
import "../../src/styles/global.css";
import InvoiceCreditNotes from "../../src/wired/sales/InvoiceCreditNotes";
import ReturnsTab from "../../src/wired/sales/ReturnsTab";
const companies = [{ id: "company-test", name: "شركة اختبار", currency: "SAR" }];
createRoot(document.getElementById("root")).render(<MemoryRouter initialEntries={["/sales/invoices"]}>
 <Routes><Route path="/sales/invoices" element={<div><Link to="/sales/returns">Open returns</Link><InvoiceCreditNotes invoice={{id:"inv-test",status:"posted",grandTotal:105}} /></div>} />
 <Route path="/sales/returns" element={<ReturnsTab companyId="company-test" companies={companies} />} /></Routes>
</MemoryRouter>);
