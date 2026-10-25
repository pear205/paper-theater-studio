const {chromium}=require('playwright');
(async()=>{const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:1360,height:900},acceptDownloads:true});const p=await ctx.newPage();
const errs=[];p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});p.on('pageerror',e=>errs.push('PAGEERR '+e.message));
await p.goto('file://'+process.cwd()+'/../../prototype/paper-theater-studio.html');
await p.waitForFunction(()=>window.S&&S.cv,null,{timeout:90000}).catch(()=>{});
console.log('cv',await p.evaluate(()=>!!S.cv));
await p.screenshot({path:'s1.png'});
// clear layer 4 and grabcut rabbit by drag
await p.evaluate(()=>{S.active=3;renderLayers();document.getElementById('clearMask').click()});
const r=await p.$eval('#view',e=>{const b=e.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height}});
const X=v=>r.x+v*r.w/1200,Y=v=>r.y+v*r.h/800;
await p.mouse.move(X(570),Y(480));await p.mouse.down();await p.mouse.move(X(700),Y(600),{steps:5});await p.mouse.move(X(780),Y(710),{steps:5});await p.mouse.up();
await p.waitForTimeout(4000);
await p.screenshot({path:'s2.png'});
await p.click('#tab3d');await p.waitForTimeout(6000);
await p.screenshot({path:'s3.png'});
const [dl]=await Promise.all([p.waitForEvent('download',{timeout:60000}),p.click('#exportPdf')]);
await dl.saveAs('out.pdf');console.log('pdf saved');
console.log(errs.join('\n'));await b.close()})();
