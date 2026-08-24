import { useNavigate, useParams } from "react-router-dom";

/**
 * يستبدل حالة `[tab, setTab]` المحلية القديمة (كانت تُمرَّر من App.jsx كـ props) بمصدر واحد حقيقي:
 * مسار الصفحة نفسه. `tab` يُقرأ من useParams (بارامتر المسار `:tab`)، و`setTab` أصبح تنقّلاً فعلياً
 * (history.pushState عبر react-router) بدل تحديث state داخلي فقط — فيتحدّث شريط العنوان تلقائياً،
 * ويصبح أي رابط يشير لهذا التبويب رابطاً حقيقياً قابلاً لفتحه في تبويب جديد.
 * تبويب غير معروف (أو غائب) في الرابط يُستبدَل بأول تبويب في القائمة (نفس القيمة الافتراضية القديمة
 * لكل موديول، لأنها كانت أصلاً tabs[0].id في كل الموديولات الثمانية).
 */
export function useModuleTab(basePath, tabs) {
  const { tab: rawTab } = useParams();
  const navigate = useNavigate();
  const tab = tabs.some((t) => t.id === rawTab) ? rawTab : tabs[0].id;
  const setTab = (id) => navigate(`${basePath}/${id}`);
  return [tab, setTab];
}
