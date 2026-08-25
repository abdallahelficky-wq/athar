import { renderHtmlToPdf } from "./zatca/pdf/renderPdf";

export interface LiveryContractView {
  contractNumber?: string | null; companyName: string; companyCr?: string | null; companyAddress?: string | null;
  companyPhone?: string | null; companyEmail?: string | null; ownerName?: string | null; ownerNationality?: string | null;
  ownerNationalId?: string | null; ownerIdIssuePlace?: string | null; ownerPhone?: string | null; ownerEmail?: string | null;
  ownerCity?: string | null; ownerDistrict?: string | null; ownerStreet?: string | null; ownerBuildingNo?: string | null;
  ownerPostalCode?: string | null; horseName: string; horseDescription?: string | null; stableName: string;
  stallNumber?: string | null; startDate: Date; endDate?: Date | null; monthlyFee: string; depositAmount?: string | null;
}

const esc = (v: unknown) => String(v ?? "—").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]!));
const date = (v?: Date | null) => v ? new Intl.DateTimeFormat("en-GB").format(v) : "—";
const field = (label: string, value: unknown) => `<span class="field"><b>${label}:</b> ${esc(value)}</span>`;

const clausesAr = [
  ["تمهيد", "حيث إن الطرف الأول منشأة رياضية متخصصة في تقديم خدمات إيواء ورعاية الخيل، وحيث رغب الطرف الثاني في الاستفادة من هذه الخدمات؛ فقد اتفق الطرفان، وهما بكامل الأهلية المعتبرة شرعاً ونظاماً، على ما يلي."],
  ["1. التمهيد والمرفقات", "يُعد التمهيد أعلاه واللوائح الداخلية وقائمة الأسعار وأي ملاحق موقعة جزءاً لا يتجزأ من هذا العقد ومكملاً ومفسراً له."],
  ["2. التزامات الطرف الأول", "يوفر الطرف الأول مكان الإيواء والعناية اليومية والتنظيف والفرشة والأعلاف والمياه، وخدمات الحِدادة ومكافحة الديدان وفق الباقة وقائمة الأسعار المعتمدة. ويجوز له تعديل الأسعار أو سياسة الخدمات بعد إشعار الطرف الثاني قبل شهر واحد."],
  ["3. التزامات الطرف الثاني", "يلتزم الطرف الثاني بسداد الرسوم مقدماً في مواعيدها، إضافة إلى ضريبة القيمة المضافة وأي خدمات إضافية، وباللوائح الداخلية وتعليمات السلامة. ويتحمل تكاليف السائس في المشاركات والمسابقات، ويلتزم بضوابط استخدام المرافق ودخول الضيوف والحيوانات الأليفة. ولا تكون الزيارة خارج المواعيد إلا لحالة بيطرية وبالتنسيق المسبق."],
  ["4. وصف الخيل", "الخيل محل العقد هو الموضح في بيانات العقد، ويقر الطرف الثاني بصحة بياناته وملكيته أو أحقيته النظامية في التعاقد بشأنه، ويلتزم بإبلاغ الطرف الأول بأي حالة صحية أو سلوكية مؤثرة."],
  ["5. ضمان المستحقات والتفويض بالبيع", "يفوض الطرف الثاني الطرف الأول في حبس الخيل وعدم تسليمه عند وجود مبالغ مستحقة. وإذا استمر عدم السداد بعد الإشعار، يحق للطرف الأول اتخاذ الإجراءات النظامية وبيع الخيل بالقدر اللازم لسداد المستحقات والمصروفات، ورد أي فائض للطرف الثاني."],
  ["6. إنهاء العقد", "يجوز إنهاء العقد باتفاق الطرفين أو عند إخلال أحدهما بالتزام جوهري وعدم معالجته بعد الإشعار. ولا يعفي الإنهاء الطرف الثاني من سداد جميع المبالغ والخدمات المستحقة حتى تاريخ إخلاء الخيل."],
  ["7. إخلاء المسؤولية والتأمين", "يقر الطرف الثاني بأن التعامل مع الخيل ينطوي على مخاطر طبيعية، ولا يكون الطرف الأول مسؤولاً عن المرض أو الإصابة أو النفوق أو السرقة أو الحوادث الخارجة عن السيطرة إلا عند ثبوت التعدي أو التقصير. ويتحمل الطرف الثاني مسؤولية التأمين على الخيل وممتلكاته."],
  ["8. المدة والتجديد", "مدة العقد سنة تبدأ من تاريخ البداية الموضح، وتتجدد تلقائياً لمدة مماثلة ما لم يُخطر أحد الطرفين الآخر كتابة بعدم التجديد قبل شهر واحد على الأقل، مع بقاء الالتزامات المالية القائمة."],
  ["9. الملاحق", "تُعد قائمة الأسعار المعتمدة وتفويض البيع واللوائح الداخلية وأي نموذج صحي أو تعريفي للخيل ملاحق لهذا العقد متى سلمت أو وقعت من الطرفين."],
  ["10. أحكام تشغيلية إضافية", "تُحتسب رسوم إضافية للفرس الحامل وفق قائمة الأسعار. ويتحمل الطرف الثاني رواتب وإقامة ونقل كفالة السائس الخاص إن وجد. ولا يسمح بمدربين من خارج المنشأة دون موافقة مكتوبة. وتحمّل تكاليف الطبيب البيطري أو الجراحة الطارئة للطرف الثاني، ولا يستخدم إلا الأطباء والبيطريون والبيطارون المعتمدون من الطرف الأول إلا بموافقته."],
  ["11. الإقرار", "يقر الطرف الثاني بأنه قرأ العقد ولوائحه وملاحقه وفهمها وقبلها، وأن البيانات المقدمة صحيحة، ويفوض الطرف الأول في اتخاذ ما يلزم لحماية صحة الخيل في الحالات العاجلة مع إشعاره متى أمكن."],
  ["12. تسوية النزاعات", "يسعى الطرفان إلى تسوية أي نزاع ودياً خلال خمسة عشر يوم عمل من تاريخ الإشعار الكتابي. وعند تعذر التسوية تكون المحكمة المختصة في مدينة جدة هي المختصة بنظر النزاع."],
  ["13. الإشعارات", "تكون الإشعارات والتبليغات صحيحة إذا سلمت باليد أو أرسلت برسالة نصية أو واتساب أو بريد إلكتروني إلى البيانات المثبتة بالعقد أو نشرت في لوحة إعلانات المنشأة، وتعد نافذة بعد خمسة أيام من إرسالها أو نشرها."],
  ["14. اللغة والنسخ", "حرر هذا العقد باللغتين العربية والإنجليزية من نسختين أصليتين، تسلم كل طرف نسخة للعمل بموجبها. وعند الاختلاف أو التعارض تكون اللغة العربية هي المعتمدة."],
];

