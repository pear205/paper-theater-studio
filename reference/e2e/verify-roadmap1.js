// 로드맵 1번(버그 1, 2) 확인: 시작 레이어가 2번인지, GrabCut이 기존 마스크를 지우지 않고 더하기만 하는지
const {chromium}=require('playwright');
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1360,height:900}});
const errs=[];p.on('pageerror',e=>errs.push('PAGEERR '+e.message));
await p.goto('file://'+process.cwd()+'/../../prototype/paper-theater-studio.html');
await p.waitForFunction(()=>window.S&&S.cv,null,{timeout:90000}).catch(()=>{});
console.log('cv',await p.evaluate(()=>!!S.cv));
console.log('start active (expect 1):',await p.evaluate(()=>S.active));
// 풀밭과 토끼(4번, index 3) 레이어에서 기존 마스크를 지우지 않고 토끼 범위 드래그
const count=()=>p.evaluate(()=>{const d=S.layers[3].mask.getContext('2d').getImageData(0,0,S.W,S.H).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i]>127)n++;return n});
await p.evaluate(()=>{S.active=3;S.tool='rect';renderLayers();render()});
const before=await count();
const snap=await p.evaluate(()=>Array.from(S.layers[3].mask.getContext('2d').getImageData(0,0,S.W,S.H).data.filter((_,i)=>i%4===3)));
const r=await p.$eval('#view',e=>{const b=e.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height}});
const X=v=>r.x+v*r.w/1200,Y=v=>r.y+v*r.h/800;
await p.mouse.move(X(570),Y(480));await p.mouse.down();await p.mouse.move(X(780),Y(710),{steps:8});await p.mouse.up();
await p.waitForTimeout(4000);
const after=await count();
const lost=await p.evaluate(s=>{const d=S.layers[3].mask.getContext('2d').getImageData(0,0,S.W,S.H).data;let n=0;for(let i=0;i<s.length;i++)if(s[i]>127&&d[i*4+3]<=127)n++;return n},snap);
console.log('mask px before/after:',before,after,'lost px (expect 0):',lost);
console.log(errs.join('\n'));await b.close()})();
