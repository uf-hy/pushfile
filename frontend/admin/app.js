function getBase() {
    return window.__BASE__ || '';
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

    function formatNumber(n) {
        try {
            return Number(n).toLocaleString('zh-CN');
        } catch (_) {
            return String(n);
        }
    }

    function pickNumber(obj, keys) {
        if (!obj || typeof obj !== 'object') return null;
        for (const k of keys) {
            const n = toNumber(obj[k]);
            if (n !== null) return n;
        }
        return null;
    }

    function isPlainObject(v) {
        return !!v && typeof v === 'object' && !Array.isArray(v);
    }

    function isStatsEntry(v) {
        return isPlainObject(v) && ('views' in v || 'first_visit' in v || 'last_visit' in v);
    }

    function resolveStatsPayload(payload) {
        const root = isPlainObject(payload) ? payload : {};
        const totals = isPlainObject(root.totals) ? root.totals : {};

        const photoCount =
            pickNumber(root, ['photo_count', 'photos', 'images', 'total_photos', 'total_images', 'total_photo_count']) ??
            pickNumber(totals, ['photo_count', 'photos', 'images', 'total_photos', 'total_images', 'total_photo_count']);

        let albumCount =
            pickNumber(root, ['album_count', 'albums', 'total_albums', 'total_album_count']) ??
            pickNumber(totals, ['album_count', 'albums', 'total_albums', 'total_album_count']);

        if (albumCount === null && isPlainObject(root)) {
            const keys = Object.keys(root);
            const entryCount = keys.reduce((acc, k) => (isStatsEntry(root[k]) ? acc + 1 : acc), 0);
            if (entryCount > 0) albumCount = entryCount;
        }

        const newVisitors =
            pickNumber(root, ['today_visit_count', 'new_visitors', 'new_visitor_count', 'today_new_visitors', 'unique_ip_count']) ??
            pickNumber(totals, ['today_visit_count', 'new_visitors', 'new_visitor_count', 'today_new_visitors', 'unique_ip_count']);

        const todayUploads =
            pickNumber(root, ['today_upload_count', 'upload_today', 'today_new_files', 'new_files_today']) ??
            pickNumber(totals, ['today_upload_count', 'upload_today', 'today_new_files', 'new_files_today']);

        const activities =
            (Array.isArray(root.recent_activities) && root.recent_activities) ||
            (Array.isArray(root.activities) && root.activities) ||
            (Array.isArray(root.recent) && root.recent) ||
            (Array.isArray(totals.recent_activities) && totals.recent_activities) ||
            null;

        return { photoCount, albumCount, newVisitors, todayUploads, activities };
    }

    function setText(el, text) {
        if (!el) return;
        el.textContent = text;
    }

    async function loadAndRenderStats() {
        if (!window.PushFileAuth || typeof window.PushFileAuth.apiGet !== 'function') return;
        try {
            const tokensData = await window.PushFileAuth.apiGet('/api/tokens', { base });
            let totalPhotos = 0;
            let albumCount = 0;
            if (tokensData && tokensData.tokens && Array.isArray(tokensData.tokens)) {
                albumCount = tokensData.tokens.length;
                totalPhotos = tokensData.tokens.reduce((sum, t) => sum + (t.count || 0), 0);
            }

            const totalPhotosEl = document.querySelector('.card-manage .stat-item:nth-child(1) .stat-value');
            const albumCountEl = document.querySelector('.card-manage .stat-item:nth-child(3) .stat-value');
            const newVisitorsEl = document.querySelector('.card-manage .stat-item:nth-child(5) .stat-value');

            setText(totalPhotosEl, formatNumber(totalPhotos));
            setText(albumCountEl, formatNumber(albumCount));

            const statsData = await window.PushFileAuth.apiGet('/api/stats', { base });
            let totalViews = 0;
            let todayViews = 0;
            const todayStr = new Date().toISOString().slice(0, 10);
            const recentItems = [];
            
            if (statsData && typeof statsData === 'object') {
                for (const key of Object.keys(statsData)) {
                    const entry = statsData[key];
                    if (isStatsEntry(entry)) {
                        totalViews += toNumber(entry.views) || 0;
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
            
            setText(newVisitorsEl, `+${formatNumber(todayViews)}`);

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

            if (todayViews > 0) {
                const greetingP = document.querySelector('.greeting p');
                if (greetingP && typeof greetingP.textContent === 'string') {
                    greetingP.textContent = greetingP.textContent.replace(/\d+/, String(todayViews));
                }
            }
        } catch (err) {
            console.warn('[admin] 统计数据加载失败', err);
        }
    }

    guardPromise.then(loadAndRenderStats);
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
