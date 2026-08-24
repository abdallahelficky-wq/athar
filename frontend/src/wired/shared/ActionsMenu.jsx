import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Icon } from "../../legacy/shared";

/**
 * قائمة "⋮ المزيد" منسدلة للإجراءات الثانوية في أعمدة الجداول (نسخ/طباعة/مرفقات/روابط...) — تُبقي
 * صف الجدول نظيفاً بعرض الإجراءات الأساسية فقط مباشرة. مُعروضة عبر portal إلى document.body (لا
 * position: absolute داخل خلية الجدول) لأن جداول القوائم هنا تُغلَّف بحاوية overflow-x: auto التي
 * تقصّ أي عنصر مُموضَع نسبياً يتجاوز حدودها رأسياً أيضاً — نفس القيد ينطبق على أي جدول قوائم آخر.
 * items: [{ label, icon?: Component, onClick, danger?, disabled?, hidden? }]
 */
export default function ActionsMenu({ items, title }) {
  const { t } = useTranslation();
  const visibleItems = items.filter((it) => it && !it.hidden);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const [ready, setReady] = useState(false);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  const openMenu = () => {
    const rect = triggerRef.current.getBoundingClientRect();
    const openLeftward = rect.left > window.innerWidth / 2;
    setPos({
      top: rect.bottom + 4,
      triggerTop: rect.top,
      ...(openLeftward ? { right: window.innerWidth - rect.right } : { left: rect.left }),
    });
    setReady(false);
    setOpen(true);
  };

  // بعد أول رسم للقائمة بموضعها المبدئي (أسفل الزر)، نقيس ارتفاعها الفعلي: لو تتجاوز أسفل حدود
  // الشاشة المرئية، نقلبها لتفتح لأعلى بدل لأسفل بدل أن تُقطَع بصرياً بلا أي وسيلة للوصول لبقيتها.
  useLayoutEffect(() => {
    if (!open || !menuRef.current || !pos) return;
    const menuRect = menuRef.current.getBoundingClientRect();
    const margin = 8;
    if (menuRect.bottom > window.innerHeight - margin && pos.top !== undefined) {
      setPos((p) => {
        const { top, ...rest } = p;
        return { ...rest, bottom: window.innerHeight - p.triggerTop + 4 };
      });
    }
    setReady(true);
    // نُنفَّذ فقط عند فتح جديد فعلياً (trigger مختلف)، وليس عند كل تحديث لاحق لـ pos نفسه — كي لا
    // يتكرر القياس/القلب في حلقة لا نهائية.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const close = () => setOpen(false);
    const onKeyDown = (e) => { if (e.key === "Escape") setOpen(false); };
    const onDocClick = (e) => {
      if (triggerRef.current && triggerRef.current.contains(e.target)) return;
      // بدون هذا الاستثناء، كان أي mousedown داخل القائمة نفسها (بما فيها الضغط على أحد عناصرها)
      // يُغلِقها فوراً عبر هذا المستمع — قبل أن يصل الحدث لمعالج onClick الخاص بالعنصر أصلاً، فيُزال
      // العنصر من الـ DOM (unmount) بين mousedown وclick فلا يُنفَّذ أي إجراء إطلاقاً (كانت هذه
      // السبب الفعلي في أن كل عناصر هذه القائمة — الطباعة والنسخ وغيرها — لا تعمل عملياً بتاتاً).
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      setOpen(false);
    };
    // فتح القائمة نفسه قد يُطلِق حدث scroll (مثلاً تمرير المتصفح للزر ضمن العرض المرئي قبل
    // النقر) — ربط مستمعي الإغلاق فوراً كان يلتقط ذلك الحدث نفسه فيُغلِق القائمة لحظة ظهورها.
    // تأجيل الربط بإطار رسم واحد يضمن استقرار أي تمرير ناتج عن فعل الفتح قبل بدء الاستماع له.
    const raf = requestAnimationFrame(() => {
      window.addEventListener("scroll", close, true);
      window.addEventListener("resize", close);
      document.addEventListener("keydown", onKeyDown);
      document.addEventListener("mousedown", onDocClick);
    });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onDocClick);
    };
  }, [open]);

  if (visibleItems.length === 0) return null;

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className="icon-btn actions-menu-trigger"
        title={title || t("common.moreActions")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openMenu())}
      >
        <Icon.MoreVertical />
      </button>
      {open && pos && createPortal(
        <div
          ref={menuRef}
          className="actions-menu-dropdown"
          role="menu"
          style={{ top: pos.top, bottom: pos.bottom, left: pos.left, right: pos.right, visibility: ready ? "visible" : "hidden" }}
        >
          {visibleItems.map((it, i) => (
            <button
              key={i}
              type="button"
              role="menuitem"
              className={"actions-menu-item" + (it.danger ? " actions-menu-item-danger" : "")}
              disabled={it.disabled}
              onClick={() => { setOpen(false); it.onClick(); }}
            >
              {it.icon && <span className="actions-menu-item-icon"><it.icon /></span>}
              {it.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
