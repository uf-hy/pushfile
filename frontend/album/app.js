const files = window.albumFiles || [];
const token = window.albumToken || '';
const domain = window.albumDomain || '';
const BASE = window.__BASE__ || '';
let lbIdx = 0;

function isIOS() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// UA 检测仅用于 UX 提示/降级，不作为安全判断或权限控制依据。
function detectInAppBrowser(ua = navigator.userAgent) {
  const isXhs = /XiaoHongShu|discover\//i.test(ua);
  const isWechat = /MicroMessenger/i.test(ua);
  const isWeibo = /Weibo/i.test(ua);
  // Issue #31 要求：/QQ\//i 命中即视为 QQ in-app。
  const isQQ = /QQ\//i.test(ua);
  const isDingTalk = /DingTalk/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  const inApp = isXhs || isWechat || isWeibo || isQQ || isDingTalk;
  return {isXhs, isWechat, isWeibo, isQQ, isDingTalk, isAndroid, inApp};
}

const __inappEnv = detectInAppBrowser();
const __androidInApp = __inappEnv.isAndroid && __inappEnv.inApp;

let __inappCopyTimer = 0;
function showInappCopyStatus(msg) {
  const el = document.getElementById('inappCopyStatus');
  if (!el) return;
  el.textContent = msg || '';
  requestAnimationFrame(updateInappBarHeight);
  if (__inappCopyTimer) clearTimeout(__inappCopyTimer);
  if (msg) __inappCopyTimer = setTimeout(() => (el.textContent = ''), 1500);
}

async function copyLink() {
  const text = window.location.href;
  let ok = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      ok = true;
    }
  } catch (err) {
    console.warn(err);
  }
  if (ok) {
    showInappCopyStatus('已复制');
    return true;
  }
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', 'readonly');
    el.style.position = 'fixed';
    el.style.opacity = '0';
    el.style.left = '-9999px';
    document.body.appendChild(el);
    el.select();
    el.setSelectionRange(0, el.value.length);
    ok = document.execCommand('copy');
    el.remove();
    showInappCopyStatus(ok ? '已复制' : '复制失败');
    return ok;
  } catch (err) {
    console.warn(err);
    showInappCopyStatus('复制失败');
    return false;
  }
}

function updateInappBarHeight() {
  const bar = document.getElementById('inappBar');
  if (!bar || bar.style.display === 'none') return;
  document.documentElement.style.setProperty('--inapp-bar-h', bar.offsetHeight + 'px');
}

function getInappBarClosedKey() {
  return 'pf_inapp_bar_closed:' + (token || '');
}

function closeInappBar() {
  const bar = document.getElementById('inappBar');
  if (bar) bar.style.display = 'none';
  document.body.classList.remove('has-inapp-bar');
  document.documentElement.style.removeProperty('--inapp-bar-h');
  window.removeEventListener('resize', updateInappBarHeight);
  try {
    sessionStorage.setItem(getInappBarClosedKey(), '1');
  } catch (err) {
    // ignore
  }
}

function openLb(i) {
  lbIdx = i;
  const lb = document.getElementById('lb');
  lb.classList.add('show');
  updLb();
  document.body.style.overflow = 'hidden';
}

function closeLb(e) {
  if (e && e.target !== e.currentTarget && !e.target.classList.contains('lb-close')) return;
  document.getElementById('lb').classList.remove('show');
  document.body.style.overflow = '';
}

function navLb(d, e) {
  if (e) e.stopPropagation();
  lbIdx = (lbIdx + d + files.length) % files.length;
  updLb();
}

function updLb() {
  document.getElementById('lbImg').src = BASE + '/d/' + token + '/' + files[lbIdx];
  document.getElementById('lbInfo').textContent = (lbIdx + 1) + ' / ' + files.length + '  ·  ' + files[lbIdx];
}

