import { Request, RequestHandler } from "express";
import { isTenantOwner } from "../../middleware/auth";
import * as authService from "./auth.service";
import { translateMessage } from "../../lib/i18n/translate";
import { clearRefreshCookie, readRefreshCookie, refreshTokenFrom, sendSession } from "../../lib/refreshCookie";
import { unauthorized } from "../../lib/httpError";

export const registerHandler: RequestHandler = async (req, res) => {
  const result = await authService.register(req.body, req.lang);
  sendSession(req, res, result, 201);
};

export const loginHandler: RequestHandler = async (req, res) => {
  const result = await authService.login(req.body, req.ip);
  sendSession(req, res, result);
};

export const refreshHandler: RequestHandler = async (req, res) => {
  const token = refreshTokenFrom(req);
  if (!token) throw unauthorized("رمز التحديث غير صالح أو منتهي الصلاحية");
  const result = await authService.refresh(token);
  sendSession(req, res, result);
};

export const logoutHandler: RequestHandler = async (req, res) => {
  const token = refreshTokenFrom(req);
  if (token) await authService.logout(token);
  clearRefreshCookie(res);
  res.status(204).send();
};

export const completeLoginChoiceHandler: RequestHandler = async (req, res) => {
  const result = await authService.completeLoginChoice(req.body.identityToken, req.body.userId);
  sendSession(req, res, result);
};

export const switchAccountHandler: RequestHandler = async (req, res) => {
  const result = await authService.switchAccount(req.auth!.sub, req.body.userId);
  // في وضع الكوكي لا تملك الواجهة رمز الجلسة السابقة لتُبطله بنفسها بعد التبديل (كما تفعل بالرمز في
  // الجسم) — فيُبطَل هنا قبل أن يحلّ الكوكي الجديد محلّه. logout() تُبطل فقط رمزاً لم يُبطَل بعد.
  const previous = readRefreshCookie(req);
  if (previous) await authService.logout(previous);
  sendSession(req, res, result);
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
  sendSession(req, res, result);
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
