import { RequestHandler } from "express";
import { prisma } from "../../lib/prisma";

/** الموظفون بمستندات تنتهي خلال عدد أيام معيّن — مطابق لـ collectExpiringEmployeeDocs */
export const expiringDocumentsHandler: RequestHandler = async (req, res) => {
  const { companyId, withinDays, docType } = req.query;
  const days = typeof withinDays === "string" ? Number(withinDays) : 30;
  const today = new Date();
  const cutoff = new Date(today.getTime() + days * 86_400_000);

  const employees = await prisma.employee.findMany({
    where: { tenantId: req.auth!.tenantId, companyId: typeof companyId === "string" ? companyId : undefined },
    include: { documents: true },
  });

  const rows = employees.flatMap((emp) =>
    emp.documents
      .filter((d) => d.expiryDate && d.expiryDate <= cutoff && (!docType || d.type === docType))
      .map((d) => ({
        employeeId: emp.id,
        employeeName: emp.name,
        companyId: emp.companyId,
        doc: d,
        days: Math.floor(((d.expiryDate as Date).getTime() - today.getTime()) / 86_400_000),
      })),
  );

  rows.sort((a, b) => a.days - b.days);
  res.json(rows);
};
