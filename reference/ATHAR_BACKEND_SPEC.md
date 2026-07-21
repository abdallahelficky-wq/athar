# مستند المواصفات الفنية — بناء الـ Backend الحقيقي لنظام "أثر المحاسبي"

**الغرض من هذا المستند:** هذا مستند تسليم فني (Technical Handoff Spec) مُعَد للعمل مع Claude Code أو أي فريق تطوير، لبناء الـ backend الحقيقي (قاعدة بيانات + API + مصادقة + تكاملات خارجية) الذي يحل محل الحالة الحالية القائمة بالكامل على الواجهة الأمامية (frontend-only prototype).

**المرجع الحي:** يوجد بروتوتايب أمامي كامل وشغّال (ملف React واحد `AtharAlMuhasabi.jsx` + نسخة `index.html` قائمة بذاتها) يحتوي على **كل منطق العمل والحسابات والشاشات** المطلوبة. هذا المستند لا يعيد اختراع المنطق، بل يوثّقه بدقة ليُبنى عليه backend حقيقي. **يجب على من يعمل على هذه المهمة قراءة الملف المرجعي أولاً** واستخراج أي تفصيل غير واضح هنا منه مباشرة، لأنه يمثّل مصدر الحقيقة (source of truth) لسلوك النظام.

---

## 1. نظرة عامة على المشروع

نظام محاسبي سحابي متعدد الشركات (Multi-company) لمجموعة تجارية سعودية، ومصمَّم لاحقاً ليكون منتج SaaS متعدد المستأجرين (Multi-tenant) قابل للبيع كاشتراك شهري. يغطي:

- المحاسبة العامة (القيود، شجرة الحسابات، التقارير المالية)
- المبيعات (عملاء، عروض أسعار، فواتير ضريبية متوافقة مع زاتكا، مردودات، سندات قبض)
- المشتريات (موردون، فواتير، مردودات)
- المخزون (أصناف، حركات إدخال/إخراج/صرف/تحويل بين الفروع)
- الأصول الثابتة (سجل، إهلاك شهري، استبعاد/بيع)
- شئون الموظفين (ملفات، إجازات، إجراءات، رواتب، نهاية خدمة، مستندات ومتابعة انتهائها)
- الإعدادات (بيانات الشركات، المستخدمون والصلاحيات، شجرة الحسابات، المواقع)
- موقع تسويقي عام + تسجيل دخول/تسجيل حساب جديد

---

## 2. التقنية المقترحة (Stack)

هذا اقتراح معقول وليس إلزامياً — لفريق التطوير حرية الاختيار حسب خبرته، لكن التالي يناسب حجم المشروع وسرعة الإنجاز مع Claude Code:

| الطبقة | الاقتراح | السبب |
|---|---|---|
| Backend Framework | Node.js + Express أو Next.js (App Router + Route Handlers) | يسمح بمشاركة الأنواع (types) مع الواجهة الأمامية بسهولة إن أُعيد بناؤها بـ TypeScript |
| قاعدة البيانات | PostgreSQL | نضج، دعم ممتاز للمعاملات (transactions) اللازمة للقيود المزدوجة |
| ORM | Prisma | migrations واضحة، وتوليد أنواع تلقائي |
| المصادقة | JWT (access + refresh token) أو NextAuth | مع تشفير كلمات المرور بـ bcrypt/argon2 |
| البريد الإلكتروني | Resend أو Amazon SES أو SendGrid | لإرسال دعوات المستخدمين وروابط تفعيل الحساب فعلياً |
| بوابة الدفع | Moyasar أو Tap أو PayTabs (بوابات سعودية/خليجية) | لتحصيل قيمة الباقات الشهرية (٥٠٠/١٠٠٠/١٥٠٠ ريال) |
| الاستضافة | خادم داخل المملكة أو مزوّد ملتزم بنظام حماية البيانات الشخصية (PDPL) الصادر عن SDAIA | بما أن البيانات مالية وحساسة |
| رمز QR للفواتير | مكتبة `qrcode` (مستخدمة بالفعل في الواجهة) لتوليد الصورة، وسيرفر التوقيع الفعلي عند الربط مع فاتورة (انظر القسم 8) |
| توليد ملفات Excel | مكتبة `xlsx` (SheetJS) — مستخدمة بالفعل في الواجهة للاستيراد والتصدير |

