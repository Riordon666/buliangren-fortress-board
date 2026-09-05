import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import Database from 'better-sqlite3';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

// Run against the local preview and a database backup, never the live data folder.
const root = process.cwd();
const output = path.resolve(root, 'artifacts/theme-check');
const dbFile = path.join(output, 'naruto-fortress.db');
const base = new URL(process.env.THEME_BASE_URL || 'http://127.0.0.1:3100');
assert(['localhost', '127.0.0.1'].includes(base.hostname), 'Theme checks require a local preview.');
await fs.mkdir(output, { recursive: true });
await fs.access(dbFile);
const db = new Database(dbFile, { fileMustExist: true });
const admin = db.prepare("SELECT id FROM users WHERE role='admin' AND is_active=1 AND deleted_at IS NULL LIMIT 1").get();
assert(admin, 'The isolated database needs an administrator.');
const today = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const date = new Date(today+'T00:00:00Z');
date.setUTCDate(date.getUTCDate() - ((date.getUTCDay()+1)%7));
const saturday = date.toISOString().slice(0,10);
let previewWeek = db.prepare('SELECT id FROM weeks WHERE event_date=?').get(saturday);
if (!previewWeek) {
  const sourceWeek = db.prepare('SELECT id FROM weeks ORDER BY event_date DESC, id DESC LIMIT 1').get();
  const weekId = Number(db.prepare("INSERT INTO weeks(title,event_date,status) VALUES ('本地预览 · 视觉验收周',?,'published')").run(saturday).lastInsertRowid);
  db.prepare(`INSERT INTO weekly_scores(week_id,user_id,score)
    SELECT ?,u.id,COALESCE((SELECT score FROM weekly_scores WHERE user_id=u.id AND week_id=?),0)
    FROM users u WHERE u.is_active=1 AND u.account_type='member' AND u.deleted_at IS NULL`).run(weekId,sourceWeek?.id || 0);
  previewWeek = {id:weekId};
}
db.prepare('UPDATE users SET must_change_password=0 WHERE id=?').run(admin.id);
const token = randomBytes(32).toString('base64url');
const hash = createHash('sha256').update(token).digest('hex');
db.prepare('INSERT INTO sessions(user_id,token_hash,expires_at) VALUES (?,?,?)').run(admin.id,hash,new Date(Date.now()+3600000).toISOString());
const browser = await chromium.launch({executablePath:process.env.THEME_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless:true});
const findings=[];
const measurements=[];
async function inspect(page,label) {
  const size=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
  if(size.document>size.viewport+1) {
    const suspects=await page.locator('body *').evaluateAll(elements=>elements.filter(el=>el.getBoundingClientRect().right>innerWidth+1&&getComputedStyle(el).position!=='fixed').slice(0,15).map(el=>({tag:el.tagName,class:typeof el.className==='string'?el.className:'svg',right:Math.round(el.getBoundingClientRect().right)})));
    findings.push({label,...size,suspects});
  }
}
try {
 for (const width of [1440,1024,390,320]) {
  const publicContext=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});
  const themeAsset=await publicContext.request.get(new URL('/assets/konoha-village-v2.webp',base).href);
  assert.equal(themeAsset.status(),200,'The village background must be included in the running build');
  assert.match(themeAsset.headers()['content-type'] || '', /^image\/webp/);
  const privateContext=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});
  await privateContext.addCookies([{name:'fortress_session',value:token,url:base.origin,httpOnly:true,sameSite:'Strict'}]);
  if (process.env.THEME_PRODUCTION === '1') {
    await privateContext.addCookies([{name:'__Host-fortress_session',value:token,url:base.origin.replace('http:','https:'),httpOnly:true,secure:true,sameSite:'Strict'}]);
  }
  for(const route of ['/','/accessories','/login','/home','/scores','/packages','/reports','/compare','/profile','/admin']) {
   const isPublic=['/','/accessories','/login'].includes(route);
   const page=await (isPublic?publicContext:privateContext).newPage();
   const label=`${width}:${route}`;
   page.on('pageerror',()=>findings.push({label,error:'Uncaught browser exception'}));
   try {
    const response=await page.goto(new URL(route,base).href,{waitUntil:'networkidle',timeout:120000});
    assert(response?.ok(),`${label}: HTTP failure`);
    assert.equal(new URL(page.url()).pathname,route,`${label}: unexpected redirect`);
    assert(await page.locator('h1').first().isVisible(),`${label}: missing main heading`);
    for(const chart of await page.locator('.deferred-chart').all()) {
     await chart.scrollIntoViewIfNeeded();
     await chart.locator('svg.recharts-surface, .compact-empty').first().waitFor({state:'visible',timeout:30000});
    }
    await inspect(page,label);
    if (route==='/scores') {
     const rows=await page.locator('.score-table tbody tr').count();
     const labels=page.locator('.bar-score-label');
     assert.equal(await labels.count(),rows,'Every member must have a bar score label');
     assert.equal(await page.locator('.chart-bar').evaluate(el=>getComputedStyle(el).overflowY),'visible');
     const chartBox=await page.locator('.chart-bar').boundingBox();
     const labelRight=await labels.evaluateAll(elements=>Math.max(...elements.map(el=>el.getBoundingClientRect().right)));
     if(labelRight>chartBox.x+chartBox.width+1) findings.push({label,error:'Bar values clipped'});
     await page.getByRole('button',{name:'选择统计周'}).click();
     assert(await page.locator('.week-menu').isVisible());
     await inspect(page,label+':week-menu');
     const menuUsable = await page.locator('.week-menu > button').first().evaluate(element => {
       const box=element.getBoundingClientRect();
       return element.contains(document.elementFromPoint(box.x+box.width/2,box.y+box.height/2));
     });
     assert(menuUsable,'Week menu is covered by another panel');
     await page.keyboard.press('Escape');
     for(const tab of await page.getByRole('tab').all()) {
      await tab.click();
      await page.locator('.chart-stage svg.recharts-surface').first().waitFor({state:'visible'});
      await inspect(page,label+':chart-tab');
     }
     await page.getByRole('tab',{name:'横向柱状'}).click();
     await page.locator('.bar-score-label').first().waitFor();
    }
    if(route==='/accessories') {
     await page.getByRole('spinbutton',{name:'输入抗魔值'}).fill('29161');
     assert(await page.getByRole('region',{name:'抗魔值查询结果'}).getByText('祈愿',{exact:true}).isVisible());
     await inspect(page,label+':query');
    }
    if(route==='/compare') {
     await page.getByRole('button',{name:'排名趋势'}).click();
     assert.equal(await page.locator('.comparison-selects select').count(),3);
     await inspect(page,label+':rank');
    }
    if(route==='/admin') {
     await page.getByRole('button',{name:'管理账号',exact:true}).first().click();
     assert(await page.locator('.member-actions-popover').isVisible());
     await inspect(page,label+':account-menu');
     await page.keyboard.press('Escape');
    }
    if(route==='/home' && width<=900) {
     await page.getByRole('button',{name:'更多',exact:true}).click();
     assert(await page.getByRole('link',{name:'每周战报',exact:true}).isVisible());
     await inspect(page,label+':more');
     await page.getByRole('button',{name:'关闭更多菜单'}).click();
    }
    if(route==='/packages') assert.equal(await page.locator('.today-package-seat').count(),5,'Five package recipients should be visible');
    await page.evaluate(()=>scrollTo(0,0));
    if(width===1440||width===390) {
      const filename=(route==='/'?'public-home':route.slice(1))+'-'+width+'.png';
      await page.screenshot({path:path.join(output,filename),fullPage:false});
    }
    measurements.push({label,...await page.evaluate(()=>({bodyFont:getComputedStyle(document.body).fontSize,width:innerWidth,pageWidth:document.documentElement.scrollWidth}))});
    console.log('Checked '+label);
   } catch(error) {findings.push({label,error:error.message});}
   finally {await page.close();}
  }
  await publicContext.close();
  await privateContext.close();
 }
} finally {
 await browser.close();
 db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash);
 db.close();
}
await fs.writeFile(path.join(output,'results.json'),JSON.stringify({findings,measurements},null,2));
console.log(JSON.stringify({pages:measurements.length,findings},null,2));
process.exitCode=findings.length?1:0;
