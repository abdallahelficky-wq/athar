import React from "react";
import FormDialog from "../shared/FormDialog";

// نافذة الإيجارات: FormDialog بتنسيق lease-dialog (رأس ملوَّن حسب نوع الإجراء، حقول متراصّة، تذييل ثابت)
export default function LeaseDialog({ tone = "gold", width = 760, children, ...props }) {
  return <FormDialog {...props} className={`lease-dialog tone-${tone}`} style={{ maxWidth: width }}>{children}</FormDialog>;
}
