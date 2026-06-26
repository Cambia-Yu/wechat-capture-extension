/**
 * 设置页面 v3.0
 * 飞书同步支持 lark-cli companion 和 API 直连。
 */

const DEFAULT_CSV_FIELDS = [
  {key:'statusText', label:'状态', enabled:true},
  {key:'title', label:'标题', enabled:true},
  {key:'sourceUrl', label:'原文链接', enabled:true},
  {key:'feishuUrl', label:'飞书链接', enabled:true},
  {key:'localPath', label:'本地路径', enabled:true},
  {key:'author', label:'公众号', enabled:false},
  {key:'publishTime', label:'发布时间', enabled:false},
  {key:'imageCount', label:'成功图片数', enabled:true},
  {key:'totalImages', label:'总图片数', enabled:true},
  {key:'mode', label:'保存方式', enabled:false},
  {key:'error', label:'错误信息', enabled:true},
  {key:'createdAt', label:'加入时间', enabled:false},
  {key:'finishedAt', label:'完成时间', enabled:false}
];

document.addEventListener('DOMContentLoaded', async () => {
  const el = id => document.getElementById(id);

  const s = await chrome.storage.local.get(['feishuConfig','saveConfig','behaviorConfig','feishuDestination','feishuDestinationFavorites','batchQueue','batchConfig','csvFieldConfig']);
  const fc = s.feishuConfig || {};
  const sc = s.saveConfig || {mode:'local',savePath:'微信文章存档',showSaveDialog:false};
  const bc = s.behaviorConfig || {showNotification:true};
  const dest = s.feishuDestination || {mode:'default',label:'默认位置',source:''};
  const favorites = Array.isArray(s.feishuDestinationFavorites) ? s.feishuDestinationFavorites : [];
  const batchCfg = s.batchConfig || {mode:'local',savePath:sc.savePath || '微信文章存档',destinationInput:'',includeImages:true};

  el('appId').value = fc.appId || '';
  el('appSecret').value = fc.appSecret || '';
  el('savePath').value = sc.savePath || '';
  el('destinationInput').value = dest.source || (dest.parentPosition === 'my_library' ? 'my_library' : '');
  el('showSaveDialog').checked = sc.showSaveDialog;
  el('showNotification').checked = bc.showNotification;
  setDest(dest.checkStatus === 'ok' ? 'ok' : 'off', dest.label || '默认位置');
  renderFavoriteDestinations(favorites);
  initBatchConfigUI(batchCfg, favorites);
  renderCsvFields(mergeCsvFields(s.csvFieldConfig));
  renderBatchQueue(Array.isArray(s.batchQueue) ? s.batchQueue : []);

  const modeCards = el('modeCards');
  const localOptions = el('localOptions');
  const workspaceTabs = el('workspaceTabs');
  const batchModeCards = el('batchModeCards');

  workspaceTabs.addEventListener('click', e => {
    const tab = e.target.closest('.workspace-tab');
    if (!tab) return;
    activateTab(tab.dataset.tab);
  });

  function setModeUI(mode) {
    modeCards.querySelectorAll('.mode-card').forEach(c=>c.classList.toggle('active',c.dataset.mode===mode));
    localOptions.classList.toggle('hidden',mode==='feishu');
  }
  setModeUI(sc.mode);

  modeCards.addEventListener('click',e=>{
    const card=e.target.closest('.mode-card');
    if(!card)return;
    setModeUI(card.dataset.mode);
    autoSave();
    toast('保存方式已更新 ✓','ok');
  });

  batchModeCards.addEventListener('click',e=>{
    const card=e.target.closest('.mode-card');
    if(!card)return;
    setBatchModeUI(card.dataset.mode);
    saveBatchConfig();
  });

  async function getFeishuCfg() {
    return (await chrome.storage.local.get('feishuConfig')).feishuConfig || {};
  }

  el('btnSaveAPI').addEventListener('click',async()=>{
    const cfg = await getFeishuCfg();
    cfg.appId = el('appId').value.trim();
    cfg.appSecret = el('appSecret').value.trim();
    chrome.storage.local.set({feishuConfig:cfg},()=>{toast('凭证已保存 ✓','ok');checkAll();});
  });

  el('btnTest').addEventListener('click',async()=>{
    const btn=el('btnTest');btn.disabled=true;btn.textContent='⏳ 测试中...';
    const aid=el('appId').value.trim(),asecret=el('appSecret').value.trim();
    if(!aid||!asecret){setApi('warn','请填写 App ID 和 App Secret');btn.disabled=false;btn.textContent='🔍 测试连接';return}
    const r=await chrome.runtime.sendMessage({action:'testFeishuConnection',config:{appId:aid,appSecret:asecret}});
    setApi(r.ok?'ok':'warn',r.ok?r.message:r.error);
    toast(r.ok?'连接成功 🎉':'连接失败',r.ok?'ok':'err');
    btn.disabled=false;btn.textContent='🔍 测试连接';
  });

  el('btnSaveDestination').addEventListener('click',async()=>{
    await saveDestination(true);
  });

  el('btnTestDestination').addEventListener('click',async()=>{
    await saveDestination(false);
  });

  el('btnResetDestination').addEventListener('click',async()=>{
    el('destinationInput').value = '';
    await saveDestination(true);
  });

  el('btnClearFavorites').addEventListener('click',async()=>{
    await chrome.runtime.sendMessage({action:'clearFeishuDestinationFavorites'});
    renderFavoriteDestinations([]);
    renderBatchFavoriteDestinations([]);
    toast('常用位置已清空 ✓','ok');
  });

  el('btnAddBatch').addEventListener('click', addBatchUrls);
  el('btnStartBatch').addEventListener('click', startBatchQueue);
  el('btnExportBatchCsv').addEventListener('click', exportBatchCsv);
  el('btnClearBatch').addEventListener('click', clearBatchQueue);
  el('batchQueueList').addEventListener('click', onBatchAction);
  el('panel-batch').addEventListener('click', onFoldToggle);
  el('csvFields').addEventListener('dragstart', onCsvDragStart);
  el('csvFields').addEventListener('dragover', onCsvDragOver);
  el('csvFields').addEventListener('drop', onCsvDrop);
  el('csvFields').addEventListener('dragend', onCsvDragEnd);
  el('csvFields').addEventListener('change', onCsvFieldToggle);
  el('btnResetCsvFields').addEventListener('click', resetCsvFields);
  el('batchSavePath').addEventListener('input',()=>setTimeout(saveBatchConfig,300));
  el('batchDestinationInput').addEventListener('input',()=>setTimeout(saveBatchConfig,300));
  el('batchIncludeImages').addEventListener('change',saveBatchConfig);
  el('btnBatchMyLibrary').addEventListener('click',()=>{
    el('batchDestinationInput').value='my_library';
    saveBatchConfig();
  });
  el('btnBatchDefaultDestination').addEventListener('click',()=>{
    el('batchDestinationInput').value='';
    saveBatchConfig();
  });
  el('batchFavoriteDestinations').addEventListener('click',e=>{
    const btn=e.target.closest('[data-source]');
    if(!btn)return;
    el('batchDestinationInput').value=btn.dataset.source || '';
    saveBatchConfig();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.batchQueue) renderBatchQueue(changes.batchQueue.newValue || []);
  });

  chrome.runtime.onMessage.addListener(msg => {
    if (msg.action !== 'batchProgress') return;
    if (msg.queue) renderBatchQueue(msg.queue);
    if (msg.step === 'start') setBatchTag('运行中');
    if (msg.step === 'done') setBatchTag('已完成');
  });

  function autoSave(){
    chrome.storage.local.set({
      saveConfig:{mode:modeCards.querySelector('.mode-card.active')?.dataset.mode||'local',savePath:el('savePath').value.trim(),showSaveDialog:el('showSaveDialog').checked},
      behaviorConfig:{showNotification:el('showNotification').checked}
    });
    const mode=modeCards.querySelector('.mode-card.active')?.dataset.mode||'local';
    localOptions.classList.toggle('hidden',mode==='feishu');
  }
  ['showSaveDialog','showNotification'].forEach(id=>el(id).addEventListener('change',autoSave));
  el('savePath').addEventListener('input',()=>setTimeout(autoSave,300));

  const gt=el('guideT'),gs=el('guideS');
  gt.addEventListener('click',()=>{const open=gs.classList.contains('collapsed');gs.classList.toggle('collapsed');gt.classList.toggle('open',open);gt.querySelector('.arr').textContent=open?'▼':'▶';});

  checkAll();
  async function checkAll(){
    const st=await chrome.runtime.sendMessage({action:'checkFeishuStatus'});
    setApi(st.hasCredentials?'ok':'off',st.hasCredentials?'已配置 · 就绪':'未配置');
    const detail = st.companionDetail || {};
    const version = (detail.cliVersion || '').replace(/^lark-cli version\s*/,'');
    const companionMsg = st.companionAvailable
      ? `lark-cli ${version || ''} 运行中 · 将自动使用`
      : '未检测到 · 运行 install.sh 一次后会自动常驻';
    setCompanion(st.companionAvailable?'ok':'off',
      companionMsg,
      detail.cliPath || '');
  }

  function saveBatchConfig(){
    chrome.storage.local.set({batchConfig:collectBatchConfig()});
  }
});

