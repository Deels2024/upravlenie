'use strict';
// Optional real-browser acceptance test; runtime application has no npm dependencies.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright-core');
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('node:assert/strict'),{spawn}=require('child_process');
const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'uk-browser-')),port=18989,base=`http://127.0.0.1:${port}`;
const env={...process.env,NODE_ENV:'test',HOST:'127.0.0.1',PORT:String(port),DB_FILE:path.join(tmp,'app.db'),UPLOAD_DIR:path.join(tmp,'uploads'),OWNER_LOGIN:'owner',OWNER_PASSWORD:'Browser-Acceptance-Only!'};
const server=spawn(process.execPath,['server.js'],{cwd:root,env,stdio:'ignore'});
let browser;const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{try{
 for(let n=0;n<50;n++){try{if((await fetch(base+'/healthz')).ok)break;}catch{}await pause(100);}
 const auth=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'owner',password:env.OWNER_PASSWORD})});const data=await auth.json(),headers={'content-type':'application/json',cookie:auth.headers.get('set-cookie').split(';')[0],'x-csrf-token':data.csrf};
 const post=async(url,body)=>{const r=await fetch(base+url,{method:'POST',headers,body:JSON.stringify(body)});assert.ok(r.ok,url+': '+r.status);return r.json();};
 const building=await post('/api/buildings',{name:'Торговый комплекс с очень длинным названием для проверки мобильной карточки',address:'Санкт-Петербург, длинный адрес, 136',area:1000,occupied:700});
 await post('/api/buildings',{name:'Второй объект',address:'Москва',area:500,occupied:200});
 await post('/api/tenants',{buildingId:building.id,company:'Тестовый арендатор',area:100,unit:'101'});
 const worker=(await post('/api/staff',{name:'Работник с длинной фамилией',email:'worker',password:'Browser-Worker-Only!',role:'technician',buildingIds:[building.id]})).user;
 for(let n=0;n<8;n++)await post('/api/issues',{buildingId:building.id,title:'Работа '+n,responsibleUserId:worker.id,due:'2020-01-01'});
 browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'],headless:true});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto(base);await page.locator('[name="email"]').fill('owner');await page.locator('[name="password"]').fill(env.OWNER_PASSWORD);await page.locator('#loginForm button[type="submit"]').click();await page.locator('#pageTitle').waitFor();
 const screenshots=process.env.SCREENSHOT_DIR;if(screenshots)fs.mkdirSync(screenshots,{recursive:true});
 for(const width of [320,390,1280]){
  await page.setViewportSize({width,height:844});await page.locator('[data-view="buildings"]:visible').click();await page.locator('#buildingSearch').fill('торговый');assert.equal(await page.locator('#buildingResults .building-card').count(),1);await page.locator('#buildingSearch').fill('');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'page overflow at '+width);
  for(const button of await page.locator('#buildingResults .building-actions .btn').all()){await button.scrollIntoViewIfNeeded();const box=await button.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1,'clipped object button at '+width);}
  await page.evaluate(()=>window.scrollTo(0,0));if(screenshots)await page.screenshot({path:path.join(screenshots,`objects-${width}.png`),fullPage:true});
  await page.locator(`[data-building="${building.id}"]`).click();assert.equal(await page.locator('#modal [data-issue]').count(),8);if(screenshots)await page.screenshot({path:path.join(screenshots,`detail-${width}.png`)});await page.locator('#buildingTask').scrollIntoViewIfNeeded();const taskBox=await page.locator('#buildingTask').boundingBox();assert.ok(taskBox.x>=0&&taskBox.x+taskBox.width<=width+1);await page.locator('#modal [data-close]').first().click();
 }
 await page.setViewportSize({width:390,height:844});await page.locator('[data-view="more"]:visible').click();await page.locator('[data-menu-view="admin"]').click();await page.locator('.staff-table').waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'admin overflow');if(screenshots)await page.screenshot({path:path.join(screenshots,'staff-390.png'),fullPage:true});
 await page.locator('[data-view="buildings"]:visible').click();await page.locator('#buildingInspection').click();assert.equal(await page.locator('[data-check-tenant]').count(),1,'first object tenant loads automatically');
 const photo={name:'photo.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII=','base64')};
 for(const n of [1,2,3])await page.locator('#exterior'+n).setInputFiles(photo);
 await page.locator('#inspectionForm [type="submit"]').click();await page.locator('#inspectionForm').waitFor({state:'detached'});
 await page.locator('[data-view="more"]:visible').click();await page.locator('[data-menu-view="admin"]').click();
 await page.locator('[data-edit-staff]').click();await page.locator('#staffForm [name="name"]').fill('Работник после изменения');await page.locator('#staffForm [type="submit"]').click();await page.locator('#staffForm').waitFor({state:'detached'});assert.ok((await page.locator('.staff-table').textContent()).includes('Работник после изменения'));
 await page.locator('[data-reset-staff]').click();await page.locator('#staffPasswordForm [name="password"]').fill('Browser-New-Password!');await page.locator('#staffPasswordForm [type="submit"]').click();await page.locator('#staffPasswordForm').waitFor({state:'detached'});
 await page.locator('[data-view="buildings"]:visible').click();await page.locator(`[data-building="${building.id}"]`).click();await page.locator('#buildingTask').click();await page.locator('#issueForm input[name="title"]').fill('Черновик после потери связи');
 await context.setOffline(true);await page.locator('#issueForm [type="submit"]').click();await page.waitForFunction(()=>document.querySelector('#issueForm')?.dataset.busy!=='1');assert.equal(await page.locator('#issueForm input[name="title"]').inputValue(),'Черновик после потери связи');
 await context.setOffline(false);await page.reload();await page.locator('#pageTitle').waitFor();await page.locator('[data-view="buildings"]:visible').click();await page.locator(`[data-building="${building.id}"]`).click();await page.locator('#buildingTask').click();await page.waitForFunction(()=>document.querySelector('#issueForm input[name="title"]').value==='Черновик после потери связи');
 await page.locator('#issuePhotos').setInputFiles({name:'photo.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII=','base64')});
 await page.locator('#issueForm [type="submit"]').click();await page.locator('#issueForm').waitFor({state:'detached'});const issues=await(await fetch(base+'/api/issues',{headers})).json();assert.equal(issues.filter(x=>x.title==='Черновик после потери связи').length,1);assert.equal(issues.find(x=>x.title==='Черновик после потери связи').photos.length,1);
 await page.locator(`[data-building="${building.id}"]`).click();await page.locator('#buildingTask').click();await page.locator('#issueForm [name="title"]').fill('Ответ сервера потерян');
 await page.route('**/api/issues',async route=>{if(route.request().method()==='POST'){await route.fetch();await route.abort('failed');}else await route.continue();});
 await page.locator('#issueForm [type="submit"]').click();await page.waitForFunction(()=>document.querySelector('#issueForm')?.dataset.busy!=='1');await page.unroute('**/api/issues');
 await page.locator('#issueForm [type="submit"]').click();await page.locator('#issueForm').waitFor({state:'detached'});const retried=await(await fetch(base+'/api/issues',{headers})).json();assert.equal(retried.filter(x=>x.title==='Ответ сервера потерян').length,1);
 const staffContext=await browser.newContext({viewport:{width:390,height:844}}),staffPage=await staffContext.newPage();staffPage.on('pageerror',e=>errors.push(e.message));await staffPage.goto(base);await staffPage.locator('[name="email"]').fill('worker');await staffPage.locator('[name="password"]').fill('Browser-New-Password!');await staffPage.locator('#loginForm [type="submit"]').click();await staffPage.locator('#pageTitle').waitFor();assert.equal(await staffPage.locator('[data-view="admin"]').count(),0);assert.equal((await staffContext.request.get(base+'/api/admin')).status(),403);
 assert.deepEqual(errors,[]);console.log('Browser: 320/390/1280 layouts, staff menu, offline draft restoration and photo task creation: OK');
 }finally{await browser?.close();server.kill('SIGTERM');}})().catch(e=>{console.error(e.stack);process.exitCode=1});
