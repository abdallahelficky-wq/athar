import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BrowserMultiFormatReader } from "@zxing/browser";

/** يفتح كاميرا الجهاز ويقرأ باركود/QR مستمراً حتى يجد تطابقاً — يستخدم الكاميرا الخلفية افتراضياً. */
export default function BarcodeScannerModal({ onDetected, onClose }) {
  const { t } = useTranslation();
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const detectedRef = useRef(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const reader = new BrowserMultiFormatReader();
    let cancelled = false;

    reader
      .decodeFromConstraints(
        { video: { facingMode: "environment" } },
        videoRef.current,
        (result) => {
          if (result && !detectedRef.current && !cancelled) {
            detectedRef.current = true;
            onDetected(result.getText());
          }
        },
      )
      .then((controls) => { controlsRef.current = controls; })
      .catch(() => setError(t("pos.scanner.cameraError")));

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="pos-modal-overlay" onClick={onClose}>
      <div className="pos-scanner-box" onClick={(e) => e.stopPropagation()}>
        <div className="pos-scanner-header">
          <span>{t("pos.scanner.header")}</span>
          <button className="pos-icon-btn" onClick={onClose}>✕</button>
        </div>
        {error ? (
          <p className="m-error">{error}</p>
        ) : (
          <video ref={videoRef} className="pos-scanner-video" muted playsInline />
        )}
      </div>
    </div>
  );
}
