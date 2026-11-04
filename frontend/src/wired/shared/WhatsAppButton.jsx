import React from "react";
import { useTranslation } from "react-i18next";
import { buildWhatsAppLink } from "../../lib/whatsapp";

/** أيقونة فقاعة محادثة عامة (ليست شعار واتساب) — تُرسَم بلون النص الحالي. */
export function ChatBubbleIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M12 2.5c-5.24 0-9.5 3.9-9.5 8.7 0 2.6 1.25 4.93 3.24 6.53L5 21.5l4.2-2.15c.9.22 1.84.35 2.8.35 5.24 0 9.5-3.9 9.5-8.7S17.24 2.5 12 2.5Zm-4 9.95a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Zm4 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Zm4 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Z"
      />
    </svg>
  );
}

/** رابط واتساب بشكل زر — message نص الرسالة الجاهزة. */
export function WhatsAppLink({ message, className = "btn-primary", children }) {
  return (
    <a className={"whatsapp-link " + className} href={buildWhatsAppLink(message)} target="_blank" rel="noopener noreferrer">
      <ChatBubbleIcon size={18} />
      <span>{children}</span>
    </a>
  );
}

/** زر عائم ثابت في زاوية الصفحات العامة (يمين الشاشة في العربية، يسارها في الإنجليزية). */
export default function WhatsAppFloatingButton({ message }) {
  const { t } = useTranslation();
  return (
    <a
      className="whatsapp-fab"
      href={buildWhatsAppLink(message ?? t("whatsapp.msgGeneral"))}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t("whatsapp.floatingLabel")}
      title={t("whatsapp.floatingLabel")}
    >
      <ChatBubbleIcon size={28} />
    </a>
  );
}
