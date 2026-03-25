
// 全局状态管理
const state = {
    key: (window.PushFileAuth && typeof window.PushFileAuth.getKey === 'function')
        ? window.PushFileAuth.getKey()
        : (localStorage.getItem('pushfile_admin_key') || ''),
    base: window.__BASE__ || '',
    tokens: [],
    currentToken: null,
    currentPath: '',
    currentTitle: '',
    currentFiles: [],
    currentFolders: [],
    folderTree: [],
    expandedFolders: new Set(),
    sidebarTreeReady: false,
    folderPanelMode: 'create',
    createFolderParentPath: '',
    renameFolderPath: '',
    downloadMode: localStorage.getItem('pf_manager_download_mode') === 'original' ? 'original' : 'deliverable',
    searchQuery: '',
    searchScope: 'subtree',
    searchResults: [],
    searchRequestId: 0,
    focusedFile: '',
    uploadTargetPath: '',
    pendingUploadFiles: [],
    pendingUploadPaths: [],
    trashItems: []
};

// API 工具函数
const api = {
    async get(path) {
        if (window.PushFileAuth && typeof window.PushFileAuth.apiGet === 'function') {
            return window.PushFileAuth.apiGet(path, { base: state.base });
        }
        const url = new URL(state.base + path, window.location.origin);
        url.searchParams.append('key', state.key);
        const res = await fetch(url);
        return res.json();
    },
    async post(path, body) {
        if (window.PushFileAuth && typeof window.PushFileAuth.apiPost === 'function') {
            return window.PushFileAuth.apiPost(path, body, { base: state.base });
        }
        const res = await fetch(state.base + path, {
            method: 'POST',
            headers: {
                'X-Upload-Key': state.key,
                ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' })
            },
            body: body
        });
        return res.json();
    }
};

function isVideoFile(file) {
    return !!String(file || '').toLowerCase().match(/\.(mp4|mov|webm)$/);
}

function getDownloadModeLabel(mode = state.downloadMode) {
    return mode === 'original' ? '下载原图' : '下载图片';
}

function getSearchScopeChipLabel(scope = state.searchScope) {
    return scope === 'global' ? '全部资源库' : '当前路径';
}

function normalizeBase() {
    return (state.base || '').replace(/\/$/, '');
}

function getRawFileUrl(file, token = state.currentToken) {
    if (!token || !file) return '';
    const base = normalizeBase();
    return `${window.location.origin}${base}/d/${encodeURIComponent(token)}/${encodeURIComponent(file)}`;
}

function getPreviewFileUrl(file, token = state.currentToken) {
    if (!token || !file) return '';
    if (isVideoFile(file)) return getRawFileUrl(file, token);
    const base = normalizeBase();
    return `${window.location.origin}${base}/v/${encodeURIComponent(token)}/${encodeURIComponent(file)}?kind=view-jpg`;
}

function getThumbFileUrl(file, token = state.currentToken) {
    if (!token || !file) return '';
    if (isVideoFile(file)) return getRawFileUrl(file, token);
    const base = normalizeBase();
    return `${window.location.origin}${base}/v/${encodeURIComponent(token)}/${encodeURIComponent(file)}?kind=thumb-avif`;
}

function getCurrentFileDownloadLink(file, token = state.currentToken, mode = state.downloadMode) {
    if (!token || !file) return '';
    const base = normalizeBase();
    if (mode === 'original') {
        return `${window.location.origin}${base}/d/${encodeURIComponent(token)}/${encodeURIComponent(file)}`;
    }
    return `${window.location.origin}${base}/f/${encodeURIComponent(token)}/${encodeURIComponent(file)}`;
}

function setDownloadMode(mode) {
    state.downloadMode = mode === 'original' ? 'original' : 'deliverable';
    localStorage.setItem('pf_manager_download_mode', state.downloadMode);
    updateDownloadModeUI();
    renderGridView();
}

function updateDownloadModeUI() {
    document.querySelectorAll('.mode-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.mode === state.downloadMode);
    });
    const label = getDownloadModeLabel();
    const pill = document.getElementById('managerModePill');
    const status = document.getElementById('statusModeLabel');
    const batchLabel = document.getElementById('batchDownloadLabel');
    if (pill) pill.textContent = label;
    if (status) status.textContent = label;
    if (batchLabel) batchLabel.textContent = label;
}

function updateSearchPlaceholder() {
    const input = document.getElementById('managerSearchInput');
    if (!input) return;
    input.placeholder = '搜索文件名或路径';
    const scopeLabel = document.getElementById('searchScopeLabel');
    if (scopeLabel) scopeLabel.textContent = getSearchScopeChipLabel();
    const scopeButton = document.getElementById('searchScopeButton');
    if (scopeButton) {
        scopeButton.setAttribute('aria-label', state.searchScope === 'global' ? '当前搜索范围：全部资源库' : '当前搜索范围：当前路径及子路径');
    }
    const scopeMenu = document.getElementById('searchScopeMenu');
    if (scopeMenu) {
        scopeMenu.querySelectorAll('[data-scope]').forEach((item) => {
            const active = item.getAttribute('data-scope') === state.searchScope;
            item.classList.toggle('active', active);
            item.setAttribute('aria-checked', active ? 'true' : 'false');
        });
    }
}

function closeSearchScopeMenu() {
    const scopeMenu = document.getElementById('searchScopeMenu');
    const scopeButton = document.getElementById('searchScopeButton');
    if (scopeMenu) scopeMenu.hidden = true;
    if (scopeButton) scopeButton.setAttribute('aria-expanded', 'false');
    updateSearchBoxState();
}

function toggleSearchScopeMenu(forceOpen) {
    const scopeMenu = document.getElementById('searchScopeMenu');
    const scopeButton = document.getElementById('searchScopeButton');
    if (!scopeMenu || !scopeButton) return;
    const nextOpen = typeof forceOpen === 'boolean' ? forceOpen : scopeMenu.hidden;
    scopeMenu.hidden = !nextOpen;
    scopeButton.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
    updateSearchBoxState();
}

function updateSearchBoxState(forceExpand = false) {
    const searchBox = document.querySelector('.search-box');
    const searchInput = document.getElementById('managerSearchInput');
    const scopeMenu = document.getElementById('searchScopeMenu');
    if (!searchBox || !searchInput) return;
    const hasQuery = !!String(searchInput.value || '').trim();
    const hasFocus = searchBox.contains(document.activeElement);
    const menuOpen = !!scopeMenu && !scopeMenu.hidden;
    searchBox.classList.toggle('is-expanded', !!forceExpand || hasQuery || hasFocus || menuOpen);
}

function updateWindowChrome() {
    const title = document.getElementById('managerWindowTitle');
    const subtitle = document.getElementById('managerWindowSubtitle');
    const selectionPill = document.getElementById('managerSelectionPill');
    if (title) title.textContent = state.currentTitle || '所有相册';
    if (subtitle) {
        if (state.searchQuery.trim()) {
            subtitle.textContent = `正在搜索“${state.searchQuery.trim()}” · ${state.searchScope === 'global' ? '全部资源库' : '当前路径及子路径'}`;
        } else if (state.currentPath) {
            subtitle.textContent = `当前路径 /${state.currentPath}`;
        } else {
            subtitle.textContent = '像访达一样浏览、预览与整理素材';
        }
    }
    if (selectionPill) {
        if (getSelectionCount() > 0) {
            selectionPill.textContent = `已选择 ${getSelectionCount()} 项`;
        } else if (state.currentPath || state.currentToken) {
            selectionPill.textContent = '当前路径可下载';
        } else {
            selectionPill.textContent = '未选择';
        }
    }
}

function updateStatusBar() {
    const pathLabel = document.getElementById('statusPathLabel');
    const countLabel = document.getElementById('statusCountLabel');
    const searchLabel = document.getElementById('statusSearchLabel');
    if (pathLabel) {
        pathLabel.textContent = state.currentPath ? `/${state.currentPath}` : '所有相册';
    }
    if (countLabel) {
        if (state.searchQuery.trim()) {
            countLabel.textContent = `${state.searchResults.length} 个命中`; 
        } else if (!state.currentPath && !state.currentToken) {
            countLabel.textContent = `${(state.folderTree || []).length} 个顶层相册`; 
        } else {
            countLabel.textContent = `${state.currentFiles.length} 张照片 · ${state.currentFolders.length} 个子文件夹`; 
        }
    }
    if (searchLabel) {
        searchLabel.textContent = state.searchQuery.trim()
            ? `${state.searchScope === 'global' ? '全部资源库' : '当前路径及子路径'} · 搜索模式`
            : '浏览模式';
    }
    updateWindowChrome();
}

function clearSearchState({ clearInput = true } = {}) {
    state.searchQuery = '';
    state.searchResults = [];
    state.searchRequestId += 1;
    if (clearInput) {
        const input = document.getElementById('managerSearchInput');
        if (input) input.value = '';
    }
    updateSearchPlaceholder();
}

async function runSearch(query) {
    const trimmed = String(query || '').trim();
    state.searchQuery = trimmed;
    if (!trimmed) {
        state.searchResults = [];
        renderGridView();
        return;
    }
    const requestId = state.searchRequestId + 1;
    state.searchRequestId = requestId;
    const path = state.currentPath || '';
    try {
        const data = await api.get(`/api/folders/search?query=${encodeURIComponent(trimmed)}&scope=${encodeURIComponent(state.searchScope)}&path=${encodeURIComponent(path)}`);
        if (requestId !== state.searchRequestId) return;
        if (data?.ok) {
            state.searchResults = Array.isArray(data.results) ? data.results : [];
            clearSelection();
            renderGridView();
        }
    } catch (err) {
        console.error('search failed:', err);
        if (requestId !== state.searchRequestId) return;
        state.searchResults = [];
        renderGridView();
        showToast('搜索失败，请稍后重试');
    }
}

function focusPendingFile() {
    if (!state.focusedFile) return;
    const hit = [...document.querySelectorAll('.image-item')].find((el) => el.dataset.file === state.focusedFile);
    state.focusedFile = '';
    if (!hit) return;
    hit.classList.add('focus-flash');
    hit.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    window.setTimeout(() => hit.classList.remove('focus-flash'), 1400);
}

