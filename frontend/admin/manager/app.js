
// 全局状态管理
const state = {
    key: (window.PushFileAuth && typeof window.PushFileAuth.getKey === 'function')
        ? window.PushFileAuth.getKey()
        : (localStorage.getItem('pushfile_admin_key') || ''),
    base: window.__BASE__ || '',
    tokens: [],
    currentToken: null,
    currentFiles: [],
    folderTree: [],
    uploadTargetPath: '',
    pendingUploadFiles: [],
    pendingUploadPaths: []
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

// 核心功能：初始化应用
async function initApp() {
    if (window.PushFileAuth && typeof window.PushFileAuth.guardPage === 'function') {
        await window.PushFileAuth.guardPage({ base: state.base });
        state.key = window.PushFileAuth.getKey();
    }
    
    try {
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
                if (node.is_album) {
                    state.tokens.push({
                        token: node.slug,
                        title: node.name,
                        path: node.path,
                        count: node.image_count
                    });
                }
                if (node.children && node.children.length > 0) {
                    flattenTree(node.children);
                }
            }
        }
        flattenTree(state.folderTree);
        
        renderSidebarTree(state.folderTree);
        
        if (state.tokens.length > 0) {
            const current = state.currentToken
                ? state.tokens.find(t => t.token === state.currentToken)
                : null;
            const target = current || state.tokens[0];
            await loadAlbum(target.token, target.title || target.token);
        }
    }
}

function getCurrentAlbumPath() {
    const t = state.tokens.find(x => x.token === state.currentToken);
    return (t && typeof t.path === 'string') ? t.path : '';
}

function splitPath(path) {
    const parts = String(path || '').split('/').filter(Boolean);
    if (parts.length === 0) return { destination: '', folderName: '' };
    return {
        destination: parts.slice(0, -1).join('/'),
        folderName: parts[parts.length - 1] || '',
    };
}

