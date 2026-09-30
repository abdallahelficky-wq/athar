import { z } from "zod";

export const jobTitleNameSchema = z.string().trim().min(1, "اسم الوظيفة مطلوب").max(100, "اسم الوظيفة طويل جداً");

export const createJobTitleSchema = z.object({ name: jobTitleNameSchema });
export const updateJobTitleSchema = z.object({ name: jobTitleNameSchema });
