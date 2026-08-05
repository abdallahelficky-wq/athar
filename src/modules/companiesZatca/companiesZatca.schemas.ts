import { z } from "zod";

export const generateCsrSchema = z.object({
  production: z.boolean().default(false),
  solutionName: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
});

export const complianceOtpSchema = z.object({
  otp: z.string().min(1),
});

export const setEnvironmentSchema = z.object({
  environment: z.enum(["sandbox", "simulation", "production"]),
});
