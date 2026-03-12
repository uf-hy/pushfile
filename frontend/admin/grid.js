// 状态管理
const state = {
    originalFile: null,
    previewUrl: null,
    tiles: [],
    lineWidth: 2,
    gap: 0,
    isProcessing: false
};

// DOM 元素
const elements = {
    uploadZone: document.getElementById('uploadZone'),
    fileInput: document.getElementById('fileInput'),
    previewContainer: document.getElementById('previewContainer'),
    previewImage: document.getElementById('previewImage'),
    removeBtn: document.getElementById('removeBtn'),
    paramsPanel: document.getElementById('paramsPanel'),
    lineWidth: document.getElementById('lineWidth'),
    lineWidthValue: document.getElementById('lineWidthValue'),
    gap: document.getElementById('gap'),
    gapValue: document.getElementById('gapValue'),
    actionButtons: document.getElementById('actionButtons'),
    saveBtn: document.getElementById('saveBtn'),
    downloadBtn: document.getElementById('downloadBtn'),
    emptyState: document.getElementById('emptyState'),
    tilesSection: document.getElementById('tilesSection'),
    tilesGrid: document.getElementById('tilesGrid'),
    loadingSpinner: document.getElementById('loadingSpinner')
};

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    // 鉴权检查
    PushFileAuth.guardPage({ base: window.__BASE__ });
    
    setupUploadZone();
    setupParamsPanel();
    setupButtons();
});

// 上传区域设置
function setupUploadZone() {
    // 点击上传
    elements.uploadZone.addEventListener('click', (e) => {
        if (e.target === elements.removeBtn || elements.removeBtn.contains(e.target)) {
            return;
        }
        elements.fileInput.click();
    });

    // 文件选择
    elements.fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            handleFile(e.target.files[0]);
        }
    });

    // 拖拽上传
    elements.uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        elements.uploadZone.classList.add('dragover');
    });

    elements.uploadZone.addEventListener('dragleave', () => {
        elements.uploadZone.classList.remove('dragover');
    });

    elements.uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        elements.uploadZone.classList.remove('dragover');
        
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            const file = e.dataTransfer.files[0];
            if (file.type.startsWith('image/')) {
                handleFile(file);
            } else {
                alert('请上传图片文件');
            }
        }
    });

    // 移除图片
    elements.removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        resetState();
    });
}

// 处理文件
function handleFile(file) {
    state.originalFile = file;
    
    // 显示预览图
    const reader = new FileReader();
    reader.onload = (e) => {
        elements.previewImage.src = e.target.result;
        elements.previewContainer.style.display = 'flex';
        
        // 启用参数面板和按钮
        elements.paramsPanel.style.opacity = '1';
        elements.paramsPanel.style.pointerEvents = 'auto';
        elements.actionButtons.style.display = 'flex';
        
        // 隐藏空状态，显示网格
        elements.emptyState.style.display = 'none';
        elements.tilesSection.style.display = 'flex';
        
        // 生成九宫格
        generateGrid();
    };
    reader.readAsDataURL(file);
}

// 重置状态
function resetState() {
    state.originalFile = null;
    state.tiles = [];
    
    elements.fileInput.value = '';
    elements.previewContainer.style.display = 'none';
    elements.previewImage.src = '';
    
    elements.paramsPanel.style.opacity = '0.5';
    elements.paramsPanel.style.pointerEvents = 'none';
    elements.actionButtons.style.display = 'none';
    
    elements.emptyState.style.display = 'flex';
    elements.tilesSection.style.display = 'none';
    elements.tilesGrid.innerHTML = '';
}

// 参数面板设置
function setupParamsPanel() {
    let debounceTimer;
    
    const updateGrid = () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            if (state.originalFile) {
                generateGrid();
            }
        }, 300);
    };

    elements.lineWidth.addEventListener('input', (e) => {
        state.lineWidth = parseInt(e.target.value);
        elements.lineWidthValue.textContent = `${state.lineWidth}px`;
        updateGrid();
    });

    elements.gap.addEventListener('input', (e) => {
        state.gap = parseInt(e.target.value);
        elements.gapValue.textContent = `${state.gap}px`;
        updateGrid();
    });
}

