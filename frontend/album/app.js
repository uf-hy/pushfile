const files = window.albumFiles || [];
const token = window.albumToken || '';
const base = window.__BASE__ || '';
let lbIdx = 0;

function isIOS() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function displayName(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

function toJpgName(name) {
  return `${displayName(name)}.jpg`;
}

function downloadUrl(name) {
  return `${base}/f/${encodeURIComponent(token)}/${encodeURIComponent(name)}`;
}

function viewUrl(name) {
  return `${base}/v/${encodeURIComponent(token)}/${encodeURIComponent(toJpgName(name))}?kind=view-jpg&src=${encodeURIComponent(name)}`;
}

function rawUrl(name) {
  return `${base}/d/${encodeURIComponent(token)}/${encodeURIComponent(name)}`;
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
  const name = files[lbIdx];
  const img = document.getElementById('lbImg');
  img.onerror = function () {
    img.onerror = null;
    img.src = rawUrl(name);
  };
  img.src = viewUrl(name);
  document.getElementById('lbInfo').textContent = displayName(name);
}

document.addEventListener('keydown', e => {
  if (!document.getElementById('lb').classList.contains('show')) return;
  if (e.key === 'Escape') closeLb();
  if (e.key === 'ArrowLeft') navLb(-1);
  if (e.key === 'ArrowRight') navLb(1);
});

function setP(done, total, name) {
  const p = total ? Math.floor(done / total * 100) : 0;
  document.getElementById('ovFill').style.width = `${p}%`;
  document.getElementById('ovLeft').textContent = `${done}/${total}`;
  document.getElementById('ovRight').textContent = `${p}%`;
  document.getElementById('ovDesc').textContent = name ? `正在下载：${name}` : '准备中…';
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
        const src = files[i];
        setP(i, files.length, src);
        const r = await fetch(downloadUrl(src));
        if (!r.ok) continue;
        const fh = await dir.getFileHandle(toJpgName(src), {create: true});
        const ws = await fh.createWritable();
        const rd = r.body.getReader();
        while (true) {
          const {done, value} = await rd.read();
          if (done) break;
          await ws.write(value);
        }
        await ws.close();
        setP(i + 1, files.length, src);
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
    const src = files[i];
    setP(i, files.length, src);
    trigger(downloadUrl(src), toJpgName(src));
    await new Promise(r => setTimeout(r, 350));
    setP(i + 1, files.length, src);
  }
  document.getElementById('ovTitle').textContent = '已触发下载';
  document.getElementById('ovDesc').textContent = '浏览器将逐个保存图片';
  setTimeout(hideOv, 800);
}

if (isIOS()) {
  document.getElementById('iosTip').style.display = 'block';
  const btn = document.getElementById('dlAllBtn');
  if (btn) btn.style.display = 'none';
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
