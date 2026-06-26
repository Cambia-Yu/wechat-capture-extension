/**
 * 微信文章抓取器 - Popup Script v3.0
 * 根据保存模式动态调整 UI
 */

let currentTabId = null;
let captureResult = null;
let feishuStatus = null;
let _clickLock = false;
let _saveMode = 'local';
let _feishuDocUrl = '';
let _localDownloadId = null;
let _localPath = '';

// ============================================================
// 初始化
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
  // --- DOM 引用 ---
  const $ = id => document.getElementById(id);
  const els = {
    btnCapture: $('btnCapture'),
    btnSync: $('btnSync'),
    btnOpenFeishu: $('btnOpenFeishu'),
    btnCopyFeishu: $('btnCopyFeishu'),
    btnShowLocal: $('btnShowLocal'),
    btnCopyLocal: $('btnCopyLocal'),
    tabFeishu: $('tabFeishu'),
    tabLocal: $('tabLocal'),
    btnSettings: $('btnSettings'),
    syncOptions: $('syncOptions'),
    includeImages: $('includeImages'),
    modeSwitcher: $('modeSwitcher'),
  };

  // --- 当前标签 ---
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab.id;

  const isWechat = tab.url && tab.url.includes('mp.weixin.qq.com/s/');
  if (!isWechat) {
    els.btnCapture.disabled = true;
    setButton(els.btnCapture, '⚠️', '非微信文章页面');
    setStatus('error', '请在微信公众号文章页面使用');
    return;
  }

  // --- 读取保存配置 ---
  const settings = await chrome.storage.local.get(['saveConfig', 'behaviorConfig']);
  _saveMode = (settings.saveConfig || {}).mode || 'local';

  renderSaveMode();

  // --- 事件绑定 ---
  els.btnCapture.addEventListener('click', onCapture);
  els.btnSync.addEventListener('click', onSync);
  els.btnOpenFeishu.addEventListener('click', openFeishuDoc);
  els.btnCopyFeishu.addEventListener('click', copyFeishuLink);
  els.btnShowLocal.addEventListener('click', showLocalFile);
  els.btnCopyLocal.addEventListener('click', copyLocalPath);
  els.tabFeishu.addEventListener('click', () => selectResultPanel('feishu'));
  els.tabLocal.addEventListener('click', () => selectResultPanel('local'));
  els.btnSettings.addEventListener('click', () => chrome.runtime.openOptionsPage());
  els.modeSwitcher.addEventListener('click', onModeSwitch);

  // --- 后台状态恢复 ---
  // 如果正在抓取中（popup 关闭后重开），显示进行中
  const capturingStatus = await chrome.runtime.sendMessage({ action: 'getCapturingStatus' });
  if (capturingStatus.capturing) {
    enterCapturingState();
  }

  // 如果有缓存结果，直接展示
  const cached = await chrome.runtime.sendMessage({ action: 'getCaptureCache' });
  if (cached && cached.success) {
    captureResult = cached;
    showPreview(cached);
    if (_saveMode === 'local') showDownloadActions();
    updateSyncOptionsVisibility();
    updateResultActions(cached);
    setStatus('success', buildCachedStatus(cached));
    setButton(els.btnCapture, '🔄', '重新抓取');
  }

  // 异步查飞书状态（不阻塞）
  chrome.runtime.sendMessage({ action: 'checkFeishuStatus' }).then(s => {
    feishuStatus = s;
    updateSyncButton();
  });

  // --- 后台进度监听 ---
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'captureProgress') {
      updateProgressUI(msg.step, msg.detail);
    }
  });
});

// ============================================================
// 抓取
// ============================================================

