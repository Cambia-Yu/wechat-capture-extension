/**
 * 设置页面 v3.0
 * 飞书同步支持 lark-cli companion 和 API 直连。
 */

document.addEventListener('DOMContentLoaded', async () => {
  const el = id => document.getElementById(id);

  const s = await chrome.storage.local.get(['feishuConfig','saveConfig','behaviorConfig']);
  const fc = s.feishuConfig || {};
  const sc = s.saveConfig || {mode:'local',savePath:'微信文章存档',showSaveDialog:false};
  const bc = s.behaviorConfig || {showNotification:true};

  el('appId').value = fc.appId || '';
  el('appSecret').value = fc.appSecret || '';
  el('savePath').value = sc.savePath || '';
  el('showSaveDialog').checked = sc.showSaveDialog;
  el('showNotification').checked = bc.showNotification;

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
      : '未检测到 · 运行 install.sh 安装后台服务';
    setCompanion(st.companionAvailable?'ok':'off',
      companionMsg,
      detail.cliPath || '');
  }
});

function setApi(type,msg){
  const b=document.getElementById('apiBar'),d=document.getElementById('apiDot'),t=document.getElementById('apiText');
  b.className='sbar '+type;d.className='sdot '+(type==='ok'?'g':type==='warn'?'o':'x');t.textContent=msg;
}
function setCompanion(type,msg,title=''){
  const b=document.getElementById('companionBar'),d=document.getElementById('companionDot'),t=document.getElementById('companionText');
  b.className='sbar '+type;d.className='sdot '+(type==='ok'?'g':'x');t.textContent=msg;
  b.title=title;
}
function toast(msg,type){
  const t=document.getElementById('toast');t.className='toast '+type+' show';t.textContent=msg;
  clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove('show'),2500);
}
