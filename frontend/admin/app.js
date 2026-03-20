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

function showToast(message) {
    let toast = document.getElementById('globalAdminToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'globalAdminToast';
        toast.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%) translateY(18px);background:rgba(28,28,30,0.9);color:#fff;padding:12px 16px;border-radius:14px;font-size:13px;font-weight:600;z-index:10020;opacity:0;pointer-events:none;transition:all .25s ease;box-shadow:0 12px 28px rgba(0,0,0,.18);backdrop-filter:blur(12px);max-width:min(88vw,420px);text-align:center;';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(18px)';
    }, 2200);
}

window.showToast = showToast;

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
    fetch(`${base || ''}/api/auth/logout`, { method: 'POST' }).finally(() => {
        window.location.href = `${base || ''}/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    });
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

    function setText(el, text) {
        if (!el) return;
        el.textContent = text;
    }

    function escapeHtml(s) {
        if (!s) return '';
        return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    async function loadUserPanel() {
        const summary = document.getElementById('userMenuSummary');
        const listEl = document.getElementById('userListPanel');
        const avatarImg = document.querySelector('.user-avatar img');
        const createSection = document.getElementById('userCreateSection');
        if (!summary || !listEl || !window.PushFileAuth) return;
        try {
            const me = await window.PushFileAuth.apiGet('/api/auth/me', { base });
            const username = me?.user?.username || 'admin';
            const isAdmin = !!me?.user?.is_admin;
            summary.textContent = `当前账号：${username}`;
            if (createSection) {
                createSection.style.display = isAdmin ? 'grid' : 'none';
            }
            if (avatarImg) {
                avatarImg.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=0D8ABC&color=fff&rounded=true`;
                avatarImg.alt = username;
            }
            const usersResp = isAdmin
                ? await window.PushFileAuth.apiGet('/api/auth/users', { base })
                : { users: [{ username, is_legacy: !!me?.user?.is_legacy, is_active: true }] };
            const users = usersResp?.users || [];
            if (!users.length) {
                listEl.innerHTML = '<div style="font-size:13px;color:var(--color-text-secondary);">暂无可见用户</div>';
                return;
            }
            listEl.innerHTML = users.map((item) => `
                <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid var(--color-border);border-radius:14px;background:rgba(245,245,247,0.72);">
                    <div>
                        <div style="font-size:14px;font-weight:600;">${escapeHtml(item.username)}</div>
                        <div style="font-size:12px;color:var(--color-text-secondary);">${item.is_legacy ? 'legacy 空间' : '独立空间'}</div>
                    </div>
                    <div style="font-size:12px;color:${item.is_active ? 'var(--color-primary)' : 'var(--color-text-secondary)'};font-weight:600;">${item.is_active ? '启用' : '停用'}</div>
                </div>
            `).join('');
        } catch (err) {
            console.error('load user panel failed', err);
            summary.textContent = '读取账号失败';
            if (createSection) createSection.style.display = 'none';
            listEl.innerHTML = '<div style="font-size:13px;color:var(--color-text-secondary);">无法读取用户列表</div>';
        }
    }

    window.openUserMenu = async function openUserMenu() {
        openModal('userMenuModal');
        await loadUserPanel();
    };

    window.createManagerUser = async function createManagerUser() {
        const usernameInput = document.getElementById('newManagerUsername');
        const passwordInput = document.getElementById('newManagerPassword');
        const username = usernameInput?.value.trim() || '';
        const password = passwordInput?.value.trim() || '';
        if (!username || !password) {
            showToast('请输入用户名和密码');
            return;
        }
        try {
            const resp = await window.PushFileAuth.apiPost('/api/auth/users', JSON.stringify({ username, password }), { base });
            if (!resp || resp.ok !== true) {
                throw new Error(resp?.detail || '创建失败');
            }
            if (usernameInput) usernameInput.value = '';
            if (passwordInput) passwordInput.value = '';
            showToast(`已创建用户：${username}`);
            await loadUserPanel();
        } catch (err) {
            console.error('create user failed', err);
            showToast(`创建失败：${err?.message || '请稍后重试'}`);
        }
    };

    function setChartSummary(dailyData) {
        const days = (dailyData?.days || []).slice(-7);
        const todayEl = document.getElementById('chartTodayValue');
        const todayMetaEl = document.getElementById('chartTodayMeta');
        const weekEl = document.getElementById('chartWeekValue');
        const peakEl = document.getElementById('chartPeakValue');
        const peakMetaEl = document.getElementById('chartPeakMeta');
        if (!todayEl || !todayMetaEl || !weekEl || !peakEl || !peakMetaEl) return;

        if (days.length === 0) {
            todayEl.textContent = '-';
            todayMetaEl.textContent = '暂无数据';
            weekEl.textContent = '-';
            peakEl.textContent = '-';
            peakMetaEl.textContent = '暂无峰值';
            return;
        }

        const total = days.reduce((sum, d) => sum + (Number(d.views) || 0), 0);
        const peak = days.reduce((best, d) => ((Number(d.views) || 0) > (Number(best.views) || 0) ? d : best), days[0]);
        const today = days[days.length - 1];
        const parts = String(peak.date || '').split('-');
        const peakLabel = parts.length === 3 ? `${Number(parts[1])}/${Number(parts[2])}` : '最近';

        todayEl.textContent = String(Number(today.views) || 0);
        todayMetaEl.textContent = peak.date === today.date ? '也是最近峰值' : '较峰值仍有空间';
        weekEl.textContent = String(total);
        peakEl.textContent = String(Number(peak.views) || 0);
        peakMetaEl.textContent = `${peakLabel} 达到峰值`;
    }

    async function loadDashboard() {
        if (!window.PushFileAuth || typeof window.PushFileAuth.apiGet !== 'function') return;

        const manageCard = document.querySelector('.card-manage');
        const homepageGreeting = document.querySelector('.greeting h2');
        if (!manageCard || !homepageGreeting || !homepageGreeting.textContent?.includes('Admin')) {
            triggerEntranceAnimations();
            return;
        }

        const totalPhotosEl = document.getElementById('statPhotos');
        const albumCountEl = document.getElementById('statAlbums');
        const newVisitorsEl = document.getElementById('statVisitors');

        try {
            const [data, dailyData] = await Promise.all([
                window.PushFileAuth.apiGet('/api/stats/dashboard', { base }),
                window.PushFileAuth.apiGet('/api/stats/daily', { base })
            ]);

            const photoCount = toNumber(data?.photo_count) || 0;
            const albumCount = toNumber(data?.album_count) || 0;
            const todayVisits = toNumber(data?.today_visits) || 0;

            animateNumber(totalPhotosEl, photoCount, 1000);
            animateNumber(albumCountEl, albumCount, 800);
            animateNumber(newVisitorsEl, todayVisits, 600, '+');

            initDailyChart(dailyData);
            setChartSummary(dailyData);

            const activities = data?.recent_activities || [];

            const listEl = document.getElementById('activityList');
            if (listEl) {
                if (activities.length === 0) {
                    listEl.innerHTML = '<div style="padding:16px;text-align:center;color:var(--color-text-secondary);font-size:13px;">暂无活动记录</div>';
                } else {
                    listEl.innerHTML = activities.slice(0, 5).map(a => `
                        <div class="activity-item" onclick="go('/manage/dashboard')">
                            <div class="activity-icon file-image"><i class="ph ph-image"></i></div>
                            <div class="activity-content">
                                <div class="activity-title">${escapeHtml(a.title || a.name)}</div>
                                <div class="activity-meta">${a.views || 0} 次访问</div>
                            </div>
                        </div>
                    `).join('');
                }
            }

            const greetingText = document.getElementById('greetingText');
            if (greetingText) {
                if (todayVisits > 0) {
                    greetingText.textContent = `今天有 ${todayVisits} 次访问，数据看起来不错。`;
                } else {
                    greetingText.textContent = '暂无今日访问数据。';
                }
            }
        } catch (err) {
            console.warn('[admin] dashboard 数据加载失败', err);
            animateNumber(totalPhotosEl, 0, 500);
            animateNumber(albumCountEl, 0, 400);
            animateNumber(newVisitorsEl, 0, 300, '+');
            setChartSummary({ days: [] });
            const greetingText = document.getElementById('greetingText');
            if (greetingText) greetingText.textContent = '数据加载失败，请刷新重试。';
        }

        triggerEntranceAnimations();
    }

    function initDailyChart(dailyData) {
        const canvas = document.getElementById('dailyChart');
        if (!canvas || typeof Chart === 'undefined') return;

        if (window._dailyChartInstance) window._dailyChartInstance.destroy();

        const days = (dailyData?.days || []).slice(-7);
        if (days.length === 0) return;
        
        const todayStr = new Date().toLocaleDateString('sv-SE', {timeZone: 'Asia/Shanghai'});
        const labels = days.map(d => {
            if (d.date === todayStr) return '今天';
            const parts = d.date.split('-');
            return `${parseInt(parts[1])}/${parseInt(parts[2])}`;
        });
        
        const bgColors = days.map(d => d.date === todayStr ? '#FFB13A' : '#ECEEF3');
        const borderColors = days.map(d => d.date === todayStr ? '#FF9500' : '#E2E6EE');
        const values = days.map(d => Number(d.views) || 0);
        const labelPlugin = {
            id: 'pushfileValueLabels',
            afterDatasetsDraw(chart) {
                const { ctx } = chart;
                const meta = chart.getDatasetMeta(0);
                ctx.save();
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                meta.data.forEach((bar, index) => {
                    const value = values[index];
                    const { x, y, base } = bar.getProps(['x', 'y', 'base'], true);
                    const textY = Math.min(y, base) - 8;
                    ctx.fillStyle = days[index].date === todayStr ? '#FF9500' : '#8A8E96';
                    ctx.font = '600 12px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", sans-serif';
                    ctx.fillText(String(value), x, textY);
                });
                ctx.restore();
            }
        };

        window._dailyChartInstance = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    data: values,
                    backgroundColor: bgColors,
                    borderColor: borderColors,
                    borderWidth: 1,
                    borderRadius: 10,
                    borderSkipped: false,
                    hoverBackgroundColor: days.map(d => d.date === todayStr ? '#FFAA29' : '#E3E6ED'),
                    hoverBorderColor: days.map(d => d.date === todayStr ? '#FF9500' : '#D5D9E3'),
                    barPercentage: 0.58,
                    categoryPercentage: 0.82,
                    maxBarThickness: 28,
                }]
            },
            plugins: [labelPlugin],
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: {
                    padding: { top: 24, right: 6, bottom: 0, left: 6 }
                },
                animation: {
                    duration: 800,
                    easing: 'easeOutQuart',
                    delay: function(context) {
                        return context.dataIndex * 80;
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: '#FFFFFF',
                        titleColor: '#1D1D1F',
                        bodyColor: '#86868B',
                        titleFont: { size: 12 },
                        bodyFont: { size: 12 },
                        padding: 10,
                        cornerRadius: 12,
                        borderColor: 'rgba(0,0,0,0.06)',
                        borderWidth: 1,
                        displayColors: false,
                        callbacks: {
                            title: function(items) {
                                const index = items[0].dataIndex;
                                const d = days[index];
                                return d && d.date === todayStr ? `${d.date} · 今天` : (d ? d.date : items[0].label);
                            },
                            label: function(item) {
                                return item.raw + ' 次访问';
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false, drawBorder: false },
                        ticks: {
                            font: { size: 12, weight: '600' },
                            color: '#9AA0AA',
                            padding: 10,
                        },
                        border: { display: false }
                    },
                    y: {
                        display: false,
                        border: { display: false },
                        beginAtZero: true,
                    }
                }
            }
        });
    }

    function triggerEntranceAnimations() {
        const cards = document.querySelectorAll('.bento-card');
        cards.forEach((card, index) => {
            setTimeout(() => {
                card.classList.add('animate-in');
            }, index * 100 + 100);
        });
    }

    guardPromise.then(loadDashboard);

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
            return `<div style="width:100%;aspect-ratio:1/1;border-radius:10px;overflow:hidden;background:var(--color-bg);border:1px solid var(--color-border);display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--color-text-secondary);padding:6px;text-align:center;">${escapeHtml(name)}</div>`;
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
                    showToast('请先选择要上传的文件');
                    return;
                }
                const { destination, folderName } = splitPath(homeUpload.selectedPath);
                if (!folderName) {
                    showToast('请先选择一个具体的保存位置（可在根目录下新建文件夹）');
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

                    showToast('上传成功');
                    resetHomeUploadState();
                    closeModal('uploadModal');
                } catch (err) {
                    console.error(err);
                    showToast(err && err.message ? err.message : '上传失败');
                } finally {
                    startBtn.disabled = false;
                    startBtn.textContent = '开始上传';
                }
            });
        }

        setHomeUploadDestText();
    }

    guardPromise.then(initHomeUpload);

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

    const allCards = document.querySelectorAll('.bento-card');
    allCards.forEach(card => {
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
