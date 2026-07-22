import { RequestHandler } from "express";
import { registerLeaveReturn } from "../leaveSettlements/leaveSettlements.service";

export const createHandler: RequestHandler = async (req, res) => {
  res.status(201).json(await registerLeaveReturn(req.auth!.tenantId, req.body.employeeId, req.body.returnDate));
};
