const ACCESS_KEY = "athar.accessToken";
const REFRESH_KEY = "athar.refreshToken";

let accessToken = localStorage.getItem(ACCESS_KEY) || null;
let refreshToken = localStorage.getItem(REFRESH_KEY) || null;

const listeners = new Set();

export function getAccessToken() {
  return accessToken;
}

export function getRefreshToken() {
  return refreshToken;
}

export function setTokens(next) {
  accessToken = next.accessToken;
  refreshToken = next.refreshToken;
  localStorage.setItem(ACCESS_KEY, accessToken);
  localStorage.setItem(REFRESH_KEY, refreshToken);
}

export function clearTokens() {
  accessToken = null;
  refreshToken = null;
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  listeners.forEach((fn) => fn());
}

/** يُستدعى عندما تُبطَل الجلسة قسراً (فشل تجديد الرمز) — تستمع له AuthContext لتسجيل الخروج فعلياً */
export function onForcedLogout(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * مزامنة بين تبويبات/نوافذ المتصفح لنفس الأصل: تحديث localStorage من تبويب يُطلق حدث "storage" في
 * كل تبويب آخر مفتوح (لا في التبويب الذي أجرى التغيير نفسه). بدونها تبقى النسخة المخزَّنة في ذاكرة
 * كل تبويب كما كانت لحظة تحميله فقط — فتبويب قديم يستمر لاحقاً بمحاولة استخدام refresh token أصبح
 * مُلغى بالفعل (كل رمز تجديد يُستخدم مرة واحدة فقط ثم يُستبدَل، rotation) بمجرد أن يُجدِّده تبويب
 * آخر لنفس المستخدم — فيُخرَج بالخطأ رغم أنه لم يسجّل خروجاً صراحةً من هذا التبويب تحديداً. هذا هو
 * السبب الجذري الفعلي لمشكلة "فتح تبويب جديد يُخرِجني من القديم"، وليس أي تعمّد لفرض جلسة واحدة —
 * الخادم لا يُبطل أي جلسات أخرى عند تسجيل دخول جديد (راجع auth.service.ts).
 */
window.addEventListener("storage", (event) => {
  if (event.key !== null && event.key !== ACCESS_KEY && event.key !== REFRESH_KEY) return;
  accessToken = localStorage.getItem(ACCESS_KEY) || null;
  refreshToken = localStorage.getItem(REFRESH_KEY) || null;
  if (!accessToken || !refreshToken) listeners.forEach((fn) => fn());
});
