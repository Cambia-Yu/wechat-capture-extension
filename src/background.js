/**
 * 微信文章抓取器 - Background Service Worker v3.0
 * 
 * 飞书同步：优先 lark-cli（运行 install.sh 后自动检测），
 * 其次 API 直连（配置 App ID + Secret）。
 */

import { Zipper } from './lib/zipper.js';

let _capturing = false;
let _captureCache = null;
let _companionCache = { available: false, checkedAt: 0, detail: null };
const CACHE_TTL = 30000;

// ============================================================
// 消息路由
// ============================================================

chrome.runtime.onMessage.addListener((req, sender, sendResp) => {
  const ok = (p) => p.then(r => sendResp(r)).catch(e => sendResp({success:false, error:e.message}));
  switch (req.action) {
    case 'capture':
      if (_capturing) { sendResp({success:false, error:'正在处理中，请稍候...'}); return false; }
      _capturing = true; _captureCache = null;
      ok(handleCapture(req.tabId, { includeImages: req.includeImages !== false }).then(r => { _capturing = false; return r; }));
      return true;
    case 'getCaptureCache': sendResp(_captureCache || {success:false}); return false;
    case 'getCapturingStatus': sendResp({capturing:_capturing}); return false;
    case 'syncToFeishu': ok(handleFeishuSync(req.data, { includeImages: req.includeImages !== false })); return true;
    case 'checkFeishuStatus': ok(checkFeishuStatus()); return true;
    case 'testFeishuConnection': ok(testConnection(req.config)); return true;
    case 'resolveFeishuDestination': ok(resolveAndStoreDestination(req.input || '')); return true;
    case 'testFeishuDestination': ok(testFeishuDestination(req.destination)); return true;
    case 'clearFeishuDestinationFavorites': ok(clearFeishuDestinationFavorites()); return true;
  }
});

// ============================================================
// 进度 & 通知
// ============================================================

const progress = (step, detail) => {
  chrome.runtime.sendMessage({action:'captureProgress', step, detail}).catch(()=>{});
};

async function notify(title, msg, ok=true) {
  const s = await chrome.storage.local.get('behaviorConfig');
  if (!(s.behaviorConfig || {}).showNotification) return;
  chrome.notifications.create({
    type:'basic', iconUrl:'icons/icon128.png',
    title:(ok?'✅ ':'❌ ')+title, message:msg, priority:ok?1:2
  });
}

// ============================================================
// 核心抓取
// ============================================================

