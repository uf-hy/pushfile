let S='',T='',files=[],sel=new Set(),dragN='',sheetTarget='',treeData=[],curPath='',expanded={},statsData={},slugMap={},treeDragPath='',treeDropEl=null,treeDropMode='';
const $=id=>document.getElementById(id);
const DOMAIN=window.__DOMAIN__||'photo.xaihub.de';
const BASE=window.__BASE__||'';
const MAX_MB=window.__MAX_MB__||25;
const ADMIN_KEY_COOKIE='pf_admin_key';
const ADMIN_KEY_MAX_AGE=518400; // 144 hours

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
    $('connBadge').textContent='✅ 已连接';$('connBadge').style.color='var(--green)';
    $('loginSection').style.display='none';$('mainSection').style.display='';
    if(rememberEl&&rememberEl.checked)setAdminKeyCookie(S);else clearAdminKeyCookie();
    await loadTree();
    if(toastSuccess)toast('连接成功');
    return true;
  }catch(e){}
  if(isAuto){
    clearAdminKeyCookie();
    S='';
    if(rememberEl)rememberEl.checked=false;
    if(inputEl)inputEl.value='';
    $('connBadge').textContent='未连接';$('connBadge').style.color='var(--sub)';
    $('loginSection').style.display='';$('mainSection').style.display='none';
    if(toastFailure)toast('自动连接失败，请重新输入密码');
    return false;
  }
  if(toastFailure)toast('密码错误');
  S='';
  return false;
}

async function loadTree(){
  const d=await api('api/folders/tree?key='+encodeURIComponent(S));
  treeData=d.tree||[];
  try{statsData=await api('api/stats?key='+encodeURIComponent(S))}catch(_){statsData={}}
  slugMap={};buildSlugMap(treeData);
  renderTree();
}

function buildSlugMap(nodes){for(const n of nodes){if(n.slug)slugMap[n.path]=n.slug;if(n.children)buildSlugMap(n.children)}}

function renderTree(){
  const box=$('treeBox');
  box.classList.remove('drop-root');
  box.innerHTML=buildTreeHTML(treeData);
  if(!treeData.length){box.innerHTML='<div class="empty" style="padding:24px"><p>还没有文件夹，上传 ZIP 或手动创建</p></div>';return}
  box.onclick=treeBoxClick;
  bindTreeDnD(box);
  box.ondragover=treeRootDragOver;
  box.ondragenter=treeRootDragEnter;
  box.ondragleave=treeRootDragLeave;
  box.ondrop=treeRootDrop;
}

function buildTreeHTML(nodes){
  let h='<ul class="tree">';
  for(const n of nodes){
    const hasKids=n.children&&n.children.length>0;
    const isOpen=expanded[n.path];
    const isActive=curPath===n.path;
    const icon=n.is_album?'🖼️':(isOpen?'📂':'📁');
    const arrow='<span class="tree-arrow'+(isOpen?' open':'')+'" data-path="'+esc(n.path)+'" data-has="'+(hasKids?'1':'0')+'"'+(hasKids?'':' style="visibility:hidden"')+'>▶</span>';
    h+='<li>';
    h+='<div class="tree-item'+(isActive?' active':'')+'" data-path="'+esc(n.path)+'" data-album="'+(n.is_album?'1':'0')+'" draggable="true">';
    h+=arrow+'<span class="tree-icon">'+icon+'</span><span class="tree-name">'+esc(n.name)+'</span>';
    if(n.image_count>0)h+='<span class="tree-count">'+n.image_count+'</span>';
    const st=statsData[n.path];if(st&&st.views)h+='<span class="tree-views">👁 '+st.views+'</span>';
    h+='</div>';
    if(hasKids&&isOpen)h+=buildTreeHTML(n.children);
    h+='</li>';
  }
  return h+'</ul>';
}

function toggleExpand(path,e){e.stopPropagation();expanded[path]=!expanded[path];renderTree()}

function treeBoxClick(e){
  const arrow=e.target.closest('.tree-arrow');
  if(arrow&&arrow.dataset&&arrow.dataset.has==='1'){toggleExpand(arrow.dataset.path,e);return}
  const item=e.target.closest('.tree-item');
  if(!item||!item.dataset||!item.dataset.path)return;
  selectNode(item.dataset.path,item.dataset.album==='1');
}

