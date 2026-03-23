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

    function formatChartLabel(index) {
        return `TOP${index + 1}`;
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        }[char] || char));
    }

    function formatChartTitle(title) {
        const text = String(title || '').trim();
        if (!text) return '未命名';
        if (text.length <= 8) return text;
        const suffixMatch = text.match(/\d+$/);
        if (suffixMatch) {
            const suffix = suffixMatch[0];
            const headLength = Math.max(3, 7 - suffix.length);
            return `${text.slice(0, headLength)}…${suffix}`;
        }
        return `${text.slice(0, 7)}…`;
    }

    function looksTechnicalTitle(value) {
        const text = String(value || '').trim();
        if (!text) return true;
        if (/^[a-z]-[a-f0-9]{8,}$/i.test(text)) return true;
        if (/^[a-f0-9_-]{10,}$/i.test(text)) return true;
        return false;
    }

    function toReadableTitle(rawTitle, rawName) {
        const title = String(rawTitle || '').trim();
        const name = String(rawName || '').trim();
        const fallback = name.split('/').pop() || name || '';
        const candidate = title || fallback;
        if (!candidate || looksTechnicalTitle(candidate)) {
            return '未命名画廊';
        }
        return candidate;
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
        const items = Array.isArray(data.recent_activities) ? data.recent_activities : [];
        if (list && items.length === 0) {
            list.innerHTML = `
                <div class="activity-item">
                    <div class="activity-content">
                        <div class="activity-title">暂无活动</div>
                        <div class="activity-meta">还没有访问记录</div>
                    </div>
                </div>
            `;
        }

        const normalized = items.slice(0, 12).map((it) => {
            const name = String(it.name || '');
            const rawTitle = String(it.title || '').trim();
            const title = toReadableTitle(rawTitle, name);
            return {
                name,
                title,
                views: Number(it.views ?? 0),
                last: String(it.last_visit || ''),
            };
        });

        const rankedByViews = [...normalized].sort((a, b) => {
            if (b.views !== a.views) return b.views - a.views;
            return (b.last || '').localeCompare(a.last || '');
        });

        if (list) {
            list.innerHTML = normalized.map((it) => {
                const lastVisitText = it.last ? ` • ${it.last.replace('T', ' ').slice(0, 19)}` : '';
                const meta = `${formatNumber(it.views)} 次访问${lastVisitText}`;
                return `
                    <div class="activity-item" onclick="go('/manage')">
                        <div class="activity-icon file-image"><i class="ph ph-chart-line-up"></i></div>
                        <div class="activity-content">
                            <div class="activity-title">${escapeHtml(it.title)}</div>
                            <div class="activity-meta">${escapeHtml(meta)}</div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        const maxViews = Math.max(...normalized.map(it => it.views), 1);
        const barChart = document.getElementById('dashboardBarChart');
        if (barChart) {
            barChart.innerHTML = rankedByViews.slice(0, 5).map((it, index) => {
                const height = Math.max(12, Math.round((it.views / maxViews) * 100));
                const chartLabel = formatChartLabel(index);
                const chartTitle = formatChartTitle(it.title);
                return `
                    <div class="dashboard-bar-item">
                        <div class="dashboard-bar-value">${formatNumber(it.views)}</div>
                        <div class="dashboard-bar-track">
                            <div class="dashboard-bar-fill" style="height:${height}%"></div>
                        </div>
                        <div class="dashboard-bar-rank">${chartLabel}</div>
                        <div class="dashboard-bar-label" title="${escapeHtml(it.title)}">${escapeHtml(chartTitle)}</div>
                    </div>
                `;
            }).join('');
        }

        const rankList = document.getElementById('dashboardRankList');
        if (rankList) {
            rankList.innerHTML = rankedByViews.slice(0, 5).map((it, index) => `
                <div class="dashboard-rank-item" onclick="go('/manage')">
                    <div class="dashboard-rank-order">${index + 1}</div>
                    <div class="dashboard-rank-main">
                        <div class="dashboard-rank-title">${escapeHtml(it.title)}</div>
                        <div class="dashboard-rank-meta">${formatNumber(it.views)} 次访问</div>
                    </div>
                </div>
            `).join('');
        }
    }

    loadDashboard().catch((e) => {
        console.warn('dashboard load failed', e);
    });
});