// 按钮设置
function setupButtons() {
    elements.saveBtn.addEventListener('click', saveToFolder);
    elements.downloadBtn.addEventListener('click', downloadZip);
}

// 生成九宫格预览
async function generateGrid() {
    if (!state.originalFile || state.isProcessing) return;
    
    state.isProcessing = true;
    elements.loadingSpinner.style.display = 'block';
    
    try {
        const formData = new FormData();
        formData.append('file', state.originalFile);
        formData.append('line_width', state.lineWidth);
        formData.append('gap', state.gap);
        
        const response = await PushFileAuth.apiPost('/api/grid/preview', formData, false);
        
        if (!response.ok) {
            throw new Error('生成预览失败');
        }
        
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        
        // 在前端模拟切割效果展示
        renderTilesPreview(url);
        
    } catch (error) {
        console.error('Error generating grid:', error);
        alert('生成预览失败，请重试');
    } finally {
        state.isProcessing = false;
        elements.loadingSpinner.style.display = 'none';
    }
}

// 渲染九宫格预览动画
function renderTilesPreview(previewUrl) {
    elements.tilesGrid.innerHTML = '';
    elements.tilesGrid.style.gap = `${state.gap}px`;
    
    // 创建 9 个格子
    for (let i = 0; i < 9; i++) {
        const row = Math.floor(i / 3);
        const col = i % 3;
        
        const tile = document.createElement('div');
        tile.className = 'tile-item';
        
        // 计算背景位置
        const xPos = col * 50;
        const yPos = row * 50;
        
        tile.style.backgroundImage = `url(${previewUrl})`;
        tile.style.backgroundSize = '300% 300%';
        tile.style.backgroundPosition = `${xPos}% ${yPos}%`;
        
        // 错峰动画
        tile.style.animationDelay = `${(row + col) * 0.1}s`;
        
        elements.tilesGrid.appendChild(tile);
        
        // 触发重绘后添加动画类
        requestAnimationFrame(() => {
            tile.classList.add('animate-in');
        });
    }
}

// 保存到文件夹
async function saveToFolder() {
    if (!state.originalFile) return;
    
    if (typeof FolderSelector === 'undefined') {
        alert('FolderSelector 组件未加载');
        return;
    }
    
    const selector = new FolderSelector({
        base: window.__BASE__,
        title: '保存九宫格到',
        onSelect: async (path, isNew, folderName) => {
            try {
                elements.saveBtn.disabled = true;
                elements.saveBtn.innerHTML = '<i class="ph ph-spinner-gap ph-spin"></i> 保存中...';
                
                const formData = new FormData();
                formData.append('file', state.originalFile);
                formData.append('destination', path);
                if (isNew && folderName) {
                    formData.append('folder_name', folderName);
                }
                formData.append('line_width', state.lineWidth);
                formData.append('gap', state.gap);
                
                const response = await PushFileAuth.apiPost('/api/grid/save', formData, false);
                
                if (response.ok) {
                    alert('保存成功！');
                } else {
                    const data = await response.json();
                    throw new Error(data.detail || '保存失败');
                }
            } catch (error) {
                console.error('Error saving grid:', error);
                alert(error.message || '保存失败，请重试');
            } finally {
                elements.saveBtn.disabled = false;
                elements.saveBtn.innerHTML = '<i class="ph ph-folder-simple"></i> 保存到文件夹';
            }
        }
    });
    
    selector.show();
}

// 下载 ZIP
async function downloadZip() {
    if (!state.originalFile) return;
    
    try {
        elements.downloadBtn.disabled = true;
        elements.downloadBtn.innerHTML = '<i class="ph ph-spinner-gap ph-spin"></i> 处理中...';
        
        const formData = new FormData();
        formData.append('file', state.originalFile);
        formData.append('line_width', state.lineWidth);
        formData.append('gap', state.gap);
        
        const response = await PushFileAuth.apiPost('/api/grid/split', formData, false);
        
        if (!response.ok) {
            throw new Error('下载失败');
        }
        
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `grid_${new Date().getTime()}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
    } catch (error) {
        console.error('Error downloading zip:', error);
        alert('下载失败，请重试');
    } finally {
        elements.downloadBtn.disabled = false;
        elements.downloadBtn.innerHTML = '<i class="ph ph-download"></i> 下载 ZIP';
    }
}