document.addEventListener('keydown', e => {
  if (!document.getElementById('lb').classList.contains('show')) return;
  if (e.key === 'Escape') closeLb();
  if (e.key === 'ArrowLeft') navLb(-1);
  if (e.key === 'ArrowRight') navLb(1);
});

function setP(done, total, name) {
  const p = total ? Math.floor(done / total * 100) : 0;
  document.getElementById('ovFill').style.width = p + '%';
  document.getElementById('ovLeft').textContent = done + '/' + total;
  document.getElementById('ovRight').textContent = p + '%';
  document.getElementById('ovDesc').textContent = name ? '正在下载：' + name : '准备中…';
}

function showOv() {
  document.getElementById('ov').classList.add('show');
}

function hideOv() {
  document.getElementById('ov').classList.remove('show');
}

function trigger(url, name) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name || '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function downloadAll(e) {
  e.preventDefault();
  if (!files.length) return;
  if (__androidInApp) return;
  try {
    if (window.showDirectoryPicker) {
      const dir = await window.showDirectoryPicker();
      showOv();
      for (let i = 0; i < files.length; i++) {
        setP(i, files.length, files[i]);
        const r = await fetch(BASE + '/d/' + token + '/' + files[i]);
        if (!r.ok) continue;
        const fh = await dir.getFileHandle(files[i], {create: true});
        const ws = await fh.createWritable();
        const rd = r.body.getReader();
        while (true) {
          const {done, value} = await rd.read();
          if (done) break;
          await ws.write(value);
        }
        await ws.close();
        setP(i + 1, files.length, files[i]);
      }
      document.getElementById('ovTitle').textContent = '下载完成';
      document.getElementById('ovDesc').textContent = '所有图片已保存';
      setTimeout(hideOv, 800);
      return;
    }
  } catch (err) {
    console.warn(err);
  }
  showOv();
  for (let i = 0; i < files.length; i++) {
    setP(i, files.length, files[i]);
    trigger(BASE + '/f/' + token + '/' + files[i], files[i]);
    await new Promise(r => setTimeout(r, 350));
    setP(i + 1, files.length, files[i]);
  }
  document.getElementById('ovTitle').textContent = '已触发下载';
  document.getElementById('ovDesc').textContent = '浏览器将逐个保存图片';
  setTimeout(hideOv, 800);
}

if (isIOS()) {
  document.getElementById('iosTip').style.display = 'block';
  document.getElementById('dlAllBtn').style.display = 'none';
}

if (__androidInApp) {
  try {
    if (sessionStorage.getItem(getInappBarClosedKey()) !== '1') {
      const bar = document.getElementById('inappBar');
      if (bar) {
        bar.style.display = 'flex';
        document.body.classList.add('has-inapp-bar');
        requestAnimationFrame(updateInappBarHeight);
        window.addEventListener('resize', updateInappBarHeight);
      }
    }
  } catch (err) {
    const bar = document.getElementById('inappBar');
    if (bar) {
      bar.style.display = 'flex';
      document.body.classList.add('has-inapp-bar');
      requestAnimationFrame(updateInappBarHeight);
      window.addEventListener('resize', updateInappBarHeight);
    }
  }

  const dlAllBtn = document.getElementById('dlAllBtn');
  if (dlAllBtn) {
    dlAllBtn.disabled = true;
    dlAllBtn.title = '请在浏览器中打开后使用批量下载';
    const tip = document.createElement('div');
    tip.className = 'inapp-tip';
    tip.textContent = '请在浏览器中打开后使用批量下载';
    dlAllBtn.parentNode && dlAllBtn.parentNode.appendChild(tip);
  }

  document.querySelectorAll('a.card-dl').forEach(a => {
    a.addEventListener('click', ev => {
      // Android in-app 下，单张下载统一降级为 location 跳转，以绕开 WebView 对下载行为的兼容问题。
      const href = a.getAttribute('href') || a.href;
      if (!href) return;
      ev.preventDefault();
      ev.stopPropagation();
      window.location.href = href;
    });
  });
}
