function getBase() {
    return window.__BASE__ || '';
}

function isGuestMode() {
    return sessionStorage.getItem('pushfile_guest_mode') === 'true';
}

function animateNumber(el, target, duration = 800, prefix = '') {
    if (!el) return;
    const start = 0;
    const startTime = performance.now();

    function format(n) {
        try {
            return Number(Math.round(n)).toLocaleString('zh-CN');
        } catch (_) {
            return String(Math.round(n));
        }
    }

    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = progress === 1 ? 1 : 1 - 2 ** (-10 * progress);
        const current = start + (target - start) * eased;
        el.textContent = prefix + format(current);
        if (progress < 1) {
            requestAnimationFrame(update);
        }
    }
    requestAnimationFrame(update);
}

function normalizePath(path) {
    if (!path) return '/';
    if (typeof path !== 'string') return '/';
    return path.startsWith('/') ? path : `/${path}`;
}

window.go = function go(path) {
    const base = getBase();
    window.location.href = `${base || ''}${normalizePath(path)}`;
};

window.openModal = function openModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = 'flex';
    document.body.style.overflow = 'hidden';
};

window.closeModal = function closeModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = 'none';

    const anyOpen = Array.from(document.querySelectorAll('.modal')).some(m => {
        const display = m?.style?.display || '';
        return display && display !== 'none';
    });
    if (!anyOpen) document.body.style.overflow = '';
};