function bindTreeDnD(box){
  const items=box.querySelectorAll('.tree-item');
  for(const it of items){
    it.addEventListener('dragstart',treeItemDragStart);
    it.addEventListener('dragend',treeItemDragEnd);
    it.addEventListener('dragenter',treeItemDragEnter);
    it.addEventListener('dragleave',treeItemDragLeave);
    it.addEventListener('dragover',treeItemDragOver);
    it.addEventListener('drop',treeItemDrop);
  }
}

function treeClearDrop(){
  const box=$('treeBox');
  if(treeDropEl){
    treeDropEl.classList.remove('drop-target','drop-before','drop-after');
    treeDropEl=null;treeDropMode='';
  }
  if(box)box.classList.remove('drop-root');
}

function treeSetDropEl(el,mode){
  if(treeDropEl===el&&treeDropMode===mode)return;
  treeClearDrop();
  if(el){
    if(mode==='before')el.classList.add('drop-before');
    else if(mode==='after')el.classList.add('drop-after');
    else el.classList.add('drop-target');
    treeDropEl=el;treeDropMode=mode||'';
  }
}

function treeDropModeForEvent(e,item){
  const r=item.getBoundingClientRect();
  const y=e.clientY-r.top;
  const h=r.height||1;
  if(y<h*0.25)return 'before';
  if(y>h*0.75)return 'after';
  return 'into';
}

function treeItemDragStart(e){
  const item=e.currentTarget;
  treeDragPath=item.dataset.path||'';
  if(!treeDragPath)return;
  e.dataTransfer.effectAllowed='move';
  try{e.dataTransfer.setData('text/plain',treeDragPath)}catch(_){}
  item.classList.add('dragging');
  treeClearDrop();
}

function treeItemDragEnd(e){
  e.currentTarget.classList.remove('dragging');
  treeDragPath='';
  treeClearDrop();
}

function treeItemDragEnter(e){
  e.preventDefault();e.stopPropagation();
  const item=e.currentTarget;const dest=item.dataset.path||'';
  if(!treeDragPath||!dest||dest===treeDragPath)return;
  treeSetDropEl(item,treeDropModeForEvent(e,item));
}

function treeItemDragOver(e){
  e.preventDefault();e.stopPropagation();
  const item=e.currentTarget;const dest=item.dataset.path||'';
  if(!treeDragPath||!dest||dest===treeDragPath)return;
  treeSetDropEl(item,treeDropModeForEvent(e,item));
}

function treeItemDragLeave(e){
  e.stopPropagation();
  const item=e.currentTarget;
  if(item.contains(e.relatedTarget))return;
  if(treeDropEl===item){item.classList.remove('drop-target','drop-before','drop-after');treeDropEl=null;treeDropMode=''}
}

function treeItemDrop(e){
  e.preventDefault();e.stopPropagation();
  const item=e.currentTarget;
  const dest=item.dataset.path||'';
  let src=treeDragPath;
  if(!src){try{src=e.dataTransfer.getData('text/plain')||''}catch(_){src=''}}
  const mode=treeDropMode||'into';
  treeClearDrop();
  if(!src||!dest||src===dest)return;
  if(mode==='into'){moveFolderTo(src,dest);return}
  const li=item.closest('li');
  const ul=li?li.parentElement:null;
  if(!ul)return;
  const sibItems=Array.from(ul.querySelectorAll(':scope > li > .tree-item'));
  const sibPaths=sibItems.map(x=>x.dataset.path||'').filter(Boolean);
  const hoverIdx=sibPaths.indexOf(dest);
  if(hoverIdx<0)return;
  let insertIdx=mode==='before'?hoverIdx:hoverIdx+1;
  const srcIdx=sibPaths.indexOf(src);
  const withoutSrc=sibPaths.filter(p=>p!==src);
  if(srcIdx!==-1&&srcIdx<insertIdx)insertIdx-=1;
  const beforePath=withoutSrc[insertIdx]||'';
  const parentLi=ul.closest('li');
  const parentItem=parentLi?parentLi.querySelector(':scope > .tree-item'):null;
  const parentPath=parentItem?(parentItem.dataset.path||''):'';
  moveFolderTo(src,parentPath,beforePath);
}

