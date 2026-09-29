import {test,expect} from '@playwright/test';
test.beforeEach(async({page})=>{
 page.on('pageerror',e=>console.log('PAGE ERROR',e.message));
 await page.addInitScript(()=>{localStorage.setItem('athar.accessToken','fixture');localStorage.setItem('athar.refreshToken','fixture');});
 await page.route('http://localhost:4000/api/**', async route=>{
  const path=new URL(route.request().url()).pathname;
  let data=[];
  if(path.endsWith('/auth/me')) data={user:{id:'u',name:'مستخدم المعاينة',role:'admin'},tenant:{id:'t',name:'شركة المعاينة'}};
  else if(path.endsWith('/companies')) data=[{id:'c',name:'شركة المعاينة',country:'SA',businessActivity:'general'}];
  else if(path.includes('financial-kpis')) data={salesCurrent:125000,netProfitEstimate:24000,cashBalance:86000,receivablesTotal:17000,payablesTotal:9000};
  else if(/financial-position|comprehensive-monthly|draft.*summary/.test(path)) data=null;
  await route.fulfill({json:data});
 });
});
test('desktop navigation and light identity',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width:1440,height:1000});await page.goto('/dashboard');
 await expect(page.locator('.nav-section-heading')).toHaveCount(5);
 await expect(page.locator('.sidebar')).toHaveCSS('background-color','rgb(255, 255, 255)');
 await expect(page.locator('.kpi-card').first()).toBeVisible();
 await page.screenshot({path:'test-results/interior-desktop.png',fullPage:true});
 await page.locator('a[href="/purchases/suppliers"]').first().click();
 await expect(page).toHaveURL(/purchases\/suppliers/);
 await page.screenshot({path:'test-results/interior-suppliers.png',fullPage:true});
 expect(errors).toEqual([]);
});
test('mobile menu opens and closes',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/dashboard');
 await page.locator('.hamburger-btn').click();await expect(page.locator('.sidebar-close-btn')).toBeVisible();
 await expect(page.locator('.sidebar')).toHaveCSS('transform','matrix(1, 0, 0, 1, 0, 0)');
 await page.screenshot({path:'test-results/interior-mobile.png',fullPage:true});
 await page.locator('.sidebar-close-btn').click();
 await expect(page.locator('.hamburger-btn')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});


