import {test,expect} from "@playwright/test";
const url="/e2e/fixtures/public-brand.html";
test("public identity preserves content, logo, navigation and responsive layouts",async({page})=>{
 const errors=[];page.on("pageerror",e=>errors.push(e.message));
 await page.setViewportSize({width:1440,height:1000});await page.goto(url);await page.evaluate(()=>document.fonts.ready);
 await expect(page.locator(".landing-logo")).toHaveAttribute("src","/brand/athar-logo-horizontal.png");
 await expect(page.locator(".pricing-card")).toHaveCount(3);
 await expect(page.locator(".landing-root")).toHaveCSS("background-color","rgb(10, 10, 10)");
 await expect(page.locator("h1")).toHaveCSS("font-family",'Tajawal, sans-serif');
 await page.screenshot({path:"test-results/brand-landing-desktop.png",fullPage:true});
 for(const [selector,target] of [[".landing-nav .btn-primary","register"],[".landing-nav .btn-ghost:not(.landing-download-link)","protection"]]){
  await page.locator(selector).first().click();await expect(page.getByTestId("destination")).toContainText(target);await page.getByRole("button",{name:"Back",exact:true}).click();
 }
 await page.locator(".language-switcher-btn").click();await expect(page.locator("html")).toHaveAttribute("dir","ltr");
 await page.screenshot({path:"test-results/brand-landing-en.png",fullPage:true});
 await page.locator(".language-switcher-btn").click();
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:"test-results/brand-landing-mobile.png",fullPage:true});
 await page.locator(".landing-nav").getByRole("button",{name:"تسجيل الدخول",exact:true}).click();
 await expect(page.locator(".auth-logo")).toHaveAttribute("src","/brand/athar-logo-horizontal.png");
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:"test-results/brand-login-mobile.png",fullPage:true});
 await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:"test-results/brand-login-desktop.png",fullPage:true});
 await page.getByRole("button",{name:"دخول",exact:true}).click();await expect(page.locator(".balance-bad")).toBeVisible();
 expect(errors).toEqual([]);
});
test("login submission and account choice remain functional",async({page})=>{
 let request;
 await page.route("**/api/auth/login",async route=>{request=route.request().postDataJSON();await route.fulfill({json:{chooseAccount:true,identityToken:"fixture-only",accounts:[{userId:"u1",tenantName:"Test company"}]}});});
 await page.goto(url);await page.locator(".landing-nav").getByRole("button",{name:"تسجيل الدخول",exact:true}).click();
 await page.getByLabel("البريد الإلكتروني").fill("test@example.com");await page.getByLabel("كلمة المرور",{exact:true}).fill("test-only");await page.getByLabel("كلمة المرور",{exact:true}).press("Enter");
 await expect(page.getByRole("button",{name:"Test company"})).toBeVisible();expect(request).toMatchObject({email:"test@example.com",password:"test-only"});
 await expect(page.locator(".auth-root")).toHaveClass(/public-brand/);
});

test("apps navigation is in the header and both downloads are preserved",async({page})=>{
 await page.setViewportSize({width:1440,height:1000});await page.goto(url);
 await expect(page.locator(".landing-footer .landing-download-link")).toHaveCount(0);
 await page.locator(".landing-nav").getByRole("button",{name:"تطبيقات أثر"}).click();
 await expect(page.locator(".download-entry")).toHaveCount(2);
 await expect(page.locator('a[download="athar-pos.apk"]')).toHaveAttribute("href","/app/athar-pos.apk");
 await expect(page.locator('a[download="athar-station.apk"]')).toHaveAttribute("href","/app/athar-station.apk");
 const boxes=await page.locator(".download-entry").evaluateAll(els=>els.map(e=>({x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y})));
 expect(boxes[0].y).toBe(boxes[1].y);expect(boxes[0].x).not.toBe(boxes[1].x);
 await page.screenshot({path:"test-results/brand-apps-desktop.png",fullPage:true});
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:"test-results/brand-apps-mobile.png",fullPage:true});
});