function activateTab(name){
  document.querySelectorAll('.workspace-tab').forEach(tab=>tab.classList.toggle('active',tab.dataset.tab===name));
  document.querySelectorAll('.tab-panel').forEach(panel=>panel.classList.toggle('active',panel.id===`panel-${name}`));
}

function onFoldToggle(event){
  const toggle=event.target.closest('[data-fold-toggle]');
  if(!toggle)return;
  toggle.closest('.fold-section')?.classList.toggle('collapsed');
}

function initBatchConfigUI(config, favorites){
  document.getElementById('batchSavePath').value = config.savePath || '微信文章存档';
  document.getElementById('batchDestinationInput').value = config.destinationInput || '';
  document.getElementById('batchIncludeImages').checked = config.includeImages !== false;
  setBatchModeUI(config.mode || 'local');
  renderBatchFavoriteDestinations(favorites || []);
}

function setBatchModeUI(mode){
  const normalized = ['local','feishu','both'].includes(mode) ? mode : 'local';
  document.querySelectorAll('#batchModeCards .mode-card').forEach(c=>c.classList.toggle('active',c.dataset.mode===normalized));
  document.getElementById('batchLocalOptions').classList.toggle('hidden',normalized==='feishu');
  document.getElementById('batchFeishuOptions').classList.toggle('hidden',normalized==='local');
}

