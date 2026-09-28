import React from "react";
import {createRoot} from "react-dom/client";
import {MemoryRouter} from "react-router-dom";
import "../../src/i18n";
import "../../src/styles/global.css";
import SuppliersTab from "../../src/wired/purchases/SuppliersTab";
import PurchaseInvoicesTab from "../../src/wired/purchases/PurchaseInvoicesTab";
createRoot(document.getElementById("root")).render(<MemoryRouter><section data-testid="suppliers"><SuppliersTab companyId="c" companies={[]} /></section><section data-testid="purchases"><PurchaseInvoicesTab companyId="c" companies={[]} /></section></MemoryRouter>);