async function handleCapture(tabId, options = {}) {
  const settings = await chrome.storage.local.get(['saveConfig','feishuConfig','behaviorConfig']);
  const saveCfg = settings.saveConfig || {mode:'local',savePath:'微信文章存档',showSaveDialog:false};
  const mode = saveCfg.mode || 'local';

  progress('extracting','正在提取文章内容...');

  let extract;
  try {
    extract = await chrome.tabs.sendMessage(tabId, {action:'extractArticle'});
  } catch {
    try {
      await chrome.scripting.executeScript({target:{tabId},files:['src/content.js']});
      extract = await chrome.tabs.sendMessage(tabId, {action:'extractArticle'});
    } catch (err) {
      await notify('抓取失败','无法提取文章内容');
      return {success:false, error:'无法提取文章内容'};
    }
  }
  if (!extract || !extract.success) {
    await notify('抓取失败', extract?.error||'');
    return {success:false, error:extract?.error||''};
  }

  progress('converting','正在整理格式...');
  const markdown = buildMarkdown(extract);
  const extractedImages = extract.images || [];
  const total = extractedImages.length;

  const imgResults = [];
  for (let i=0;i<extractedImages.length;i++) {
    if(total>0) progress('downloading_images',`正在下载图片 (${i+1}/${total})...`);
    imgResults.push(await dlImg(extractedImages[i]));
  }

  const imgsB64 = imgResults.filter(r=>r.success).map(r=>({
    localName:r.localName,data:ab2b64(r.data),originalUrl:r.originalUrl
  }));
  const imageFailures = imgResults.filter(r=>!r.success).map(r=>({
    localName:r.localName,
    originalUrl:r.originalUrl,
    error:r.error || 'unknown_error',
    status:r.status || null
  }));

  const result = {
    success:true,
    title:extract.title,author:extract.author,publishTime:extract.publishTime,
    sourceUrl:extract.sourceUrl,markdown,images:imgsB64,
    markdownLength:markdown.length,imageCount:imgsB64.length,totalImages:imgResults.length,
    imageFailures
  };

  // ====== 飞书模式 / both 模式 → 同步 ======
  let feishuResult = null;
  if (mode==='feishu' || mode==='both') {
    progress('syncing','正在同步到飞书...');
    feishuResult = await handleFeishuSync(result, options);
    if (feishuResult.success) {
      result.feishuUrl = feishuResult.docUrl;
    } else {
      result.feishuError = feishuResult.authHint || feishuResult.error || '飞书同步失败';
      if (feishuResult.needConfig) result.needConfig = true;
      if (mode==='feishu') {
        await notify('同步失败', result.feishuError, false);
        return {success:false, error:result.feishuError, authHint:feishuResult.authHint, needConfig:feishuResult.needConfig};
      }
    }
  }

  // ====== 本地模式 / both 模式 → 下载 ======
  if (mode==='local' || mode==='both') {
    progress('packaging','正在打包 ZIP...');
    const safeTitle = sanitizeFilename(extract.title);
    const files = buildZipFiles(safeTitle,markdown,imgResults,extract);
    const zipBlob = await Zipper.createZip(files);

    progress('downloading','正在保存到本地...');
    const dataUrl = 'data:application/zip;base64,' + ab2b64(await zipBlob.arrayBuffer());
    const savePath = saveCfg.savePath || '微信文章存档';
    const filename = savePath ? savePath+'/'+safeTitle+'.zip' : safeTitle+'.zip';

    try {
      const downloadId = await chrome.downloads.download({url:dataUrl,filename,saveAs:saveCfg.showSaveDialog});
      result.downloaded = true;
      result.downloadId = downloadId;
      result.localFilename = filename;
      const items = await chrome.downloads.search({id: downloadId}).catch(()=>[]);
      result.localPath = items?.[0]?.filename || filename;
    }catch{}
  }

  const doneMessage = result.feishuError ? '本地已保存，飞书同步失败' : (mode==='feishu' ? '已推送到飞书' : '完成！');
  progress('done', doneMessage);
  await notify(result.feishuError ? '部分完成' : '抓取完成', result.feishuError || extract.title.substring(0,60), !result.feishuError);

  _captureCache = result;

  return result;
}

// ============================================================
// 工具函数
// ============================================================

