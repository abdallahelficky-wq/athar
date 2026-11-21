import { BlockList, isIP } from "node:net";
import { RequestHandler } from "express";

/**
 * عنوان العميل الحقيقي عندما يمرّ الطلب عبر Cloudflare (api.atharerp.com).
 *
 * المسار: العميل ← Cloudflare ← وكيل Railway ← الخادم. trust proxy (TRUST_PROXY_HOPS=1) يجعل req.ip
 * عنوان آخر وكيل قبل Railway، أي عنوان خادم Cloudflare نفسه لكل الطلبات — فتتشارك كل الطلبات المارّة
 * بنفس خادم Cloudflare عدّاد حدّ المحاولات نفسه (بوابة الموظف، OTP المتجر، publicRateLimit).
 *
 * الحل: إن كان req.ip ضمن نطاقات Cloudflare المنشورة، نأخذ CF-Connecting-IP (ترويسة يضعها Cloudflare
 * ويستبدل بها أي قيمة يرسلها العميل). وإن لم يكن (طلب مباشر على athar-production-*.up.railway.app)
 * تُتجاهَل الترويسة تماماً — لا يستطيع عميل مباشر انتحال عنوان بإرسالها بنفسه.
 *
 * النطاقات من https://www.cloudflare.com/ips-v4 و ips-v6 (تُحدَّث نادراً؛ راجعها عند أي تغيير).
 */
const CLOUDFLARE_V4 = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18",
  "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17",
  "162.158.0.0/15", "104.16.0.0/13", "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
];
const CLOUDFLARE_V6 = [
  "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32",
  "2a06:98c0::/29", "2c0f:f248::/32",
];

const cloudflare = new BlockList();
for (const cidr of CLOUDFLARE_V4) {
  const [net, bits] = cidr.split("/");
  cloudflare.addSubnet(net, Number(bits), "ipv4");
}
for (const cidr of CLOUDFLARE_V6) {
  const [net, bits] = cidr.split("/");
  cloudflare.addSubnet(net, Number(bits), "ipv6");
}

/** يزيل بادئة IPv4 المحوّلة لـIPv6 (::ffff:1.2.3.4) التي يضعها Node أحياناً. */
function normalize(ip: string): string {
  return ip.startsWith("::ffff:") && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip;
}

export function isCloudflareIp(ip: string | undefined): boolean {
  if (!ip) return false;
  const addr = normalize(ip);
  const family = isIP(addr);
  if (family === 4) return cloudflare.check(addr, "ipv4");
  if (family === 6) return cloudflare.check(addr, "ipv6");
  return false;
}

/** العنوان الذي تُبنى عليه حدود المحاولات: CF-Connecting-IP فقط إن جاء الطلب فعلاً من Cloudflare. */
export function resolveClientIp(proxyIp: string | undefined, cfConnectingIp: string | string[] | undefined): string | undefined {
  const header = Array.isArray(cfConnectingIp) ? cfConnectingIp[0] : cfConnectingIp;
  const candidate = header?.trim();
  if (candidate && isIP(candidate) && isCloudflareIp(proxyIp)) return normalize(candidate);
  return proxyIp;
}

/** يستبدل req.ip لهذا الطلب بعنوان العميل الحقيقي، فيعمل كل من يقرأ req.ip دون تعديل. */
export const cloudflareClientIp: RequestHandler = (req, _res, next) => {
  const ip = resolveClientIp(req.ip, req.headers["cf-connecting-ip"]);
  if (ip !== req.ip) Object.defineProperty(req, "ip", { value: ip, configurable: true, enumerable: true });
  next();
};
