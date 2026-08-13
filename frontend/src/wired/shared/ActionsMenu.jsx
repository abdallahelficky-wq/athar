import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../legacy/shared";

/**
 * قائمة "⋮ المزيد" منسدلة للإجراءات الثانوية في أعمدة الجداول (نسخ/طباعة/مرفقات/روابط...) — تُبقي
 * صف الجدول نظيفاً بعرض الإجراءات الأساسية فقط مباشرة. مُعروضة عبر portal إلى document.body (لا
 * position: absolute داخل خلية الجدول) لأن جداول القوائم هنا تُغلَّف بحاوية overflow-x: auto التي
 * تقصّ أي عنصر مُموضَع نسبياً يتجاوز حدودها رأسياً أيضاً — نفس القيد ينطبق على أي جدول قوائم آخر.
 * items: [{ label, icon?: Component, onClick, danger?, disabled?, hidden? }]
 */
export default function ActionsMenu({ items, title = "المزيد" }) {
  const visibleItems = items.filter((it) => it && !it.hidden);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);

  const openMenu = () => {
    const rect = triggerRef.current.getBoundingClientRect();
    const openLeftward = rect.left > window.innerWidth / 2;
    setPos(openLeftward
      ? { top: rect.bottom + 4, right: window.innerWidth - rect.right }
      : { top: rect.bottom + 4, left: rect.left });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return undefined;
    const close = () => setOpen(false);
    const onKeyDown = (e) => { if (e.key === "Escape") setOpen(false); };
    const onDocClick = (e) => {
      if (triggerRef.current && triggerRef.current.contains(e.target)) return;
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
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openMenu())}
      >
        <Icon.MoreVertical />
      </button>
      {open && pos && createPortal(
        <div className="actions-menu-dropdown" role="menu" style={pos}>
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