function renderSidebarTree(tree) {
    const container = document.getElementById('album-list');
    if (!container) return;
    
    function buildTreeHtml(nodes, level = 0) {
        let html = '';
        for (const node of nodes) {
            const paddingLeft = level * 16 + 12;
            
            if (node.is_album) {
                const countHtml = node.image_count !== undefined ? `<span style="margin-left:auto;font-size:12px;color:var(--color-text-secondary)">${node.image_count}</span>` : '';
                html += `
                    <a href="#" class="nav-item" data-token="${node.slug}" onclick="loadAlbum('${node.slug}', '${node.name}')" style="padding-left: ${paddingLeft}px">
                        <i class="ph-fill ph-image" style="color: #82b1ff;"></i>
                        <span>${node.name}</span>
                        ${countHtml}
                    </a>
                `;
            } else {
                html += `
                    <div class="nav-folder" style="padding-left: ${paddingLeft}px; padding-top: 8px; padding-bottom: 4px; display: flex; align-items: center; gap: 8px; color: var(--color-text-main); font-size: 13px; font-weight: 600;">
                        <i class="ph-fill ph-folder" style="color: #ffd54f;"></i>
                        <span>${node.name}</span>
                    </div>
                `;
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
async function loadAlbum(token, title) {
    state.currentToken = token;
    updateBreadcrumbs(title || token);

    state.uploadTargetPath = getCurrentAlbumPath();
    const display = document.getElementById('uploadDestDisplay');
    if (display) {
        display.textContent = state.uploadTargetPath ? `/${state.uploadTargetPath}` : '未选择';
    }
    
    // 更新侧边栏激活状态
    document.querySelectorAll('.nav-item[data-token]').forEach(item => {
        item.classList.toggle('active', item.dataset.token === token);
    });

    const data = await api.get(`/api/manage/${token}`);
    if (data.files) {
        state.currentFiles = data.files;
        renderGridView();
        // 切换目录时清空选择
        clearSelection();
    }
}

// 渲染网格视图
function renderGridView() {
    const container = document.querySelector('.grid-view') || document.querySelector('.mobile-view');
    if (!container) return;
    
    if (state.currentFiles.length === 0) {
        container.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--color-text-secondary);">
                <i class="ph ph-empty" style="font-size: 48px; margin-bottom: 16px;"></i>
                <p>相册是空的喵～</p>
            </div>
        `;
        return;
    }

    container.innerHTML = state.currentFiles.map(file => {
        const isVideo = file.toLowerCase().match(/\.(mp4|mov|webm)$/);
        const url = `${state.base}/d/${state.currentToken}/${file}`;
        
        let mediaHtml = isVideo 
            ? `<div style="width:100%;height:100%;background:#f0f0f0;display:flex;align-items:center;justify-content:center"><i class="ph-fill ph-video-camera" style="font-size:32px;color:#999"></i></div>`
            : `<img src="${url}" alt="${file}" loading="lazy" draggable="false">`;
            
        return `
            <div class="grid-item image-item" data-file="${file}" data-url="${url}" draggable="true">
                <div class="item-checkbox" onclick="event.stopPropagation(); toggleSelect(this.closest('.grid-item'))"><i class="ph-bold ph-check"></i></div>
                <div class="item-thumb" onclick="handleItemClick(event, this.closest('.grid-item'))">
                    ${mediaHtml}
                    <div class="item-overlay">
                        <button class="action-btn" onclick="event.stopPropagation(); copyUrl('${url}')"><i class="ph ph-link"></i></button>
                    </div>
                </div>
                <div class="item-info">
                    <span class="item-name" title="${file}">${file}</span>
                </div>
            </div>
        `;
    }).join('');

    if (isMobile) {
        document.body.classList.add('mobile-multi-select');
    } else {
        document.body.classList.remove('mobile-multi-select');
    }

    setupDragAndDrop();
    
    if (currentView === 'mobile') {
        container.className = 'mobile-view';
    }
}

let currentView = 'grid';
window.switchView = function(view) {
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
};

function setupDragAndDrop() {
    const container = document.querySelector('.grid-view') || document.querySelector('.mobile-view');
    if (!container) return;

    let draggedItem = null;

    const items = container.querySelectorAll('.grid-item');
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
                const allItems = [...container.querySelectorAll('.grid-item')];
                const draggedIndex = allItems.indexOf(draggedItem);
                const droppedIndex = allItems.indexOf(this);
                
                if (draggedIndex < droppedIndex) {
                    this.parentNode.insertBefore(draggedItem, this.nextSibling);
                } else {
                    this.parentNode.insertBefore(draggedItem, this);
                }

                const newFiles = [...container.querySelectorAll('.grid-item')].map(el => el.dataset.file);
                state.currentFiles = newFiles;

                try {
                    await api.post(`/api/manage/${state.currentToken}/order`, JSON.stringify({ files: newFiles }));
                } catch (err) {
                    console.error('Failed to save order:', err);
                }
            }
        });
    });
}

// 更新面包屑
function updateBreadcrumbs(title) {
    const currentCrumb = document.querySelector('.crumb-item.current');
    if (currentCrumb) {
        currentCrumb.textContent = title;
    }
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
        alert('链接已复制喵！');
    } catch (err) {
        prompt('请复制链接:', fullUrl);
    }
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
let contextMenuTarget = null;
let isMobile = window.innerWidth <= 768;

window.addEventListener('resize', () => {
    isMobile = window.innerWidth <= 768;
});

// 切换单项选中状态
window.toggleSelect = function(itemEl) {
    const file = itemEl.dataset.file;
    if (!file) return;
    
    if (selectedFiles.has(file)) {
        selectedFiles.delete(file);
        itemEl.classList.remove('selected');
    } else {
        selectedFiles.add(file);
        itemEl.classList.add('selected');
    }
    
    updateBottomActionBar();
};

// 清空所有选中
window.clearSelection = function() {
    selectedFiles.clear();
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
    if (!bar || !countBadge) return;
    
    if (selectedFiles.size > 0) {
        countBadge.textContent = selectedFiles.size;
        bar.classList.add('active');
        if (previewBtn) {
            previewBtn.style.display = (isMobile && selectedFiles.size === 1) ? 'flex' : 'none';
        }
    } else {
        bar.classList.remove('active');
        if (previewBtn) {
            previewBtn.style.display = 'none';
        }
    }
}

// 处理项目点击 (兼容移动端与桌面端)
window.handleItemClick = function(e, itemEl) {
    if (isMobile || selectedFiles.size > 0) {
        e.preventDefault();
        toggleSelect(itemEl);
        return;
    }
    
    e.preventDefault();
    previewImage(itemEl.dataset.url);
};

// 右键菜单逻辑
document.addEventListener('contextmenu', function(e) {
    const itemEl = e.target.closest('.grid-item');
    if (itemEl) {
        e.preventDefault();
        showContextMenu(e, itemEl, false);
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
});

function showContextMenu(e, itemEl, centerForMobile) {
    const menu = document.getElementById('contextMenu');
    if (!menu) return;
    
    contextMenuTarget = itemEl;
    
    // 如果是在多选中右键了一个未选中的项，先清空再选中它
    const file = itemEl.dataset.file;
    if (selectedFiles.size > 0 && !selectedFiles.has(file)) {
        clearSelection();
        toggleSelect(itemEl);
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
    
    const file = contextMenuTarget.dataset.file;
    const url = contextMenuTarget.dataset.url;
    
    switch (action) {
        case 'preview':
            previewImage(url);
            break;
        case 'copy':
            copyUrl(url);
            break;
        case 'download':
            window.open(url, '_blank');
            break;
        case 'delete':
            if (confirm(`确定要删除 ${file} 喵？`)) {
                (async () => {
                    try {
                        const data = await api.post(
                            `/api/manage/${state.currentToken}/delete`,
                            JSON.stringify({ name: file })
                        );
                        if (!data || !data.ok) {
                            alert('删除失败，请重试');
                            return;
                        }
                        await loadTokens();
                        clearSelection();
                    } catch (e) {
                        console.error('delete failed:', e);
                        alert('删除失败，请重试');
                    }
                })();
            }
            break;
    }
};

// 处理批量操作
window.handleBatchAction = function(action) {
    const count = selectedFiles.size;
    if (count === 0) return;
    
    const files = Array.from(selectedFiles);
    
    switch (action) {
        case 'preview':
            if (count === 1) {
                const file = files[0];
                const url = `${state.base}/d/${state.currentToken}/${file}`;
                previewImage(url);
            }
            break;
        case 'copy': {
            const urls = files.map(f => new URL(`${state.base}/d/${state.currentToken}/${f}`, window.location.origin).href);
            navigator.clipboard.writeText(urls.join(String.fromCharCode(10)))
                .then(() => alert(`已复制 ${count} 个链接喵！`))
                .catch(() => alert('复制失败，请重试'));
            clearSelection();
            break;
        }
        case 'move':
            (async () => {
                const dest = (prompt('移动到哪个文件夹路径？（相对根目录，可填子目录）') || '').trim();
                if (!dest) return;
                try {
                    const data = await api.post(
                        `/api/manage/${state.currentToken}/batch-move`,
                        JSON.stringify({ dest: dest, names: files })
                    );
                    if (!data || !data.ok) {
                        alert('移动失败，请重试');
                        return;
                    }
                    const movedCount = (data.moved || []).length;
                    const skippedCount = (data.skipped || []).length;
                    alert(`移动完成喵！成功: ${movedCount}，跳过: ${skippedCount}`);
                    await loadTokens();
                    clearSelection();
                } catch (e) {
                    console.error('batch-move failed:', e);
                    alert('移动失败，请重试');
                }
            })();
            break;
        case 'delete':
            if (confirm(`确定要删除选中的 ${count} 个文件喵？不可恢复哦！`)) {
                (async () => {
                    try {
                        const data = await api.post(
                            `/api/manage/${state.currentToken}/batch-delete`,
                            JSON.stringify({ names: files })
                        );
                        if (!data || !data.ok) {
                            alert('删除失败，请重试');
                            return;
                        }
                        const deletedCount = data.count ?? (data.deleted || []).length;
                        alert(`删除完成喵！成功删除 ${deletedCount} 个文件`);
                        await loadTokens();
                        clearSelection();
                    } catch (e) {
                        console.error('batch-delete failed:', e);
                        alert('删除失败，请重试');
                    }
                })();
            }
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
    
    function toggleSidebar() {
        if(sidebar) sidebar.classList.toggle('open');
        if(overlay) overlay.classList.toggle('open');
    }

    if (sidebarToggle && sidebar && overlay) {
        sidebarToggle.addEventListener('click', toggleSidebar);
        overlay.addEventListener('click', toggleSidebar);
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
