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



test('income chart displays totals above existing dashboard cards',async({page})=>{
 await page.route('**/api/dashboard/income-expense-trend**',r=>r.fulfill({json:[{month:'2026-08',revenue:1000,expense:400},{month:'2026-09',revenue:850,expense:350}]}));
 await page.goto('/dashboard');
 await expect(page.getByTestId('revenue-total')).toContainText('1,850');
 await expect(page.getByTestId('expense-total')).toContainText('750');
 await expect(page.locator('.income-expense-chart .recharts-bar')).toHaveCount(2);
 await page.screenshot({path:'test-results/income-expense.png',fullPage:true});
});

test('bulk posting confirms, skips posted entries and retains failures',async({page})=>{
 const entries=[{id:'a',status:'saved'},{id:'b',status:'saved'},{id:'c',status:'posted'}].map(e=>({...e,entryNumber:e.id,date:'2026-09-29',memo:e.id,lines:[]}));
 const calls=[];
 await page.route('**/api/journal-entries**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname.endsWith('/post')) {
   calls.push(url.pathname);
   if(url.pathname.includes('/a/')) {entries[0].status='posted';await route.fulfill({json:entries[0]});}
   else await route.fulfill({status:400,json:{message:'القيد غير متوازن'}});
  } else await route.fulfill({json:entries});
 });
 await page.goto('/accounts/journal');
 await page.locator('thead input[type=checkbox]').check();
 const button=page.getByRole('button',{name:'ترحيل القيود المحددة (2)'});
 await expect(button).toBeEnabled();
 page.once('dialog',dialog=>dialog.dismiss());await button.click();expect(calls).toEqual([]);
 page.once('dialog',dialog=>dialog.accept());await button.click();
 await expect(page.getByRole('button',{name:'ترحيل القيود المحددة (1)'})).toBeEnabled();
 expect(calls).toEqual(['/api/journal-entries/a/post','/api/journal-entries/b/post']);
 await expect(page.locator('[data-entry-row=b] input[type=checkbox]')).toBeChecked();
 await expect(page.locator('[data-entry-row=a] input[type=checkbox]')).not.toBeChecked();
 await expect(page.getByRole('alert')).toContainText('b');
});
