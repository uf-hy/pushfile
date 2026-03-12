class FolderSelector {
    constructor(options) {
        this.options = Object.assign({
            base: '',
            title: '选择文件夹',
            onSelect: () => {}
        }, options);
        
        this.folders = [];
        this.selectedPath = null;
        this.isNewFolder = false;
        
        this.init();
    }
    
    init() {
        // 创建 DOM 结构
        this.overlay = document.createElement('div');
        this.overlay.className = 'folder-selector-overlay';
        
        this.overlay.innerHTML = `
            <div class="folder-selector-modal">
                <div class="folder-selector-header">
                    <h3>${this.options.title}</h3>
                    <button type="button" class="folder-selector-close">
                        <i class="ph ph-x"></i>
                    </button>
                </div>
                <div class="folder-selector-body">
                    <div class="folder-list" id="folderList">
                        <div style="text-align: center; padding: 20px; color: var(--color-text-secondary);">
                            <i class="ph ph-spinner-gap ph-spin" style="font-size: 24px;"></i>
                            <p style="margin-top: 8px; font-size: 14px;">加载中...</p>
                        </div>
                    </div>
                    <div class="new-folder-input-container" id="newFolderContainer">
                        <input type="text" class="new-folder-input" id="newFolderInput" placeholder="输入新文件夹名称">
                    </div>
                </div>
                <div class="folder-selector-footer">
                    <button type="button" class="btn btn-secondary" id="folderCancelBtn">取消</button>
                    <button type="button" class="btn btn-primary" id="folderConfirmBtn" disabled>确定</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(this.overlay);
        
        // 绑定元素
        this.folderList = this.overlay.querySelector('#folderList');
        this.newFolderContainer = this.overlay.querySelector('#newFolderContainer');
        this.newFolderInput = this.overlay.querySelector('#newFolderInput');
        this.confirmBtn = this.overlay.querySelector('#folderConfirmBtn');
        
        // 绑定事件
        this.overlay.querySelector('.folder-selector-close').addEventListener('click', () => this.hide());
        this.overlay.querySelector('#folderCancelBtn').addEventListener('click', () => this.hide());
        
        this.confirmBtn.addEventListener('click', () => {
            if (this.selectedPath === 'new') {
                const folderName = this.newFolderInput.value.trim();
                if (!folderName) {
                    alert('请输入文件夹名称');
                    return;
                }
                this.options.onSelect('', true, folderName);
            } else {
                this.options.onSelect(this.selectedPath, false, null);
            }
            this.hide();
        });
        
        this.newFolderInput.addEventListener('input', () => {
            this.confirmBtn.disabled = this.selectedPath === 'new' && !this.newFolderInput.value.trim();
        });
        
        // 点击遮罩层关闭
        this.overlay.addEventListener('click', (e) => {
            if (e.target === this.overlay) {
                this.hide();
            }
        });
    }
    
    async loadFolders() {
        try {
            const response = await PushFileAuth.apiGet('/api/folders');
            if (response.ok) {
                const data = await response.json();
                this.folders = data.folders || [];
                this.renderFolders();
            } else {
                throw new Error('Failed to load folders');
            }
        } catch (error) {
            console.error('Error loading folders:', error);
            this.folderList.innerHTML = `
                <div style="text-align: center; padding: 20px; color: var(--color-danger);">
                    <i class="ph ph-warning-circle" style="font-size: 24px;"></i>
                    <p style="margin-top: 8px; font-size: 14px;">加载失败，请重试</p>
                </div>
            `;
        }
    }
    
    renderFolders() {
        this.folderList.innerHTML = '';
        
        // 添加根目录选项
        this.addFolderItem({
            name: '根目录',
            path: '',
            icon: 'ph-folder-open'
        });
        
        // 添加现有文件夹
        this.folders.forEach(folder => {
            this.addFolderItem({
                name: folder.name,
                path: folder.path,
                icon: 'ph-folder'
            });
        });
        
        // 添加新建文件夹选项
        this.addFolderItem({
            name: '新建文件夹...',
            path: 'new',
            icon: 'ph-folder-plus',
            isSpecial: true
        });
    }
    
    addFolderItem(folder) {
        const item = document.createElement('div');
        item.className = 'folder-item';
        if (this.selectedPath === folder.path) {
            item.classList.add('selected');
        }
        
        item.innerHTML = `
            <i class="ph ${folder.icon}"></i>
            <div class="folder-item-info">
                <div class="folder-item-name">${folder.name}</div>
                ${folder.path && folder.path !== 'new' ? `<div class="folder-item-path">/${folder.path}</div>` : ''}
            </div>
        `;
        
        item.addEventListener('click', () => {
            this.folderList.querySelectorAll('.folder-item').forEach(el => {
                el.classList.remove('selected');
            });
            item.classList.add('selected');
            
            this.selectedPath = folder.path;
            
            if (folder.path === 'new') {
                this.newFolderContainer.classList.add('show');
                this.newFolderInput.focus();
                this.confirmBtn.disabled = !this.newFolderInput.value.trim();
            } else {
                this.newFolderContainer.classList.remove('show');
                this.confirmBtn.disabled = false;
            }
        });
        
        this.folderList.appendChild(item);
    }
    
    show() {
        this.overlay.style.display = 'flex';
        // 触发重绘以应用动画
        this.overlay.offsetHeight;
        this.overlay.classList.add('show');
        
        this.loadFolders();
    }
    
    hide() {
        this.overlay.classList.remove('show');
        setTimeout(() => {
            this.overlay.remove();
        }, 200); // 等待动画完成
    }
}