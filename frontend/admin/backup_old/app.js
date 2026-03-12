let S='',T='',files=[],sel=new Set(),dragN='',sheetTarget='',treeData=[],curPath='',expanded={},statsData={},slugMap={};
let importDraft={type:'',zipFile:null,folderEntries:[],sourceName:'',preferredDest:''};
let showAnalytics=false,analyticsData=null,showGridTool=false,showManage=false,gridState={file:null,fileName:'',previewBlob:null,previewUrl:''};
const $=id=>document.getElementById(id);
const DOMAIN=window.__DOMAIN__||'photo.xaihub.de';
const BASE=window.__BASE__||'';
const MAX_MB=window.__MAX_MB__||25;
const APP_VERSION=window.__APP_VERSION__||'dev';
const APP_BUILD_TIME=window.__APP_BUILD_TIME__||'local';

// Constants for cookies
const ADMIN_KEY_COOKIE = 'pushfile_admin_key';
const ADMIN_KEY_MAX_AGE = 6 * 24 * 60 * 60; // 6 days

function toast(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2000)}
function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}
async function api(path,opts){const r=await fetch(BASE+'/'+path,opts||{});const j=await r.json().catch(()=>({detail:'error'}));if(!r.ok)throw new Error(j.detail||'fail');return j}

function getCookie(name){
  const all=document.cookie||'';
  if(!all)return '';
  const parts=all.split(/;\s*/);
  for(const p of parts){
    const i=p.indexOf('=');
    const k=i>=0?p.slice(0,i):p;
    if(k===name){
      const v=i>=0?p.slice(i+1):'';
      try{return decodeURIComponent(v)}catch(_){return v}
    }
  }
  return '';
}

function setAdminKeyCookie(key){
  document.cookie=ADMIN_KEY_COOKIE+'='+encodeURIComponent(key)+'; path=/admin; max-age='+ADMIN_KEY_MAX_AGE+'; SameSite=Strict';
}

function clearAdminKeyCookie(){
  document.cookie=ADMIN_KEY_COOKIE+'=; path=/admin; max-age=0; SameSite=Strict';
}

async function connect(key,opts){
  const isAuto=!!(opts&&opts.auto);
  const toastSuccess=!(opts&&opts.toastSuccess===false);
  const toastFailure=!(opts&&opts.toastFailure===false);
  const rememberEl=$('remember');
  const inputEl=$('secret');

  S=((key!=null?String(key):(inputEl?inputEl.value:''))||'').trim();
  if(!S){if(toastFailure)toast('请输入密码');return false}
  try{
    await api('api/tokens?key='+encodeURIComponent(S));
    $('connBadge').textContent='已连接';
    $('connBadge').style.color='var(--green)';
    $('loginSection').style.display='none';
    $('mainSection').style.display='';
    
    if(rememberEl && rememberEl.checked) {
      setAdminKeyCookie(S);
    }
    
    await loadTree();
    await loadDashboardStats();
    if(toastSuccess) toast('连接成功');
    return true;
  }catch(e){
    if(toastFailure) toast('密码错误');
    S='';
    clearAdminKeyCookie();
    return false;
  }
}

async function loadDashboardStats() {
  try {
    const d = await api('api/analytics', {headers:{'X-Upload-Key':S}});
    const today = Number(d.today_visit_count||0)||0;
    const albums = Object.keys(d.by_token||{}).length;
    
    const dashToday = $('dashTodayViews');
    if(dashToday) dashToday.textContent = today;
    
    const dashAlbums = $('dashAlbumCount');
    if(dashAlbums) dashAlbums.textContent = albums;
  } catch(e) {
    console.error('Failed to load dashboard stats', e);
  }
}

async function loadTree(){
  const d=await api('api/folders/tree?key='+encodeURIComponent(S));
  treeData=d.tree||[];
  try{statsData=await api('api/stats?key='+encodeURIComponent(S))}catch(_){statsData={}}
  slugMap={};buildSlugMap(treeData);
  renderTree();
}

function buildSlugMap(nodes){for(const n of nodes){if(n.slug)slugMap[n.path]=n.slug;if(n.children)buildSlugMap(n.children)}}

// Navigation Logic
function hideAllPanels() {
  $('dashboardGrid').style.display = 'none';
  $('dashboardRecent').style.display = 'none';
  $('analyticsPanel').style.display = 'none';
  $('gridPanel').style.display = 'none';
  $('adminPanel').style.display = 'none';
  showAnalytics = false;
  showGridTool = false;
  showManage = false;
}

function showDashboard() {
  hideAllPanels();
  $('dashboardGrid').style.display = 'grid';
  $('dashboardRecent').style.display = 'block';
  loadDashboardStats();
}

