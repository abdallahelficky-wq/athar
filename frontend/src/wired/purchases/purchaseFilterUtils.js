const text = (value) => String(value ?? "").trim().toLocaleLowerCase();
const matches = (values, query) => values.some(value => text(value).includes(text(query)));
export function filterSuppliers(rows, f) {
 return rows.filter(s => matches([s.name,s.vatNumber,s.crNumber,s.phone,s.email,s.city],f.search) && (!f.city || s.city === f.city) && (!f.terms || s.paymentTerms === f.terms));
}
export function filterPurchases(rows, f) {
 return rows.filter(inv => matches([inv.invoiceNumber,inv.supplier?.name,inv.supplier?.vatNumber],f.search) && (!f.supplier || inv.supplierId === f.supplier) && (!f.status || inv.status === f.status) && (!f.from || inv.date.slice(0,10) >= f.from) && (!f.to || inv.date.slice(0,10) <= f.to));
}