function buildMarkdown(article) {
  const h=['# '+article.title,'','> 公众号: '+(article.author||'未知')];
  if(article.publishTime) h.push('> 发布时间: '+article.publishTime);
  h.push('> 原文链接: '+article.sourceUrl,'','---','');
  return h.join('\n')+'\n'+(article.markdown||'');
}
function sanitizeFilename(n){return n.replace(/[<>:"/\\|?*]/g,'').replace(/\s+/g,'_').substring(0,100).trim()}
function ab2b64(buf){const b=new Uint8Array(buf);let s='';for(let i=0;i<b.length;i++)s+=String.fromCharCode(b[i]);return btoa(s)}
async function dlImg(img){
  try{
    const r=await fetch(img.originalUrl,{mode:'cors',credentials:'omit'});
    if(!r.ok)return{...img,success:false,status:r.status,error:`http_${r.status}`};
    const bl=await r.blob();
    const ab=await bl.arrayBuffer();
    return{...img,success:true,data:new Uint8Array(ab),size:ab.byteLength,type:bl.type};
  }catch(e){return{...img,success:false,error:e?.message||String(e)||'fetch_failed'}}
}

function stripMarkdownImages(markdown) {
  return markdown
    .split('\n')
    .filter(line => !line.trim().match(/^!\[[^\]]*\]\([^)]+\)$/))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildFeishuPayload(data, options = {}) {
  const payload = options.includeImages !== false ? {...data} : {
    ...data,
    markdown: stripMarkdownImages(data.markdown || ''),
    images: [],
    imageCount: 0,
    feishuIncludeImages: false
  };
  if (options.destination) payload.destination = options.destination;
  return payload;
}

function parseFeishuDestination(input) {
  const value = String(input || '').trim();
  if (!value || value === 'default' || value === '默认') {
    return {mode:'default', label:'默认位置', source:''};
  }
  if (value === 'my_library' || value === '我的文档库') {
    return {mode:'parent_position', parentPosition:'my_library', label:'我的文档库', source:value};
  }

  const source = value.match(/^https?:\/\/[^\s]+/)?.[0] || value;
  const folder = source.match(/\/drive\/folder\/([^/?#]+)/);
  if (folder) return {mode:'parent_token', parentToken:folder[1], label:'飞书文件夹', source};
  const wiki = source.match(/\/wiki\/([^/?#]+)/);
  if (wiki) return {mode:'parent_token', parentToken:wiki[1], label:'知识库位置', source};
  if (/^sp[a-zA-Z0-9_-]+/.test(source)) {
    throw new Error('这个看起来是知识库空间 ID。请打开知识库里的具体页面/节点，再复制该页面的 /wiki/ 链接。');
  }
  const raw = source.match(/^([A-Za-z0-9_-]{8,})$/);
  if (raw) return {mode:'parent_token', parentToken:raw[1], label:'指定位置', source};
  throw new Error('请粘贴飞书文件夹链接、知识库节点链接，或填写 my_library');
}

function normalizeDestination(destination) {
  if (!destination || destination.mode === 'default') return {mode:'default', label:'默认位置'};
  if (destination.parentPosition) return {mode:'parent_position', parentPosition:destination.parentPosition, label:destination.label || '我的文档库', source:destination.source || ''};
  if (destination.parentToken) return {mode:'parent_token', parentToken:destination.parentToken, label:destination.label || '指定位置', source:destination.source || ''};
  return {mode:'default', label:'默认位置'};
}

async function resolveAndStoreDestination(input) {
  const destination = parseFeishuDestination(input);
  const checked = await testFeishuDestination(destination).catch(e => ({success:false, error:e.message}));
  const merged = {
    ...destination,
    label: checked.success && checked.label ? checked.label : destination.label,
    checkedAt: Date.now(),
    checkStatus: checked.success ? 'ok' : 'warn',
    checkMessage: checked.message || checked.error || ''
  };
  await chrome.storage.local.set({feishuDestination: merged});
  if (checked.success) await rememberFeishuDestination(merged);
  return {...checked, destination: merged, success: checked.success};
}

function destinationKey(destination) {
  if (!destination || destination.mode === 'default') return '';
  return destination.parentPosition || destination.parentToken || destination.source || '';
}

async function rememberFeishuDestination(destination) {
  const key = destinationKey(destination);
  if (!key) return;
  const s = await chrome.storage.local.get('feishuDestinationFavorites');
  const existing = Array.isArray(s.feishuDestinationFavorites) ? s.feishuDestinationFavorites : [];
  const normalized = normalizeDestination(destination);
  const item = {
    ...normalized,
    label: destination.label || normalized.label || '飞书位置',
    source: destination.source || normalized.source || key,
    lastUsedAt: Date.now()
  };
  const favorites = [item, ...existing.filter(d => destinationKey(d) !== key)].slice(0, 5);
  await chrome.storage.local.set({feishuDestinationFavorites: favorites});
}

async function clearFeishuDestinationFavorites() {
  await chrome.storage.local.set({feishuDestinationFavorites: []});
  return {success:true};
}

function buildZipFiles(st,md,ims,art){
  const f=[{name:st+'.md',data:md}];
  ims.filter(i=>i.success).forEach(i=>f.push({name:'images/'+i.localName,data:i.data}));
  const failures = ims.filter(i=>!i.success).map(i=>({
    localName:i.localName,
    originalUrl:i.originalUrl,
    status:i.status||null,
    error:i.error||'unknown_error'
  }));
  f.push({name:'metadata.json',data:JSON.stringify({
    sourceUrl:art.sourceUrl,
    title:art.title,
    author:art.author,
    publishTime:art.publishTime,
    captureTime:new Date().toISOString(),
    markdownFile:st+'.md',
    imageCount:ims.filter(i=>i.success).length,
    totalImages:ims.length,
    imageFailures:failures
  },null,2)});
  return f;
}

// ============================================================
// 飞书同步（lark-cli 优先，API 直连兜底）
// ============================================================

async function handleFeishuSync(data, options = {}) {
  const settings = await chrome.storage.local.get('feishuDestination');
  const destination = normalizeDestination(settings.feishuDestination);
  const payload = buildFeishuPayload(data, {...options, destination});
  const companionOk = await checkCompanionHealth();
  if (companionOk) {
    console.log('[飞书] lark-cli 通道');
    return syncViaCompanion(payload);
  }
  console.log('[飞书] API 直连通道');
  return syncViaAPI(payload);
}

async function checkCompanionHealth() {
  const now = Date.now();
  if (now - _companionCache.checkedAt < CACHE_TTL) return _companionCache.available;
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 1000);
    const r = await fetch('http://localhost:8765/health', { signal: c.signal });
    clearTimeout(t);
    const detail = await r.json().catch(() => null);
    const available = r.ok && detail?.larkCli === true;
    _companionCache = { available, checkedAt: now, detail };
    return available;
  } catch { _companionCache = { available: false, checkedAt: now, detail: null }; return false; }
}

async function syncViaCompanion(data) {
  try {
    const r = await fetch('http://localhost:8765/sync', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        title:data.title,
        markdown:data.markdown,
        images:data.images||[],
        sourceUrl:data.sourceUrl,
        destination:data.destination || {}
      })
    });
    return await r.json();
  } catch(e) { return {success:false, error:'lark-cli 通信失败: '+e.message}; }
}

async function syncViaAPI(data) {
  const s = await chrome.storage.local.get('feishuConfig');
  const c = s.feishuConfig || {};
  if (!c.appId || !c.appSecret) {
    return {success:false, needConfig:true, 
      error:'未配置飞书凭证。请在设置中填入飞书应用的 App ID 和 App Secret（一次配置，永久自动）。'};
  }
  try {
    const token = await Feishu.token(c.appId, c.appSecret);
    const doc = await Feishu.createFromMarkdown(token, data);
    return {
      success:true,
      docId:doc.document_id || doc.token || '',
      docUrl:doc.url || (doc.document_id ? `https://my.feishu.cn/docx/${doc.document_id}` : ''),
      imageCount:(data.images||[]).length,
      imagePlacement:'markdown_remote_url',
      destinationLabel:data.destination?.label || '',
      title:data.title
    };
  } catch (e) {
    return {success:false, error:'飞书 API 失败: '+e.message};
  }
}

// ============================================================
// 飞书 API Client
// ============================================================

const Feishu = {
  BASE:'https://open.feishu.cn/open-apis',
  async token(aid,asec){
    const r=await fetch(`${this.BASE}/auth/v3/tenant_access_token/internal`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({app_id:aid,app_secret:asec})});
    const d=await r.json();if(d.code!==0)throw new Error(`获取token失败(${d.code}):${d.msg}`);return d.tenant_access_token;
  },
  markdownWithRemoteImages(markdown,images=[]){
    let result=markdown||'';
    for(const img of images){
      if(!img.localName||!img.originalUrl)continue;
      result=result.replaceAll(`](images/${img.localName})`, `](${img.originalUrl})`);
      result=result.replaceAll(`](./images/${img.localName})`, `](${img.originalUrl})`);
    }
    return result;
  },
  async createFromMarkdown(token,data){
    const body={content:this.markdownWithRemoteImages(data.markdown||'',data.images||[]),format:'markdown'};
    const dest=normalizeDestination(data.destination);
    if(dest.parentPosition)body.parent_position=dest.parentPosition;
    if(dest.parentToken)body.parent_token=dest.parentToken;
    const r=await fetch(`${this.BASE}/docs_ai/v1/documents`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
    const d=await r.json();if(d.code!==0)throw new Error(`创建文档失败(${d.code}):${d.msg}`);return d.data.document || d.data;
  },
  async createDoc(token,title){
    const r=await fetch(`${this.BASE}/docx/v1/documents`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({title})});
    const d=await r.json();if(d.code!==0)throw new Error(`创建文档失败(${d.code}):${d.msg}`);return d.data.document;
  },
  async append(token,docId,md,images=[]){
    const {blocks,imageCount} = await this.md2b(md,token,images);
    for(let i=0;i<blocks.length;i+=50) await this.w(token,docId,docId,blocks.slice(i,i+50));
    return {imageCount};
  },
  async md2b(md,token,images=[]){
    const lines=md.split('\n'),blocks=[];let cur='',imageCount=0;
    const byName = new Map(images.map(img=>[img.localName,img]));
    for(const l of lines){
      const t=l.trim();if(!t){if(cur){blocks.push(this.p(cur));cur='';}continue}
      const imgMatch=t.match(/^!\[[^\]]*\]\((?:\.\/)?images\/([^)]+)\)$/);
      if(imgMatch){
        if(cur){blocks.push(this.p(cur));cur='';}
        const img=byName.get(imgMatch[1]);
        if(img){
          try{
            const ft=await this.upImg(token,img.data,img.localName);
            if(ft){blocks.push({block_type:27,image:{token:ft,width:640}});imageCount++;continue}
          }catch{}
        }
      }
      const h=t.match(/^(#{1,6})\s+(.+)/);if(h){if(cur){blocks.push(this.p(cur));cur='';}blocks.push(this.h(h[1].length,h[2]));continue}
      if(/^-{3,}$/.test(t)){if(cur){blocks.push(this.p(cur));cur='';}blocks.push({block_type:22});continue}
      cur+=(cur?'\n':'')+t;
    }
    if(cur)blocks.push(this.p(cur));return {blocks,imageCount};
  },
  p(c){return{block_type:2,text:{elements:[{text_run:{content:c}}],style:{}}}},
  h(lv,c){const o={block_type:3+lv};o[['','','','heading1','heading2','heading3','heading4','heading5','heading6'][3+lv]]={elements:[{text_run:{content:c}}],style:{}};return o},
  async w(token,docId,pid,blocks){await fetch(`${this.BASE}/docx/v1/documents/${docId}/blocks/${pid}/children`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({children:blocks,index:-1})})},
  async upImg(token,b64,fn){
    const bs=atob(b64),ab=new ArrayBuffer(bs.length),ia=new Uint8Array(ab);
    for(let i=0;i<bs.length;i++)ia[i]=bs.charCodeAt(i);
    const ext=fn.split('.').pop()||'jpeg';
    const m={jpeg:'image/jpeg',jpg:'image/jpeg',png:'image/png',gif:'image/gif',webp:'image/webp',bmp:'image/bmp'}[ext]||'image/jpeg';
    const fd=new FormData();fd.append('file',new Blob([ab],{type:m}),fn);fd.append('file_type','image');
    const r=await fetch(`${this.BASE}/drive/v1/medias/upload_all`,{method:'POST',headers:{Authorization:`Bearer ${token}`},body:fd});
    const d=await r.json();if(d.code!==0)throw new Error(`上传图片失败(${d.code})`);return d.data.file_token;
  },
  async insImg(token,docId,ft){await this.w(token,docId,docId,[{block_type:27,image:{token:ft,width:640}}])}
};

async function testFeishuDestination(destination) {
  const dest = normalizeDestination(destination);
  const companionOk = await checkCompanionHealth();
  if (companionOk) {
    try {
      const r = await fetch('http://localhost:8765/destination/inspect', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({destination:dest})
      });
      return await r.json();
    } catch(e) {
      return {success:false, error:'位置检测服务不可用: '+e.message};
    }
  }
  if (dest.mode === 'default' || dest.parentPosition || dest.parentToken) {
    return {success:true, label:dest.label || '指定位置', message:'位置格式有效；未检测到 lark-cli，实际写入权限将在同步时验证。'};
  }
  return {success:false, error:'位置格式无效'};
}