function treeRootDragEnter(e){
  if(e.target.closest&&e.target.closest('.tree-item'))return;
  if(!treeDragPath)return;
  e.preventDefault();
  treeClearDrop();
  $('treeBox').classList.add('drop-root');
}

function treeRootDragOver(e){
  if(e.target.closest&&e.target.closest('.tree-item'))return;
  if(!treeDragPath)return;
  e.preventDefault();
  treeClearDrop();
  $('treeBox').classList.add('drop-root');
}

function treeRootDragLeave(e){
  const box=$('treeBox');if(!box)return;
  if(box.contains(e.relatedTarget))return;
  box.classList.remove('drop-root');
}

function treeRootDrop(e){
  if(e.target.closest&&e.target.closest('.tree-item'))return;
  e.preventDefault();
  let src=treeDragPath;
  if(!src){try{src=e.dataTransfer.getData('text/plain')||''}catch(_){src=''}}
  treeClearDrop();
  if(!src)return;
  moveFolderTo(src,'');
}

function treeRemapAfterMove(oldBase,newBase,dest){
  if(curPath===oldBase||curPath.startsWith(oldBase+'/'))curPath=newBase+curPath.slice(oldBase.length);
  if(T===oldBase||T.startsWith(oldBase+'/'))T=newBase+T.slice(oldBase.length);
  const next={};
  for(const k in expanded){
    if(k===oldBase||k.startsWith(oldBase+'/'))next[newBase+k.slice(oldBase.length)]=expanded[k];
    else next[k]=expanded[k];
  }
  expanded=next;
  if(dest)expanded[dest]=true;
  expanded[newBase]=true;
}

async function moveFolderTo(path,dest,before){
  const src=(path||'').trim();
  const parent=(dest||'').trim().replace(/(^\/+|\/+$)/g,'');
  const beforePath=(before||'').trim().replace(/(^\/+|\/+$)/g,'');
  if(!src)return;
  if(parent===src||parent.startsWith(src+'/'))return toast('不能把父文件夹移动到自己的子文件夹里');
  const name=src.split('/').pop();
  const newBase=parent?(parent+'/'+name):name;
  try{
    await api('api/folders/move',{method:'POST',headers:{'Content-Type':'application/json','X-Upload-Key':S},body:JSON.stringify({path:src,dest:parent,before:beforePath||undefined})});
    treeRemapAfterMove(src,newBase,parent);
    toast('已移动');
    await loadTree();
    if(T)await loadAlbumFiles(T);
    else if(curPath)await loadFolderView(curPath);
  }catch(e){toast('移动失败：'+e.message);await loadTree()}
}

function selectNode(path,isAlbum){
  curPath=path;expanded[path]=true;renderTree();
  if(isAlbum)loadAlbumFiles(path);else loadFolderView(path);
}

async function loadFolderView(path){
  const d=await api('api/folders/list?path='+encodeURIComponent(path)+'&key='+encodeURIComponent(S));
  const c=$('contentArea');
  let h=renderBreadcrumb(path);
  h+='<div class="group"><div class="group-label">'+esc(path.split('/').pop())+'</div><div class="group-box">';
  if(d.subfolders&&d.subfolders.length)for(const sf of d.subfolders)h+='<div class="row row-tap" onclick="selectNode(\''+esc(path+'/'+sf)+'\',false)"><span class="tree-icon">📁</span><span style="flex:1">'+esc(sf)+'</span><span class="row-chevron">›</span></div>';
  if(d.files&&d.files.length){T=path;files=d.files.slice();sel.clear();h+='<div class="row"><span style="color:var(--sub)">'+d.files.length+' 张图片</span></div>';}
  if((!d.subfolders||!d.subfolders.length)&&(!d.files||!d.files.length))h+='<div class="row"><span style="color:var(--sub)">空文件夹</span></div>';
  h+='<div class="row row-tap" onclick="deleteFolder(\''+esc(path)+'\')"><span style="color:var(--danger)">删除此文件夹</span></div>';
  h+='</div></div>';
  if(d.files&&d.files.length){h+='<div class="group"><div class="group-label">照片 ('+files.length+')</div><div class="photos" id="photoGrid"></div></div>';c.innerHTML=h;renderPhotos();}
  else c.innerHTML=h;
}