function collectBatchConfig(){
  const mode = document.querySelector('#batchModeCards .mode-card.active')?.dataset.mode || 'local';
  return {
    mode,
    savePath: document.getElementById('batchSavePath').value.trim() || '微信文章存档',
    destinationInput: document.getElementById('batchDestinationInput').value.trim(),
    includeImages: document.getElementById('batchIncludeImages').checked
  };
}

function parseBatchUrls(text){
  return String(text||'')
    .split(/\s+/)
    .map(x=>x.trim())
    .filter(Boolean)
    .filter(x=>/^https?:\/\/mp\.weixin\.qq\.com\/s\//.test(x));
}

async function addBatchUrls(){
  const input=document.getElementById('batchUrls');
  const urls=parseBatchUrls(input.value);
  if(!urls.length){toast('没有识别到公众号文章链接','err');return}
  const s=await chrome.storage.local.get('batchQueue');
  const existing=Array.isArray(s.batchQueue)?s.batchQueue:[];
  const known=new Set(existing.map(item=>item.url));
  const now=Date.now();
  const additions=urls.filter(url=>!known.has(url)).map((url,index)=>({
    id:`q_${now}_${index}`,
    url,
    status:'pending',
    statusText:'待抓取',
    retryCount:0,
    createdAt:now
  }));
  const queue=[...existing,...additions];
  await chrome.storage.local.set({batchQueue:queue});
  input.value='';
  renderBatchQueue(queue);
  toast(additions.length?`已加入 ${additions.length} 条链接`:'这些链接已在队列中','ok');
}

async function startBatchQueue(){
  const btn=document.getElementById('btnStartBatch');
  btn.disabled=true;
  btn.textContent='运行中...';
  setBatchTag('运行中');
  try{
    const config=collectBatchConfig();
    await chrome.storage.local.set({batchConfig:config});
    const r=await chrome.runtime.sendMessage({action:'startBatchQueue',config});
    if(!r?.success)throw new Error(r?.error||'启动失败');
    toast('批量队列处理完成','ok');
  }catch(e){
    toast(e.message||'批量抓取失败','err');
  }finally{
    btn.disabled=false;
    btn.textContent='开始抓取';
    const s=await chrome.storage.local.get('batchQueue');
    renderBatchQueue(Array.isArray(s.batchQueue)?s.batchQueue:[]);
  }
}

async function clearBatchQueue(){
  await chrome.storage.local.set({batchQueue:[]});
  renderBatchQueue([]);
  toast('批量队列已清空 ✓','ok');
}

async function onBatchAction(event){
  const btn=event.target.closest('[data-batch-action]');
  if(!btn)return;
  const id=btn.dataset.id;
  const action=btn.dataset.batchAction;
  const s=await chrome.storage.local.get('batchQueue');
  const queue=Array.isArray(s.batchQueue)?s.batchQueue:[];
  const item=queue.find(x=>x.id===id);
  if(action==='openFeishu'&&item?.feishuUrl){chrome.tabs.create({url:item.feishuUrl});return}
  if(action==='copyFeishu'&&item?.feishuUrl){await copyText(item.feishuUrl,'已复制飞书链接');return}
  if(action==='showLocal'&&Number.isInteger(item?.downloadId)){chrome.downloads.show(item.downloadId);return}
  if(action==='copyLocal'&&item?.localPath){await copyText(item.localPath,'已复制本地地址');return}
  const next=queue.map(item=>{
    if(item.id!==id)return item;
    if(action==='skip')return {...item,status:'skipped',statusText:'已跳过',error:'',finishedAt:Date.now()};
    if(action==='retry')return {...item,status:'pending',statusText:item.retryCount?'已重试':'待抓取',retryCount:(item.retryCount||0)+1,error:''};
    return item;
  });
  await chrome.storage.local.set({batchQueue:next});
  renderBatchQueue(next);
}

function renderBatchQueue(queue){
  const box=document.getElementById('batchQueueList');
  if(!box)return;
  const list=Array.isArray(queue)?queue:[];
  if(!list.length){
    box.innerHTML='<div class="batch-empty">暂无批量任务</div>';
    setBatchTag('待开始');
    return;
  }
  const running=list.some(item=>item.status==='running');
  const pending=list.some(item=>['pending','retry'].includes(item.status));
  setBatchTag(running?'运行中':(pending?'待开始':'已完成'));
  box.innerHTML=list.map(item=>`
    <div class="batch-row">
      <div class="batch-status ${escapeHtml(item.status||'pending')}">${escapeHtml(item.statusText||'待抓取')}</div>
      <div class="batch-url" title="${escapeHtml(item.error||item.url)}">${escapeHtml(item.title||item.url)}</div>
      <div class="batch-result-actions">${renderBatchActions(item)}</div>
    </div>
  `).join('');
}

function renderBatchActions(item){
  const status=item.status||'pending';
  const buttons=[];
  if(item.feishuUrl){
    buttons.push(`<button class="batch-action" type="button" data-batch-action="openFeishu" data-id="${escapeHtml(item.id)}">打开飞书</button>`);
    buttons.push(`<button class="batch-action" type="button" data-batch-action="copyFeishu" data-id="${escapeHtml(item.id)}">复制链接</button>`);
  }
  if(Number.isInteger(item.downloadId)||item.localPath){
    if(Number.isInteger(item.downloadId))buttons.push(`<button class="batch-action" type="button" data-batch-action="showLocal" data-id="${escapeHtml(item.id)}">打开本地</button>`);
    if(item.localPath)buttons.push(`<button class="batch-action" type="button" data-batch-action="copyLocal" data-id="${escapeHtml(item.id)}">复制路径</button>`);
  }
  if(buttons.length)return buttons.join('');
  if(status==='pending'||status==='retry'){
    return `<button class="batch-action" type="button" data-batch-action="skip" data-id="${escapeHtml(item.id)}">跳过</button>`;
  }
  if(status==='failed'||status==='sync_failed'||status==='partial_image_failed'||status==='skipped'){
    return `<button class="batch-action" type="button" data-batch-action="retry" data-id="${escapeHtml(item.id)}">重试</button>`;
  }
  if(status==='running')return '<button class="batch-action" type="button" disabled>处理中</button>';
  return '<button class="batch-action" type="button" disabled>完成</button>';
}

function setBatchTag(text){
  const tag=document.getElementById('batchStateTag');
  if(tag)tag.textContent=text;
}

async function exportBatchCsv(){
  const s=await chrome.storage.local.get(['batchQueue','csvFieldConfig']);
  const queue=Array.isArray(s.batchQueue)?s.batchQueue:[];
  if(!queue.length){toast('没有可导出的批量记录','err');return}
  const fields=mergeCsvFields(s.csvFieldConfig).filter(f=>f.enabled);
  if(!fields.length){toast('请至少保留一个 CSV 字段','err');return}
  const csv=buildCsv(queue,fields);
  const url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));
  const filename=`微信文章批量结果_${formatDateForFilename(new Date())}.csv`;
  await chrome.downloads.download({url,filename,saveAs:true});
  setTimeout(()=>URL.revokeObjectURL(url),30000);
  toast('CSV 已生成','ok');
}