---

## 3. مبدأ العمل الأساسي: القيد المزدوج (Double-Entry) كمصدر حقيقة واحد

**هذا أهم مبدأ في النظام بأكمله ويجب الحفاظ عليه حرفياً:**

كل معاملة مالية في أي موديول (فاتورة مبيعات، فاتورة مشتريات، راتب، سلفة، شراء أصل، إهلاك...) **يجب أن تُنشئ قيداً محاسبياً فعلياً** في جدول `journal_entries` (رأس القيد) و`journal_entry_lines` (أسطر مدين/دائن). كل التقارير المالية (ميزان المراجعة، قائمة الدخل، المركز المالي) **تُحسب مباشرة من هذه الأسطر فقط** — لا تُخزَّن أرقام التقارير في مكان منفصل، لتفادي عدم الاتساق.

**قاعدة صارمة:** أي قيد يُرحَّل يجب أن يتحقق الـ backend أن مجموع المدين = مجموع الدائن قبل الحفظ، ويرفض الحفظ إن لم يتحقق ذلك (تحقّق من جهة الخادم وليس فقط الواجهة).

### حسابات مركز التكلفة/القسم/الطرف
كل سطر قيد قد يحمل حقولاً اختيارية إضافية للربط:
- `cost_center_id` (مركز التكلفة — محطة/فرع/مخزن)
- `department` (القسم)
- `customer_id` (عند الربط بذمم عميل)
- `supplier_id` (عند الربط بذمم مورد)
- `employee_id` (عند الربط بذمم موظف)

**أرصدة العملاء والموردين والموظفين تُحسب دائماً من تجميع هذه الأسطر** (Debit - Credit أو العكس حسب طبيعة الحساب)، وليست حقلاً مخزَّناً منفصلاً.

---

## 4. نماذج البيانات (Data Models)

### 4.1 الجداول الأساسية متعددة المستأجرين (Multi-tenancy)

```
Tenant (المستأجر / المجموعة المشتركة)
  - id, name, subscriptionPlan (basic/professional/enterprise)
  - trialEndsAt, subscriptionStatus (trialing/active/past_due/canceled)
  - createdAt

User (مستخدم)
  - id, tenantId (FK), name, email (unique), passwordHash
  - role (مدير النظام/مدير مالي/محاسب/مسؤول موارد بشرية/مشاهدة فقط)
  - companyScope (all أو معرّف شركة محددة ضمن المستأجر)
  - active (bool), inviteStatus (pending/accepted), inviteToken, inviteExpiresAt
  - lastLoginAt
```

**كل الجداول التالية يجب أن تحمل `tenantId` وتُفلتَر به إلزامياً في كل استعلام** (عبر middleware أو Row-Level Security في PostgreSQL) — هذا هو الفرق الجوهري بين البروتوتايب الحالي (بيانات مشتركة في متصفح واحد) والمنتج الحقيقي (بيانات كل عميل معزولة تماماً).

### 4.2 الشركات والإعدادات

```
Company (شركة ضمن المجموعة)
  - id, tenantId, name, shortName, logoUrl, brandColor
  - vatNumber, crNumber, nationalAddress

CostCenter / Location (مركز تكلفة / موقع / فرع / مخزن)
  - id, tenantId, companyId (nullable = عام لكل الشركات), name

Account (شجرة الحسابات)
  - id, tenantId, name, type (asset/liability/equity/revenue/expense)

CompanyDocument (مستندات رسمية: سجل تجاري، دفاع مدني...)
  - id, tenantId, companyId, docType, number, locationId (nullable), expiryDate
```

### 4.3 القيود اليومية

```
JournalEntry
  - id, tenantId, companyId, date, memo, createdBy, status (draft/posted)
  - sourceModule (manual/sales_invoice/purchase_invoice/payroll/depreciation/...)
  - sourceId (معرّف المستند المصدر، للتتبّع والرجوع)

JournalEntryLine
  - id, journalEntryId, accountName (أو accountId), costCenterId, department
  - debit, credit, customerId, supplierId, employeeId
```

### 4.4 المبيعات

