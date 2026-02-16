const files = window.albumFiles || [];
const token = window.albumToken || '';
const domain = window.albumDomain || '';
let lbIdx = 0;

function isIOS() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
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
  document.getElementById('lbImg').src = '../d/' + token + '/' + files[lbIdx];
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
  try {
    if (window.showDirectoryPicker) {
      const dir = await window.showDirectoryPicker();
      showOv();
      for (let i = 0; i < files.length; i++) {
        setP(i, files.length, files[i]);
        const r = await fetch('../d/' + token + '/' + files[i]);
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
    trigger('../f/' + token + '/' + files[i], files[i]);
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
