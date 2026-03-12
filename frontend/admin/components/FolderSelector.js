class FolderSelector {
    constructor(options) {
        this.options = Object.assign({
            base: '',
            title: '选择保存位置',
            onSelect: () => {}
        }, options);
        this.folderTree = [];
        this.selectedPath = ''; // Default to root
        this.init();
    }
    init() {
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
                    <div class="folder-tree-container" id="folderTreeContainer">
                        <div style="text-align: center; padding: 20px; color: var(--color-text-secondary);">
                            <i class="ph ph-spinner-gap ph-spin" style="font-size: 24px;"></i>
                            <p style="margin-top: 8px; font-size: 14px;">加载中...</p>
                        </div>
                    </div>
                    <div class="new-folder-section">
                        <button type="button" class="btn btn-text" id="toggleNewFolderBtn">
                            <i class="ph ph-folder-plus"></i> 在当前目录下新建文件夹
                        </button>
                        <div class="new-folder-input-container" id="newFolderContainer">
                            <input type="text" class="new-folder-input" id="newFolderInput" placeholder="输入新文件夹名称">
                            <button type="button" class="btn btn-primary btn-sm" id="createFolderBtn" disabled>新建</button>
                        </div>
                    </div>
                </div>
                <div class="folder-selector-footer">
                    <div class="selected-path-display" id="selectedPathDisplay">当前选择: 根目录</div>
                    <div class="footer-actions">
                        <button type="button" class="btn btn-secondary" id="folderCancelBtn">取消</button>
                        <button type="button" class="btn btn-primary" id="folderConfirmBtn">确定</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(this.overlay);
        this.overlay.style.display = 'none';
        this.treeContainer = this.overlay.querySelector('#folderTreeContainer');
        this.newFolderContainer = this.overlay.querySelector('#newFolderContainer');
        this.newFolderInput = this.overlay.querySelector('#newFolderInput');
        this.toggleNewFolderBtn = this.overlay.querySelector('#toggleNewFolderBtn');
        this.createFolderBtn = this.overlay.querySelector('#createFolderBtn');
        this.confirmBtn = this.overlay.querySelector('#folderConfirmBtn');
        this.selectedPathDisplay = this.overlay.querySelector('#selectedPathDisplay');
        this.overlay.querySelector('.folder-selector-close').addEventListener('click', () => this.hide());
        this.overlay.querySelector('#folderCancelBtn').addEventListener('click', () => this.hide());
        this.confirmBtn.addEventListener('click', () => {
            this.options.onSelect(this.selectedPath);
            this.hide();
        });
        this.toggleNewFolderBtn.addEventListener('click', () => {
            const isShowing = this.newFolderContainer.classList.contains('show');
            if (isShowing) {
                this.newFolderContainer.classList.remove('show');
            } else {
                this.newFolderContainer.classList.add('show');
                this.newFolderInput.focus();
            }
        });
        this.newFolderInput.addEventListener('input', () => {
            this.createFolderBtn.disabled = !this.newFolderInput.value.trim();
        });
        this.newFolderInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !this.createFolderBtn.disabled) {
                this.createFolder();
            }
        });
        this.createFolderBtn.addEventListener('click', () => this.createFolder());
        this.overlay.addEventListener('click', (e) => {
            if (e.target === this.overlay) {
                this.hide();
            }
        });
    }
    async loadFolders() {
        try {
            const data = await PushFileAuth.apiGet('/api/folders/tree', { base: this.options.base || '' });
            if (!data || data.ok !== true) {
                throw new Error((data && data.detail) || 'Failed to load folders');
            }
            this.folderTree = data.tree || [];
            this.renderTree();
        } catch (error) {
            console.error('Error loading folders:', error);
            this.treeContainer.innerHTML = `
                <div style="text-align: center; padding: 20px; color: var(--color-danger);">
                    <i class="ph ph-warning-circle" style="font-size: 24px;"></i>
                    <p style="margin-top: 8px; font-size: 14px;">加载失败，请重试</p>
                </div>
            `;
        }
    }
    renderTree() {
        this.treeContainer.innerHTML = '';
        const rootNode = this.createTreeNode({
            name: '根目录',
            path: '',
            children: this.folderTree
        }, true);
        this.treeContainer.appendChild(rootNode);
        if (this.selectedPath === '') {
            const rootContent = rootNode.querySelector('.tree-node-content');
            if (rootContent) rootContent.classList.add('selected');
        }
    }
    createTreeNode(folder, isRoot = false) {
        const node = document.createElement('div');
        node.className = 'tree-node';
        const hasChildren = folder.children && folder.children.length > 0;
        const content = document.createElement('div');
        content.className = 'tree-node-content';
        if (this.selectedPath === folder.path) {
            content.classList.add('selected');
        }
        const depth = isRoot ? 0 : (folder.path.match(/\//g) || []).length + 1;
        content.style.paddingLeft = `${depth * 20 + 12}px`;
        const toggleIcon = document.createElement('i');
        toggleIcon.className = `ph ph-caret-${hasChildren ? 'down' : 'right'} tree-toggle`;
        if (!hasChildren) toggleIcon.style.visibility = 'hidden';
        const folderIcon = document.createElement('i');
        folderIcon.className = `ph ${isRoot ? 'ph-hard-drives' : 'ph-folder'} tree-icon`;
        const nameSpan = document.createElement('span');
        nameSpan.className = 'tree-name';
        nameSpan.textContent = folder.name;
        content.appendChild(toggleIcon);
        content.appendChild(folderIcon);
        content.appendChild(nameSpan);
        node.appendChild(content);
        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'tree-children';
        if (hasChildren) {
            folder.children.forEach(child => {
                childrenContainer.appendChild(this.createTreeNode(child));
            });
        }
        node.appendChild(childrenContainer);
        content.addEventListener('click', (e) => {
            if (e.target === toggleIcon && hasChildren) {
                e.stopPropagation();
                const isExpanded = toggleIcon.classList.contains('ph-caret-down');
                if (isExpanded) {
                    toggleIcon.classList.replace('ph-caret-down', 'ph-caret-right');
                    childrenContainer.style.display = 'none';
                } else {
                    toggleIcon.classList.replace('ph-caret-right', 'ph-caret-down');
                    childrenContainer.style.display = 'block';
                }
                return;
            }
            this.treeContainer.querySelectorAll('.tree-node-content').forEach(el => {
                el.classList.remove('selected');
            });
            content.classList.add('selected');
            this.selectedPath = folder.path;
            this.selectedPathDisplay.textContent = `当前选择: ${folder.path ? '/' + folder.path : '根目录'}`;
            this.newFolderContainer.classList.remove('show');
            this.newFolderInput.value = '';
            this.createFolderBtn.disabled = true;
        });
        return node;
    }
    async createFolder() {
        const folderName = this.newFolderInput.value.trim();
        if (!folderName) return;
        this.createFolderBtn.disabled = true;
        this.createFolderBtn.innerHTML = '<i class="ph ph-spinner-gap ph-spin"></i>';
        try {
            const parent = (this.selectedPath || '').replace(/^\/+|\/+$/g, '');
            const name = folderName.replace(/^\/+|\/+$/g, '');
            const path = [parent, name].filter(Boolean).join('/');
            const data = await PushFileAuth.apiPost(
                '/api/folders/create',
                JSON.stringify({ path }),
                { base: this.options.base || '' }
            );
            if (!data || data.ok !== true) {
                alert(`创建失败: ${(data && data.detail) || '未知错误'}`);
                return;
            }
            this.selectedPath = data.path || path;
            this.selectedPathDisplay.textContent = `当前选择: ${this.selectedPath ? '/' + this.selectedPath : '根目录'}`;
            await this.loadFolders();
            this.newFolderInput.value = '';
            this.newFolderContainer.classList.remove('show');
        } catch (error) {
            console.error('Error creating folder:', error);
            alert('创建文件夹失败，请检查网络连接');
        } finally {
            this.createFolderBtn.disabled = false;
            this.createFolderBtn.textContent = '新建';
        }
    }
    show() {
        this.overlay.style.display = 'flex';
        this.overlay.style.pointerEvents = 'auto';
        this.overlay.offsetHeight;
        this.overlay.classList.add('show');
        this.loadFolders();
    }
    hide() {
        this.overlay.style.pointerEvents = 'none';
        this.overlay.classList.remove('show');
        setTimeout(() => {
            this.overlay.remove();
        }, 200);
    }
}