```
Customer
  - id, tenantId, companyId, name, customerType (business/individual)
  - vatNumber (15 رقماً - إلزامي لو business)، crNumber، nationalId
  - buildingNo, street, district, city, postalCode, additionalNo
  - paymentTerms, creditLimit

Quotation (عرض سعر)
  - id, tenantId, quoteNumber, companyId, customerId, date, validUntil
  - status (draft/converted), convertedInvoiceId

SalesInvoice
  - id, tenantId, invoiceNumber, companyId, customerId, date
  - invoiceType (standard/simplified) — يُحسب تلقائياً: business+vatNumber = standard، غير ذلك simplified
  - status (draft/posted), journalEntryId, qrPayload (base64 TLV)
  - subtotal, vatTotal, grandTotal

SalesInvoiceLine
  - id, invoiceId, account, description, quantity, unitPrice
  - discountPct, priceIncludesVat (bool), subtotal, vat, total

SalesReturn (مردود مبيعات) — نفس بنية SalesInvoice تقريباً + relatedInvoiceId, reason, refundMethod

Receipt (سند قبض)
  - id, tenantId, receiptNumber, companyId, customerId, date, method (cash/bank)
  - totalAmount, status (draft/posted), journalEntryId

ReceiptAllocation (توزيع سند القبض على الفواتير)
  - id, receiptId, invoiceId, amount
```

**منطق حالة سداد الفاتورة (يُحسب، لا يُخزَّن):**
```
paidAmount = SUM(ReceiptAllocation.amount WHERE invoiceId = X)
status = paidAmount >= grandTotal - 0.5 ? "مسددة"
       : paidAmount > 0 ? "مسددة جزئياً"
       : "غير مسددة"
```

### 4.5 المشتريات
نفس بنية المبيعات تماماً (Supplier بدل Customer، PurchaseInvoice، PurchaseReturn) لكن بدون QR وبدون تصنيف قياسية/مبسّطة.

### 4.6 المخزون

```
Item (صنف)
  - id, tenantId, companyId, code, name, unit, category, costPrice, reorderLevel

StockMovement
  - id, tenantId, companyId, itemId, warehouseId (= costCenterId)
  - type (in/out/issue/transfer_out/transfer_in), quantity, unitCost, date, note
  - journalEntryId
```

**رصيد أي صنف في أي موقع = مجموع (in + transfer_in) − مجموع (out + issue + transfer_out)** — يُحسب من الحركات، لا يُخزَّن كرصيد جاهز.

### 4.7 الأصول الثابتة

```
FixedAsset
  - id, tenantId, companyId, name, category, purchaseDate, cost
  - usefulLifeYears, salvageValue, status (active/disposed)
  - disposalDate, disposalValue

DepreciationRun
  - id, tenantId, companyId, month (YYYY-MM), totalAmount, journalEntryId
```

**معادلة الإهلاك بالقسط الثابت:**
```
monthlyDepreciation = (cost - salvageValue) / usefulLifeYears / 12
accumulatedDepreciation(asset, date) = MIN(monthlyDepreciation × عدد الأشهر المنقضية منذ الشراء, cost - salvageValue)
netBookValue = cost - accumulatedDepreciation
```

**عند الاستبعاد/البيع:**
```
gainOrLoss = salePrice - netBookValueAtDisposalDate
قيد: مدين مجمع الإهلاك (بكامل قيمته) + مدين النقدية/البنك (لو فيه سعر بيع)
     دائن الأصول الثابتة (بالتكلفة الأصلية كاملة)
     + مدين "خسائر استبعاد أصول" لو gainOrLoss سالب، أو دائن "أرباح استبعاد أصول" لو موجب
```

### 4.8 شئون الموظفين