async function loadAlbumFiles(path){
  const d=await api('api/folders/list?path='+encodeURIComponent(path)+'&key='+encodeURIComponent(S));
  T=path;files=(d.files||[]).slice();sel.clear();
  renderAlbumContent();
}

function renderBreadcrumb(path){
  const parts=path.split('/');let h='<div class="breadcrumb"><span onclick="curPath=\'\';renderTree();$(\'contentArea\').innerHTML=\'\'">根目录</span>';
  let acc='';
  for(let i=0;i<parts.length;i++){acc+=(i?'/':'')+parts[i];const p=acc;h+='<span class="sep">/</span>';
    if(i===parts.length-1)h+='<span style="color:var(--text);cursor:default">'+esc(parts[i])+'</span>';
    else h+='<span onclick="selectNode(\''+esc(p)+'\',false)">'+esc(parts[i])+'</span>';}
  return h+'</div>';
}

function renderAlbumContent(){
  const c=$('contentArea');const slug=slugMap[T]||T;const url='https://'+DOMAIN+'/d/'+slug;
  let h=renderBreadcrumb(T);
  h+='<div class="share"><span class="share-url">'+url+'</span><button class="btn btn-sm btn-blue share-copy" onclick="navigator.clipboard.writeText(\''+url+'\');toast(\'已复制\')">复制</button></div>';
  const st=statsData[T];
  if(st&&st.views){h+='<div class="group"><div class="group-label">访问统计</div><div class="group-box"><div class="row"><span class="row-label">浏览次数</span><span>'+st.views+'</span></div>';
    if(st.last_visit)h+='<div class="row"><span class="row-label">最后访问</span><span>'+new Date(st.last_visit).toLocaleString('zh-CN')+'</span></div>';
    if(st.first_visit)h+='<div class="row"><span class="row-label">首次访问</span><span>'+new Date(st.first_visit).toLocaleString('zh-CN')+'</span></div>';
    h+='</div></div>';}
  h+='<div class="group"><div class="group-box"><div class="row row-tap" onclick="deleteFolder(\''+esc(T)+'\')"><span style="color:var(--danger)">删除此相册</span></div></div></div>';
  h+='<div class="group"><div class="group-label">上传照片</div>'+
    '<div class="upload-zone" id="uploadZone" onclick="$(\'fileInput\').click()"><div style="font-size:36px;color:var(--sub)">⊕</div><p>点击选择或拖拽图片</p><small>JPG/PNG/GIF/WebP · 最大 '+MAX_MB+'MB</small>'+
    '<input id="fileInput" type="file" accept="image/*" multiple style="display:none" onchange="handleUpload(this.files)"></div>'+
    '<div class="upload-prog" id="uploadProg"><div class="upload-bar"><div class="upload-fill" id="uploadFill"></div></div><div class="upload-txt" id="uploadTxt"></div></div></div>';
  h+='<div class="group"><div class="group-label">照片 ('+files.length+')</div><div class="photos" id="photoGrid"></div></div>';
  c.innerHTML=h;
  const zone=$('uploadZone');
  zone.addEventListener('dragover',e=>{e.preventDefault();zone.classList.add('dragover')});
  zone.addEventListener('dragleave',()=>zone.classList.remove('dragover'));
  zone.addEventListener('drop',e=>{e.preventDefault();zone.classList.remove('dragover');handleUpload(e.dataTransfer.files)});
  renderPhotos();
}

