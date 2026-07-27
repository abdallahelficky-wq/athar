import React, { useCallback, useEffect, useState } from "react";

/** Toast مشترك بسيط: useToast() يوفّر notify(message, type) + <ToastHost /> يعرضها */
export function useToast() {
  const [toast, setToast] = useState(null);

  const notify = useCallback((message, type = "success") => {
    setToast({ message, type, key: Date.now() });
  }, []);

  return { toast, notify, dismiss: () => setToast(null) };
}

export function ToastHost({ toast, onDismiss }) {
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(onDismiss, 3500);
    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  if (!toast) return null;
  return (
    <div className={"app-toast" + (toast.type === "error" ? " app-toast-error" : "")} onClick={onDismiss}>
      {toast.message}
    </div>
  );
}