```
Employee
  - id, tenantId, companyId, name, jobTitle, department
  - hireDate, contractType (unlimited/limited), contractEnd
  - basicSalary, housingAllowance, transportAllowance, otherAllowance
  - gosiApplicable (bool), gosiAmount (override اختياري)
  - advances, otherDeductions (قيم معتادة شهرية، تُستخدم كخط أساس)
  - nationality, dateOfBirth, bankName, bankAccount
  - leaveStatus (active/onLeave), lastLeaveReturnDate
  - status (active/terminated)

EmployeeDocument (إقامة/جواز/رخصة قيادة/بطاقة تشغيل سائق...)
  - id, employeeId, type, number, expiryDate

LeaveRequest (طلب/خطاب إجازة بسيط)
  - id, employeeId, type, startDate, endDate, days, status, note

LeaveSettlement (تسوية مستحقات إجازة فعلية)
  - id, employeeId, leaveStartDate, monthAmount (راتب أيام الشهر), daysWorked
  - bonuses, deductions, ticketAmount, visaAmount, accruedDays, netAmount
  - journalEntryId, status (calculated/disbursed)
  - disbursement { method (cash/bank), date, journalEntryId }
  - returnDate (تاريخ المباشرة بعد الإجازة، فارغ حتى العودة)

HrAction (إجراء: غياب/عمل إضافي/سلفة/مخالفة/عقوبة...)
  - id, employeeId, month (YYYY-MM), actionType, value (أيام أو مبلغ), note, batchId

PayrollRun (كشف رواتب شهري)
  - id, tenantId, companyId, month, employeeIds[], status (draft/posted)
  - overrides { [employeeId]: { basic, housing, transport, otherAllow, otherAdd, overtime, gosi, absence, advance, violation, penalty, otherDed } }
  - journalEntryId
```

**معادلة رصيد إجازة سنوية متراكم (نظام العمل السعودي، المادة 109):**
```
annualEntitlement = عدد سنوات الخدمة >= 5 ? 30 يوماً : 21 يوماً
accruedDays = (الأيام منذ آخر عودة من إجازة أو تاريخ المباشرة إن كانت أول إجازة) / 365 × annualEntitlement
```

**معادلة مكافأة نهاية الخدمة (المادتان 84 و85):**
```
wage = basicSalary + housingAllowance
first5Years = MIN(totalYears, 5)
remaining = MAX(totalYears - 5, 0)
fullReward = first5Years × 0.5 × wage + remaining × 1 × wage

# نسبة الاستحقاق عند الاستقالة (المادة 85):
لو استقالة:
  totalYears < 2  → النسبة = 0
  2 ≤ totalYears < 5  → النسبة = 1/3
  5 ≤ totalYears < 10 → النسبة = 2/3
  totalYears ≥ 10 → النسبة = 1 (كامل)
لو إنهاء من صاحب العمل أو انتهاء عقد → النسبة = 1 (كامل)

finalAmount = fullReward × النسبة
```

**⚠️ ملاحظة قانونية مهمة يجب نقلها للمستند وللواجهة:** هذه معادلة تقديرية مبسّطة لأغراض النظام، ولا تُغني عن المراجعة القانونية الدقيقة لكل حالة فردية (خصوصاً حالات الفصل التأديبي).

**كشف الرواتب — بنود الأعمدة الكاملة (يجب الحفاظ عليها بالضبط):**

| المجموعة | الأعمدة |
|---|---|
| الإضافات | الأساسي، بدل سكن، بدل مواصلات، بدلات أخرى (ثابتة)، إضافات أخرى (شهرية من الإجراءات)، بدل إضافي (عمل إضافي) |
| الخصومات | تأمينات (GOSI)، غياب، سلف، مخالفات، عقوبات، خصومات أخرى |
| الناتج | إجمالي الإضافات، إجمالي الراتب، إجمالي الخصومات، صافي الراتب |

**قيد ترحيل كشف الرواتب — توزيع كل بند على حساب مستقل في شجرة الحسابات (إلزامي، وفق طلب العميل الصريح):**

```
مدين: مصروف رواتب أساسية = Σ الأساسي (كل الموظفين)
مدين: مصروف بدل سكن = Σ بدل سكن
مدين: مصروف بدل مواصلات = Σ بدل مواصلات
مدين: مصروف بدلات أخرى = Σ بدلات أخرى
مدين: مصروف إضافات وحوافز أخرى = Σ إضافات أخرى
مدين: مصروف بدل إضافي = Σ بدل إضافي
دائن: التأمينات الاجتماعية - مستحقة = Σ تأمينات
دائن: سلف الموظفين = Σ سلف
دائن: صندوق العاملين - مخالفات وعقوبات = Σ (مخالفات + عقوبات)  ⚠️ ليست إيراداً للشركة، بل أمانة تخضع لأنظمة نظام العمل (المادة 91) بخصوص توجيه حصيلة الجزاءات لصندوق خدمات العاملين
دائن: استقطاعات أخرى مستحقة = Σ خصومات أخرى
دائن: رواتب مستحقة للصرف = صافي الرواتب الإجمالي
```