async function onCapture() {
  // 同步锁 —— 点击瞬间生效，不用等 await
  if (_clickLock) return;
  _clickLock = true;

  const btn = document.getElementById('btnCapture');
  enterCapturingState();

  try {
    const result = await chrome.runtime.sendMessage({
      action: 'capture',
      tabId: currentTabId,
      includeImages: getIncludeImages()
    });
    _clickLock = false;

    if (result.success) {
      captureResult = result;
      const doneMsg = result.feishuError ? '⚠️ 本地已保存，飞书同步失败' :
                      _saveMode === 'feishu' ? '☁️ 已推送到飞书！' :
                      _saveMode === 'both' ? '✅ 已保存本地并同步到飞书' :
                      '💾 ZIP 已保存到下载目录';
      updateProgressUI('done', doneMsg);
      showPreview(result);
      if (_saveMode === 'local') showDownloadActions();
      updateSyncOptionsVisibility();
      updateResultActions(result);
      if (result.feishuError) {
        setStatus('error', '飞书同步失败，本地 ZIP 已保存');
        showError(result.feishuError);
      } else {
        setStatus('success', '✅ 抓取完成');
      }
      setButton(btn, '🔄', '重新抓取');
      btn.disabled = false;
      setTimeout(() => hideProgress(), 3000);
    } else {
      exitCapturingState();
      setStatus('error', '抓取失败');
      showError(result.error || '未知错误');
      setButton(btn, '📥', '抓取文章');
      btn.disabled = false;
    }
  } catch (err) {
    _clickLock = false;
    exitCapturingState();
    setStatus('error', '通信失败');
    showError(err.message);
    setButton(btn, '📥', '抓取文章');
    btn.disabled = false;
  }
}

// ============================================================
// 飞书同步
// ============================================================

async function onSync() {
  if (!captureResult) return;
  const btn = document.getElementById('btnSync');
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-icon">⏳</span><span>同步中...</span>';
  setStatus('working', '正在同步到飞书...');

  try {
    const result = await chrome.runtime.sendMessage({
      action: 'syncToFeishu',
      data: captureResult,
      includeImages: getIncludeImages()
    });
    if (result.success) {
      if (result.docUrl) {
        captureResult = {...captureResult, feishuUrl: result.docUrl};
        showPreview(captureResult);
        updateResultActions(captureResult, 'feishu');
        setStatus('success', '✅ 已同步到飞书，可打开或复制链接');
      } else {
        setStatus('success', '✅ 已同步到飞书');
        showError('同步成功，但插件没有收到飞书文档链接。');
      }
      setButton(btn, '☁️', '重新同步');
      btn.onclick = null;
      btn.disabled = false;
    } else if (result.needConfig) {
      showError('请在「⚙️ 设置」中配置飞书 App ID 和 App Secret（一次配置，永久自动）。');
      setStatus('error', '飞书未配置');
      resetSyncButton();
    } else {
      showError(result.error || '飞书同步失败');
      setStatus('error', '同步失败');
      resetSyncButton();
    }
  } catch (err) {
    showError(err.message);
    setStatus('error', '同步失败');
    resetSyncButton();
  }
}

function resetSyncButton() {
  const btn = document.getElementById('btnSync');
  btn.disabled = false;
  btn.innerHTML = '<span class="btn-icon">☁️</span><span>同步到飞书</span>';
  btn.onclick = null;
}

async function onModeSwitch(event) {
  const btn = event.target.closest('.mode-switch');
  if (!btn || btn.dataset.mode === _saveMode) return;
  _saveMode = btn.dataset.mode;
  renderSaveMode();

  const current = (await chrome.storage.local.get('saveConfig')).saveConfig || {};
  await chrome.storage.local.set({
    saveConfig: {
      mode: _saveMode,
      savePath: current.savePath ?? '微信文章存档',
      showSaveDialog: current.showSaveDialog ?? false
    }
  });
  setStatus('success', `保存方式已切换为${modeName(_saveMode)}`);
}

