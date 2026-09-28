import React, {useEffect,useRef} from "react";
import {createPortal} from "react-dom";
import {useTranslation} from "react-i18next";
export default function PurchaseFormDialog({title,onClose,saving,children}) {
 const {t}=useTranslation(); const ref=useRef(null);
 useEffect(()=>{const previous=document.activeElement; const overflow=document.body.style.overflow; document.body.style.overflow="hidden";ref.current?.querySelector("input")?.focus();return()=>{document.body.style.overflow=overflow;previous?.focus();};},[]);
 const keyDown=e=>{if(e.key==="Escape"){e.preventDefault();if(!saving)onClose();}if(e.key!=="Tab")return;const els=[...ref.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)')].filter(el=>el.getClientRects().length);const first=els[0],last=els[els.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}};
 return createPortal(<div className="invoice-modal-overlay" onClick={e=>e.target===e.currentTarget&&!saving&&onClose()}><div ref={ref} className="invoice-modal-box" role="dialog" aria-modal="true" aria-label={title} onKeyDown={keyDown}><div className="modal-title-row"><h3>{title}</h3><button className="modal-close-btn" aria-label={t("common.close")} disabled={saving} onClick={onClose}>×</button></div>{children}</div></div>,document.body);
}