function openManage() {
  if(!S) return toast('请先连接');
  hideAllPanels();
  showManage = true;
  const panel = $('adminPanel');
  panel.style.display = 'block';
  
  // Add back button if not exists
  if(!panel.querySelector('.nav-header')) {
    const header = document.createElement('div');
    header.className = 'nav-header';
    header.innerHTML = `
      <button class="back-btn" onclick="showDashboard()">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
        返回
      </button>
      <h2 class="panel-title">文件管理</h2>
    `;
    panel.insertBefore(header, panel.firstChild);
  }
}

function toggleAnalytics(){
  if(!S) return toast('请先连接');
  hideAllPanels();
  showAnalytics = true;
  const panel = $('analyticsPanel');
  panel.style.display = 'block';
  
  panel.innerHTML = `
    <div class="nav-header">
      <button class="back-btn" onclick="showDashboard()">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
        返回
      </button>
      <h2 class="panel-title">数据统计</h2>
    </div>
    <div class="group"><div class="group-box"><div class="row"><span class="row-label">加载中</span><span class="row-value">请稍候…</span></div></div></div>
  `;
  
  api('api/analytics',{headers:{'X-Upload-Key':S}})
    .then(renderAnalytics)
    .catch(e => {
      panel.innerHTML += '<div class="group"><div class="group-box"><div class="row"><span class="row-label">错误</span><span class="row-value">'+esc(e.message)+'</span></div></div></div>';
    });
}

function renderAnalytics(d){
  const panel=$('analyticsPanel');if(!panel)return;
  const total=Number(d.total_visit_count||0)||0;
  const today=Number(d.today_visit_count||0)||0;
  const uniq=Number(d.unique_ip_count||0)||0;
  const byCity=d.by_city||{};
  const cityTop=Object.entries(byCity).sort((a,b)=>Number(b[1]||0)-Number(a[1]||0)).slice(0,8);
  const rows=cityTop.map(([k,v])=>'<div class="row"><span class="row-label">'+esc(k||'未知')+'</span><span class="row-value">'+(Number(v)||0)+'</span></div>').join('')||'<div class="row"><span class="row-label">暂无</span><span class="row-value">0</span></div>';
  
  // Keep header
  const header = panel.querySelector('.nav-header').outerHTML;
  
  panel.innerHTML= header +
    '<div class="group"><div class="group-label">统计概览</div><div class="bento-grid" style="grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 24px;">' +
    '<div class="bento-card" style="padding: 16px;"><div class="stat-value">'+today+'</div><div class="stat-label">今日访问</div></div>' +
    '<div class="bento-card" style="padding: 16px;"><div class="stat-value">'+total+'</div><div class="stat-label">总访问</div></div>' +
    '<div class="bento-card" style="padding: 16px;"><div class="stat-value">'+uniq+'</div><div class="stat-label">独立 IP</div></div>' +
    '<div class="bento-card" style="padding: 16px;"><div class="stat-value">'+Object.keys(d.by_token||{}).length+'</div><div class="stat-label">相册数</div></div>' +
    '</div></div>' +
    '<div class="group"><div class="group-label">城市分布（TOP 8）</div><div class="group-box">'+rows+'</div></div>';
}

function toggleGridTool(){
  if(!S) return toast('请先连接');
  hideAllPanels();
  showGridTool = true;
  const panel = $('gridPanel');
  panel.style.display = 'block';
  
  if(!panel.querySelector('.nav-header')) {
    const header = document.createElement('div');
    header.className = 'nav-header';
    header.innerHTML = `
      <button class="back-btn" onclick="showDashboard()">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
        返回
      </button>
      <h2 class="panel-title">九宫格创作</h2>
    `;
    
    // Add basic grid tool UI
    const content = document.createElement('div');
    content.innerHTML = `
      <div class="group">
        <div class="group-box">
          <div class="upload-zone" id="gridUploadZone" onclick="gridChooseFile()">
            <div class="icon" style="font-size: 48px; margin-bottom: 16px;">🔲</div>
            <p style="font-size: 16px; font-weight: 500; margin-bottom: 8px;">点击选择图片，或拖拽到此</p>
            <small style="color: var(--sub);">推荐正方形高清图 · 支持 JPG/PNG</small>
          </div>
          <input id="gridFileInput" type="file" accept="image/*" style="display:none" onchange="handleGridFileChange(this.files)">
        </div>
      </div>
      <div class="group" id="gridPreviewSection" style="display:none">
        <div class="group-label">预览</div>
        <div class="grid-preview" id="gridPreview"></div>
        <div style="display: flex; gap: 12px; margin-top: 16px;">
          <button class="btn btn-secondary" style="flex: 1" onclick="generateGridPreview()">生成预览</button>
          <button class="btn btn-primary" style="flex: 1" id="gridSaveBtn" onclick="saveGridToAlbum()">保存到相册</button>
        </div>
      </div>
    `;
    
    panel.appendChild(header);
    panel.appendChild(content);
  }
}