function renderSaveMode() {
  const modeLabels = {
    local: ['📥', '抓取并保存本地'],
    feishu: ['☁️', '同步到飞书'],
    both: ['📥', '本地 + 飞书']
  };
  setButton(document.getElementById('btnCapture'), ...(modeLabels[_saveMode] || modeLabels.local));
  document.querySelectorAll('.mode-switch').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === _saveMode);
  });
  if (_saveMode === 'local' && captureResult) showDownloadActions();
  else hideDownloadActions();
  updateSyncOptionsVisibility();
}

function modeName(mode) {
  return ({local:'仅保存到本地', feishu:'仅同步到飞书', both:'本地 + 飞书'})[mode] || '仅保存到本地';
}

function updateSyncButton() {
  const btn = document.getElementById('btnSync');
  if (!feishuStatus) return;

  if (feishuStatus.companionAvailable) {
    btn.title = 'lark-cli 已就绪，点击同步到飞书';
    btn.style.opacity = '1';
  } else if (feishuStatus.hasCredentials) {
    btn.title = 'API 直连已配置，点击同步到飞书';
    btn.style.opacity = '1';
  } else {
    btn.title = '配置方式二选一：① 运行 install.sh 安装 lark-cli 后台服务  ② 在设置中填入 App ID + Secret';
    btn.style.opacity = '0.6';
  }
}

// ============================================================
// 状态管理
// ============================================================

function enterCapturingState() {
  _clickLock = true;
  const btn = document.getElementById('btnCapture');
  btn.disabled = true;
  setButton(btn, '⏳', '处理中...');
  setStatus('working', '正在抓取...');
  hideError(); hidePreview(); hideDownloadActions(); hideResultActions();
  showProgress(5, '准备中...');
}

function exitCapturingState() {
  _clickLock = false;
  hideProgress();
  const btn = document.getElementById('btnCapture');
  btn.disabled = false;
  setButton(btn, '📥', '抓取文章');
}

function updateProgressUI(step, detail) {
  const map = {
    extracting:         { pct: 10, text: '📄 提取文章内容...' },
    converting:         { pct: 25, text: '📝 转换为 Markdown...' },
    downloading_images: { pct: 50, text: detail },
    packaging:          { pct: 80, text: '📦 打包 ZIP...' },
    downloading:        { pct: 90, text: '💾 保存到本地...' },
    done:               { pct: 100, text: '✅ 完成！' }
  };
  const info = map[step] || { pct: 30, text: detail || '处理中...' };
  showProgress(info.pct, info.text);
  setStatus('working', info.text);
}

// ============================================================
// UI 工具
// ============================================================

function setStatus(type, text) {
  const icon = document.getElementById('statusIcon');
  const status = document.getElementById('statusText');
  icon.className = 'status-dot ' + type;
  status.textContent = text;
}

function showProgress(pct, text) {
  document.getElementById('progressArea').classList.remove('hidden');
  document.getElementById('progressFill').style.width = pct + '%';
  document.getElementById('progressText').textContent = text;
}
function hideProgress() {
  document.getElementById('progressArea').classList.add('hidden');
}

function showPreview(r) {
  const a = document.getElementById('previewArea');
  document.getElementById('previewTitle').textContent = r.title;
  document.getElementById('previewAuthor').textContent = (r.author || '未知');
  document.getElementById('previewTime').textContent = r.publishTime || '';
  let stats = `正文 ${r.markdownLength} 字 · 图片 ${r.imageCount}/${r.totalImages} 张`;
  if (r.feishuUrl) stats += ' · ✅ 已同步到飞书';
  else if (r.downloaded) stats += ' · 💾 已保存到本地';
  else stats += ' · ☁️ 已推送到飞书';
  document.getElementById('previewStats').textContent = stats;
  a.classList.remove('hidden');
}
function hidePreview() { document.getElementById('previewArea').classList.add('hidden'); }
function showDownloadActions() { document.getElementById('downloadActions').classList.remove('hidden'); }
function hideDownloadActions() { document.getElementById('downloadActions').classList.add('hidden'); }

function getIncludeImages() {
  return document.getElementById('includeImages')?.checked !== false;
}