const clausesEn = [
  ["Preamble", "The First Party is a sports establishment specialised in horse livery and care services, and the Second Party wishes to use those services. The parties, having full legal capacity, agree as follows."],
  ["1. Preamble and attachments", "The above preamble, internal regulations, price list and all signed annexes form an integral, complementary and interpretive part of this Contract."],
  ["2. First Party obligations", "The First Party provides livery accommodation, daily care, cleaning, bedding, feed and water, farrier and worming services according to the selected package and approved price list. Prices or service policies may be changed on one month's prior notice."],
  ["3. Second Party obligations", "The Second Party shall pay fees in advance when due, together with VAT and additional services, and comply with internal and safety rules. The Second Party bears groom costs for events and competitions and follows rules for facilities, guests and pets. Visits outside opening hours are permitted only for veterinary necessity with prior coordination."],
  ["4. Horse description", "The horse is identified in the Contract Details. The Second Party confirms the accuracy of its information and legal ownership or authority and shall disclose any material health or behavioural condition."],
  ["5. Security for dues and authority to sell", "The Second Party authorises the First Party to retain and withhold release of the horse while sums remain unpaid. After notice and continued default, the First Party may take lawful steps and sell the horse to recover dues and expenses, returning any surplus."],
  ["6. Termination", "This Contract may be terminated by mutual agreement or for a material breach not remedied after notice. Termination does not release the Second Party from fees and services accrued until the horse leaves the premises."],
  ["7. Disclaimer and insurance", "The Second Party accepts the inherent risks of horses. The First Party is not liable for illness, injury, death, theft or events beyond its control unless negligence or misconduct is proven. The Second Party is responsible for insuring the horse and belongings."],
  ["8. Term and renewal", "The Contract runs for one year from the stated start date and renews automatically for the same period unless either party gives at least one month's written non-renewal notice. Outstanding financial obligations survive."],
  ["9. Annexes", "The approved price list, sale authorisation, internal regulations and any horse health or identification form become annexes when delivered or signed."],
  ["10. Additional operational terms", "A pregnant mare surcharge applies under the price list. The Second Party bears salary, accommodation and sponsorship-transfer costs for a private groom. External trainers require written approval. Emergency veterinary and surgery costs are borne by the Second Party, and only First Party-approved vets and farriers may be used unless otherwise approved."],
  ["11. Acknowledgment", "The Second Party confirms having read, understood and accepted this Contract, its rules and annexes; confirms all supplied information is correct; and authorises urgent action reasonably required to protect the horse's health, with notice where practicable."],
  ["12. Disputes", "The parties shall seek an amicable settlement within fifteen business days after written notice. If settlement fails, the competent court in Jeddah shall have jurisdiction."],
  ["13. Notices", "Notices are valid when delivered by hand, SMS, WhatsApp or email using the Contract details, or posted on the establishment notice board, and become effective five days after sending or posting."],
  ["14. Language and copies", "This Contract is executed in Arabic and English in two originals, one for each party. If the texts differ or conflict, the Arabic text prevails."],
];