function gridChooseFile() {
  const input = $('gridFileInput');
  if(input) input.click();
}

function handleGridFileChange(files) {
  if(!files || !files.length) return;
  const f = files[0];
  if(!f || !(f.type||'').startsWith('image/')) { toast('请选择图片文件'); return; }
  
  gridState.fileName = f.name || 'grid';
  gridState.file = f;
  
  $('gridPreviewSection').style.display = 'block';
  $('gridPreview').innerHTML = '<div style="color: white; padding: 40px; text-align: center;">已选择：' + esc(f.name) + '<br><br>点击「生成预览」查看效果</div>';
}

async function generateGridPreview() {
  if(!S) return toast('请先连接');
  if(!gridState.file) return toast('请先选择图片');
  
  const prev = $('gridPreview');
  prev.innerHTML = '<div style="color: white; padding: 40px; text-align: center;">生成预览中...</div>';
  
  try {
    const fd = new FormData();
    fd.append('file', gridState.file);
    fd.append('line_width', '4');
    fd.append('gap', '0');
    
    const r = await fetch(BASE+'/api/grid/preview', {method:'POST', headers:{'X-Upload-Key':S}, body:fd});
    if(!r.ok) throw new Error('预览失败');
    
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    gridState.previewBlob = blob;
    gridState.previewUrl = url;
    
    prev.innerHTML = '<div class="grid-preview-inner"><img src="'+url+'" alt="预览"></div>';
  } catch(e) {
    toast(e.message || '预览失败');
    prev.innerHTML = '<div style="color: var(--danger); padding: 40px; text-align: center;">预览失败</div>';
  }
}

async function saveGridToAlbum() {
  if(!S) return toast('请先连接');
  if(!gridState.file) return toast('请先选择图片');
  
  const btn = $('gridSaveBtn');
  btn.disabled = true;
  btn.textContent = '保存中...';
  
  try {
    const fd = new FormData();
    fd.append('file', gridState.file);
    fd.append('destination', '九宫格');
    fd.append('folder_name', gridState.fileName.split('.')[0] || 'grid');
    fd.append('line_width', '4');
    fd.append('gap', '0');
    
    const r = await fetch(BASE+'/api/grid/save', {method:'POST', headers:{'X-Upload-Key':S}, body:fd});
    if(!r.ok) throw new Error('保存失败');
    
    toast('已保存到相册');
    await loadTree();
    showDashboard();
  } catch(e) {
    toast('保存失败');
  } finally {
    btn.disabled = false;
    btn.textContent = '保存到相册';
  }
}

// Tree rendering (simplified for now)
function renderTree() {
  const box = $('treeBox');
  if(!box) return;
  
  if(!treeData.length) {
    box.innerHTML = '<div class="empty-state"><p>还没有文件夹</p></div>';
    return;
  }
  
  let html = '<ul class="tree">';
  for(const n of treeData) {
    html += `
      <li class="tree-item" onclick="selectNode('${esc(n.path)}', ${n.is_album})">
        <span class="tree-icon">${n.is_album ? '🖼️' : '📁'}</span>
        <span class="tree-name">${esc(n.name)}</span>
        ${n.image_count > 0 ? `<span class="tree-count">${n.image_count}</span>` : ''}
      </li>
    `;
  }
  html += '</ul>';
  box.innerHTML = html;
}

function selectNode(path, isAlbum) {
  curPath = path;
  toast('已选择: ' + path);
  // Full implementation would load contents here
}

async function createToken() {
  const input = $('newTokenInput');
  const val = (input ? input.value : '').trim();
  if(!val) return toast('请输入相册名称');
  
  try {
    // If not connected, try to connect first if we have a cookie
    if(!S) {
      const savedKey = getCookie(ADMIN_KEY_COOKIE);
      if(savedKey) {
        await connect(savedKey, {auto: true, toastSuccess: false});
      } else {
        return toast('请先连接服务器');
      }
    }
    
    await api('api/tokens', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-Upload-Key': S},
      body: JSON.stringify({token: val})
    });
    
    toast('创建成功');
    if(input) input.value = '';
    await loadTree();
    
    // If we're on the login screen, switch to dashboard
    if($('loginSection').style.display !== 'none') {
      $('loginSection').style.display = 'none';
      $('mainSection').style.display = '';
      showDashboard();
    }
  } catch(e) {
    toast('创建失败: ' + (e.message || ''));
  }
}

// Init
window.addEventListener('DOMContentLoaded', () => {
  const v = $('versionBadge');
  if(v) v.textContent = 'v' + APP_VERSION;
  
  // Auto connect if cookie exists
  const savedKey = getCookie(ADMIN_KEY_COOKIE);
  if(savedKey) {
    const rememberEl = $('remember');
    if(rememberEl) rememberEl.checked = true;
    connect(savedKey, {auto: true, toastSuccess: false});
  }
});
