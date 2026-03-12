document.addEventListener('DOMContentLoaded', () => {
    const base = window.__BASE__ || '';

    if (window.PushFileAuth && typeof window.PushFileAuth.guardPage === 'function') {
        window.PushFileAuth.guardPage({ base });
    }

    function setText(id, text) {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = text;
    }

    function formatNumber(n) {
        try {
            return Number(n).toLocaleString('zh-CN');
        } catch (_) {
            return String(n);
        }
    }

    async function loadDashboard() {
        if (!window.PushFileAuth || typeof window.PushFileAuth.apiGet !== 'function') return;
        const data = await window.PushFileAuth.apiGet('/api/stats/dashboard', { base });
        if (!data || data.ok !== true) return;

        setText('statPhotos', formatNumber(data.photo_count ?? 0));
        setText('statAlbums', formatNumber(data.album_count ?? 0));
        setText('statToday', formatNumber(data.today_visits ?? 0));
        setText('statTotal', formatNumber(data.total_visits ?? 0));

        setText('dashSubtitle', `今日访问 ${formatNumber(data.today_visits ?? 0)}，总访问 ${formatNumber(data.total_visits ?? 0)}`);

        const list = document.getElementById('dashActivityList');
        if (!list) return;
        const items = Array.isArray(data.recent_activities) ? data.recent_activities : [];
        if (items.length === 0) {
            list.innerHTML = `
                <div class="activity-item">
                    <div class="activity-content">
                        <div class="activity-title">暂无活动</div>
                        <div class="activity-meta">还没有访问记录</div>
                    </div>
                </div>
            `;
            return;
        }

        list.innerHTML = items.slice(0, 12).map((it) => {
            const name = String(it.name || '');
            const title = name.split('/').pop() || name || '未知';
            const views = it.views ?? 0;
            const last = String(it.last_visit || '');
            const meta = `${formatNumber(views)} 次访问${last ? ' • ' + last.replace('T', ' ').slice(0, 19) : ''}`;
            return `
                <div class="activity-item" onclick="go('/manage')">
                    <div class="activity-icon file-image"><i class="ph ph-chart-line-up"></i></div>
                    <div class="activity-content">
                        <div class="activity-title">${title}</div>
                        <div class="activity-meta">${meta}</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    loadDashboard().catch((e) => {
        console.warn('dashboard load failed', e);
    });
});
