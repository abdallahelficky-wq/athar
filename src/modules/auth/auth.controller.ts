import { RequestHandler } from "express";
import * as authService from "./auth.service";

export const registerHandler: RequestHandler = async (req, res) => {
  const result = await authService.register(req.body);
  res.status(201).json(result);
};

export const loginHandler: RequestHandler = async (req, res) => {
  const result = await authService.login(req.body);
  res.json(result);
};

export const refreshHandler: RequestHandler = async (req, res) => {
  const result = await authService.refresh(req.body.refreshToken);
  res.json(result);
};

export const logoutHandler: RequestHandler = async (req, res) => {
  await authService.logout(req.body.refreshToken);
  res.status(204).send();
};

export const inviteHandler: RequestHandler = async (req, res) => {
  const result = await authService.invite(req.auth!.tenantId, req.body);
  res.status(201).json(result);
};

export const acceptInviteHandler: RequestHandler = async (req, res) => {
  const result = await authService.acceptInvite(req.body);
  res.json(result);
};

export const changeUnlockPinHandler: RequestHandler = async (req, res) => {
  await authService.changeUnlockPin(req.auth!.tenantId, req.body.currentPin, req.body.newPin);
  res.status(204).send();
};

export const updateTenantHandler: RequestHandler = async (req, res) => {
  const tenant = await authService.updateTenantName(req.auth!.tenantId, req.body.name);
  res.json({ tenant });
};

export const meHandler: RequestHandler = async (req, res) => {
  const result = await authService.getMe(req.auth!.sub);
  res.json(result);
};

export const updateMeHandler: RequestHandler = async (req, res) => {
  const user = await authService.updateMyName(req.auth!.sub, req.body.name);
  res.json({ user });
};

export const forgotPasswordHandler: RequestHandler = async (req, res) => {
  const message = await authService.forgotPassword(req.body.email);
  res.json({ message });
};

export const resetPasswordHandler: RequestHandler = async (req, res) => {
  await authService.resetPassword(req.body.token, req.body.password);
  res.json({ message: "تم تعيين كلمة المرور الجديدة بنجاح. سجّل الدخول بها الآن." });
};
