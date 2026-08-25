import { RequestHandler } from "express";
import { askAtharAi } from "./ai.service";

export const askAiHandler: RequestHandler = async (req, res) => {
  const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
  if (!question) {
    res.status(400).json({ error: "السؤال مطلوب" });
    return;
  }
  if (question.length > 4000) {
    res.status(400).json({ error: "السؤال أطول من الحد المسموح" });
    return;
  }

  const context = req.body?.context;
  const result = await askAtharAi(question, context);
  res.json(result);
};
