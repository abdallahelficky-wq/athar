import { Request, RequestHandler } from "express";
import { isTenantOwner } from "../../middleware/auth";
import * as authService from "./auth.service";
import { translateMessage } from "../../lib/i18n/translate";

export const registerHandler: RequestHandler = async (req, res) => {
  const result = await authService.register(req.body, req.lang);
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

export const completeLoginChoiceHandler: RequestHandler = async (req, res) => {
  const result = await authService.completeLoginChoice(req.body.identityToken, req.body.userId);
  res.json(result);
};

export const switchAccountHandler: RequestHandler = async (req, res) => {
  const result = await authService.switchAccount(req.auth!.sub, req.body.userId);
  res.json(result);
};

async function userActor(auth: NonNullable<Request["auth"]>): Promise<authService.UserActor> {
  return { id: auth.sub, role: auth.role, isOwner: auth.role === "super_admin" || await isTenantOwner(auth) };
}

export const inviteHandler: RequestHandler = async (req, res) => {
  const result = await authService.invite(req.auth!.tenantId, req.body, req.lang, await userActor(req.auth!));
  res.status(201).json(result);
};

export const updateUserHandler: RequestHandler = async (req, res) => {
  const result = await authService.updateUser(req.auth!.tenantId, await userActor(req.auth!), req.params.id, req.body);
  res.json(result);
};

export const listUsersHandler: RequestHandler = async (req, res) => {
  const users = await authService.listUsers(req.auth!.tenantId);
  res.json(users);
};

export const resendInviteHandler: RequestHandler = async (req, res) => {
  const result = await authService.resendInvite(req.auth!.tenantId, req.params.id, req.lang);
  res.json(result);
};

export const setUserActiveHandler: RequestHandler = async (req, res) => {
  const result = await authService.setUserActive(req.auth!.tenantId, req.auth!.sub, req.params.id, req.body.active);
  res.json(result);
};

export const deleteUserHandler: RequestHandler = async (req, res) => {
  res.json(await authService.deleteUser(req.auth!.tenantId, req.auth!.sub, req.params.id));
};

export const getInviteInfoHandler: RequestHandler = async (req, res) => {
  const result = await authService.getInviteInfo(String(req.query.token ?? ""));
  res.json(result);
};

export const acceptInviteHandler: RequestHandler = async (req, res) => {
  const result = await authService.acceptInvite(req.body);
  res.json(result);
};

export const changeUnlockPinHandler: RequestHandler = async (req, res) => {
  await authService.changeUnlockPin(req.auth!.tenantId, req.auth!.sub, req.body.currentPin, req.body.newPin);
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
  const message = await authService.forgotPassword(req.body.email, req.lang);
  res.json({ message: translateMessage(message, req.lang) });
};

export const resetPasswordHandler: RequestHandler = async (req, res) => {
  await authService.resetPassword(req.body.token, req.body.password);
  res.json({ message: translateMessage("تم تعيين كلمة المرور الجديدة بنجاح. سجّل الدخول بها الآن.", req.lang) });
};