function updateSyncOptionsVisibility() {
  const shouldShow = _saveMode === 'feishu' || _saveMode === 'both' || !!captureResult;
  document.getElementById('syncOptions').classList.toggle('hidden', !shouldShow);
}

function buildCachedStatus(result) {
  const hasFeishu = !!result?.feishuUrl;
  const hasLocal = Number.isInteger(result?.downloadId) || !!result?.localPath || !!result?.localFilename;
  if (hasFeishu && hasLocal) return '上次结果：已保存本地并同步到飞书';
  if (hasFeishu) return '上次结果：已同步到飞书';
  if (hasLocal) return '上次结果：ZIP 已下载';
  return '上次抓取结果';
}

function updateResultActions(result, preferredPanel) {
  _feishuDocUrl = result?.feishuUrl || '';
  _localDownloadId = Number.isInteger(result?.downloadId) ? result.downloadId : null;
  _localPath = result?.localPath || result?.localFilename || '';

  const hasFeishu = !!_feishuDocUrl;
  const hasLocal = _localDownloadId !== null || !!_localPath;
  document.getElementById('resultActions').classList.toggle('hidden', !(hasFeishu || hasLocal));
  document.getElementById('resultTabs').classList.toggle('hidden', !(hasFeishu && hasLocal));
  document.getElementById('tabFeishu').classList.toggle('hidden', !hasFeishu);
  document.getElementById('tabLocal').classList.toggle('hidden', !hasLocal);

  const panel = preferredPanel || (hasFeishu ? 'feishu' : 'local');
  selectResultPanel(panel);
}

function selectResultPanel(panel) {
  const showFeishu = panel === 'feishu' && !!_feishuDocUrl;
  const showLocal = panel === 'local' && (_localDownloadId !== null || !!_localPath);
  document.getElementById('feishuActions').classList.toggle('hidden', !showFeishu);
  document.getElementById('localActions').classList.toggle('hidden', !showLocal);
  document.getElementById('tabFeishu').classList.toggle('active', showFeishu);
  document.getElementById('tabLocal').classList.toggle('active', showLocal);
}

function hideResultActions() {
  _feishuDocUrl = '';
  _localDownloadId = null;
  _localPath = '';
  document.getElementById('resultActions').classList.add('hidden');
  document.getElementById('feishuActions').classList.add('hidden');
  document.getElementById('localActions').classList.add('hidden');
}

function openFeishuDoc() {
  if (!_feishuDocUrl) return;
  chrome.tabs.create({ url: _feishuDocUrl });
}

async function copyFeishuLink() {
  if (!_feishuDocUrl) return;
  const btn = document.getElementById('btnCopyFeishu');
  try {
    await navigator.clipboard.writeText(_feishuDocUrl);
    setButton(btn, '✅', '已复制');
    setStatus('success', '飞书链接已复制');
    setTimeout(() => setButton(btn, '⧉', '复制链接'), 1600);
  } catch (err) {
    showError('复制失败：' + (err.message || '请手动打开文档后复制地址'));
  }
}

function showLocalFile() {
  if (_localDownloadId === null) return;
  chrome.downloads.show(_localDownloadId);
}

async function copyLocalPath() {
  if (!_localPath) return;
  const btn = document.getElementById('btnCopyLocal');
  try {
    await navigator.clipboard.writeText(_localPath);
    setButton(btn, '✅', '已复制');
    setStatus('success', '本地地址已复制');
    setTimeout(() => setButton(btn, '⧉', '复制本地地址'), 1600);
  } catch (err) {
    showError('复制失败：' + (err.message || '请在下载记录中查看文件位置'));
  }
}

function showError(msg) {
  const a = document.getElementById('errorArea');
  document.getElementById('errorText').textContent = msg;
  a.classList.remove('hidden');
}
function hideError() { document.getElementById('errorArea').classList.add('hidden'); }

function setButton(btn, icon, text) {
  btn.innerHTML = `<span class="btn-icon">${icon}</span><span>${text}</span>`;
}