function renderPhotos(){
  const grid=$('photoGrid');if(!grid)return;
  if(!files.length){grid.innerHTML='<div class="empty" style="grid-column:1/-1;padding:24px"><p style="color:var(--sub)">还没有照片</p></div>';updateBatch();return}
  grid.innerHTML='';
  files.forEach(name=>{
    const imgBase=slugMap[T]||T;
    const d=document.createElement('div');d.className='photo'+(sel.has(name)?' selected':'');d.draggable=true;d.dataset.name=name;
    d.innerHTML='<div class="photo-sel'+(sel.has(name)?' on':'')+'" onclick="toggleSel(\''+esc(name)+'\',event)">'+(sel.has(name)?'✓':'')+'</div>'+
      '<img src="/d/'+encodeURIComponent(imgBase)+'/'+encodeURIComponent(name)+'" loading="lazy"><div class="photo-name">'+esc(name)+'</div>';
    d.addEventListener('click',e=>{if(e.target.closest('.photo-sel'))return;openSheet(name)});
    d.addEventListener('dragstart',()=>{dragN=name;d.classList.add('dragging')});
    d.addEventListener('dragend',()=>{dragN='';d.classList.remove('dragging')});
    d.addEventListener('dragover',e=>e.preventDefault());
    d.addEventListener('drop',e=>{e.preventDefault();if(!dragN||dragN===name)return;const a=files.indexOf(dragN),b=files.indexOf(name);if(a<0||b<0)return;files.splice(a,1);files.splice(b,0,dragN);renderPhotos()});
    grid.appendChild(d);
  });
  updateBatch();
}

function toggleSel(name,e){e.stopPropagation();sel.has(name)?sel.delete(name):sel.add(name);renderPhotos()}
function selectAll(){files.forEach(n=>sel.add(n));renderPhotos()}
function updateBatch(){const n=sel.size;$('batchCount').textContent=n+' 已选';$('batchBar').classList.toggle('show',n>0)}
function openSheet(name){sheetTarget=name;$('sheetBg').classList.add('show')}
function closeSheet(){$('sheetBg').classList.remove('show');sheetTarget=''}

async function sheetRename(){
  closeSheet();const name=sheetTarget;const n=prompt('新文件名：',name);if(!n||n===name)return;
  try{await api('api/manage/'+encodeURIComponent(slugMap[T]||T)+'/rename',{method:'POST',headers:{'Content-Type':'application/json','X-Upload-Key':S},body:JSON.stringify({oldName:name,newName:n})});toast('已改名');await loadAlbumFiles(T);await loadTree()}catch(e){toast('失败：'+e.message)}
}
function sheetDownload(){closeSheet();const imgBase=slugMap[T]||T;const a=document.createElement('a');a.href='/f/'+encodeURIComponent(imgBase)+'/'+encodeURIComponent(sheetTarget);a.download=sheetTarget;document.body.appendChild(a);a.click();a.remove()}
async function sheetDelete(){
  closeSheet();if(!confirm('删除 '+sheetTarget+' ？'))return;
  try{await api('api/manage/'+encodeURIComponent(slugMap[T]||T)+'/delete',{method:'POST',headers:{'Content-Type':'application/json','X-Upload-Key':S},body:JSON.stringify({name:sheetTarget})});toast('已删除');await loadAlbumFiles(T);await loadTree()}catch(e){toast('失败：'+e.message)}
}

async function handleUpload(fileList){
  if(!fileList||!fileList.length||!T)return;
  const prog=$('uploadProg');prog.style.display='block';let done=0;const total=fileList.length;
  for(const f of fileList){
    const baseP=Math.round(done/total*100);
    $('uploadTxt').textContent='上传中 ('+(done+1)+'/'+total+'): '+f.name;
    $('uploadFill').style.width=baseP+'%';
    const fd=new FormData();fd.append('file',f);
    await new Promise((resolve)=>{
      const xhr=new XMLHttpRequest();
      xhr.open('POST',BASE+'/api/upload/'+encodeURIComponent(slugMap[T]||T));
      xhr.setRequestHeader('X-Upload-Key',S);
      xhr.upload.onprogress=function(e){
        if(e.lengthComputable){const filePct=e.loaded/e.total;const overallPct=Math.round((done+filePct)/total*100);$('uploadFill').style.width=overallPct+'%'}
      };
      xhr.onload=function(){if(xhr.status>=400){try{const j=JSON.parse(xhr.responseText);toast('失败: '+(j.detail||''))}catch(_){toast('失败')}}resolve()};
      xhr.onerror=function(){toast('错误: 网络异常');resolve()};
      xhr.send(fd);
    });
    done++;
  }
  $('uploadFill').style.width='100%';$('uploadTxt').textContent='上传完成 ✅';
  setTimeout(()=>{prog.style.display='none';$('uploadFill').style.width='0%'},1200);
  await loadTree();await loadAlbumFiles(T);
}

