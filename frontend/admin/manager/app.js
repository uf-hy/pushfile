
// 全局状态管理
const state = {
    key: localStorage.getItem('pushfile_admin_key') || '',
    base: window.__BASE__ || '',
    tokens: [],
    currentToken: null,
    currentFiles: []
};

// API 工具函数
const api = {
    async get(path) {
        const url = new URL(state.base + path, window.location.origin);
        url.searchParams.append('key', state.key);
        const res = await fetch(url);
        if (res.status === 401) {
            handleAuthError();
            throw new Error('Unauthorized');
        }
        return res.json();
    },
    async post(path, body) {
        const res = await fetch(state.base + path, {
            method: 'POST',
            headers: {
                'X-Upload-Key': state.key,
                ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' })
            },
            body: body
        });
        if (res.status === 401) {
            handleAuthError();
            throw new Error('Unauthorized');
        }
        return res.json();
    }
};

function handleAuthError() {
    const key = prompt('请输入管理员密码：');
    if (key) {
        localStorage.setItem('pushfile_admin_key', key);
        state.key = key;
        initApp();
    }
}

// 核心功能：初始化应用
async function initApp() {
    if (!state.key) {
        handleAuthError();
        return;
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
    const data = await api.get('/api/tokens');
    if (data.ok) {
        state.tokens = data.tokens;
        renderSidebarTokens();
        renderUploadSelect();
        
        // 默认加载第一个相册
        if (state.tokens.length > 0) {
            const first = state.tokens[0];
            loadAlbum(first.token, first.title || first.token);
        }
    }
}

// 加载具体相册内容
async function loadAlbum(token, title) {
    state.currentToken = token;
    updateBreadcrumbs(title || token);
    
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

// 渲染侧边栏相册列表
function renderSidebarTokens() {
    const container = document.getElementById('album-list');
    if (!container) return;
    
    container.innerHTML = state.tokens.map(t => {
        const displayTitle = t.title || t.token;
        const countHtml = t.count !== undefined ? `<span style="margin-left:auto;font-size:12px;color:var(--color-text-secondary)">${t.count}</span>` : '';
        return `
            <a href="#" class="nav-item" data-token="${t.token}" onclick="loadAlbum('${t.token}', '${displayTitle}')">
                <i class="ph-fill ph-folder" style="color: #82b1ff;"></i>
                <span>${displayTitle}</span>
                ${countHtml}
            </a>
        `;
    }).join('');
}

// 渲染网格视图
function renderGridView() {
    const container = document.querySelector('.grid-view');
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
        const isVideo = file.toLowerCase().match(/.(mp4|mov|webm)$/);
        const url = `${state.base}/d/${state.currentToken}/${file}`;
        
        let mediaHtml = isVideo 
            ? `<div style="width:100%;height:100%;background:#f0f0f0;display:flex;align-items:center;justify-content:center"><i class="ph-fill ph-video-camera" style="font-size:32px;color:#999"></i></div>`
            : `<img src="${url}" alt="${file}" loading="lazy">`;
            
        return `
            <div class="grid-item image-item" data-file="${file}" data-url="${url}">
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
}

// 更新面包屑
function updateBreadcrumbs(title) {
    const currentCrumb = document.querySelector('.crumb-item.current');
    if (currentCrumb) {
        currentCrumb.textContent = title;
    }
}

// 渲染上传下拉框
function renderUploadSelect() {
    const select = document.getElementById('upload-album-select');
    if (!select) return;
    
    select.innerHTML = state.tokens.map(t => {
        const displayTitle = t.title || t.token;
        const isSelected = t.token === state.currentToken ? 'selected' : '';
        return `<option value="${t.token}" ${isSelected}>${displayTitle}</option>`;
    }).join('');
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
    if (!bar || !countBadge) return;
    
    if (selectedFiles.size > 0) {
        countBadge.textContent = selectedFiles.size;
        bar.classList.add('active');
    } else {
        bar.classList.remove('active');
    }
}

// 处理项目点击 (兼容移动端与桌面端)
window.handleItemClick = function(e, itemEl) {
    if (selectedFiles.size > 0) {
        // 如果处于多选模式，点击项相当于 toggle
        e.preventDefault();
        toggleSelect(itemEl);
        return;
    }
    
    if (isMobile) {
        // 手机端直接打开操作菜单
        e.preventDefault();
        showContextMenu(e, itemEl, true);
    } else {
        // 桌面端默认行为: 触发预览
        e.preventDefault();
        previewImage(itemEl.dataset.url);
    }
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
                alert('准备删除: ' + file);
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
        case 'copy':
            const urls = files.map(f => new URL(`${state.base}/d/${state.currentToken}/${f}`, window.location.origin).href);
            navigator.clipboard.writeText(urls.join(String.fromCharCode(10)))
                .then(() => alert(`已复制 ${count} 个链接喵！`))
                .catch(() => alert('复制失败，请重试'));
            clearSelection();
            break;
        case 'move':
            alert(`准备移动 ${count} 个文件 (待接入API)`);
            break;
        case 'delete':
            if (confirm(`确定要删除选中的 ${count} 个文件喵？不可恢复哦！`)) {
                alert('准备批量删除 (待接入API)');
                clearSelection();
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
            }
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

    const dropzone = document.getElementById('dropzone');
    if (dropzone) {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropzone.addEventListener(eventName, preventDefaults, false);
        });

        function preventDefaults(e) {
            e.preventDefault();
            e.stopPropagation();
        }

        ['dragenter', 'dragover'].forEach(eventName => {
            dropzone.addEventListener(eventName, () => {
                dropzone.classList.add('dragover');
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropzone.addEventListener(eventName, () => {
                dropzone.classList.remove('dragover');
            }, false);
        });

        dropzone.addEventListener('drop', handleDrop, false);

        function handleDrop(e) {
            let dt = e.dataTransfer;
            let files = dt.files;
            handleFiles(files);
        }
    }
}

// 处理文件上传
async function handleFiles(files) {
    if (files.length === 0) return;
    
    const selectEl = document.getElementById('upload-album-select');
    const token = selectEl ? selectEl.value : state.currentToken;
    if (!token) {
        alert('请先选择或创建一个相册喵！');
        return;
    }

    const dropzoneContent = document.querySelector('.dropzone-content');
    const originalHtml = dropzoneContent.innerHTML;
    
    dropzoneContent.innerHTML = `
        <div class="upload-icon-ring" style="animation: pulse 1.5s infinite">
            <i class="ph ph-spinner-gap ph-spin"></i>
        </div>
        <h4>正在上传...</h4>
        <p id="upload-progress">0 / ${files.length}</p>
    `;

    let successCount = 0;
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const formData = new FormData();
        formData.append('file', file);
        
        try {
            document.getElementById('upload-progress').textContent = `${i + 1} / ${files.length} (${file.name})`;
            await api.post(`/api/upload/${token}`, formData);
            successCount++;
        } catch (e) {
            console.error(`上传 ${file.name} 失败:`, e);
        }
    }

    alert(`上传完成喵！成功: ${successCount}，失败: ${files.length - successCount}`);
    
    dropzoneContent.innerHTML = originalHtml;
    toggleUploadModal();
    if (token === state.currentToken) {
        loadAlbum(token, document.querySelector('.crumb-item.current').textContent);
    }
}

window.toggleUploadModal = function() {
    const modal = document.getElementById('uploadModal');
    if (modal) {
        modal.classList.toggle('active');
        if (modal.classList.contains('active')) {
            renderUploadSelect();
        }
    }
};

document.addEventListener('DOMContentLoaded', initApp);
