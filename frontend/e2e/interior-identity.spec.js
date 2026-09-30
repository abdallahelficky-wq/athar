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

test('trial balance summary, category filter and printing share visible rows',async({page})=>{
 const node=(id,type,value)=>({accountId:id,code:id,name:id==='1'?'الأصول':'الالتزامات',type,level:1,isPosting:false,opening:{debit:0,credit:0},period:{debit:type==='asset'?value:0,credit:type==='liability'?value:0},closing:{debit:type==='asset'?value:0,credit:type==='liability'?value:0},children:[]});
 await page.route('**/api/reports/**',r=>r.fulfill({json:r.request().url().includes('trial-balance-tree')?{roots:[node('1','asset',1000),node('2','liability',1000)],summary:{assets:1000,liabilities:1000,equity:0,revenue:500,expense:650,netIncome:-150},totals:{openingDebit:0,openingCredit:0,periodDebit:1000,periodCredit:1000,closingDebit:1000,closingCredit:1000},balanced:true}:null}));
 await page.setViewportSize({width:1440,height:1000});await page.goto('/reports/trial');
 await expect(page.getByTestId('trial-assets')).toContainText('1,000');
 await expect(page.locator('.trial-table tbody tr')).toHaveCount(2);
 await page.screenshot({path:'test-results/trial-balance.png',fullPage:true});
 await page.locator('.trial-table').scrollIntoViewIfNeeded();
 await page.screenshot({path:'test-results/trial-table.png'});
 await page.addStyleTag({content:'.sidebar {transition:none!important;}'});
 await page.setViewportSize({width:390,height:844});
 await page.locator('.trial-summary-grid').scrollIntoViewIfNeeded();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'test-results/trial-mobile.png'});
 await page.setViewportSize({width:1440,height:1000});
 await page.getByRole('button',{name:'الأصول',exact:true}).click();
 await expect(page.locator('.trial-table tbody tr')).toHaveCount(1);
 await expect(page.getByTestId('trial-liabilities')).toContainText('1,000');
 await page.getByRole('button',{name:'طباعة',exact:true}).click();
 await expect(page.locator('.tb-print-table tbody tr')).toHaveCount(1);
 await expect(page.locator('.trial-print-summary')).toContainText('1,000');
 await page.screenshot({path:'test-results/trial-print.png',fullPage:true});
});


test('position permission matrix saves independent grants and assigns a user', async ({ page }) => {
 const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 const position={id:'p',name:'محاسب',matrixEnabled:true,matrix:{suppliers:{read:true}},actionLevels:{},members:[]};
 const resources=[{id:'suppliers',label:{ar:'الموردون',en:'Suppliers'},actions:['read','create','edit','delete']},{id:'salesInvoices',label:{ar:'فواتير المبيعات',en:'Sales invoices'},actions:['read','create','edit','delete','approve']}];
 let saved, assigned;
 await page.route('http://localhost:4000/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/auth/me')) return route.fulfill({json:{user:{id:'u',name:'المالك',role:'admin'},tenant:{id:'t',ownerId:'u',name:'شركة المعاينة'}}});
  if(!path.includes('/positions')) return route.fallback();
  let data=[];
  if(path.endsWith('/matrix-resources')) data=resources;
  else if(path.endsWith('/assignable-users')) data=[{id:'employee',name:'المستخدم التجريبي',email:'fixture@example.test',positionId:null}];
  else if(path.endsWith('/actions')) data={};
  else if(path.endsWith('/matrix')) { saved=route.request().postDataJSON().rows; data={...position,matrix:Object.fromEntries(saved.map(({resourceId,...grants})=>[resourceId,grants]))}; }
  else if(path.endsWith('/members')) { assigned=route.request().postDataJSON(); data=position; }
  else if(path.endsWith('/positions')) data=[position];
  await route.fulfill({json:data});
 });
 await page.setViewportSize({width:1440,height:1000});
 await page.goto('/settings/positions');
 const matrix=page.getByRole('region',{name:'مصفوفة الصلاحيات'});
 await expect(matrix).toBeVisible();
 await matrix.getByRole('checkbox',{name:'فواتير المبيعات — الإنشاء',exact:true}).check();
 await expect(matrix.getByRole('checkbox',{name:'فواتير المبيعات — الاعتماد / الترحيل',exact:true})).not.toBeChecked();
 await matrix.getByRole('searchbox').fill('فواتير');
 await matrix.getByRole('button',{name:'حفظ الصلاحيات',exact:true}).click();
 await expect(matrix.getByRole('status')).toHaveText('تم حفظ الصلاحيات.');
 expect(saved.find(r=>r.resourceId==='salesInvoices')).toMatchObject({create:true,approve:false,delete:false});
 expect(saved.find(r=>r.resourceId==='suppliers').read).toBe(true);
 await matrix.getByRole('searchbox').fill('');
 await page.screenshot({path:'test-results/position-matrix-desktop.png',fullPage:true});
 await page.getByRole('combobox',{name:'تعيين مستخدم للمنصب'}).selectOption('employee');
 await page.getByRole('button',{name:'تعيين المستخدم المحدد'}).click();
 await expect.poll(()=>assigned?.userId).toBe('employee');
 await page.addStyleTag({content:'.sidebar {transition:none!important}'});
 await page.setViewportSize({width:390,height:844});
 await expect(matrix).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await matrix.scrollIntoViewIfNeeded();
 await page.screenshot({path:'test-results/position-matrix-mobile.png',fullPage:true});
 expect(errors).toEqual([]);
});


