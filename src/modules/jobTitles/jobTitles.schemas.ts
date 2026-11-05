import { z } from "zod";

export const jobTitleNameSchema = z.string().trim().min(1, "اسم الوظيفة مطلوب").max(100, "اسم الوظيفة طويل جداً");

// الاسم الإنجليزي اختياري — يظهر حين تكون الواجهة إنجليزية، وفارغ = ارتداد للاسم العربي
export const jobTitleNameEnSchema = z.string().trim().max(100, "اسم الوظيفة طويل جداً").nullable().optional();

export const createJobTitleSchema = z.object({ name: jobTitleNameSchema, nameEn: jobTitleNameEnSchema });
export const updateJobTitleSchema = z.object({ name: jobTitleNameSchema, nameEn: jobTitleNameEnSchema });
