import { z } from "zod";

const optionalText = z.string().trim().optional().nullable();
const optionalMoney = z.coerce.number().nonnegative().optional().nullable();

export const createStableSchema = z.object({
  companyId: z.string(), name: z.string().trim().min(2), code: optionalText, location: optionalText,
  managerName: optionalText, phone: optionalText, capacity: z.coerce.number().int().nonnegative().default(0),
  notes: optionalText,
});
export const updateStableSchema = createStableSchema.partial().omit({ companyId: true }).extend({ isArchived: z.boolean().optional() });

export const createStallSchema = z.object({
  companyId: z.string(), stableId: z.string(), number: z.string().trim().min(1), type: optionalText,
  dailyRate: optionalMoney, status: z.enum(["available", "occupied", "maintenance", "inactive"]).optional(), notes: optionalText,
});
export const updateStallSchema = createStallSchema.partial().omit({ companyId: true, stableId: true });

export const createHorseSchema = z.object({
  companyId: z.string(), stableId: z.string().optional().nullable(), stallId: z.string().optional().nullable(),
  name: z.string().trim().min(2), registrationNo: optionalText, microchipNo: optionalText, breed: optionalText,
  color: optionalText, sex: z.enum(["stallion", "mare", "gelding"]), birthDate: z.coerce.date().optional().nullable(),
  ownerName: optionalText, ownerPhone: optionalText,
  status: z.enum(["active", "training", "resting", "medical_hold", "sold", "deceased"]).optional(), notes: optionalText,
});
export const updateHorseSchema = createHorseSchema.partial().omit({ companyId: true });

const contractSchema = z.object({
  companyId: z.string(), stableId: z.string(), horseId: z.string(), stallId: z.string().optional().nullable(),
  startDate: z.coerce.date(), endDate: z.coerce.date().optional().nullable(), monthlyFee: z.coerce.number().nonnegative(),
  depositAmount: optionalMoney, contractNumber: optionalText, ownerName: z.string().trim().min(2), ownerNationality: optionalText,
  ownerNationalId: optionalText, ownerIdIssuePlace: optionalText, ownerPhone: optionalText,
  ownerEmail: z.string().trim().email().optional().nullable(), ownerCity: optionalText, ownerDistrict: optionalText,
  ownerStreet: optionalText, ownerBuildingNo: optionalText, ownerPostalCode: optionalText,
  status: z.enum(["active", "completed", "cancelled"]).optional(), notes: optionalText,
});
export const createContractSchema = contractSchema.refine((v) => !v.endDate || v.endDate >= v.startDate, { message: "تاريخ النهاية يجب أن يكون بعد تاريخ البداية", path: ["endDate"] });
export const updateContractSchema = contractSchema.partial().omit({ companyId: true });
export const sendContractEmailSchema = z.object({ email: z.string().trim().email().optional() });

export const createCareRecordSchema = z.object({
  companyId: z.string(), horseId: z.string(), type: z.enum(["veterinary", "vaccination", "farrier", "feeding", "training", "grooming", "medication", "other"]),
  performedAt: z.coerce.date(), provider: optionalText, description: z.string().trim().min(2), cost: optionalMoney,
  nextDueDate: z.coerce.date().optional().nullable(), notes: optionalText,
});
export const updateCareRecordSchema = createCareRecordSchema.partial().omit({ companyId: true, horseId: true });

export const trainerSchema = z.object({ companyId:z.string(), name:z.string().trim().min(2), phone:optionalText, email:z.string().email().optional().nullable(), specialties:optionalText, bio:optionalText, isActive:z.boolean().optional() });
export const lessonTypeSchema = z.object({ companyId:z.string(), name:z.string().trim().min(2), level:z.enum(["beginner","intermediate","advanced","competition"]), durationMinutes:z.coerce.number().int().positive(), format:z.enum(["individual","pair","group"]), capacity:z.coerce.number().int().positive(), price:z.coerce.number().nonnegative(), trainerId:optionalText, description:optionalText, isActive:z.boolean().optional() });
export const lessonSchema = z.object({ companyId:z.string(), lessonTypeId:z.string(), trainerId:z.string(), horseId:optionalText, studentName:z.string().trim().min(2), studentPhone:optionalText, scheduledAt:z.coerce.date(), participants:z.coerce.number().int().positive(), price:z.coerce.number().nonnegative(), status:z.enum(["scheduled","completed","cancelled","no_show"]).optional(), notes:optionalText });
export const competitionSchema = z.object({ companyId:z.string(), name:z.string().trim().min(2), discipline:z.string().trim().min(2), level:optionalText, location:z.string().trim().min(2), startDate:z.coerce.date(), endDate:z.coerce.date().optional().nullable(), registrationDeadline:z.coerce.date().optional().nullable(), entryFee:optionalMoney, horseId:optionalText, trainerId:optionalText, riderName:optionalText, status:z.enum(["planned","registered","completed","cancelled"]).optional(), result:optionalText, notes:optionalText });
export const careServiceSchema = z.object({ companyId:z.string(), code:optionalText, category:z.enum(["livery","nursing","veterinary","farrier","breeding","grooming","dental","training","competition","supplies","optional"]), nameAr:z.string().trim().min(2), nameEn:optionalText, price:optionalMoney, priceIncludesVat:z.boolean().optional(), unit:z.string().trim().min(1), isActive:z.boolean().optional() });
export const updateTrainerSchema=trainerSchema.partial().omit({companyId:true}); export const updateLessonTypeSchema=lessonTypeSchema.partial().omit({companyId:true}); export const updateLessonSchema=lessonSchema.partial().omit({companyId:true}); export const updateCompetitionSchema=competitionSchema.partial().omit({companyId:true}); export const updateCareServiceSchema=careServiceSchema.partial().omit({companyId:true});

