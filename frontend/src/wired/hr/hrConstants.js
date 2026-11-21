// قوائم ثابتة لملفات الموظفين — كانت داخل legacy/hr.jsx (شاشة موارد بشرية قديمة غير مستخدمة حُذفت).
export const EMPLOYEE_DOC_TYPES = ["إقامة", "جواز سفر", "رخصة قيادة", "بطاقة تشغيل سائق (نقل عام)", "شهادة صحية", "تأمين طبي", "أخرى"];
export const NATIONALITIES = ["سعودي", "مصري", "باكستاني", "بنغلاديشي", "هندي", "يمني", "سوداني", "فلبيني", "أخرى"];
// مفاتيح ترجمة مستقرة للعرض فقط — القيمة المخزَّنة/المُرسَلة تبقى النص العربي أعلاه حرفياً بلا أي
// تغيير (راجع frontend/src/legacy/listLabels.js: labelForListValue).
export const EMPLOYEE_DOC_TYPE_KEYS = {
  "إقامة": "residencyId", "جواز سفر": "passport", "رخصة قيادة": "drivingLicense",
  "بطاقة تشغيل سائق (نقل عام)": "publicTransportDriverCard", "شهادة صحية": "healthCertificate",
  "تأمين طبي": "medicalInsurance", "أخرى": "other",
};
export const NATIONALITY_KEYS = {
  "سعودي": "saudi", "مصري": "egyptian", "باكستاني": "pakistani", "بنغلاديشي": "bangladeshi",
  "هندي": "indian", "يمني": "yemeni", "سوداني": "sudanese", "فلبيني": "filipino", "أخرى": "other",
};