window.logout = function logout() {
    try {
        if (window.PushFileAuth && typeof window.PushFileAuth.clearKey === 'function') {
            window.PushFileAuth.clearKey();
        } else {
            localStorage.removeItem('pushfile_admin_key');
        }
        sessionStorage.removeItem('pushfile_admin_key');
    } catch (_) {}

    const base = getBase();
    window.location.href = `${base || ''}/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
};

document.addEventListener('DOMContentLoaded', () => {
    const base = window.__BASE__ || '';
    let guardPromise = Promise.resolve();
    if (window.PushFileAuth && typeof window.PushFileAuth.guardPage === 'function') {
        guardPromise = Promise.resolve(window.PushFileAuth.guardPage({ base }));
    }

    function toNumber(v) {
        if (typeof v === 'number' && Number.isFinite(v)) return v;
        if (typeof v === 'string') {
            const n = Number(v.replace(/,/g, '').replace(/^\+/, ''));
            if (Number.isFinite(n)) return n;
        }
        return null;
    }

    function isPlainObject(v) {
        return !!v && typeof v === 'object' && !Array.isArray(v);
    }

    function isStatsEntry(v) {
        return isPlainObject(v) && ('views' in v || 'first_visit' in v || 'last_visit' in v);
    }

    function setText(el, text) {
        if (!el) return;
        el.textContent = text;
    }

    const mockData = {
        photoCount: 1284,
        albumCount: 12,
        todayVisitors: 24
    };

    function applyGuestMode() {
        const uploadBtn = document.getElementById('uploadBtn');
        const greetingText = document.getElementById('greetingText');
        const statPhotos = document.getElementById('statPhotos');
        const statAlbums = document.getElementById('statAlbums');
        const statVisitors = document.getElementById('statVisitors');

        if (uploadBtn) uploadBtn.classList.add('guest-mode-disabled');
        if (greetingText) greetingText.textContent = '欢迎体验 PushFile，这是演示模式的数据展示。';

        animateNumber(statPhotos, mockData.photoCount, 1000);
        animateNumber(statAlbums, mockData.albumCount, 800);
        animateNumber(statVisitors, mockData.todayVisitors, 600, '+');
    }

    async function loadAndRenderStats() {
        if (isGuestMode()) {
            applyGuestMode();
            return;
        }

        const manageCard = document.querySelector('.card-manage');
        const homepageGreeting = document.querySelector('.greeting h2');
        if (!manageCard || !homepageGreeting || !homepageGreeting.textContent?.includes('Admin')) {
            return;
        }

        if (!window.PushFileAuth || typeof window.PushFileAuth.apiGet !== 'function') return;

        const totalPhotosEl = document.getElementById('statPhotos');
        const albumCountEl = document.getElementById('statAlbums');
        const newVisitorsEl = document.getElementById('statVisitors');

        try {
            const tokensData = await window.PushFileAuth.apiGet('/api/tokens', { base });
            let totalPhotos = 0;
            let albumCount = 0;
            if (tokensData && tokensData.tokens && Array.isArray(tokensData.tokens)) {
                albumCount = tokensData.tokens.length;
                totalPhotos = tokensData.tokens.reduce((sum, t) => sum + (t.count || 0), 0);
            }

            // 数字动画展示
            animateNumber(totalPhotosEl, totalPhotos, 1000);
            animateNumber(albumCountEl, albumCount, 800);

            const statsData = await window.PushFileAuth.apiGet('/api/stats', { base });
            let todayViews = 0;
            const todayStr = new Date().toISOString().slice(0, 10);
            const recentItems = [];
            
            if (statsData && typeof statsData === 'object') {
                for (const key of Object.keys(statsData)) {
                    const entry = statsData[key];
                    if (isStatsEntry(entry)) {
                        const lastVisit = entry.last_visit || '';
                        if (lastVisit.slice(0, 10) === todayStr) {
                            todayViews += toNumber(entry.views) || 0;
                        }
                        recentItems.push({
                            title: key.split('/').pop() || key,
                            views: entry.views,
                            last_visit: entry.last_visit
                        });
                    }
                }
            }
            
            animateNumber(newVisitorsEl, todayViews, 600, '+');

            recentItems.sort((a, b) => (b.last_visit || '').localeCompare(a.last_visit || ''));
            const top5 = recentItems.slice(0, 5);
            
            if (top5.length > 0) {
                const items = document.querySelectorAll('.activity-list .activity-item');
                for (let i = 0; i < items.length && i < top5.length; i++) {
                    const item = top5[i];
                    const titleEl = items[i].querySelector('.activity-title');
                    const metaEl = items[i].querySelector('.activity-meta');
                    if (titleEl) setText(titleEl, item.title);
                    if (metaEl) setText(metaEl, `${item.views} 次访问`);
                }
            }

            const greetingText = document.getElementById('greetingText');
            if (greetingText) {
                if (todayViews > 0) {
                    greetingText.textContent = `今天有 ${todayViews} 次访问，数据看起来不错。`;
                } else {
                    greetingText.textContent = '暂无今日访问数据。';
                }
            }
        } catch (err) {
            console.warn('[admin] 统计数据加载失败', err);
            // 加载失败时显示 0
            animateNumber(totalPhotosEl, 0, 500);
            animateNumber(albumCountEl, 0, 400);
            animateNumber(newVisitorsEl, 0, 300, '+');
            const greetingText = document.getElementById('greetingText');
            if (greetingText) greetingText.textContent = '数据加载失败，请刷新重试。';
        }
    }

    guardPromise.then(loadAndRenderStats);

    const homeUpload = {
        selectedPath: '',
        files: [],
        paths: [],
    };

    function splitPath(path) {
        const parts = String(path || '').split('/').filter(Boolean);
        if (parts.length === 0) return { destination: '', folderName: '' };
        return { destination: parts.slice(0, -1).join('/'), folderName: parts[parts.length - 1] || '' };
    }

    function renderHomeUploadPreview() {
        const box = document.getElementById('homeUploadPreview');
        if (!box) return;
        const items = homeUpload.files.slice(0, 6);
        if (items.length === 0) {
            box.innerHTML = '';
            return;
        }
        box.innerHTML = items.map((f) => {
            const isImg = (f && f.type && f.type.startsWith('image/'));
            if (isImg) {
                const url = URL.createObjectURL(f);
                return `<div style="width:100%;aspect-ratio:1/1;border-radius:10px;overflow:hidden;background:var(--color-bg);border:1px solid var(--color-border);"><img src="${url}" style="width:100%;height:100%;object-fit:cover;display:block;"></div>`;
            }
            const name = (f && f.name) ? f.name : '文件';
            return `<div style="width:100%;aspect-ratio:1/1;border-radius:10px;overflow:hidden;background:var(--color-bg);border:1px solid var(--color-border);display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--color-text-secondary);padding:6px;text-align:center;">${name}</div>`;
        }).join('');
    }

    function setHomeUploadDestText() {
        const el = document.getElementById('homeUploadDest');
        if (!el) return;
        el.textContent = homeUpload.selectedPath ? `/${homeUpload.selectedPath}` : '未选择';
    }

    function resetHomeUploadState() {
        homeUpload.files = [];
        homeUpload.paths = [];
        renderHomeUploadPreview();
    }

    function initHomeUpload() {
        const zone = document.getElementById('homeUploadZone');
        const fileInput = document.getElementById('homeUploadFileInput');
        const folderInput = document.getElementById('homeUploadFolderInput');
        const chooseFilesBtn = document.getElementById('homeChooseFilesBtn');
        const chooseFolderBtn = document.getElementById('homeChooseFolderBtn');
        const chooseDestBtn = document.getElementById('homeChooseDestBtn');
        const startBtn = document.getElementById('homeUploadStartBtn');

        if (isGuestMode()) {
            if (startBtn) {
                startBtn.disabled = true;
                startBtn.textContent = '访客模式不可上传';
            }
            return;
        }

        if (chooseFilesBtn && fileInput) {
            chooseFilesBtn.addEventListener('click', () => fileInput.click());
        }
        if (chooseFolderBtn && folderInput) {
            chooseFolderBtn.addEventListener('click', () => folderInput.click());
        }
        if (zone && fileInput) {
            zone.addEventListener('click', (e) => {
                if (e.target && e.target.closest && e.target.closest('button')) return;
                fileInput.click();
            });
            zone.addEventListener('dragover', (e) => {
                e.preventDefault();
            });
            zone.addEventListener('drop', (e) => {
                e.preventDefault();
                const files = (e.dataTransfer && e.dataTransfer.files) ? Array.from(e.dataTransfer.files) : [];
                homeUpload.files = files;
                homeUpload.paths = files.map(f => f.name || 'file');
                renderHomeUploadPreview();
            });
        }

        if (fileInput) {
            fileInput.addEventListener('change', () => {
                const files = fileInput.files ? Array.from(fileInput.files) : [];
                homeUpload.files = files;
                homeUpload.paths = files.map(f => f.name || 'file');
                renderHomeUploadPreview();
            });
        }

        if (folderInput) {
            folderInput.addEventListener('change', () => {
                const files = folderInput.files ? Array.from(folderInput.files) : [];
                homeUpload.files = files;
                homeUpload.paths = files.map(f => f.webkitRelativePath || f.name || 'file');
                renderHomeUploadPreview();
            });
        }

        if (chooseDestBtn) {
            chooseDestBtn.addEventListener('click', () => {
                const picker = new FolderSelector({
                    base,
                    title: '选择保存位置',
                    onSelect: (p) => {
                        homeUpload.selectedPath = p || '';
                        setHomeUploadDestText();
                    },
                });
                picker.show();
            });
        }

        if (startBtn) {
            startBtn.addEventListener('click', async () => {
                if (!window.PushFileAuth || typeof window.PushFileAuth.apiPost !== 'function') return;
                if (!homeUpload.files || homeUpload.files.length === 0) {
                    alert('请先选择要上传的文件');
                    return;
                }
                const { destination, folderName } = splitPath(homeUpload.selectedPath);
                if (!folderName) {
                    alert('请先选择一个具体的保存位置（可在根目录下新建文件夹）');
                    return;
                }

                startBtn.disabled = true;
                startBtn.textContent = '上传中...';

                try {
                    const pairs = homeUpload.files.map((f, idx) => ({
                        file: f,
                        path: homeUpload.paths[idx] || (f && f.name ? f.name : 'file'),
                    }));
                    const zipPairs = pairs.filter(p => (p.file && p.file.name && p.file.name.toLowerCase().endsWith('.zip')));
                    const otherPairs = pairs.filter(p => !(p.file && p.file.name && p.file.name.toLowerCase().endsWith('.zip')));

                    for (const p of zipPairs) {
                        const fd = new FormData();
                        fd.append('file', p.file);
                        fd.append('destination', destination);
                        fd.append('folder_name', folderName);
                        const r = await window.PushFileAuth.apiPost('/api/upload/zip-import', fd, { base });
                        if (!r || r.ok !== true) throw new Error((r && r.detail) || 'ZIP 上传失败');
                    }

                    if (otherPairs.length > 0) {
                        const fd = new FormData();
                        for (const p of otherPairs) {
                            fd.append('files', p.file);
                            fd.append('paths', p.path);
                        }
                        fd.append('destination', destination);
                        fd.append('folder_name', folderName);
                        const r = await window.PushFileAuth.apiPost('/api/upload/folder-import', fd, { base });
                        if (!r || r.ok !== true) throw new Error((r && r.detail) || '上传失败');
                    }

                    alert('上传成功');
                    resetHomeUploadState();
                    closeModal('uploadModal');
                } catch (err) {
                    console.error(err);
                    alert(err && err.message ? err.message : '上传失败');
                } finally {
                    startBtn.disabled = false;
                    startBtn.textContent = '开始上传';
                }
            });
        }

        setHomeUploadDestText();
    }

    guardPromise.then(initHomeUpload);
    // 简单的交互动画逻辑
    
    // 1. 按钮点击波纹效果 (Apple 风格的轻微缩放)
    const buttons = document.querySelectorAll('.btn, .icon-btn, .action-item, .activity-item');
    
    buttons.forEach(btn => {
        btn.addEventListener('mousedown', function() {
            this.style.transform = 'scale(0.96)';
            this.style.transition = 'transform 0.1s cubic-bezier(0.2, 0.8, 0.2, 1)';
        });
        
        btn.addEventListener('mouseup', function() {
            this.style.transform = '';
            this.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
        });
        
        btn.addEventListener('mouseleave', function() {
            this.style.transform = '';
            this.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
        });
    });

    // 2. 统计图表动画
    const bars = document.querySelectorAll('.bar');
    
    // 初始状态设为 0
    bars.forEach(bar => {
        const targetHeight = bar.style.height;
        bar.dataset.targetHeight = targetHeight;
        bar.style.height = '0%';
    });
    
    // 延迟触发动画，产生生长效果
    setTimeout(() => {
        bars.forEach((bar, index) => {
            setTimeout(() => {
                bar.style.height = bar.dataset.targetHeight;
            }, index * 100); // 错开动画时间
        });
    }, 500);

    // 3. 卡片 3D 悬浮效果 (可选，增加高级感)
    const cards = document.querySelectorAll('.bento-card');
    
    // 4. Bento Grid 卡片错峰入场动画 (Stagger Animation)
    cards.forEach((card, index) => {
        setTimeout(() => {
            card.classList.add('animate-in');
        }, index * 100 + 100); // 基础延迟 100ms，每个卡片间隔 100ms
    });
    
    cards.forEach(card => {
        card.addEventListener('mousemove', e => {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;
            
            const rotateX = ((y - centerY) / centerY) * -2;
            const rotateY = ((x - centerX) / centerX) * 2;
            
            card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-4px)`;
            card.style.transition = 'none';
        });
        
        card.addEventListener('mouseleave', () => {
            card.style.transform = '';
            card.style.transition = 'all 0.4s cubic-bezier(0.2, 0.8, 0.2, 1)';
        });
    });
});