### 4.9 نظام فك الترحيل المحمي بكلمة سر

كل معاملة قابلة للترحيل (فاتورة، سند، كشف رواتب، قيد إهلاك...) لها الحالة `draft` أو `posted`. **فك ترحيل أي معاملة (`posted → draft`) يجب أن:**
1. يطلب من المستخدم كلمة سر منفصلة (`unlockPin` على مستوى المستأجر، قابلة للتغيير من الإعدادات)
2. يحذف/يعكس القيد المحاسبي المرتبط بها
3. يسجَّل الحدث في سجل تدقيق (audit log) — **هذا غير موجود في البروتوتايب الحالي ويجب إضافته في النظام الحقيقي**: من فكّ الترحيل، متى، ولأي معاملة.

---

## 5. واجهات برمجة التطبيقات (API Endpoints) — نظرة عامة

بنية REST مقترحة (يمكن تحويلها لـ GraphQL حسب تفضيل الفريق):

```
POST   /api/auth/register          إنشاء مستأجر جديد + مستخدم أول + بدء تجربة مجانية
POST   /api/auth/login             تسجيل الدخول (يُعيد access + refresh token)
POST   /api/auth/invite            دعوة مستخدم جديد (يرسل بريداً فعلياً برابط التفعيل)
POST   /api/auth/accept-invite     قبول الدعوة وتعيين كلمة مرور فعلية

GET/POST/PATCH/DELETE  /api/companies
GET/POST/PATCH/DELETE  /api/accounts                (شجرة الحسابات)
GET/POST/PATCH/DELETE  /api/cost-centers

GET/POST/PATCH/DELETE  /api/journal-entries
POST   /api/journal-entries/import      (استيراد إكسل)
POST   /api/journal-entries/:id/unpost  (يتطلب unlockPin)

GET/POST/PATCH/DELETE  /api/customers
GET/POST/PATCH/DELETE  /api/quotations
POST   /api/quotations/:id/convert-to-invoice
GET/POST/PATCH/DELETE  /api/sales-invoices
POST   /api/sales-invoices/import
POST   /api/sales-invoices/:id/unpost
GET/POST/PATCH/DELETE  /api/sales-returns
GET/POST/PATCH/DELETE  /api/receipts

GET/POST/PATCH/DELETE  /api/suppliers
GET/POST/PATCH/DELETE  /api/purchase-invoices
GET/POST/PATCH/DELETE  /api/purchase-returns

GET/POST/PATCH/DELETE  /api/items
GET/POST                /api/stock-movements  (in/out/issue/transfer)
GET    /api/stock/balances

GET/POST/PATCH/DELETE  /api/fixed-assets
POST   /api/depreciation-runs
POST   /api/fixed-assets/:id/dispose

GET/POST/PATCH/DELETE  /api/employees
GET/POST/PATCH/DELETE  /api/employee-documents
GET/POST/PATCH/DELETE  /api/leave-settlements
POST   /api/leave-settlements/:id/disburse
POST   /api/leave-returns
GET/POST/PATCH/DELETE  /api/hr-actions
GET/POST                /api/payroll-runs
POST   /api/payroll-runs/:id/post
POST   /api/payroll-runs/:id/unpost   (يتطلب unlockPin)

GET    /api/reports/trial-balance?companyId=&date=
GET    /api/reports/income-statement?companyId=&from=&to=
GET    /api/reports/balance-sheet?companyId=&date=
GET    /api/reports/aging?type=receivables|payables&companyId=
GET    /api/reports/expiring-documents?withinDays=30
```

**كل نقاط النهاية يجب أن:**
- تتحقق من `tenantId` المستخرج من الـ JWT، وترفض أي طلب يحاول الوصول لبيانات مستأجر آخر
- تتحقق من صلاحيات الدور (role) قبل تنفيذ عمليات الكتابة الحساسة (ترحيل/فك ترحيل/حذف)

---

## 6. التكامل الفعلي مع فاتورة (منصة زاتكا) — القسم الأكثر حساسية

