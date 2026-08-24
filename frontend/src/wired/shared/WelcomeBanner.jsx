import React from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../context/AuthContext";
import { dailyQuoteIndex } from "./dailyQuote";

/**
 * ترحيب شخصي أعلى لوحة القيادة — تحية حسب وقت اليوم الفعلي باسم المستخدم الحقيقي المسجَّل دخوله
 * (نفس user.name المستخدَم في UserMenu بالهيدر)، ومقولة يومية تحتها تتغيّر تلقائياً كل يوم عبر
 * فهرس حتمي (dayOfYear % عدد المقولات) — بلا أي طلب شبكة أو تخزين إضافي.
 */
export default function WelcomeBanner() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const hour = new Date().getHours();
  const greeting = hour < 12
    ? t("dashboard.welcome.greetingMorning", { name: user?.name || "" })
    : t("dashboard.welcome.greetingEvening", { name: user?.name || "" });

  const quotes = t("dashboard.dailyQuotes", { returnObjects: true });
  const quote = Array.isArray(quotes) ? quotes[dailyQuoteIndex(quotes.length)] : "";

  return (
    <div className="dashboard-welcome">
      <div className="dashboard-welcome-greeting">{greeting}</div>
      {quote && <div className="dashboard-welcome-quote">{quote}</div>}
    </div>
  );
}