export function buildLiveryContractHtml(v: LiveryContractView) {
  const address = [v.ownerCity, v.ownerDistrict, v.ownerStreet, v.ownerBuildingNo, v.ownerPostalCode].filter(Boolean).join("، ");
  const list = (items: string[][], dir: string) => items.map(([h,p]) => `<section dir="${dir}"><h3>${h}</h3><p>${p}</p></section>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @page{size:A4}*{box-sizing:border-box}body{font-family:Arial,"Noto Sans Arabic",sans-serif;color:#17212b;font-size:10px;line-height:1.55}.head{text-align:center;border-bottom:3px solid #9b7b45;padding-bottom:8px}.head h1{font-size:19px;margin:2px}.meta,.parties,.horse,.fees{border:1px solid #b8b8b8;border-radius:5px;padding:8px;margin:8px 0}.field{display:inline-block;min-width:31%;padding:3px}.columns{display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:start}.columns>div:first-child{border-right:1px solid #ccc;padding-right:10px}.columns>div:last-child{padding-left:10px}section{break-inside:avoid;margin-bottom:7px}h3{font-size:11px;margin:0 0 2px;color:#76592d}p{margin:0;text-align:justify}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:35px;margin-top:24px;break-inside:avoid}.sig{height:100px;border:1px solid #777;padding:8px}.sig b{display:block;margin-bottom:32px}.muted{color:#666}</style></head><body>
  <header class="head"><h1>عقد تقديم خدمات إيواء خيل وخلافة</h1><h1>Contract of Providing Livery Services</h1><div class="muted">${esc(v.contractNumber ? `رقم العقد / Contract No. ${v.contractNumber}` : "")}</div></header>
  <div class="meta">${field("تاريخ البداية / Start date",date(v.startDate))}${field("تاريخ النهاية / End date",date(v.endDate))}${field("الإسطبل / Stable",v.stableName)}</div>
  <div class="parties" dir="rtl"><b>الطرف الأول / First Party</b><br>${field("المنشأة / Establishment",v.companyName)}${field("السجل التجاري / CR",v.companyCr)}${field("العنوان / Address",v.companyAddress)}${field("الهاتف / Phone",v.companyPhone)}${field("البريد / Email",v.companyEmail)}</div>
  <div class="parties" dir="rtl"><b>الطرف الثاني (مالك الخيل) / Second Party (Horse Owner)</b><br>${field("الاسم / Name",v.ownerName)}${field("الجنسية / Nationality",v.ownerNationality)}${field("الهوية / ID",v.ownerNationalId)}${field("مكان الإصدار / Issue place",v.ownerIdIssuePlace)}${field("الجوال وواتساب / Mobile & WhatsApp",v.ownerPhone)}${field("البريد / Email",v.ownerEmail)}${field("العنوان / Address",address||"—")}</div>
  <div class="horse" dir="rtl"><b>بيانات الخيل / Horse Details</b><br>${field("الاسم / Name",v.horseName)}${field("الوصف / Description",v.horseDescription)}${field("رقم البوكس / Stall",v.stallNumber)}</div>
  <div class="fees" dir="rtl">${field("رسوم الإيواء الشهرية / Monthly fee",v.monthlyFee)}${field("التأمين / Deposit",v.depositAmount)}</div>
  <div class="columns"><div>${list(clausesEn,"ltr")}</div><div>${list(clausesAr,"rtl")}</div></div>
  <div class="signatures"><div class="sig"><b>First Party / الطرف الأول</b>Name / الاسم: ____________________<br>Signature / التوقيع: ____________________</div><div class="sig" dir="rtl"><b>Second Party / الطرف الثاني</b>الاسم / Name: ${esc(v.ownerName)}<br>التوقيع / Signature: ____________________</div></div>
  </body></html>`;
}

export const buildLiveryContractPdf = (view: LiveryContractView) => renderHtmlToPdf(buildLiveryContractHtml(view));