**الوضع الحالي في البروتوتايب:** يُنتج النظام حمولة QR بصيغة TLV/Base64 صحيحة البنية (Tags 1-5: اسم البائع، الرقم الضريبي، الطابع الزمني، الإجمالي، الضريبة) — وهذا يفي بمتطلبات **المرحلة الأولى (Generation Phase)** من فوترة زاتكا.

**للوصول إلى المرحلة الثانية (Integration Phase)** المطلوبة فعلياً للربط المباشر مع منصة فاتورة، يحتاج الفريق:

1. توليد فاتورة بصيغة **UBL 2.1 XML** موقّعة رقمياً (وليس فقط QR)
2. الحصول على **CSID** (Cryptographic Stamp Identity) من زاتكا عبر تسجيل الجهاز/الحل
3. توليد **CSR** (Certificate Signing Request) وتبادله مع بوابة زاتكا (Compliance API ثم Production API)
4. توقيع كل فاتورة بشهادة رقمية (Digital Signature + Hash + Cryptographic Stamp) قبل إرسالها
5. إرسال الفاتورة لمنصة فاتورة عبر API الخاص بها للتحقق (Clearance للفواتير القياسية B2B) أو الإبلاغ (Reporting للفواتير المبسّطة B2C خلال 24 ساعة)

هذا الجزء **يتطلب تعاقداً مع مزوّد حلول فوترة معتمد من زاتكا** (يوجد عدد كبير من المزوّدين السعوديين المعتمدين)، أو تطوير حل داخلي متوافق يمر باختبارات الاعتماد (Onboarding) الرسمية من الهيئة. **ينصح بشدة عدم محاولة تنفيذ هذا الجزء تحديداً بدون استشارة متخصص امتثال ضريبي**، نظراً للمسؤولية القانونية المرتبطة بالفوترة الإلكترونية.

---

## 7. خطة الهجرة المقترحة (Migration Roadmap)

**المرحلة صفر — الأساس (2-3 أسابيع تقديرية):**
- إعداد قاعدة البيانات + نماذج Prisma لكل الجداول أعلاه
- نظام المصادقة الحقيقي (تسجيل/دخول/دعوة/فصل بيانات المستأجرين)
- API القيود اليومية + شجرة الحسابات + التقارير المالية الثلاثة (أهم موديول لأنه الأساس لكل شيء آخر)

**المرحلة الأولى:**
- المبيعات كاملة (عملاء، عروض أسعار، فواتير، مردودات، سندات قبض) + التقارير
- المشتريات كاملة

**المرحلة الثانية:**
- المخزون + الأصول الثابتة

**المرحلة الثالثة:**
- شئون الموظفين والرواتب كاملة (الأكثر تعقيداً في المنطق الحسابي)

**المرحلة الرابعة:**
- الموقع التسويقي العام + الاشتراكات + بوابة الدفع
- التكامل الفعلي مع فاتورة (بالتعاقد مع مزوّد معتمد، كما هو موضّح أعلاه)

**في كل مرحلة:** يُنصح بمقارنة نتائج الـ backend الجديد رقماً برقم مع نتائج البروتوتايب الحالي لنفس البيانات، للتأكد من تطابق المنطق الحسابي (خصوصاً الرواتب والزكاة والإهلاك).

---

## 8. ملاحظةختامية لمن سيعمل على هذا المستند (Claude Code أو غيره)

- **الملف المرجعي `AtharAlMuhasabi.jsx` هو الحَكَم عند أي تعارض أو غموض** في هذا المستند — اقرأه واستخرج التفاصيل الدقيقة (كل دالة حساب موجودة فيه باسمها: `computeInvoiceLine`, `calcEOS`, `assetAccumulatedDepreciation`, `computeWidePayrollRow`, إلخ).
- لا تُعد تصميم الشاشات من الصفر — الواجهة الحالية شغّالة ومُختبَرة، والهدف هو استبدال طبقة البيانات (state) بطبقة API حقيقية خلفها، مع الحفاظ على نفس تجربة المستخدم قدر الإمكان.
- أي رقم مالي (بالذات الرواتب والزكاة ومكافأة نهاية الخدمة) يجب اختباره بحالات حديّة (edge cases) صريحة قبل اعتماده في الإنتاج.