for (const kind of ['journal_entry','purchase_invoice']) {
 test(`Office attachments upload and appear on ${kind}`, async ({page})=>{
  const files=[]; const payloads=[];
  await page.route('http://localhost:4000/api/attachments**',async route=>{
   if(route.request().method()==='POST') {
    const body=route.request().postDataBuffer().toString();payloads.push(body);
    const filename=/filename="([^"]+)"/.exec(body)?.[1];
    files.push({id:String(files.length),fileName:filename,fileSize:12,uploadedAt:'2026-09-30',fileUrl:'https://example.test/download/'+filename});
    return route.fulfill({json:files.at(-1)});
   }
   await route.fulfill({json:files});
  });
  if(kind==='journal_entry') {
   await page.route('http://localhost:4000/api/journal-entries**',r=>r.fulfill({json:[{id:'doc1',entryNumber:'J-1',date:'2026-09-30',status:'saved',memo:'test',lines:[]}]}));
   await page.goto('/accounts/journal');
   await page.locator('[data-entry-row="doc1"] button[aria-haspopup="menu"]').click();
   await page.getByRole('menuitem',{name:'المرفقات',exact:true}).click();
  } else {
   await page.route('http://localhost:4000/api/purchase-invoices**',r=>r.fulfill({json:[{id:'doc1',invoiceNumber:'P-1',date:'2026-09-30',status:'draft',grandTotal:100,supplier:{name:'Supplier'}}]}));
   await page.goto('/purchases/invoices');
   await page.getByTitle('المرفقات',{exact:true}).click();
  }
  const panel=page.locator('.attachments-panel');
  await expect(panel).toBeVisible();
  const input=panel.locator('input[type=file]');
  for(const [ext,mimeType] of [['doc','application/msword'],['docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document'],['xls','application/vnd.ms-excel'],['xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']]) {
   expect(await input.getAttribute('accept')).toContain('.'+ext);
   await input.setInputFiles({name:'attachment.'+ext,mimeType,buffer:Buffer.from('office-upload-fixture')});
   await expect(panel.getByRole('link',{name:'attachment.'+ext,exact:true})).toBeVisible();
   expect(payloads.at(-1)).toContain(kind); expect(payloads.at(-1)).toContain('doc1'); expect(payloads.at(-1)).toContain(mimeType);
  }
  expect(payloads).toHaveLength(4);
 });
}
