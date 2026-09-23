import { test } from "node:test";
import assert from "node:assert/strict";
import { itemTaxDefaults, itemDescription, itemMatches } from "./itemDefaults.js";
import { computeInvoiceLine } from "./invoiceLine.js";
test("catalog names are searchable in either language and snapshot together", () => {
 const item={name:"منظف",nameEn:"Cleaner",code:"A1"};
 assert.equal(itemMatches(item,"CLEAN"),true); assert.equal(itemMatches(item,"منظف"),true);
 assert.equal(itemDescription(item),"منظف / Cleaner");
});
test("catalog price basis and zero rate reach invoice totals", () => {
 const line={quantity:1,unitPrice:100,...itemTaxDefaults({taxCategoryCode:"S",priceIncludesVat:false})};
 assert.equal(computeInvoiceLine(line).total,115);
 assert.equal(computeInvoiceLine({...line,...itemTaxDefaults({taxCategoryCode:"Z",vatApplicable:true})}).total,100);
 assert.equal(itemTaxDefaults({vatApplicable:false}).taxCategoryCode,"O");
});