function handleZipImport(fileList){
  if(!fileList||!fileList.length)return;const f=fileList[0];
  if(!f.name.toLowerCase().endsWith('.zip'))return toast('请选择 .zip 文件');
  const prog=$('zipProg');prog.style.display='block';$('zipTxt').textContent='上传中… 0%';$('zipFill').style.width='0%';
  const fd=new FormData();fd.append('file',f);
  const xhr=new XMLHttpRequest();
  xhr.open('POST',BASE+'/api/upload/zip-import');
  xhr.setRequestHeader('X-Upload-Key',S);
  xhr.upload.onprogress=function(e){
    if(e.lengthComputable){const pct=Math.round(e.loaded/e.total*90);$('zipFill').style.width=pct+'%';$('zipTxt').textContent='上传中… '+pct+'%'}
  };
  xhr.onload=async function(){
    try{const j=JSON.parse(xhr.responseText);
      if(xhr.status>=400)throw new Error(j.detail||'fail');
      $('zipFill').style.width='100%';$('zipTxt').textContent='导入完成 ✅ 共 '+j.imported+' 张图片';
      await loadTree();setTimeout(()=>{prog.style.display='none';$('zipFill').style.width='0%'},2000);
    }catch(e){$('zipTxt').textContent='导入失败：'+e.message;setTimeout(()=>{prog.style.display='none';$('zipFill').style.width='0%'},3000)}
  };
  xhr.onerror=function(){$('zipTxt').textContent='网络错误';setTimeout(()=>{prog.style.display='none';$('zipFill').style.width='0%'},3000)};
  xhr.send(fd);
}

async function createFolder(){
  const name=$('newFolderInput').value.trim();if(!name)return toast('请输入文件夹名称');
  const path=curPath?(curPath+'/'+name):name;
  try{await api('api/folders/create',{method:'POST',headers:{'Content-Type':'application/json','X-Upload-Key':S},body:JSON.stringify({path})});
    $('newFolderInput').value='';toast('已创建 '+name);await loadTree()}catch(e){toast('创建失败：'+e.message)}
}

async function deleteFolder(path){
  if(!confirm('⚠️ 删除「'+path+'」及其所有内容？不可恢复！'))return;
  try{await api('api/folders/delete',{method:'POST',headers:{'Content-Type':'application/json','X-Upload-Key':S},body:JSON.stringify({path})});
    toast('已删除');curPath='';T='';$('contentArea').innerHTML='';await loadTree()}catch(e){toast('删除失败：'+e.message)}
}

async function batchDelete(){
  const names=files.filter(x=>sel.has(x));if(!names.length)return toast('请先选择');if(!confirm('删除 '+names.length+' 张照片？'))return;
  try{await api('api/manage/'+encodeURIComponent(slugMap[T]||T)+'/batch-delete',{method:'POST',headers:{'Content-Type':'application/json','X-Upload-Key':S},body:JSON.stringify({names})});toast('已删除 '+names.length+' 张');await loadAlbumFiles(T);await loadTree()}catch(e){toast('失败：'+e.message)}
}

async function saveOrder(){
  try{await api('api/manage/'+encodeURIComponent(slugMap[T]||T)+'/order',{method:'POST',headers:{'Content-Type':'application/json','X-Upload-Key':S},body:JSON.stringify({names:files})});toast('排序已保存')}catch(e){toast('失败：'+e.message)}
}

async function batchMove(){
  const names=files.filter(x=>sel.has(x));if(!names.length)return toast('请先选择');
  showFolderPicker(names);
}