async function exportSelectedFiles(files) {
    if (!state.currentToken || !files.length) return;
    const data = await fetch(`${normalizeBase()}/api/manage/${encodeURIComponent(state.currentToken)}/export`, {
        method: 'POST',
        headers: {
            'X-Upload-Key': state.key,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ names: files, mode: state.downloadMode }),
    });
    if (!data.ok) {
        throw new Error(await data.text().catch(() => '导出失败'));
    }
    const blob = await data.blob();
    const disposition = data.headers.get('content-disposition') || '';
    const match = disposition.match(/filename\*=UTF-8''([^;]+)/i) || disposition.match(/filename="?([^";]+)"?/i);
    const downloadName = match ? decodeURIComponent(match[1]) : (files.length > 1 ? 'export.zip' : files[0]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// 核心功能：初始化应用
async function initApp() {
    if (window.PushFileAuth && typeof window.PushFileAuth.guardPage === 'function') {
        await window.PushFileAuth.guardPage({ base: state.base });
        state.key = window.PushFileAuth.getKey();
    }

    const savedSidebarWidth = localStorage.getItem('pf_manager_sidebar_width');
    if (savedSidebarWidth) {
        const n = Number(savedSidebarWidth);
        if (Number.isFinite(n)) {
            document.documentElement.style.setProperty('--sidebar-width', `${Math.min(520, Math.max(220, n))}px`);
        }
    }
    
    try {
        updateSearchPlaceholder();
        updateDownloadModeUI();
        await loadTokens();
        setupEventListeners();
    } catch (e) {
        console.error('Failed to init app:', e);
    }
}

// 加载相册列表 (Tokens)
async function loadTokens() {
    const data = await api.get('/api/folders/tree');
    if (data.ok) {
        state.tokens = [];
        state.folderTree = data.tree || [];
        
        function flattenTree(nodes) {
            for (const node of nodes) {
                if (node.slug) {
                    state.tokens.push({
                        token: node.slug,
                        title: node.name,
                        path: node.path,
                        count: node.image_count,
                        isAlbum: !!node.is_album,
                    });
                }
                if (node.children && node.children.length > 0) {
                    flattenTree(node.children);
                }
            }
        }
        flattenTree(state.folderTree);

        const current = state.currentToken
            ? state.tokens.find(t => t.token === state.currentToken)
            : null;
        const target = current || state.tokens[0] || null;
        state.currentToken = target ? target.token : null;
        syncExpandedFolders(state.folderTree, target ? target.path : '');
        
        renderSidebarTree(state.folderTree);
        
        if (target) {
            await loadAlbum(target.token, target.title || target.token, { skipSidebarRender: true });
        } else {
            clearCurrentAlbumState();
        }
    }
}

function getCurrentAlbumPath() {
    if (state.currentPath) return state.currentPath;
    const t = state.tokens.find(x => x.token === state.currentToken);
    return (t && typeof t.path === 'string') ? t.path : '';
}

function findNodeByPath(nodes, targetPath) {
    for (const node of nodes || []) {
        if (node.path === targetPath) return node;
        if (node.children && node.children.length > 0) {
            const found = findNodeByPath(node.children, targetPath);
            if (found) return found;
        }
    }
    return null;
}

function findNodeBySlug(nodes, slug) {
    for (const node of nodes || []) {
        if (node.slug === slug) return node;
        if (node.children && node.children.length > 0) {
            const found = findNodeBySlug(node.children, slug);
            if (found) return found;
        }
    }
    return null;
}

function normalizePathSegments(path) {
    return String(path || '').split('/').map((part) => part.trim()).filter(Boolean);
}

function splitPath(path) {
    const parts = String(path || '').split('/').filter(Boolean);
    if (parts.length === 0) return { destination: '', folderName: '' };
    return {
        destination: parts.slice(0, -1).join('/'),
        folderName: parts[parts.length - 1] || '',
    };
}

function escapeHtml(value) {
    if (value == null) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function collectFolderPaths(nodes, out = new Set()) {
    for (const node of nodes || []) {
        if (!node.is_album && node.path) out.add(node.path);
        if (node.children && node.children.length > 0) collectFolderPaths(node.children, out);
    }
    return out;
}

function addCurrentAncestors(nodes, currentPath, out) {
    if (!currentPath) return out;
    for (const node of nodes || []) {
        if (!node.is_album && node.path && (currentPath === node.path || currentPath.startsWith(`${node.path}/`))) {
            out.add(node.path);
            if (node.children && node.children.length > 0) addCurrentAncestors(node.children, currentPath, out);
        }
    }
    return out;
}

function buildInitialExpandedFolders(tree, currentPath) {
    return addCurrentAncestors(tree, currentPath, new Set());
}

function syncExpandedFolders(tree, currentPath) {
    const available = collectFolderPaths(tree);
    if (!state.sidebarTreeReady) {
        state.expandedFolders = buildInitialExpandedFolders(tree, currentPath);
        state.sidebarTreeReady = true;
        return;
    }
    const next = new Set([...state.expandedFolders].filter(path => available.has(path)));
    addCurrentAncestors(tree, currentPath, next);
    state.expandedFolders = next;
}

function openCreateFolderPanel(parentPath = '') {
    state.folderPanelMode = 'create';
    state.createFolderParentPath = parentPath || '';
    state.renameFolderPath = '';
    const panel = document.getElementById('folderCreatePanel');
    const meta = document.getElementById('folderCreateMeta');
    const input = document.getElementById('folderCreateInput');
    const submit = document.getElementById('folderCreateSubmit');
    if (!panel || !meta || !input) return;
    meta.textContent = parentPath ? `新建到 /${parentPath}` : '新建到根目录';
    input.placeholder = '输入文件夹名称';
    if (submit) submit.title = '确认创建';
    panel.hidden = false;
    input.value = '';
    input.focus();
}

function openRenameFolderPanel(path, currentName) {
    state.folderPanelMode = 'rename';
    state.renameFolderPath = path || '';
    state.createFolderParentPath = '';
    const panel = document.getElementById('folderCreatePanel');
    const meta = document.getElementById('folderCreateMeta');
    const input = document.getElementById('folderCreateInput');
    const submit = document.getElementById('folderCreateSubmit');
    if (!panel || !meta || !input) return;
    meta.textContent = `重命名 /${path}`;
    input.placeholder = '输入新的文件夹名称';
    if (submit) submit.title = '确认重命名';
    panel.hidden = false;
    input.value = currentName || '';
    input.focus();
    input.select();
}

function closeCreateFolderPanel() {
    const panel = document.getElementById('folderCreatePanel');
    const input = document.getElementById('folderCreateInput');
    state.folderPanelMode = 'create';
    state.createFolderParentPath = '';
    state.renameFolderPath = '';
    if (panel) panel.hidden = true;
    if (input) input.value = '';
}

async function submitFolderPanel() {
    if (state.folderPanelMode === 'rename') {
        await submitRenameFolder();
        return;
    }

    const input = document.getElementById('folderCreateInput');
    if (!input) return;
    const name = input.value.trim();
    if (!name) {
        showToast('请输入文件夹名称');
        input.focus();
        return;
    }
    if (/[/\\]/.test(name)) {
        showToast('文件夹名称不能包含斜杠');
        input.focus();
        return;
    }

    const path = state.createFolderParentPath ? `${state.createFolderParentPath}/${name}` : name;
    try {
        const data = await api.post('/api/folders/create', JSON.stringify({ path }));
        if (!data || data.ok !== true) {
            throw new Error((data && (data.detail || data.message)) || '创建失败');
        }
        if (state.createFolderParentPath) {
            state.expandedFolders.add(state.createFolderParentPath);
        }
        closeCreateFolderPanel();
        showToast(`已创建文件夹：${name}`);
        await loadTokens();
    } catch (err) {
        console.error('create folder failed:', err);
        showToast(`创建失败：${getErrorMessage(err)}`);
    }
}

async function submitRenameFolder() {
    const input = document.getElementById('folderCreateInput');
    if (!input) return;
    const newName = input.value.trim();
    const path = state.renameFolderPath;
    const currentName = String(path || '').split('/').filter(Boolean).pop() || '';
    if (!path) {
        closeCreateFolderPanel();
        return;
    }
    if (!newName) {
        showToast('请输入新的文件夹名称');
        input.focus();
        return;
    }
    if (/[/\\]/.test(newName)) {
        showToast('文件夹名称不能包含斜杠');
        input.focus();
        return;
    }
    if (newName === currentName) {
        closeCreateFolderPanel();
        return;
    }

    try {
        const data = await api.post('/api/folders/rename', JSON.stringify({ path, new_name: newName }));
        if (!data || data.ok !== true) {
            throw new Error((data && (data.detail || data.message)) || '重命名失败');
        }
        closeCreateFolderPanel();
        showToast(`已重命名为：${newName}`);
        await loadTokens();
    } catch (err) {
        console.error('rename folder failed:', err);
        showToast(`重命名失败：${getErrorMessage(err)}`);
    }
}

function requestDeleteFolder(path, name) {
    const label = name || path || '该文件夹';
    showActionDialog({
        title: '移入回收站',
        message: `确定将“${label}”移入回收站吗？其中内容也会一起进入回收站，可稍后恢复。`,
        confirmText: '移入回收站',
        danger: true,
        onConfirm: async () => {
            hideActionDialog();
            await deleteFolderByPath(path, label);
        }
    });
}

async function deleteFolderByPath(path, name) {
    const label = name || path || '该文件夹';
    try {
        const data = await api.post('/api/folders/delete', JSON.stringify({ path }));
        if (!data || data.ok !== true) {
            throw new Error((data && (data.detail || data.message)) || '删除失败');
        }
        const currentPath = getCurrentAlbumPath();
        if (currentPath && (currentPath === path || currentPath.startsWith(`${path}/`))) {
            state.currentToken = null;
        }
        state.expandedFolders.delete(path);
        showToast(`已移入回收站：${label}`);
        await loadTokens();
        await refreshTrashItems();
    } catch (err) {
        console.error('delete folder failed:', err);
        showToast(`删除失败：${getErrorMessage(err)}`);
    }
}

function toggleFolderExpand(path) {
    if (!path) return;
    if (state.expandedFolders.has(path)) {
        state.expandedFolders.delete(path);
    } else {
        state.expandedFolders.add(path);
    }
    renderSidebarTree(state.folderTree);
}

function getFolderLinkText(node) {
    if (!node) return '';
    if (node.image_count && node.image_count > 0) return `<span class="tree-count">${node.image_count}</span>`;
    if (node.children && node.children.length > 0) return `<span class="tree-count">${node.children.length}</span>`;
    return '';
}

function renderSidebarTree(tree) {
    const container = document.getElementById('album-list');
    if (!container) return;

    function buildTreeHtml(nodes, level = 0) {
        let html = '';
        for (const node of nodes) {
            const paddingLeft = level * 16 + 8;
            const path = node.path || '';
            const name = escapeHtml(node.name || '未命名');
            const activeClass = node.slug === state.currentToken ? ' active' : '';
            const isFolderOnly = !node.is_album;
            const iconClass = node.is_album ? 'ph-fill ph-image' : 'ph-fill ph-folder';
            const iconColor = node.is_album ? '#82b1ff' : '#ffd54f';
            const countHtml = getFolderLinkText(node);
            if (node.is_album) {
                html += `
                    <div class="tree-node is-album-node" data-path="${escapeHtml(path)}">
                        <div class="tree-row is-album${activeClass}" style="padding-left:${paddingLeft}px">
                            <span class="tree-spacer"></span>
                            <button type="button" class="tree-link" data-action="open-folder" data-token="${escapeHtml(node.slug)}" data-path="${escapeHtml(path)}" data-title="${name}">
                                <i class="${iconClass}" style="color:${iconColor};"></i>
                                <span class="tree-name">${name}</span>
                                ${countHtml}
                            </button>
                            <div class="tree-row-actions">
                                <button type="button" class="tree-action-btn" data-action="rename-folder" data-path="${escapeHtml(path)}" data-name="${name}" title="重命名文件夹">
                                    <i class="ph ph-pencil-simple"></i>
                                </button>
                                <button type="button" class="tree-action-btn danger" data-action="delete-folder" data-path="${escapeHtml(path)}" data-name="${name}" title="删除文件夹">
                                    <i class="ph ph-trash"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            } else {
                const isExpanded = state.expandedFolders.has(path);
                const childrenHtml = node.children && node.children.length > 0
                    ? buildTreeHtml(node.children, level + 1)
                    : '';
                html += `
                    <div class="tree-node is-folder-node ${isExpanded ? 'is-expanded' : 'is-collapsed'}" data-path="${escapeHtml(path)}">
                        <div class="tree-row is-folder${activeClass}" style="padding-left:${paddingLeft}px">
                            <button type="button" class="tree-toggle" data-action="toggle-folder" data-path="${escapeHtml(path)}" title="${isExpanded ? '折叠' : '展开'}">
                                <i class="ph ph-caret-right"></i>
                            </button>
                            <button type="button" class="tree-link" data-action="open-folder" data-token="${escapeHtml(node.slug)}" data-path="${escapeHtml(path)}" data-title="${name}">
                                <i class="${iconClass}" style="color:${iconColor};"></i>
                                <span class="tree-name">${name}</span>
                                ${countHtml}
                            </button>
                            <div class="tree-row-actions">
                                <button type="button" class="tree-action-btn" data-action="create-child-folder" data-path="${escapeHtml(path)}" data-name="${name}" title="新建子文件夹">
                                    <i class="ph ph-plus"></i>
                                </button>
                                <button type="button" class="tree-action-btn" data-action="rename-folder" data-path="${escapeHtml(path)}" data-name="${name}" title="重命名文件夹">
                                    <i class="ph ph-pencil-simple"></i>
                                </button>
                                <button type="button" class="tree-action-btn danger" data-action="delete-folder" data-path="${escapeHtml(path)}" data-name="${name}" title="删除文件夹">
                                    <i class="ph ph-trash"></i>
                                </button>
                            </div>
                        </div>
                        <div class="tree-children">
                            ${childrenHtml}
                        </div>
                    </div>
                `;
                continue;
            }
            
            if (node.children && node.children.length > 0) {
                html += buildTreeHtml(node.children, level + 1);
            }
        }
        return html;
    }
    
    container.innerHTML = buildTreeHtml(tree);
}

// 加载具体相册内容
function clearCurrentAlbumState() {
    clearSearchState({ clearInput: true });
    state.currentToken = null;
    state.currentPath = '';
    state.currentTitle = '所有相册';
    state.currentFiles = [];
    state.currentFolders = [];
    state.uploadTargetPath = '';
    updateBreadcrumbs();
    const display = document.getElementById('uploadDestDisplay');
    if (display) {
        display.textContent = '未选择';
    }
    renderGridView();
    clearSelection();
    renderSidebarTree(state.folderTree);
}

async function loadAlbum(token, title, options = {}) {
    const skipSidebarRender = !!options.skipSidebarRender;
    clearSearchState({ clearInput: !options.preserveSearch });
    const node = findNodeBySlug(state.folderTree, token);
    const currentPath = node?.path || getCurrentAlbumPath();
    const currentTitle = node?.name || title || token;

    state.currentToken = token;
    state.currentPath = currentPath || '';
    state.currentTitle = currentTitle;
    updateBreadcrumbs();

    if (currentPath) {
        addCurrentAncestors(state.folderTree, currentPath, state.expandedFolders);
    }

    state.uploadTargetPath = currentPath || '';
    if (!skipSidebarRender) {
        renderSidebarTree(state.folderTree);
    }
    const display = document.getElementById('uploadDestDisplay');
    if (display) {
        display.textContent = state.uploadTargetPath ? `/${state.uploadTargetPath}` : '未选择';
    }

    if (!currentPath) {
        clearCurrentAlbumState();
        return;
    }

    const data = await api.get(`/api/folders/list?path=${encodeURIComponent(currentPath)}`);
    if (data && data.ok) {
        state.currentFiles = data.files || [];
        state.currentFolders = data.subfolders || [];
        renderGridView();
        clearSelection();
        focusPendingFile();
    }
}

function openRootView() {
    clearSearchState({ clearInput: true });
    state.currentToken = null;
    state.currentPath = '';
    state.currentTitle = '所有相册';
    state.currentFiles = [];
    state.currentFolders = [];
    state.uploadTargetPath = '';
    updateBreadcrumbs();
    renderGridView();
    clearSelection();
    renderSidebarTree(state.folderTree);
}

function applyCurrentViewClass(container, forceGrid = false) {
    if (!container) return;
    const nextView = forceGrid ? 'grid' : currentView;
    container.className = nextView === 'mobile' ? 'mobile-view' : 'grid-view';
}

function buildSearchResultsHtml() {
    const query = state.searchQuery.trim();
    const results = Array.isArray(state.searchResults) ? state.searchResults : [];
    const folderResults = results.filter((item) => item.kind === 'folder');
    const fileResults = results.filter((item) => item.kind === 'file');
    const scopeText = state.searchScope === 'global' ? '全部资源库' : '当前路径及子路径';
    const summary = `找到 ${results.length} 个结果，其中 ${folderResults.length} 个相册、${fileResults.length} 个文件`;

    if (!results.length) {
        return `
            <div class="search-summary-card">
                <div class="search-summary-copy">
                    <div class="search-summary-title">搜索“${escapeHtml(query)}”</div>
                    <div class="search-summary-meta">${escapeHtml(scopeText)} · 暂时没有找到命中结果</div>
                </div>
                <button type="button" class="btn-secondary" onclick="clearManagerSearch()">清空搜索</button>
            </div>
            <div class="search-empty-state">
                <i class="ph ph-magnifying-glass"></i>
                <div>没有找到匹配项，试试更短的关键词或切到“全部资源库”喵～</div>
            </div>
        `;
    }

    const folderCards = folderResults.map((item) => {
        const itemName = escapeHtml(item.name || '未命名');
        const itemPath = escapeHtml(item.path || '');
        const itemToken = escapeHtml(item.token || '');
        const count = Number(item.image_count || 0);
        return `
            <button type="button" class="grid-item folder-item search-folder-item" data-item-kind="folder" data-action="open-folder-card" data-folder-token="${itemToken}" data-folder-title="${itemName}" data-folder-path="${itemPath}">
                <div class="item-icon-wrapper">
                    <i class="ph-fill ph-folder"></i>
                </div>
                <div class="item-info">
                    <span class="item-name" title="${itemName}">${itemName}</span>
                    <div class="search-hit-meta">
                        <span class="search-hit-badge">相册</span>
                        <span class="search-hit-path" title="/${itemPath}">/${itemPath}</span>
                    </div>
                    <span class="item-meta">${count} 张照片</span>
                </div>
            </button>
        `;
    }).join('');

    const fileCards = fileResults.map((item) => {
        const fileName = String(item.name || '');
        const safeFile = escapeHtml(fileName);
        const token = String(item.token || '');
        const parentPath = String(item.path || '');
        const previewUrl = getPreviewFileUrl(fileName, token);
        const thumbUrl = getThumbFileUrl(fileName, token);
        const downloadUrl = getCurrentFileDownloadLink(fileName, token);
        const safePreviewUrl = escapeHtml(previewUrl);
        const safeThumbUrl = escapeHtml(thumbUrl);
        const safeDownloadUrl = escapeHtml(downloadUrl);
        const safeParentPath = escapeHtml(parentPath);
        return `
            <div class="grid-item image-item search-item" data-item-kind="image" data-file="${safeFile}" data-url="${safePreviewUrl}" data-copy-url="${safePreviewUrl}" data-download-url="${safeDownloadUrl}" data-file-token="${escapeHtml(token)}" data-folder-path="${safeParentPath}">
                <div class="item-thumb" data-action="preview-image">
                    <img src="${safeThumbUrl}" alt="${safeFile}" loading="lazy" draggable="false">
                    <div class="item-overlay">
                        <button class="action-btn" type="button" data-action="copy-image-link"><i class="ph ph-link"></i></button>
                    </div>
                </div>
                <div class="item-info">
                    <span class="item-name" title="${safeFile}">${safeFile}</span>
                    <div class="search-hit-meta">
                        <span class="search-hit-badge">文件</span>
                        <span class="search-hit-path" title="/${safeParentPath}">/${safeParentPath}</span>
                    </div>
                    <button type="button" class="search-reveal-btn" data-action="reveal-search-item" data-file="${safeFile}" data-token="${escapeHtml(token)}" data-path="${safeParentPath}">
                        <i class="ph ph-corners-out"></i>
                        定位到文件夹
                    </button>
                </div>
            </div>
        `;
    }).join('');

    return `
        <div class="search-summary-card">
            <div class="search-summary-copy">
                <div class="search-summary-title">搜索“${escapeHtml(query)}”</div>
                <div class="search-summary-meta">${escapeHtml(scopeText)} · ${escapeHtml(summary)}</div>
            </div>
            <button type="button" class="btn-secondary" onclick="clearManagerSearch()">清空搜索</button>
        </div>
        ${folderCards}${fileCards}
    `;
}

window.clearManagerSearch = function() {
    clearSearchState({ clearInput: true });
    renderGridView();
};

// 渲染网格视图
function renderGridView() {
    const container = document.querySelector('.grid-view') || document.querySelector('.mobile-view');
    if (!container) return;

    if (state.searchQuery.trim()) {
        container.innerHTML = buildSearchResultsHtml();
        applyCurrentViewClass(container, true);
        updateStatusBar();
        updateBottomActionBar();
        return;
    }

    if (!state.currentPath && !state.currentToken) {
        const rootCards = (state.folderTree || []).map((node) => {
            const itemName = escapeHtml(node.name || '未命名');
            const itemPath = escapeHtml(node.path || '');
            const itemToken = escapeHtml(node.slug || '');
            const count = Number(node.image_count || 0);
            const meta = node.is_album
                ? `${count} 张照片`
                : `${(node.children || []).length} 个子项${count > 0 ? ` · ${count} 张照片` : ''}`;
            return `
                <button type="button" class="grid-item folder-item" data-item-kind="folder" data-action="open-folder-card" data-folder-token="${itemToken}" data-folder-title="${itemName}" data-folder-path="${itemPath}">
                    <div class="item-checkbox" onclick="event.stopPropagation(); toggleSelect(this.closest('.grid-item'))"><i class="ph-bold ph-check"></i></div>
                    <div class="item-icon-wrapper">
                        <i class="${node.is_album ? 'ph-fill ph-images' : 'ph-fill ph-folder'}"></i>
                    </div>
                    <div class="item-info">
                        <span class="item-name" title="${itemName}">${itemName}</span>
                        <span class="item-meta">${escapeHtml(meta)}</span>
                    </div>
                </button>
            `;
        }).join('');

        container.innerHTML = rootCards || `
            <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--color-text-secondary);">
                <i class="ph ph-folders" style="font-size: 48px; margin-bottom: 16px;"></i>
                <p>还没有可浏览的相册喵～</p>
            </div>
        `;

        applyCurrentViewClass(container);
        updateStatusBar();
        updateBottomActionBar();
        return;
    }

    const folderCards = state.currentFolders.map((folderName) => {
        const childPath = state.currentPath ? `${state.currentPath}/${folderName}` : folderName;
        const childNode = findNodeByPath(state.folderTree, childPath);
        const childToken = childNode?.slug || '';
        const childCount = childNode?.image_count || 0;
        return `
            <button type="button" class="grid-item folder-item" data-item-kind="folder" data-action="open-folder-card" data-folder-token="${escapeHtml(childToken)}" data-folder-title="${escapeHtml(folderName)}" data-folder-path="${escapeHtml(childPath)}">
                <div class="item-checkbox" onclick="event.stopPropagation(); toggleSelect(this.closest('.grid-item'))"><i class="ph-bold ph-check"></i></div>
                <div class="item-icon-wrapper">
                    <i class="ph-fill ph-folder"></i>
                </div>
                <div class="item-info">
                    <span class="item-name" title="${escapeHtml(folderName)}">${escapeHtml(folderName)}</span>
                    <span class="item-meta">${childCount} 张照片</span>
                </div>
            </button>
        `;
    }).join('');
    
    if (state.currentFiles.length === 0 && state.currentFolders.length === 0) {
        container.innerHTML = `
            <div class="search-empty-state">
                <i class="ph ph-folder-open"></i>
                <div>这个文件夹里还没有照片喵～</div>
                <div class="search-summary-meta">可以先上传图片，或者切换到其它子文件夹继续整理。</div>
            </div>
        `;
        updateStatusBar();
        updateBottomActionBar();
        return;
    }

    const emptyFolderPrompt = state.currentFiles.length === 0 && state.currentFolders.length > 0
        ? `
            <div class="search-summary-card album-empty-summary">
                <div class="search-summary-copy">
                    <div class="search-summary-title">当前文件夹还没有照片</div>
                    <div class="search-summary-meta">先进入下一级文件夹继续浏览，或直接上传内容到这里。</div>
                </div>
            </div>
        `
        : '';

    const folderSectionTitle = state.currentFiles.length === 0 && state.currentFolders.length > 0
        ? '<div class="album-folder-section-title">继续浏览子文件夹</div>'
        : '';

    const fileCards = state.currentFiles.map(file => {
        const safeFile = escapeHtml(file);
        const isVideo = isVideoFile(file);
        const previewUrl = getPreviewFileUrl(file);
        const thumbUrl = getThumbFileUrl(file);
        const downloadUrl = getCurrentFileDownloadLink(file);
        const safePreviewUrl = escapeHtml(previewUrl);
        const safeThumbUrl = escapeHtml(thumbUrl);
        const safeDownloadUrl = escapeHtml(downloadUrl);
        
        let mediaHtml = isVideo 
            ? `<div style="width:100%;height:100%;background:#f0f0f0;display:flex;align-items:center;justify-content:center"><i class="ph-fill ph-video-camera" style="font-size:32px;color:#999"></i></div>`
            : `<img src="${safeThumbUrl}" alt="${safeFile}" loading="lazy" draggable="false">`;
             
        return `
            <div class="grid-item image-item" data-item-kind="image" data-file="${safeFile}" data-url="${safePreviewUrl}" data-copy-url="${safePreviewUrl}" data-download-url="${safeDownloadUrl}" data-file-token="${escapeHtml(state.currentToken || '')}" data-folder-path="${escapeHtml(state.currentPath || '')}" draggable="true">
                <div class="item-checkbox" onclick="event.stopPropagation(); toggleSelect(this.closest('.grid-item'))"><i class="ph-bold ph-check"></i></div>
                <div class="item-thumb" data-action="preview-image">
                    ${mediaHtml}
                    <div class="item-overlay">
                        <button class="action-btn" type="button" data-action="copy-image-link"><i class="ph ph-link"></i></button>
                    </div>
                </div>
                <div class="item-info">
                    <span class="item-name" title="${safeFile}">${safeFile}</span>
                </div>
            </div>
        `;
    }).join('');

    container.innerHTML = emptyFolderPrompt + folderSectionTitle + folderCards + fileCards;

    if (isMobile) {
        document.body.classList.add('mobile-multi-select');
    } else {
        document.body.classList.remove('mobile-multi-select');
    }

    setupDragAndDrop();
    applyCurrentViewClass(container);
    updateStatusBar();
    updateBottomActionBar();
}

let currentView = 'grid';
window.switchView = function(view) {
    if (state.searchQuery.trim() && view === 'mobile') {
        showToast('搜索结果先保持网格视图会更清楚喵～');
        return;
    }
    if (currentView === view) return;
    currentView = view;
    
    const container = document.querySelector('.grid-view') || document.querySelector('.mobile-view');
    if (container) {
        container.className = view === 'grid' ? 'grid-view' : 'mobile-view';
    }
    
    document.querySelectorAll('.view-toggles .icon-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    const activeBtn = document.querySelector(`.view-toggles .icon-btn[onclick="switchView('${view}')"]`);
    if (activeBtn) {
        activeBtn.classList.add('active');
    }
    updateStatusBar();
};

function setupDragAndDrop() {
    const container = document.querySelector('.grid-view') || document.querySelector('.mobile-view');
    if (!container) return;

    let draggedItem = null;

    const items = container.querySelectorAll('.image-item');
    items.forEach(item => {
        item.addEventListener('dragstart', function(e) {
            draggedItem = this;
            setTimeout(() => this.classList.add('dragging'), 0);
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', this.dataset.file);
        });

        item.addEventListener('dragend', function() {
            this.classList.remove('dragging');
            items.forEach(i => { i.classList.remove('drag-over'); });
            draggedItem = null;
        });

        item.addEventListener('dragover', function(e) {
            e.preventDefault();
            if (this !== draggedItem) {
                this.classList.add('drag-over');
            }
        });

        item.addEventListener('dragleave', function() {
            this.classList.remove('drag-over');
        });

        item.addEventListener('drop', async function(e) {
            e.preventDefault();
            this.classList.remove('drag-over');
            
            if (this !== draggedItem && draggedItem) {
                const allItems = [...container.querySelectorAll('.image-item')];
                const draggedIndex = allItems.indexOf(draggedItem);
                const droppedIndex = allItems.indexOf(this);
                
                if (draggedIndex < droppedIndex) {
                    this.parentNode.insertBefore(draggedItem, this.nextSibling);
                } else {
                    this.parentNode.insertBefore(draggedItem, this);
                }

                const newFiles = [...container.querySelectorAll('.image-item')].map(el => el.dataset.file).filter(Boolean);
                state.currentFiles = newFiles;

                try {
                    await api.post(`/api/manage/${state.currentToken}/order`, JSON.stringify({ names: newFiles }));
                } catch (err) {
                    console.error('Failed to save order:', err);
                }
            }
        });
    });
}

// 更新面包屑
function updateBreadcrumbs() {
    const container = document.getElementById('managerBreadcrumbs');
    if (!container) return;

    const parts = normalizePathSegments(state.currentPath);
    const crumbs = [
        '<button type="button" class="crumb-item" data-crumb-root="true"><i class="ph-fill ph-folder" style="color: #82b1ff; margin-right: 4px;"></i> 所有相册</button>'
    ];

    let builtPath = '';
    parts.forEach((part, index) => {
        builtPath = builtPath ? `${builtPath}/${part}` : part;
        crumbs.push('<i class="ph ph-caret-right separator"></i>');
        if (index === parts.length - 1) {
            crumbs.push(`<span class="crumb-item current">${escapeHtml(part)}</span>`);
        } else {
            crumbs.push(`<button type="button" class="crumb-item" data-crumb-path="${escapeHtml(builtPath)}">${escapeHtml(part)}</button>`);
        }
    });

    if (parts.length === 0) {
        crumbs[0] = '<span class="crumb-item current"><i class="ph-fill ph-folder" style="color: #82b1ff; margin-right: 4px;"></i> 所有相册</span>';
    }

    container.innerHTML = crumbs.join('');
}

function renderUploadSelect() {
    const select = document.getElementById('upload-album-select');
    if (!select) return;

    select.innerHTML = state.tokens.map(t => {
        const displayTitle = t.title || t.token;
        const isSelected = t.token === state.currentToken ? 'selected' : '';
        return `<option value="${t.token}" ${isSelected}>${displayTitle}</option>`;
    }).join('');
}

function setUploadAlbumSelection(token) {
    if (!token) return;
    state.uploadTargetToken = token;

    const t = state.tokens.find(x => x.token === token);
    const name = t ? (t.title || t.token) : token;
    const nameEl = document.getElementById('selectedAlbumName');
    if (nameEl) nameEl.textContent = name;

    const list = document.getElementById('albumList');
    if (!list) return;
    list.querySelectorAll('.album-item').forEach(el => {
        el.classList.toggle('selected', el.dataset && el.dataset.token === token);
    });
}

function toggleAlbumList() {
    const list = document.getElementById('albumList');
    if (!list) return;
    list.style.display = list.style.display === 'none' ? 'block' : 'none';
}

function selectAlbum(path, name, el) {
    if (!path) return;
    state.uploadTargetToken = path;
    const nameEl = document.getElementById('selectedAlbumName');
    if (nameEl) nameEl.textContent = name;
    const list = document.getElementById('albumList');
    if (list) list.style.display = 'none';

    document.querySelectorAll('#albumList .album-item').forEach(item => { item.classList.remove('selected'); });
    const target = el && el.closest ? el.closest('.album-item') : null;
    if (target) target.classList.add('selected');
}

function renderAlbumList(folders) {
    const list = document.getElementById('albumList');
    if (!list) return;
    list.innerHTML = '';

    const frag = document.createDocumentFragment();

    function appendNodes(nodes, level) {
        for (const node of nodes || []) {
            const clamped = Math.min(Math.max(level, 0), 3);
            const item = document.createElement('div');
            item.className = `album-item${clamped > 0 ? ` level-${clamped}` : ''}`;

            const icon = document.createElement('i');
            icon.className = 'ph ph-folder';
            const text = document.createElement('span');
            text.textContent = node.name || '';

            item.appendChild(icon);
            item.appendChild(text);

            if (node.is_album) {
                item.dataset.token = node.slug;
                item.addEventListener('click', () => selectAlbum(node.slug, node.name, item));
            } else {
                item.style.cursor = 'default';
                item.style.fontWeight = '600';
                item.style.opacity = '0.85';
            }

            frag.appendChild(item);

            if (node.children && node.children.length > 0) {
                appendNodes(node.children, level + 1);
            }
        }
    }

    appendNodes(folders || [], 0);
    list.appendChild(frag);
}

// 工具：复制链接
async function copyUrl(url) {
    const fullUrl = new URL(url, window.location.origin).href;
    try {
        await navigator.clipboard.writeText(fullUrl);
        showToast('链接已复制喵！');
    } catch (_err) {
        const input = document.createElement('input');
        input.value = fullUrl;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
        showToast(`链接已复制: ${fullUrl}`);
    }
}

const actionDialogState = {
    onConfirm: null,
};

function showActionDialog({ title, message, confirmText = '确定', danger = false, onConfirm }) {
    const modal = document.getElementById('actionDialog');
    const titleEl = document.getElementById('actionDialogTitle');
    const messageEl = document.getElementById('actionDialogMessage');
    const confirmBtn = document.getElementById('actionDialogConfirm');
    if (!modal || !titleEl || !messageEl || !confirmBtn) return;
    titleEl.textContent = title || '确认操作';
    messageEl.textContent = message || '确定继续吗？';
    confirmBtn.textContent = confirmText;
    confirmBtn.classList.toggle('danger', !!danger);
    actionDialogState.onConfirm = onConfirm || null;
    modal.style.display = 'flex';
}

function hideActionDialog() {
    const modal = document.getElementById('actionDialog');
    if (modal) modal.style.display = 'none';
    actionDialogState.onConfirm = null;
}

function formatTrashTime(value) {
    const raw = String(value || '').trim();
    if (!raw) return '刚刚';
    try {
        return new Date(raw).toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch (_error) {
        return raw.replace('T', ' ').slice(0, 16);
    }
}

function renderTrashItems() {
    const list = document.getElementById('trashList');
    if (!list) return;
    const items = Array.isArray(state.trashItems) ? state.trashItems : [];
    if (items.length === 0) {
        list.innerHTML = '<div class="trash-empty">回收站还是空的喵～</div>';
        return;
    }
    list.innerHTML = items.map((item) => {
        const typeText = item.item_type === 'folder' ? '文件夹' : '文件';
        const originalPath = escapeHtml(item.original_rel_path || '');
        const displayName = escapeHtml(item.display_name || originalPath || '未命名');
        const deletedAt = formatTrashTime(item.deleted_at);
        return `
            <div class="trash-item">
                <div class="trash-item-main">
                    <div class="trash-item-title">${displayName}</div>
                    <div class="trash-item-meta">${typeText} · 原位置 /${originalPath || '-'} · 删除于 ${escapeHtml(deletedAt)}</div>
                </div>
                <div class="trash-item-actions">
                    <button type="button" class="btn-secondary" data-trash-action="restore" data-trash-id="${item.id}">恢复</button>
                    <button type="button" class="btn-primary" data-trash-action="delete" data-trash-id="${item.id}">永久删除</button>
                </div>
            </div>
        `;
    }).join('');
}

async function refreshTrashItems() {
    try {
        const data = await api.get('/api/trash');
        state.trashItems = Array.isArray(data?.items) ? data.items : [];
        renderTrashItems();
    } catch (err) {
        console.error('load trash failed:', err);
        const list = document.getElementById('trashList');
        if (list) {
            list.innerHTML = '<div class="trash-empty">回收站读取失败，请稍后重试。</div>';
        }
    }
}

async function openTrashModal() {
    const modal = document.getElementById('trashModal');
    if (!modal) return;
    modal.style.display = 'flex';
    await refreshTrashItems();
}

function closeTrashModal() {
    const modal = document.getElementById('trashModal');
    if (!modal) return;
    modal.style.display = 'none';
}

async function restoreTrashItemById(itemId) {
    const data = await api.post('/api/trash/restore', JSON.stringify({ id: itemId }));
    if (!data || data.ok !== true) {
        throw new Error((data && (data.detail || data.message)) || '恢复失败');
    }
}

async function deleteTrashItemById(itemId) {
    const data = await api.post('/api/trash/delete', JSON.stringify({ id: itemId }));
    if (!data || data.ok !== true) {
        throw new Error((data && (data.detail || data.message)) || '永久删除失败');
    }
}

function getCurrentShareLink(token = state.currentToken) {
    if (!token) return '';
    const base = (state.base || '').replace(/\/$/, '');
    return `${window.location.origin}${base}/d/${token}`;
}

function getFolderShareLinkByPath(path) {
    const node = findNodeByPath(state.folderTree, path);
    return node?.slug ? getCurrentShareLink(node.slug) : '';
}

function showFolderPicker({ title, allowRoot = false, onSelect }) {
    const picker = new FolderSelector({
        base: state.base,
        title,
        onSelect: async (selectedPath) => {
            const dest = String(selectedPath || '').trim();
            if (!allowRoot && !dest) {
                showToast('请选择目标文件夹');
                return;
            }
            await onSelect(dest);
        }
    });
    picker.show();
}

async function renameFileByPath(path, fileName) {
    const currentName = String(fileName || '').trim();
    if (!path || !currentName) return;
    const nextName = window.prompt('请输入新的文件名', currentName) || '';
    const trimmed = nextName.trim();
    if (!trimmed || trimmed === currentName) return;
    try {
        const data = await api.post('/api/folders/file-rename', JSON.stringify({ path, old_name: currentName, new_name: trimmed }));
        if (!data || data.ok !== true) {
            throw new Error((data && (data.detail || data.message)) || '重命名失败');
        }
        state.focusedFile = data.new || trimmed;
        showToast(`已重命名为：${data.new || trimmed}`);
        await loadTokens();
        clearSelection();
    } catch (err) {
        console.error('rename file failed:', err);
        showToast(`重命名失败：${getErrorMessage(err)}`);
    }
}

async function moveFilesByPath(path, files, dest) {
    return api.post('/api/folders/files-move', JSON.stringify({ path, names: files, dest }));
}

async function copyFilesByPath(path, files, dest) {
    return api.post('/api/folders/files-copy', JSON.stringify({ path, names: files, dest }));
}

function showMoveSelector(names, sourcePath = state.currentPath) {
    const files = Array.isArray(names) ? names.filter(Boolean) : [];
    if (!files.length || !sourcePath) return;
    showFolderPicker({
        title: files.length === 1 ? '移动到哪个文件夹' : `移动 ${files.length} 个文件到…`,
        onSelect: async (selectedPath) => {
            try {
                const data = await moveFilesByPath(sourcePath, files, selectedPath);
                if (!data || !data.ok) {
                    throw new Error((data && (data.detail || data.message)) || '移动失败');
                }
                const movedCount = (data.moved || []).length;
                const skippedCount = (data.skipped || []).length;
                showToast(`移动完成：成功 ${movedCount}，跳过 ${skippedCount}`);
                await loadTokens();
                clearSelection();
            } catch (e) {
                console.error('batch-move failed:', e);
                showToast(`移动失败：${getErrorMessage(e)}`);
            }
        }
    });
}

function showCopySelector(names, sourcePath = state.currentPath) {
    const files = Array.isArray(names) ? names.filter(Boolean) : [];
    if (!files.length || !sourcePath) return;
    showFolderPicker({
        title: files.length === 1 ? '复制到哪个文件夹' : `复制 ${files.length} 个文件到…`,
        onSelect: async (selectedPath) => {
            try {
                const data = await copyFilesByPath(sourcePath, files, selectedPath);
                if (!data || !data.ok) {
                    throw new Error((data && (data.detail || data.message)) || '复制失败');
                }
                const copiedCount = (data.copied || []).length;
                const skippedCount = (data.skipped || []).length;
                showToast(`复制完成：成功 ${copiedCount}，跳过 ${skippedCount}`);
                await loadTokens();
                clearSelection();
            } catch (e) {
                console.error('batch-copy failed:', e);
                showToast(`复制失败：${getErrorMessage(e)}`);
            }
        }
    });
}

function showFolderMoveSelector(paths) {
    const folders = Array.isArray(paths) ? paths.filter(Boolean) : [];
    if (!folders.length) return;
    showFolderPicker({
        title: folders.length === 1 ? '移动文件夹到…' : `移动 ${folders.length} 个文件夹到…`,
        allowRoot: true,
        onSelect: async (selectedPath) => {
            try {
                const data = await api.post('/api/folders/batch-move', JSON.stringify({ paths: folders, dest: selectedPath }));
                if (!data || !data.ok) {
                    throw new Error((data && (data.detail || data.message)) || '移动失败');
                }
                showToast(`已移动 ${data.count ?? folders.length} 个文件夹`);
                await loadTokens();
                clearSelection();
            } catch (err) {
                console.error('move folders failed:', err);
                showToast(`移动失败：${getErrorMessage(err)}`);
            }
        }
    });
}

function showFolderCopySelector(paths) {
    const folders = Array.isArray(paths) ? paths.filter(Boolean) : [];
    if (!folders.length) return;
    showFolderPicker({
        title: folders.length === 1 ? '复制文件夹到…' : `复制 ${folders.length} 个文件夹到…`,
        allowRoot: true,
        onSelect: async (selectedPath) => {
            try {
                const data = await api.post('/api/folders/batch-copy', JSON.stringify({ paths: folders, dest: selectedPath }));
                if (!data || !data.ok) {
                    throw new Error((data && (data.detail || data.message)) || '复制失败');
                }
                showToast(`已复制 ${data.count ?? folders.length} 个文件夹`);
                await loadTokens();
                clearSelection();
            } catch (err) {
                console.error('copy folders failed:', err);
                showToast(`复制失败：${getErrorMessage(err)}`);
            }
        }
    });
}

function showSelectionMoveSelector(files, folders) {
    const safeFiles = Array.isArray(files) ? files.filter(Boolean) : [];
    const safeFolders = Array.isArray(folders) ? folders.filter(Boolean) : [];
    if (!safeFiles.length && !safeFolders.length) return;
    if (safeFiles.length && !safeFolders.length) {
        showMoveSelector(safeFiles, state.currentPath);
        return;
    }
    if (safeFolders.length && !safeFiles.length) {
        showFolderMoveSelector(safeFolders);
        return;
    }
    showFolderPicker({
        title: `移动 ${safeFiles.length + safeFolders.length} 个项目到…`,
        allowRoot: true,
        onSelect: async (selectedPath) => {
            try {
                if (safeFiles.length) {
                    if (!selectedPath) {
                        showToast('文件不能移动到根目录');
                        return;
                    }
                    const fileData = await moveFilesByPath(state.currentPath, safeFiles, selectedPath);
                    if (!fileData || !fileData.ok) {
                        throw new Error((fileData && (fileData.detail || fileData.message)) || '文件移动失败');
                    }
                }
                if (safeFolders.length) {
                    const folderData = await api.post('/api/folders/batch-move', JSON.stringify({ paths: safeFolders, dest: selectedPath }));
                    if (!folderData || !folderData.ok) {
                        throw new Error((folderData && (folderData.detail || folderData.message)) || '文件夹移动失败');
                    }
                }
                showToast('已移动选中项目');
                await loadTokens();
                clearSelection();
            } catch (err) {
                console.error('move selected items failed:', err);
                showToast(`移动失败：${getErrorMessage(err)}`);
            }
        }
    });
}

function showSelectionCopySelector(files, folders) {
    const safeFiles = Array.isArray(files) ? files.filter(Boolean) : [];
    const safeFolders = Array.isArray(folders) ? folders.filter(Boolean) : [];
    if (!safeFiles.length && !safeFolders.length) return;
    if (safeFiles.length && !safeFolders.length) {
        showCopySelector(safeFiles, state.currentPath);
        return;
    }
    if (safeFolders.length && !safeFiles.length) {
        showFolderCopySelector(safeFolders);
        return;
    }
    showFolderPicker({
        title: `复制 ${safeFiles.length + safeFolders.length} 个项目到…`,
        allowRoot: true,
        onSelect: async (selectedPath) => {
            try {
                if (safeFiles.length) {
                    if (!selectedPath) {
                        showToast('文件不能复制到根目录');
                        return;
                    }
                    const fileData = await copyFilesByPath(state.currentPath, safeFiles, selectedPath);
                    if (!fileData || !fileData.ok) {
                        throw new Error((fileData && (fileData.detail || fileData.message)) || '文件复制失败');
                    }
                }
                if (safeFolders.length) {
                    const folderData = await api.post('/api/folders/batch-copy', JSON.stringify({ paths: safeFolders, dest: selectedPath }));
                    if (!folderData || !folderData.ok) {
                        throw new Error((folderData && (folderData.detail || folderData.message)) || '文件夹复制失败');
                    }
                }
                showToast('已复制选中项目');
                await loadTokens();
                clearSelection();
            } catch (err) {
                console.error('copy selected items failed:', err);
                showToast(`复制失败：${getErrorMessage(err)}`);
            }
        }
    });
}

function renderContextMenuItems(items) {
    const list = document.getElementById('contextMenuList');
    if (!list) return;
    list.innerHTML = items.map((item) => {
        if (item.type === 'divider') {
            return '<div class="context-menu-divider"></div>';
        }
        const dangerClass = item.danger ? ' danger' : '';
        return `<div class="context-menu-item${dangerClass}" data-action="${escapeHtml(item.action)}"><i class="ph ${escapeHtml(item.icon)}"></i><span>${escapeHtml(item.label)}</span></div>`;
    }).join('');
}

function buildContextMenuItems(target) {
    if (!target) return [];
    if (target.kind === 'folder') {
        return [
            { action: 'open-folder', icon: 'ph-folder-open', label: '打开' },
            { action: 'copy-folder-link', icon: 'ph-link', label: '复制链接' },
            { action: 'new-subfolder', icon: 'ph-folder-plus', label: '新建子文件夹' },
            { action: 'rename-folder', icon: 'ph-pencil-simple', label: '重命名' },
            { action: 'move-folder', icon: 'ph-folder-simple-dashed', label: '移动至…' },
            { action: 'copy-folder', icon: 'ph-copy', label: '复制到…' },
            { type: 'divider' },
            { action: 'delete-folder', icon: 'ph-trash', label: '删除', danger: true },
        ];
    }
    const items = [
        { action: 'preview', icon: 'ph-eye', label: '预览图片' },
        { action: 'copy', icon: 'ph-link', label: '复制链接' },
        { action: 'download', icon: 'ph-download-simple', label: getDownloadModeLabel() },
        { action: 'rename-file', icon: 'ph-pencil-simple', label: '重命名' },
        { action: 'move-one', icon: 'ph-folder-simple-dashed', label: '移动至…' },
        { action: 'copy-one', icon: 'ph-copy', label: '复制到…' },
        { type: 'divider' },
        { action: 'delete', icon: 'ph-trash', label: '删除', danger: true },
    ];
    if (target.path && target.path !== state.currentPath && target.token) {
        items.splice(3, 0, { action: 'reveal-folder', icon: 'ph-corners-out', label: '定位到文件夹' });
    }
    return items;
}

function copyCurrentLink() {
    const token = state.currentToken;
    if (!token) {
        showToast('请先选择一个相册');
        return;
    }
    const base = (state.base || '').replace(/\/$/, '');
    const url = `${window.location.origin}${base}/d/${token}`;

    const fallbackCopy = () => {
        const input = document.createElement('input');
        input.value = url;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
        showToast(`链接已复制: ${url}`);
    };

    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
        fallbackCopy();
        return;
    }

    navigator.clipboard.writeText(url).then(() => {
        showToast(`链接已复制: ${url}`);
    }).catch(() => {
        fallbackCopy();
    });
}

// === 多选与右键菜单交互逻辑 ===
let selectedFiles = new Set();
let selectedFolders = new Set();
let contextMenuTarget = null;
let isMobile = window.innerWidth <= 768;

window.addEventListener('resize', () => {
    isMobile = window.innerWidth <= 768;
});

function getSelectionCount() {
    return selectedFiles.size + selectedFolders.size;
}

function isFolderElementSelected(itemEl) {
    const path = itemEl?.dataset?.folderPath || '';
    return !!path && selectedFolders.has(path);
}

function isFileElementSelected(itemEl) {
    const file = itemEl?.dataset?.file || '';
    return !!file && selectedFiles.has(file);
}

function toggleSelectionClasses(itemEl, selected) {
    if (!itemEl) return;
    const visualTarget = itemEl.classList?.contains('grid-item') ? itemEl : itemEl.closest?.('.grid-item');
    if (!visualTarget) return;
    visualTarget.classList.toggle('selected', !!selected);
}

function selectSingleTarget(target) {
    clearSelection();
    if (!target?.element) return;
    if (target.kind === 'folder' && target.path) {
        selectedFolders.add(target.path);
    } else if (target.kind === 'image' && target.file) {
        selectedFiles.add(target.file);
    }
    toggleSelectionClasses(target.element, true);
    updateBottomActionBar();
}

function getSelectionContext() {
    const singleFile = selectedFiles.size === 1 && selectedFolders.size === 0 ? Array.from(selectedFiles)[0] : '';
    const singleFolder = selectedFolders.size === 1 && selectedFiles.size === 0 ? Array.from(selectedFolders)[0] : '';
    return {
        count: getSelectionCount(),
        hasFiles: selectedFiles.size > 0,
        hasFolders: selectedFolders.size > 0,
        onlyFiles: selectedFiles.size > 0 && selectedFolders.size === 0,
        onlyFolders: selectedFolders.size > 0 && selectedFiles.size === 0,
        singleFile,
        singleFolder,
    };
}

// 切换单项选中状态
window.toggleSelect = function(itemEl) {
    if (!itemEl) return;
    const kind = itemEl.dataset.itemKind || (itemEl.dataset.file ? 'image' : 'folder');
    if (kind === 'folder') {
        const path = itemEl.dataset.folderPath || '';
        if (!path) return;
        if (selectedFolders.has(path)) {
            selectedFolders.delete(path);
            toggleSelectionClasses(itemEl, false);
        } else {
            selectedFolders.add(path);
            toggleSelectionClasses(itemEl, true);
        }
        updateBottomActionBar();
        return;
    }

    const file = itemEl.dataset.file;
    if (!file) return;
    if (selectedFiles.has(file)) {
        selectedFiles.delete(file);
        toggleSelectionClasses(itemEl, false);
    } else {
        selectedFiles.add(file);
        toggleSelectionClasses(itemEl, true);
    }
    updateBottomActionBar();
};

// 清空所有选中
window.clearSelection = function() {
    selectedFiles.clear();
    selectedFolders.clear();
    document.querySelectorAll('.grid-item.selected').forEach(el => {
        el.classList.remove('selected');
    });
    updateBottomActionBar();
};

// 更新底部操作栏状态
function updateBottomActionBar() {
    const bar = document.getElementById('bottomActionBar');
    const countBadge = document.getElementById('selectedCount');
    const previewBtn = document.getElementById('batchPreviewBtn');
    const downloadBtn = document.getElementById('batchDownloadBtn');
    const renameBtn = document.getElementById('batchRenameBtn');
    const copyToBtn = document.getElementById('batchCopyToBtn');
    if (!bar || !countBadge) return;

    const selection = getSelectionContext();
    if (selection.count > 0) {
        countBadge.textContent = selection.count;
        bar.classList.add('active');
        if (previewBtn) {
            previewBtn.style.display = (selection.singleFile && isMobile) ? 'flex' : 'none';
        }
        if (downloadBtn) {
            downloadBtn.style.display = selection.onlyFiles ? 'flex' : 'none';
        }
        if (renameBtn) {
            renameBtn.style.display = (selection.singleFile || selection.singleFolder) ? 'flex' : 'none';
        }
        if (copyToBtn) {
            copyToBtn.style.display = (selection.hasFiles || selection.hasFolders) ? 'flex' : 'none';
        }
    } else {
        bar.classList.remove('active');
        if (previewBtn) {
            previewBtn.style.display = 'none';
        }
        if (downloadBtn) {
            downloadBtn.style.display = 'none';
        }
        if (renameBtn) {
            renameBtn.style.display = 'none';
        }
        if (copyToBtn) {
            copyToBtn.style.display = 'none';
        }
    }
    updateDownloadModeUI();
    updateWindowChrome();
}

// 处理项目点击 (兼容移动端与桌面端)
window.handleItemClick = function(e, itemEl) {
    if (isMobile || getSelectionCount() > 0) {
        e.preventDefault();
        toggleSelect(itemEl);
        return;
    }
    
    e.preventDefault();
    previewImage(itemEl.dataset.url);
};

function getFolderContextTarget(folderEl) {
    if (!folderEl) return null;
    const token = folderEl.getAttribute('data-folder-token') || folderEl.getAttribute('data-token') || '';
    const title = folderEl.getAttribute('data-folder-title') || folderEl.getAttribute('data-title') || folderEl.getAttribute('data-name') || '';
    const path = folderEl.getAttribute('data-folder-path') || folderEl.getAttribute('data-path') || '';
    if (!token && !path) return null;
    return { kind: 'folder', token, title, path, element: folderEl };
}

document.addEventListener('contextmenu', function(e) {
    const imageEl = e.target.closest('.image-item');
    if (imageEl) {
        e.preventDefault();
        showContextMenu(e, {
            kind: 'image',
            element: imageEl,
            file: imageEl.dataset.file,
            url: imageEl.dataset.url,
            copyUrl: imageEl.dataset.copyUrl,
            downloadUrl: imageEl.dataset.downloadUrl,
            token: imageEl.dataset.fileToken || state.currentToken,
            path: imageEl.dataset.folderPath || state.currentPath,
        }, false);
        return;
    }
    const folderCard = e.target.closest('[data-action="open-folder-card"]');
    if (folderCard) {
        const target = getFolderContextTarget(folderCard);
        if (target) {
            e.preventDefault();
            showContextMenu(e, target, false);
            return;
        }
    }
    const treeRow = e.target.closest('.tree-row');
    if (treeRow) {
        const treeFolder = treeRow.querySelector('[data-action="open-folder"]');
        const target = getFolderContextTarget(treeFolder);
        if (target) {
            e.preventDefault();
            showContextMenu(e, target, false);
        }
    }
});

// 隐藏菜单
document.addEventListener('click', function(e) {
    const menu = document.getElementById('contextMenu');
    if (menu && menu.classList.contains('active')) {
        if (!e.target.closest('.context-menu')) {
            menu.classList.remove('active');
            contextMenuTarget = null;
        }
    }

    const folderCard = e.target.closest('[data-action="open-folder-card"]');
    if (folderCard) {
        const token = folderCard.getAttribute('data-folder-token') || '';
        const title = folderCard.getAttribute('data-folder-title') || '';
        if (getSelectionCount() > 0) {
            e.preventDefault();
            toggleSelect(folderCard);
            return;
        }
        if (token) {
            loadAlbum(token, title || token);
        }
        return;
    }

    const previewEl = e.target.closest('[data-action="preview-image"]');
    if (previewEl) {
        const item = previewEl.closest('.image-item');
        if (item) {
            handleItemClick(e, item);
        }
        return;
    }

    const copyEl = e.target.closest('[data-action="copy-image-link"]');
    if (copyEl) {
        e.preventDefault();
        e.stopPropagation();
        const item = copyEl.closest('.image-item');
        if (item?.dataset.copyUrl || item?.dataset.url) {
            copyUrl(item.dataset.copyUrl || item.dataset.url);
        }
        return;
    }

    const revealEl = e.target.closest('[data-action="reveal-search-item"]');
    if (revealEl) {
        e.preventDefault();
        e.stopPropagation();
        const token = revealEl.getAttribute('data-token') || '';
        const path = revealEl.getAttribute('data-path') || '';
        const file = revealEl.getAttribute('data-file') || '';
        if (token) {
            state.focusedFile = file;
            loadAlbum(token, path || token);
        }
    }
});

function showContextMenu(e, itemEl, centerForMobile) {
    const menu = document.getElementById('contextMenu');
    if (!menu) return;
    renderContextMenuItems(buildContextMenuItems(itemEl));
    contextMenuTarget = itemEl;

    if (!state.searchQuery.trim() && itemEl.kind === 'image' && (!isFileElementSelected(itemEl.element) || selectedFolders.size > 0)) {
        selectSingleTarget(itemEl);
    }
    if (!state.searchQuery.trim() && itemEl.kind === 'folder' && (!isFolderElementSelected(itemEl.element) || selectedFiles.size > 0)) {
        selectSingleTarget(itemEl);
    }
    
    menu.classList.add('active');
    
    if (centerForMobile) {
        // 手机端居中显示
        menu.style.top = '50%';
        menu.style.left = '50%';
        menu.style.transform = 'translate(-50%, -50%) scale(1)';
        menu.style.position = 'fixed';
        
        let overlay = document.getElementById('ctxOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'ctxOverlay';
            overlay.style = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);z-index:9998;';
            document.body.appendChild(overlay);
            overlay.onclick = () => {
                menu.classList.remove('active');
                overlay.remove();
            };
        }
    } else {
        // 桌面端跟随鼠标
        let x = e.clientX;
        let y = e.clientY;
        
        // 防溢出
        const menuRect = menu.getBoundingClientRect();
        if (x + menuRect.width > window.innerWidth) x -= menuRect.width;
        if (y + menuRect.height > window.innerHeight) y -= menuRect.height;
        
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
        menu.style.transform = 'scale(1)';
        
        const overlay = document.getElementById('ctxOverlay');
        if (overlay) overlay.remove();
    }
}

// 处理单项右键菜单操作
window.handleContextAction = function(action) {
    const menu = document.getElementById('contextMenu');
    if (menu) menu.classList.remove('active');
    
    const overlay = document.getElementById('ctxOverlay');
    if (overlay) overlay.remove();
    
    if (!contextMenuTarget) return;
    
    const file = contextMenuTarget.file;
    const url = contextMenuTarget.url;
    
    switch (action) {
        case 'open-folder':
            if (contextMenuTarget.token) {
                loadAlbum(contextMenuTarget.token, contextMenuTarget.title || contextMenuTarget.token);
            }
            break;
        case 'copy-folder-link':
            copyUrl(getFolderShareLinkByPath(contextMenuTarget.path || '') || getCurrentShareLink(contextMenuTarget.token));
            break;
        case 'new-subfolder':
            openCreateFolderPanel(contextMenuTarget.path || '');
            break;
        case 'rename-folder':
            openRenameFolderPanel(contextMenuTarget.path || '', contextMenuTarget.title || '');
            break;
        case 'move-folder':
            showFolderMoveSelector([contextMenuTarget.path || '']);
            break;
        case 'copy-folder':
            showFolderCopySelector([contextMenuTarget.path || '']);
            break;
        case 'delete-folder':
            showActionDialog({
                title: '移入回收站',
                message: `确定将“${contextMenuTarget.title || contextMenuTarget.path}”移入回收站吗？其中内容也会一起进入回收站，可稍后恢复。`,
                confirmText: '移入回收站',
                danger: true,
                onConfirm: async () => {
                    hideActionDialog();
                    await deleteFolderByPath(contextMenuTarget.path || '', contextMenuTarget.title || '');
                }
            });
            break;
        case 'preview':
            previewImage(url);
            break;
        case 'copy':
            copyUrl(contextMenuTarget.copyUrl || url);
            break;
        case 'download':
            window.open(contextMenuTarget.downloadUrl || getCurrentFileDownloadLink(file, contextMenuTarget.token), '_blank');
            break;
        case 'rename-file':
            renameFileByPath(contextMenuTarget.path || state.currentPath, file);
            break;
        case 'reveal-folder':
            if (contextMenuTarget.token) {
                state.focusedFile = file || '';
                loadAlbum(contextMenuTarget.token, contextMenuTarget.path || contextMenuTarget.token);
            }
            break;
        case 'move-one':
            showMoveSelector([file], contextMenuTarget.path || state.currentPath);
            break;
        case 'copy-one':
            showCopySelector([file], contextMenuTarget.path || state.currentPath);
            break;
        case 'delete':
            showActionDialog({
                title: '移入回收站',
                message: `确定将 ${file} 移入回收站吗？后续可在回收站恢复。`,
                confirmText: '移入回收站',
                danger: true,
                onConfirm: async () => {
                    hideActionDialog();
                    try {
                        const data = await api.post('/api/folders/file-delete', JSON.stringify({ path: contextMenuTarget.path || state.currentPath, name: file }));
                        if (!data || !data.ok) {
                            showToast('删除失败，请重试');
                            return;
                        }
                        showToast(`已移入回收站：${file}`);
                        await loadTokens();
                        await refreshTrashItems();
                        clearSelection();
                    } catch (e) {
                        console.error('delete failed:', e);
                        showToast('删除失败，请重试');
                    }
                }
            });
            break;
    }
};

// 处理批量操作
window.handleBatchAction = function(action) {
    const files = Array.from(selectedFiles);
    const folders = Array.from(selectedFolders);
    const count = files.length + folders.length;
    if (count === 0) return;
    const selection = getSelectionContext();
    
    switch (action) {
        case 'preview':
            if (selection.singleFile) {
                const file = selection.singleFile;
                const url = getPreviewFileUrl(file);
                previewImage(url);
            }
            break;
        case 'download':
            if (!files.length) {
                return;
            }
            if (files.length === 1) {
                window.open(getCurrentFileDownloadLink(files[0]), '_blank');
            } else {
                exportSelectedFiles(files)
                    .then(() => showToast(`已导出 ${files.length} 个文件`))
                    .catch((err) => {
                        console.error('batch export failed:', err);
                        showToast(`导出失败：${getErrorMessage(err)}`);
                    });
            }
            clearSelection();
            break;
        case 'copy': {
            const urls = [
                ...files.map(f => getCurrentFileDownloadLink(f)).filter(Boolean),
                ...folders.map(path => getFolderShareLinkByPath(path)).filter(Boolean),
            ];
            navigator.clipboard.writeText(urls.join(String.fromCharCode(10)))
                .then(() => showToast(`已复制 ${count} 个链接喵！`))
                .catch(() => showToast('复制失败，请重试'));
            clearSelection();
            break;
        }
        case 'rename':
            if (selection.singleFile) {
                renameFileByPath(state.currentPath, selection.singleFile);
            } else if (selection.singleFolder) {
                const name = String(selection.singleFolder).split('/').filter(Boolean).pop() || '';
                openRenameFolderPanel(selection.singleFolder, name);
            }
            break;
        case 'move':
            showSelectionMoveSelector(files, folders);
            break;
        case 'copy-to':
            showSelectionCopySelector(files, folders);
            break;
        case 'delete':
            showActionDialog({
                title: '批量移入回收站',
                message: `确定将选中的 ${count} 个项目移入回收站吗？后续可在回收站恢复。`,
                confirmText: '移入回收站',
                danger: true,
                onConfirm: async () => {
                    hideActionDialog();
                    try {
                        let deletedCount = 0;
                        if (files.length) {
                            const fileData = await api.post('/api/folders/files-delete', JSON.stringify({ path: state.currentPath, names: files }));
                            if (!fileData || !fileData.ok) {
                                throw new Error((fileData && (fileData.detail || fileData.message)) || '文件删除失败');
                            }
                            deletedCount += Number(fileData.count || 0);
                        }
                        if (folders.length) {
                            const folderData = await api.post('/api/folders/batch-delete', JSON.stringify({ paths: folders }));
                            if (!folderData || !folderData.ok) {
                                throw new Error((folderData && (folderData.detail || folderData.message)) || '文件夹删除失败');
                            }
                            deletedCount += Number(folderData.count || 0);
                        }
                        showToast(`已移入回收站：${deletedCount} 个项目`);
                        await loadTokens();
                        await refreshTrashItems();
                        clearSelection();
                    } catch (e) {
                        console.error('batch-delete failed:', e);
                        showToast('删除失败，请重试');
                    }
                }
            });
            break;
    }
};

// 简单预览实现 (Lightbox)
window.previewImage = function(url) {
    let viewer = document.getElementById('imageViewer');
    if (!viewer) {
        viewer = document.createElement('div');
        viewer.id = 'imageViewer';
        viewer.innerHTML = `
            <div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.9);backdrop-filter:blur(10px);z-index:10000;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity 0.3s;cursor:zoom-out;">
                <button onclick="document.getElementById('imageViewer').classList.remove('show')" style="position:absolute;top:20px;right:20px;background:rgba(255,255,255,0.2);border:none;color:white;width:40px;height:40px;border-radius:50%;cursor:pointer;font-size:24px;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);"><i class="ph ph-x"></i></button>
                <img id="viewerImg" src="" style="max-width:90%;max-height:90%;object-fit:contain;border-radius:8px;box-shadow:0 20px 40px rgba(0,0,0,0.5);transform:scale(0.95);transition:transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.1);">
            </div>
        `;
        document.body.appendChild(viewer);
        
        const style = document.createElement('style');
        style.textContent = `
            #imageViewer.show > div { opacity: 1 !important; }
            #imageViewer.show img { transform: scale(1) !important; }
        `;
        document.head.appendChild(style);
        
        viewer.querySelector('div').addEventListener('click', function(e) {
            if (e.target === this) {
                viewer.classList.remove('show');
                setTimeout(() => viewer.remove(), 300);
            }
        });
        
        viewer.querySelector('button').addEventListener('click', function(e) {
            viewer.classList.remove('show');
            setTimeout(() => viewer.remove(), 300);
        });
    }
    
    document.getElementById('viewerImg').src = url;
    setTimeout(() => viewer.classList.add('show'), 10);
};

// 设置事件监听器
function setupEventListeners() {
    const sidebarToggle = document.querySelector('.sidebar-toggle');
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    const sidebarResizer = document.getElementById('sidebarResizer');
    const createRootFolderBtn = document.getElementById('createRootFolderBtn');
    const folderCreateSubmit = document.getElementById('folderCreateSubmit');
    const folderCreateCancel = document.getElementById('folderCreateCancel');
    const folderCreateInput = document.getElementById('folderCreateInput');
    const albumList = document.getElementById('album-list');
    const contextMenuList = document.getElementById('contextMenuList');
    const actionDialog = document.getElementById('actionDialog');
    const actionDialogCancel = document.getElementById('actionDialogCancel');
    const actionDialogConfirm = document.getElementById('actionDialogConfirm');
    const openTrashModalBtn = document.getElementById('openTrashModalBtn');
    const trashModal = document.getElementById('trashModal');
    const trashModalCloseBtn = document.getElementById('trashModalCloseBtn');
    const trashModalCloseFooterBtn = document.getElementById('trashModalCloseFooterBtn');
    const trashList = document.getElementById('trashList');
    const openRootAlbumsLink = document.getElementById('openRootAlbumsLink');
    const managerBreadcrumbs = document.getElementById('managerBreadcrumbs');
    const searchBox = document.querySelector('.search-box');
    const searchInput = document.getElementById('managerSearchInput');
    const searchScopeButton = document.getElementById('searchScopeButton');
    const searchScopeMenu = document.getElementById('searchScopeMenu');
    const downloadModeToggle = document.getElementById('downloadModeToggle');
    
    function toggleSidebar() {
        if(sidebar) sidebar.classList.toggle('open');
        if(overlay) overlay.classList.toggle('open');
    }

    if (sidebarToggle && sidebar && overlay) {
        sidebarToggle.addEventListener('click', toggleSidebar);
        overlay.addEventListener('click', toggleSidebar);
    }

    if (sidebarResizer) {
        let isResizing = false;
        let startX = 0;
        let startWidth = 0;

        const onMove = (e) => {
            if (!isResizing) return;
            const next = Math.min(520, Math.max(220, startWidth + (e.clientX - startX)));
            document.documentElement.style.setProperty('--sidebar-width', `${next}px`);
        };

        const onUp = () => {
            if (!isResizing) return;
            isResizing = false;
            const widthValue = getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width').trim();
            const widthNumber = Number(String(widthValue).replace('px', ''));
            if (Number.isFinite(widthNumber)) {
                localStorage.setItem('pf_manager_sidebar_width', String(widthNumber));
            }
            document.body.classList.remove('is-resizing-sidebar');
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };

        sidebarResizer.addEventListener('mousedown', (e) => {
            e.preventDefault();
            isResizing = true;
            startX = e.clientX;
            startWidth = sidebar ? sidebar.getBoundingClientRect().width : 320;
            document.body.classList.add('is-resizing-sidebar');
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
        });
    }

    if (createRootFolderBtn) {
        createRootFolderBtn.addEventListener('click', () => openCreateFolderPanel(''));
    }

    if (openRootAlbumsLink) {
        openRootAlbumsLink.addEventListener('click', (e) => {
            e.preventDefault();
            openRootView();
        });
    }

    if (managerBreadcrumbs) {
        managerBreadcrumbs.addEventListener('click', async (e) => {
            const rootTrigger = e.target.closest('[data-crumb-root]');
            if (rootTrigger) {
                e.preventDefault();
                openRootView();
                return;
            }

            const pathTrigger = e.target.closest('[data-crumb-path]');
            if (!pathTrigger) return;
            e.preventDefault();
            const path = pathTrigger.getAttribute('data-crumb-path') || '';
            const node = findNodeByPath(state.folderTree, path);
            if (node?.slug) {
                await loadAlbum(node.slug, node.name || node.slug);
            }
        });
    }

    if (searchInput) {
        searchInput.value = state.searchQuery;
        updateSearchBoxState();
        searchInput.addEventListener('focus', () => updateSearchBoxState(true));
        searchInput.addEventListener('input', () => {
            window.clearTimeout(searchInput._searchTimer);
            searchInput._searchTimer = window.setTimeout(() => {
                runSearch(searchInput.value);
                updateSearchBoxState();
            }, 180);
        });
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (searchInput.value.trim()) {
                    searchInput.value = '';
                    runSearch('');
                }
                closeSearchScopeMenu();
                searchInput.blur();
            }
        });
    }

    if (searchBox && searchInput) {
        searchBox.addEventListener('click', (e) => {
            if (e.target.closest('#searchScopeButton') || e.target.closest('#searchScopeMenu')) return;
            updateSearchBoxState(true);
            searchInput.focus();
        });
        searchBox.addEventListener('focusout', () => {
            window.setTimeout(() => updateSearchBoxState(), 0);
        });
    }

    if (searchScopeButton && searchScopeMenu) {
        searchScopeButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleSearchScopeMenu();
        });

        searchScopeMenu.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-scope]');
            if (!btn) return;
            e.preventDefault();
            e.stopPropagation();
            state.searchScope = btn.getAttribute('data-scope') === 'global' ? 'global' : 'subtree';
            updateSearchPlaceholder();
            closeSearchScopeMenu();
            if (state.searchQuery.trim()) {
                runSearch(state.searchQuery);
            } else {
                updateStatusBar();
            }
        });
    }

    document.addEventListener('click', (e) => {
        if (!searchScopeButton || !searchScopeMenu) return;
        if (e.target.closest('#searchScopeButton') || e.target.closest('#searchScopeMenu')) return;
        closeSearchScopeMenu();
    });

    if (downloadModeToggle) {
        updateDownloadModeUI();
        downloadModeToggle.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-mode]');
            if (!btn) return;
            setDownloadMode(btn.getAttribute('data-mode'));
        });
    }

    if (folderCreateSubmit) {
        folderCreateSubmit.addEventListener('click', submitFolderPanel);
    }

    if (folderCreateCancel) {
        folderCreateCancel.addEventListener('click', closeCreateFolderPanel);
    }

    if (folderCreateInput) {
        folderCreateInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                submitFolderPanel();
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                closeCreateFolderPanel();
            }
        });
    }

    if (albumList) {
        albumList.addEventListener('click', async (e) => {
            const actionEl = e.target.closest('[data-action]');
            if (!actionEl || !albumList.contains(actionEl)) return;
            e.preventDefault();
            e.stopPropagation();

            const action = actionEl.dataset.action;
            const path = actionEl.dataset.path || '';
            const name = actionEl.dataset.name || '';
            const token = actionEl.dataset.token || '';
            const title = actionEl.dataset.title || name || '';

            if (action === 'toggle-folder') {
                toggleFolderExpand(path);
                return;
            }
            if (action === 'open-folder') {
                await loadAlbum(token, title || token);
                return;
            }
            if (action === 'create-child-folder') {
                openCreateFolderPanel(path);
                return;
            }
            if (action === 'rename-folder') {
                openRenameFolderPanel(path, name || title);
                return;
            }
            if (action === 'delete-folder') {
                requestDeleteFolder(path, name || title);
            }
        });
    }

    if (contextMenuList) {
        contextMenuList.addEventListener('click', (e) => {
            const item = e.target.closest('.context-menu-item[data-action]');
            if (!item) return;
            handleContextAction(item.getAttribute('data-action') || '');
        });
    }

    if (actionDialogCancel) {
        actionDialogCancel.addEventListener('click', hideActionDialog);
    }

    if (actionDialogConfirm) {
        actionDialogConfirm.addEventListener('click', async () => {
            const handler = actionDialogState.onConfirm;
            if (typeof handler === 'function') {
                await handler();
            }
        });
    }

    if (actionDialog) {
        actionDialog.addEventListener('click', (e) => {
            if (e.target === actionDialog) {
                hideActionDialog();
            }
        });
    }

    if (openTrashModalBtn) {
        openTrashModalBtn.addEventListener('click', async () => {
            await openTrashModal();
        });
    }

    if (trashModalCloseBtn) {
        trashModalCloseBtn.addEventListener('click', closeTrashModal);
    }

    if (trashModalCloseFooterBtn) {
        trashModalCloseFooterBtn.addEventListener('click', closeTrashModal);
    }

    if (trashModal) {
        trashModal.addEventListener('click', (e) => {
            if (e.target === trashModal) {
                closeTrashModal();
            }
        });
    }

    if (trashList) {
        trashList.addEventListener('click', async (e) => {
            const actionEl = e.target.closest('[data-trash-action][data-trash-id]');
            if (!actionEl) return;
            const trashId = Number(actionEl.getAttribute('data-trash-id') || '0');
            if (!Number.isFinite(trashId) || trashId <= 0) return;
            const action = actionEl.getAttribute('data-trash-action') || '';
            try {
                if (action === 'restore') {
                    await restoreTrashItemById(trashId);
                    showToast('已从回收站恢复');
                } else if (action === 'delete') {
                    await deleteTrashItemById(trashId);
                    showToast('已永久删除');
                } else {
                    return;
                }
                await refreshTrashItems();
                await loadTokens();
            } catch (err) {
                console.error('trash action failed:', err);
                showToast(getErrorMessage(err));
            }
        });
    }

    const fileInput = document.getElementById('fileInput');
    if (fileInput) {
        fileInput.addEventListener('change', handleFiles);
    }

    const folderInput = document.getElementById('folderInput');
    if (folderInput) {
        folderInput.addEventListener('change', handleFiles);
    }

    const chooseFilesBtn = document.getElementById('chooseFilesBtn');
    if (chooseFilesBtn && fileInput) {
        chooseFilesBtn.addEventListener('click', () => fileInput.click());
    }

    const chooseFolderBtn = document.getElementById('chooseFolderBtn');
    if (chooseFolderBtn && folderInput) {
        chooseFolderBtn.addEventListener('click', () => folderInput.click());
    }

    const uploadZone = document.getElementById('uploadZone');
    if (uploadZone) {
        uploadZone.addEventListener('dragover', e => {
            e.preventDefault();
            uploadZone.classList.add('dragover');
        });

        uploadZone.addEventListener('drop', e => {
            e.preventDefault();
            uploadZone.classList.remove('dragover');
            const files = e.dataTransfer && e.dataTransfer.files;
            handleFiles({ target: { files } });
        });

        uploadZone.addEventListener('click', e => {
            if (!fileInput) return;
            if (e.target && e.target.closest && e.target.closest('#chooseFilesBtn, #chooseFolderBtn')) return;
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
            const target = e.target;
            const typing = target && ['INPUT', 'TEXTAREA'].includes(target.tagName);
            if (!typing && searchInput) {
                e.preventDefault();
                searchInput.focus();
                searchInput.select();
                return;
            }
        }
        if (e.key !== 'Escape') return;
        if (trashModal && trashModal.style.display === 'flex') {
            closeTrashModal();
            return;
        }
        if (actionDialog && actionDialog.style.display === 'flex') {
            hideActionDialog();
            return;
        }
        if (state.searchQuery.trim()) {
            clearSearchState({ clearInput: true });
            renderGridView();
            return;
        }
        if (getSelectionCount() > 0) {
            clearSelection();
        }
    });
}

async function uploadFiles(files, token, onProgress) {
    let successCount = 0;
    let failCount = 0;
    let lastError = null;

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const formData = new FormData();
        formData.append('file', file);

        try {
            if (typeof onProgress === 'function') {
                onProgress(i + 1, files.length, file);
            }
            const res = await api.post(`/api/upload/${token}`, formData);
            if (res && res.ok === false) {
                throw new Error(res.message || '上传失败');
            }
            successCount++;
        } catch (err) {
            lastError = err;
            failCount++;
        }
    }

    return { successCount, failCount, lastError };
}

function showToast(message) {
    let toast = document.getElementById('pfToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'pfToast';
        toast.style.cssText = [
            'position:fixed',
            'left:50%',
            'bottom:28px',
            'transform:translateX(-50%)',
            'background:rgba(0,0,0,0.75)',
            'color:#fff',
            'padding:10px 14px',
            'border-radius:10px',
            'font-size:13px',
            'z-index:20000',
            'max-width:90vw',
            'text-align:center',
            'opacity:0',
            'transition:opacity 0.2s ease'
        ].join(';');
        document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.style.opacity = '1';
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => {
        toast.style.opacity = '0';
    }, 2200);
}

function getErrorMessage(err) {
    if (!err) return '未知错误';
    if (typeof err === 'string') return err;
    if (err instanceof Error && err.message) return err.message;
    if (typeof err.message === 'string') return err.message;
    return String(err);
}

function updateUploadProgress(current, total, file) {
    const el = document.getElementById('upload-progress');
    if (!el) return;
    const name = file && file.name ? ` (${file.name})` : '';
    el.textContent = `${current} / ${total}${name}`;
}

function setUploadingUI(files) {
    const dropzoneContent = document.querySelector('.dropzone-content');
    if (!dropzoneContent) return null;

    const originalHtml = dropzoneContent.innerHTML;
    dropzoneContent.innerHTML = `
        <div class="upload-icon-ring" style="animation: pulse 1.5s infinite">
            <i class="ph ph-spinner-gap ph-spin"></i>
        </div>
        <h4>正在上传...</h4>
        <p id="upload-progress">0 / ${files.length}</p>
    `;

    return () => {
        dropzoneContent.innerHTML = originalHtml;
    };
}

function renderPendingUploadPreview() {
    const list = document.getElementById('uploadPreviewList');
    if (!list) return;

    const files = state.pendingUploadFiles || [];
    if (!files.length) {
        list.innerHTML = '';
        return;
    }

    list.innerHTML = files.slice(0, 8).map((file) => {
        const isImage = !!(file && file.type && file.type.startsWith('image/'));
        if (isImage) {
            const url = URL.createObjectURL(file);
            return `<div class="upload-preview-item"><img src="${url}" alt="${file.name || 'image'}"></div>`;
        }
        const icon = (file && file.name && file.name.toLowerCase().endsWith('.zip')) ? 'ph-file-zip' : 'ph-folder';
        const label = file && file.name ? file.name : '文件';
        return `<div class="upload-preview-item upload-preview-file"><i class="ph ${icon}"></i><span>${label}</span></div>`;
    }).join('');
}

function resetPendingUpload() {
    state.pendingUploadFiles = [];
    state.pendingUploadPaths = [];
    renderPendingUploadPreview();
    const fileInput = document.getElementById('fileInput');
    const folderInput = document.getElementById('folderInput');
    if (fileInput) fileInput.value = '';
    if (folderInput) folderInput.value = '';
}

function cachePendingFiles(files, paths) {
    state.pendingUploadFiles = Array.from(files || []);
    state.pendingUploadPaths = Array.isArray(paths)
        ? paths
        : state.pendingUploadFiles.map(file => file.name || 'file');
    renderPendingUploadPreview();
}

window.chooseUploadDestination = function() {
    const picker = new FolderSelector({
        base: state.base,
        title: '选择保存位置',
        onSelect: (selectedPath) => {
            state.uploadTargetPath = selectedPath || '';
            const display = document.getElementById('uploadDestDisplay');
            if (display) {
                display.textContent = state.uploadTargetPath ? `/${state.uploadTargetPath}` : '未选择';
            }
        },
    });
    picker.show();
};

async function handleFiles(e) {
    const files = e && e.target ? e.target.files : null;
    if (!files || files.length === 0) return;

    const fileList = Array.from(files);
    const paths = fileList.map(file => file.webkitRelativePath || file.name || 'file');
    cachePendingFiles(fileList, paths);
    showToast(`已选择 ${fileList.length} 个文件，请确认保存位置后开始上传`);
}

window.startPendingUpload = async function() {
    const files = state.pendingUploadFiles || [];
    if (!files.length) {
        showToast('请先选择要上传的文件');
        return;
    }

    const targetPath = state.uploadTargetPath || getCurrentAlbumPath();
    const { destination, folderName } = splitPath(targetPath);
    if (!folderName) {
        showToast('请先选择一个具体的保存位置（可在根目录下新建文件夹）');
        return;
    }

    showToast('上传中...');
    const restoreUI = setUploadingUI(files);

    try {
        const list = Array.from(files);
        const zipFiles = list.filter(f => (f && f.name && f.name.toLowerCase().endsWith('.zip')));
        const otherFiles = list.filter(f => !(f && f.name && f.name.toLowerCase().endsWith('.zip')));

        if (zipFiles.length > 0) {
            for (let i = 0; i < zipFiles.length; i++) {
                const file = zipFiles[i];
                updateUploadProgress(i + 1, zipFiles.length, file);
                const fd = new FormData();
                fd.append('file', file);
                fd.append('destination', destination);
                fd.append('folder_name', folderName);
                const data = await api.post('/api/upload/zip-import', fd);
                if (!data || data.ok !== true) {
                    throw new Error((data && data.detail) || 'ZIP 上传失败');
                }
            }
        }

        if (otherFiles.length > 0) {
            const fd = new FormData();
            for (const file of otherFiles) {
                fd.append('files', file);
                const originalPath = state.pendingUploadPaths[list.indexOf(file)] || file.webkitRelativePath || file.name || 'file';
                fd.append('paths', originalPath);
            }
            fd.append('destination', destination);
            fd.append('folder_name', folderName);
            const data = await api.post('/api/upload/folder-import', fd);
            if (!data || data.ok !== true) {
                throw new Error((data && data.detail) || '上传失败');
            }
        }

        showToast('上传成功');
        toggleUploadModal();
        resetPendingUpload();
        if (targetPath && targetPath === getCurrentAlbumPath()) {
            loadAlbum(state.currentToken, document.querySelector('.crumb-item.current').textContent);
        }
    } catch (err) {
        showToast('上传失败: ' + getErrorMessage(err));
    } finally {
        if (typeof restoreUI === 'function') restoreUI();
    }
};

window.toggleUploadModal = function() {
    const modal = document.getElementById('uploadModal');
    if (modal) {
        modal.classList.toggle('active');
        if (modal.classList.contains('active')) {
            const display = document.getElementById('uploadDestDisplay');
            if (display) {
                const p = state.uploadTargetPath || getCurrentAlbumPath();
                display.textContent = p ? `/${p}` : '未选择';
            }
        } else {
            resetPendingUpload();
        }
    }
};

document.addEventListener('DOMContentLoaded', initApp);