// ============================================================
// 状态查询
// ============================================================

async function checkFeishuStatus() {
  const companionOk = await checkCompanionHealth();
  const s = await chrome.storage.local.get('feishuConfig');
  const c = s.feishuConfig || {};
  const hasCred = !!(c.appId && c.appSecret);
  return {
    companionAvailable: companionOk,
    companionDetail: _companionCache.detail,
    hasCredentials: hasCred,
    ready: companionOk || hasCred
  };
}

async function testConnection(cfg) {
  if(!cfg.appId||!cfg.appSecret) return {ok:false, error:'请填写 App ID 和 App Secret'};
  try {await Feishu.token(cfg.appId,cfg.appSecret);return{ok:true,message:'连接成功！飞书应用凭证有效。'}}
  catch(e){return{ok:false,error:e.message};}
}

// ============================================================
// 初始化
// ============================================================

chrome.runtime.onInstalled.addListener(()=>{
  chrome.storage.local.get('feishuConfig',r=>{if(!r.feishuConfig)chrome.storage.local.set({feishuConfig:{appId:'',appSecret:''}})});
  chrome.storage.local.get('feishuDestination',r=>{if(!r.feishuDestination)chrome.storage.local.set({feishuDestination:{mode:'default',label:'默认位置',source:''}})});
  chrome.storage.local.get('saveConfig',r=>{if(!r.saveConfig)chrome.storage.local.set({saveConfig:{mode:'local',savePath:'微信文章存档',showSaveDialog:false}})});
  chrome.storage.local.get('behaviorConfig',r=>{if(!r.behaviorConfig)chrome.storage.local.set({behaviorConfig:{showNotification:true}})});
});