function showFolderPicker(names){
  let overlay=document.createElement('div');
  overlay.className='picker-overlay';
  let box=document.createElement('div');box.className='picker-box';
  box.innerHTML='<div class="picker-title">移动 '+names.length+' 张图片到…</div>'+
    '<div class="picker-input"><input type="text" id="pickerNewFolder" placeholder="输入新文件夹路径（如 待整理/2026）"><button class="btn btn-blue btn-sm" id="pickerConfirm">确定</button></div>'+
    '<div class="picker-tree" id="pickerTree"></div>';
  let cancelBtn=document.createElement('button');
  cancelBtn.className='btn btn-sm';cancelBtn.style.cssText='margin-top:12px;width:100%';cancelBtn.textContent='取消';
  cancelBtn.addEventListener('click',()=>overlay.remove());
  box.appendChild(cancelBtn);
  overlay.appendChild(box);
  overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove()});
  document.body.appendChild(overlay);
  box.querySelector('#pickerConfirm').addEventListener('click',()=>doMove(overlay,names));
  renderPickerTree(treeData);
}

function renderPickerTree(nodes){
  const box=$('pickerTree');if(!box)return;
  box.innerHTML='';
  function walk(nodes,depth){
    for(const n of nodes){
      if(n.path===T)continue;
      const item=document.createElement('div');
      item.className='picker-item';
      item.style.paddingLeft=depth*16+'px';
      item.textContent=(n.is_album?'🖼️ ':'📁 ')+n.name;
      if(n.image_count>0){const cnt=document.createElement('span');cnt.className='tree-count';cnt.textContent=n.image_count;item.appendChild(cnt)}
      item.dataset.path=n.path;
      item.addEventListener('click',()=>{const input=$('pickerNewFolder');if(input)input.value=n.path});
      box.appendChild(item);
      if(n.children)walk(n.children,depth+1);
    }
  }
  walk(nodes,0);
  if(!box.children.length)box.innerHTML='<div style="padding:12px;color:var(--sub)">没有其他文件夹</div>';
}

async function doMove(overlay,names){
  const dest=$('pickerNewFolder').value.trim();
  if(!dest)return toast('请输入或选择目标文件夹');
  if(!confirm('确定移动 '+names.length+' 张图片到「'+dest+'」？'))return;
  overlay.remove();
  try{
    const r=await api('api/manage/'+encodeURIComponent(slugMap[T]||T)+'/batch-move',{method:'POST',headers:{'Content-Type':'application/json','X-Upload-Key':S},body:JSON.stringify({names,dest})});
    let msg='已移动 '+r.count+' 张到 '+r.dest;
    if(r.skipped&&r.skipped.length)msg+='（跳过 '+r.skipped.length+' 张）';
    toast(msg);
    await loadTree();
    if(T)await loadAlbumFiles(T);
  }catch(e){toast('移动失败：'+e.message)}
}

async function createToken(){
  S=S||$('secret').value.trim();const tk=$('newTokenInput').value.trim();if(!S||!tk)return toast('请填写密码和名称');
  try{await api('api/tokens',{method:'POST',headers:{'Content-Type':'application/json','X-Upload-Key':S},body:JSON.stringify({token:tk})});
    const rememberEl=$('remember');
    if(rememberEl&&rememberEl.checked)setAdminKeyCookie(S);else clearAdminKeyCookie();
    $('newTokenInput').value='';
    if($('mainSection').style.display==='none'){$('loginSection').style.display='none';$('mainSection').style.display='';$('connBadge').textContent='✅';$('connBadge').style.color='var(--green)'}
    await loadTree();toast('已创建 '+tk)}catch(e){toast('创建失败：'+e.message)}
}

$('secret').addEventListener('keydown',e=>{if(e.key==='Enter')connect()});
const zz=$('zipZone');
if(zz){zz.addEventListener('dragover',e=>{e.preventDefault();zz.classList.add('dragover')});zz.addEventListener('dragleave',()=>zz.classList.remove('dragover'));zz.addEventListener('drop',e=>{e.preventDefault();zz.classList.remove('dragover');handleZipImport(e.dataTransfer.files)})}

function initAutoConnect(){
  const saved=getCookie(ADMIN_KEY_COOKIE);
  if(!saved)return;
  const input=$('secret');if(input)input.value=saved;
  const remember=$('remember');if(remember)remember.checked=true;
  $('connBadge').textContent='⏳ 连接中';$('connBadge').style.color='var(--sub)';
  connect(saved,{auto:true,toastSuccess:false,toastFailure:true});
}

initAutoConnect();
