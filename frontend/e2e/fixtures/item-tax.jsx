import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/i18n";
import "../../src/styles/global.css";
import ItemsTab from "../../src/wired/inventory/ItemsTab";
import SalesInvoiceLinesEditor, { emptySalesLine } from "../../src/wired/sales/SalesInvoiceLinesEditor";
import { MemoryRouter } from "react-router-dom";
const items=[{id:"item1",name:"منظف",nameEn:"Cleaner",type:"service",salePrice:100,priceIncludesVat:false,taxCategoryCode:"S",revenueAccountId:"rev"}];
function App(){const [lines,setLines]=useState([emptySalesLine()]);return <MemoryRouter><ItemsTab companyId="company-test" /><section data-testid="invoice"><SalesInvoiceLinesEditor lines={lines} setLines={setLines} items={items} accounts={[]} onRequestNewItem={()=>{}} /></section></MemoryRouter>;}
createRoot(document.getElementById("root")).render(<App />);
