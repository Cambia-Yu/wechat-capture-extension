/**
 * 设置页面 v3.0
 * 飞书同步支持 lark-cli companion 和 API 直连。
 */

document.addEventListener('DOMContentLoaded', async () => {
  const el = id => document.getElementById(id);

  const s = await chrome.storage.local.get(['feishuConfig','saveConfig','behaviorConfig','feishuDestination','feishuDestinationFavorites']);
  const fc = s.feishuConfig || {};
  const sc = s.saveConfig || {mode:'local',savePath:'微信文章存档',showSaveDialog:false};
  const bc = s.behaviorConfig || {showNotification:true};
  const dest = s.feishuDestination || {mode:'default',label:'默认位置',source:''};

  el('appId').value = fc.appId || '';
  el('appSecret').value = fc.appSecret || '';
  el('savePath').value = sc.savePath || '';
  el('destinationInput').value = dest.source || (dest.parentPosition === 'my_library' ? 'my_library' : '');
  el('showSaveDialog').checked = sc.showSaveDialog;
  el('showNotification').checked = bc.showNotification;
  setDest(dest.checkStatus === 'ok' ? 'ok' : 'off', dest.label || '默认位置');
  renderFavoriteDestinations(Array.isArray(s.feishuDestinationFavorites) ? s.feishuDestinationFavorites : []);

  const modeCards = el('modeCards');
  const localOptions = el('localOptions');

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
    toast('常用位置已清空 ✓','ok');
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
});

async function saveDestination(persistToast){
  const input=document.getElementById('destinationInput').value.trim();
  const btn=document.getElementById('btnTestDestination');
  btn.disabled=true;btn.textContent='⏳ 检测中...';
  try{
    const r=await chrome.runtime.sendMessage({action:'resolveFeishuDestination',input});
    const dest=r.destination||{};
    const latest=await chrome.storage.local.get('feishuDestinationFavorites');
    renderFavoriteDestinations(Array.isArray(latest.feishuDestinationFavorites)?latest.feishuDestinationFavorites:[]);
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