function buildCsv(queue,fields){
  const header=fields.map(f=>csvCell(f.label)).join(',');
  const rows=queue.map(item=>fields.map(f=>csvCell(csvValue(item,f.key))).join(','));
  return [header,...rows].join('\r\n');
}

function csvValue(item,key){
  if(key==='sourceUrl')return item.sourceUrl || item.url || '';
  if(key==='title')return item.title || item.url || '';
  const value=item?.[key];
  if(key==='createdAt'||key==='startedAt'||key==='finishedAt')return value?new Date(value).toLocaleString():'';
  if(key==='mode')return ({local:'本地',feishu:'飞书',both:'两者'})[value]||value||'';
  if(value===null||value===undefined)return '';
  return String(value);
}

function csvCell(value){
  const text=String(value??'');
  return `"${text.replace(/"/g,'""')}"`;
}

function formatDateForFilename(date){
  const pad=n=>String(n).padStart(2,'0');
  return `${date.getFullYear()}${pad(date.getMonth()+1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function mergeCsvFields(saved){
  const list=Array.isArray(saved)?saved:[];
  const byKey=new Map(DEFAULT_CSV_FIELDS.map(f=>[f.key,{...f}]));
  const merged=[];
  for(const field of list){
    if(!byKey.has(field.key))continue;
    const base=byKey.get(field.key);
    merged.push({...base,enabled:field.enabled!==false});
    byKey.delete(field.key);
  }
  return [...merged,...byKey.values()];
}

async function saveCsvFields(fields){
  await chrome.storage.local.set({csvFieldConfig:fields});
}

function renderCsvFields(fields){
  const box=document.getElementById('csvFields');
  if(!box)return;
  const list=mergeCsvFields(fields);
  box.innerHTML=list.map((field,index)=>`
    <div class="csv-field" data-index="${index}" draggable="true">
      <span class="csv-order">${index+1}</span>
      <span class="csv-drag" title="拖拽调整顺序">⋮⋮</span>
      <label title="${escapeHtml(field.label)}">
        <input type="checkbox" ${field.enabled?'checked':''} data-csv-toggle="${escapeHtml(field.key)}">
        <span>${escapeHtml(field.label)}</span>
      </label>
    </div>
  `).join('');
}

function onCsvDragStart(event){
  const row=event.target.closest('.csv-field');
  if(!row)return;
  row.classList.add('dragging');
  event.dataTransfer.effectAllowed='move';
  event.dataTransfer.setData('text/plain',row.dataset.index);
}

function onCsvDragOver(event){
  if(event.target.closest('.csv-field'))event.preventDefault();
}

async function onCsvDrop(event){
  const row=event.target.closest('.csv-field');
  if(!row)return;
  event.preventDefault();
  const from=Number(event.dataTransfer.getData('text/plain'));
  const to=Number(row.dataset.index);
  if(!Number.isInteger(from)||!Number.isInteger(to)||from===to)return;
  const s=await chrome.storage.local.get('csvFieldConfig');
  const fields=mergeCsvFields(s.csvFieldConfig);
  const [moved]=fields.splice(from,1);
  fields.splice(to,0,moved);
  await saveCsvFields(fields);
  renderCsvFields(fields);
}

function onCsvDragEnd(){
  document.querySelectorAll('.csv-field.dragging').forEach(row=>row.classList.remove('dragging'));
}

async function onCsvFieldToggle(event){
  const input=event.target.closest('[data-csv-toggle]');
  if(!input)return;
  const s=await chrome.storage.local.get('csvFieldConfig');
  const fields=mergeCsvFields(s.csvFieldConfig).map(field=>field.key===input.dataset.csvToggle?{...field,enabled:input.checked}:field);
  await saveCsvFields(fields);
  renderCsvFields(fields);
}

async function resetCsvFields(){
  const fields=DEFAULT_CSV_FIELDS.map(f=>({...f}));
  await saveCsvFields(fields);
  renderCsvFields(fields);
  toast('CSV 字段已恢复默认','ok');
}

async function copyText(text,message){
  try{
    await navigator.clipboard.writeText(text);
    toast(message,'ok');
  }catch{
    toast('复制失败','err');
  }
}

async function saveDestination(persistToast){
  const input=document.getElementById('destinationInput').value.trim();
  const btn=document.getElementById('btnTestDestination');
  btn.disabled=true;btn.textContent='⏳ 检测中...';
  try{
    const r=await chrome.runtime.sendMessage({action:'resolveFeishuDestination',input});
    const dest=r.destination||{};
    const latest=await chrome.storage.local.get('feishuDestinationFavorites');
    const favorites=Array.isArray(latest.feishuDestinationFavorites)?latest.feishuDestinationFavorites:[];
    renderFavoriteDestinations(favorites);
    renderBatchFavoriteDestinations(favorites);
    setDest(r.success?'ok':'warn', r.success ? `${dest.label||'默认位置'} · ${r.message||'可用'}` : (r.authHint||r.error||'检测失败'));
    if(persistToast)toast(r.success?'保存位置成功 ✓':'位置无法访问，请检查链接或权限',r.success?'ok':'err');
  }catch(e){
    setDest('warn',e.message);
    toast('保存位置失败','err');
  }finally{
    btn.disabled=false;btn.textContent='🔍 检测位置';
  }
}

function renderFavoriteDestinations(favorites){
  const box=document.getElementById('favoriteDestinations');
  const actions=document.getElementById('favoriteActions');
  if(!box||!actions)return;
  const list=(favorites||[]).slice(0,5);
  box.innerHTML=list.map(d=>`<span class="favorite-destination" title="${escapeHtml(d.source||'')}">${escapeHtml(d.label||d.source||'飞书位置')}</span>`).join('');
  actions.style.display=list.length?'flex':'none';
}

function renderBatchFavoriteDestinations(favorites){
  const box=document.getElementById('batchFavoriteDestinations');
  if(!box)return;
  const list=(favorites||[]).slice(0,5).filter(d=>d.source || d.parentPosition || d.parentToken);
  box.innerHTML=list.map(d=>{
    const source=d.source || d.parentPosition || d.parentToken || '';
    return `<span class="favorite-destination clickable" data-source="${escapeHtml(source)}" title="${escapeHtml(source)}">${escapeHtml(d.label||source||'飞书位置')}</span>`;
  }).join('');
}

function setApi(type,msg){
  const b=document.getElementById('apiBar'),d=document.getElementById('apiDot'),t=document.getElementById('apiText');
  b.className='sbar '+type;d.className='sdot '+(type==='ok'?'g':type==='warn'?'o':'x');t.textContent=msg;
}
function setCompanion(type,msg,title=''){
  const b=document.getElementById('companionBar'),d=document.getElementById('companionDot'),t=document.getElementById('companionText');
  b.className='sbar '+type;d.className='sdot '+(type==='ok'?'g':'x');t.textContent=msg;
  b.title=title;
}
function setDest(type,msg){
  const b=document.getElementById('destBar'),d=document.getElementById('destDot'),t=document.getElementById('destText');
  b.className='sbar '+type;d.className='sdot '+(type==='ok'?'g':type==='warn'?'o':'x');t.textContent=msg;
}
function toast(msg,type){
  const t=document.getElementById('toast');t.className='toast '+type+' show';t.textContent=msg;
  clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove('show'),2500);
}

function escapeHtml(value){
  return String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
