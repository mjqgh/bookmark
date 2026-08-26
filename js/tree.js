/**
 * 文件夹树模块 - 管理左侧文件夹树
 */

const Tree = {
    data: null,
    expandedNodes: new Set(),
    selectedFolderId: null,
    searchQuery: '',
    onSelectFolder: null,
    onUpdate: null,
    tooltipElement: null,
    treeSortables: [],
    contextMenuFolderId: null,
    justDragged: false,
    
    /**
     * 初始化
     */
    init(data, callbacks) {
        this.data = data;
        this.onSelectFolder = callbacks.onSelectFolder || function() {};
        this.onUpdate = callbacks.onUpdate || function() {};
        
        // 创建全局 tooltip 元素
        this.createTooltip();
        
        // 从 localStorage 恢复用户上次展开/折叠状态（移动端 / 桌面端 共用）
        const savedExpanded = localStorage.getItem('tree_expanded_ids');
        if (savedExpanded) {
            try {
                JSON.parse(savedExpanded).forEach(id => this.expandedNodes.add(id));
            } catch (e) {
                this.expandedNodes.clear();
            }
        }
        
        // 默认只展开第一层（无论移动端还是桌面端）
        if (this.data.folders.length > 0) {
            // 如果用户此前从未展开过任何目录（expandedNodes 为空或无有效顶层节点），
            // 则帮他展开第一层，避免第一屏空空如也
            const anyTopExpanded = this.data.folders.some(f => this.expandedNodes.has(f.id));
            if (!anyTopExpanded) {
                this.data.folders.forEach(f => this.expandedNodes.add(f.id));
            }
            
            // 自动选择第一个有收藏的文件夹
            const firstFolderWithBookmarks = this.findFirstFolderWithBookmarks();
            this.selectedFolderId = firstFolderWithBookmarks || this.data.folders[0].id;
            
            // 展开选中项的父级路径，让用户能看见它所在的位置
            this.expandParentPath(this.selectedFolderId);
        }
        
        this.bindTreeEvents();
        this.render();
        
        // 通知外部初始选择
        if (this.selectedFolderId) {
            this.onSelectFolder(this.selectedFolderId);
        }
    },
    
    /**
     * 绑定文件夹树级别的事件（右键菜单）
     */
    bindTreeEvents() {
        // 文件夹树右键菜单项点击
        document.getElementById('treeContextMenu').addEventListener('click', (e) => {
            const action = e.target.closest('.context-menu-item')?.dataset?.action;
            if (!action) return;
            
            this.handleTreeContextMenuAction(action);
            this.hideTreeContextMenu();
        });
        
        // 全局：点击其他地方关闭文件夹右键菜单
        document.addEventListener('click', (e) => {
            const menu = document.getElementById('treeContextMenu');
            if (menu.classList.contains('active') && !menu.contains(e.target)) {
                this.hideTreeContextMenu();
            }
        });
        
        // 全局：Escape 关闭文件夹右键菜单
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hideTreeContextMenu();
            }
        });
    },
    
    /**
     * 显示文件夹树右键菜单
     */
    showTreeContextMenu(x, y, folderId) {
        const menu = document.getElementById('treeContextMenu');
        this.contextMenuFolderId = folderId;
        menu.classList.add('active');
        
        // 防止菜单超出视口
        const rect = menu.getBoundingClientRect();
        if (x + rect.width > window.innerWidth) {
            x = window.innerWidth - rect.width - 10;
        }
        if (y + rect.height > window.innerHeight) {
            y = window.innerHeight - rect.height - 10;
        }
        
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
    },
    
    /**
     * 隐藏文件夹树右键菜单
     */
    hideTreeContextMenu() {
        document.getElementById('treeContextMenu').classList.remove('active');
        this.contextMenuFolderId = null;
    },
    
    /**
     * 处理文件夹树右键菜单操作
     */
    handleTreeContextMenuAction(action) {
        if (!this.contextMenuFolderId) return;
        const folderId = this.contextMenuFolderId;
        
        switch (action) {
            case 'create-bookmark-here':
                // 在该文件夹下创建收藏页
                Bookmarks.openBookmarkModal();
                setTimeout(() => {
                    const folderSelect = document.getElementById('bookmarkFolder');
                    folderSelect.value = folderId;
                }, 0);
                break;
            case 'create-folder-here':
                // 在该文件夹下创建子文件夹
                Bookmarks.openFolderModal();
                setTimeout(() => {
                    const parentSelect = document.getElementById('parentFolder');
                    parentSelect.value = folderId;
                }, 0);
                break;
            case 'edit':
                // 编辑该文件夹
                Bookmarks.openFolderModal(folderId);
                break;
            case 'delete-folder':
                // 删除该文件夹
                const folder = this.findFolder(folderId);
                if (!folder) return;
                const bookmarkCount = this.countBookmarks(folderId);
                const subfolderCount = this.countSubfolders(folder);
                if (confirm(`确定删除"${folder.name}"？\n包含 ${bookmarkCount} 个收藏和 ${subfolderCount} 个子文件夹。`)) {
                    this.deleteFolder(folderId);
                    Storage.save(this.data);
                    this.onUpdate();
                    App.showToast('文件夹已删除', 'success');
                }
                break;
        }
    },
    
    /**
     * 创建全局浮层 tooltip
     */
    createTooltip() {
        this.tooltipElement = document.createElement('div');
        this.tooltipElement.className = 'tree-tooltip-float';
        document.body.appendChild(this.tooltipElement);
    },
    
    /**
     * 显示 tooltip
     */
    showTooltip(e, text) {
        if (!this.tooltipElement) this.createTooltip();
        this.tooltipElement.textContent = text;
        this.tooltipElement.classList.add('visible');
        this.moveTooltip(e);
    },
    
    /**
     * 移动 tooltip 位置
     */
    moveTooltip(e) {
        if (!this.tooltipElement) return;
        const padding = 10;
        let x = e.clientX + padding;
        let y = e.clientY + padding;
        
        // 防止超出视口
        const rect = this.tooltipElement.getBoundingClientRect();
        if (x + rect.width > window.innerWidth) {
            x = e.clientX - rect.width - padding;
        }
        if (y + rect.height > window.innerHeight) {
            y = e.clientY - rect.height - padding;
        }
        
        this.tooltipElement.style.left = x + 'px';
        this.tooltipElement.style.top = y + 'px';
    },
    
    /**
     * 隐藏 tooltip
     */
    hideTooltip() {
        if (this.tooltipElement) {
            this.tooltipElement.classList.remove('visible');
        }
    },
    
    /**
     * 持久化展开状态到 localStorage
     */
    persistExpanded() {
        try {
            localStorage.setItem('tree_expanded_ids', JSON.stringify([...this.expandedNodes]));
        } catch (e) {
            // ignore
        }
    },

    /**
     * 渲染树
     */
    render() {
        // 每次渲染前把展开状态写回 localStorage，保留用户最后一次折叠/展开结果
        this.persistExpanded();
        
        const container = document.getElementById('folderTree');
        container.innerHTML = '';
        
        if (this.data.folders.length === 0) {
            container.innerHTML = `
                <div class="tree-empty-state">
                    <div class="tree-empty-icon">📂</div>
                    <div class="tree-empty-text">暂无收藏夹</div>
                    <div class="tree-empty-actions">
                        <button class="btn btn-primary" id="emptyCreateFolder">
                            <span>📁</span>
                            <span>创建收藏夹</span>
                        </button>
                        <button class="btn btn-default" id="emptyCreateBookmark">
                            <span>☆</span>
                            <span>创建收藏页</span>
                        </button>
                    </div>
                </div>
            `;
            document.getElementById('emptyCreateFolder').addEventListener('click', () => {
                Bookmarks.openFolderModal();
            });
            document.getElementById('emptyCreateBookmark').addEventListener('click', () => {
                if (this.data.folders.length === 0) {
                    App.showToast(App.i18n('emptyFolderTip'), 'error');
                    return;
                }
                Bookmarks.openBookmarkModal();
            });
            return;
        }
        
        this.data.folders.forEach(folder => {
            container.appendChild(this.renderNode(folder, 0));
        });
        
        // 渲染后初始化拖拽排序
        this.initTreeSortable();
    },
    
    /**
     * 渲染单个节点
     */
    renderNode(folder, depth) {
        const hasChildren = folder.children && folder.children.length > 0;
        const bookmarkCount = this.countBookmarks(folder.id);
        const subfolderCount = this.countSubfolders(folder);
        const isExpanded = this.expandedNodes.has(folder.id);
        const isSelected = this.selectedFolderId === folder.id;
        // 非空目录：有子文件夹 或 有收藏页 → 需要显示展开/折叠箭头
        const hasContent = hasChildren || bookmarkCount > 0;
        
        // 检查搜索过滤
        if (this.searchQuery && !this.nodeMatchesSearch(folder)) {
            return document.createDocumentFragment();
        }
        
        const node = document.createElement('div');
        node.className = 'tree-node';
        node.dataset.folderId = folder.id;
        
        // 节点头部
        const header = document.createElement('div');
        header.className = 'tree-node-header';
        if (hasContent) {
            header.classList.add('has-children');
        }
        if (isExpanded && hasContent) {
            header.classList.add('expanded');
        }
        if (isSelected) {
            header.classList.add('selected');
        }
        
        // 展开/折叠箭头
        const toggle = document.createElement('span');
        toggle.className = 'tree-toggle';
        if (!hasContent) {
            toggle.classList.add('empty');
        }
        toggle.innerHTML = '▶';
        toggle.style.transform = isExpanded && hasContent ? 'rotate(90deg)' : '';
        header.appendChild(toggle);

        // 拖拽手柄（移动端显示，与 .tree-toggle 同一 18px 位置）
        const dragHandle = document.createElement('span');
        dragHandle.className = 'tree-node-drag';
        dragHandle.innerHTML = '⋮⋮';
        dragHandle.title = '拖动排序';
        header.appendChild(dragHandle);
        
        // 文件夹图标
        const icon = document.createElement('span');
        icon.className = 'tree-icon ' + (isExpanded ? 'folder-open' : 'folder');
        icon.textContent = isExpanded ? '📂' : '📁';
        header.appendChild(icon);
        
        // 文件夹名称
        const label = document.createElement('span');
        label.className = 'tree-label';
        label.textContent = folder.name;
        header.appendChild(label);
        
        // 右侧内联提示文案（简短形式）
        if (hasChildren || bookmarkCount > 0) {
            const meta = document.createElement('span');
            meta.className = 'tree-node-meta';
            let parts = [];
            if (bookmarkCount > 0) {
                parts.push(`${bookmarkCount}收藏`);
            }
            if (subfolderCount > 0) {
                parts.push(`${subfolderCount}夹`);
            }
            meta.textContent = parts.join(' ');
            header.appendChild(meta);
        }
        
        // 点击事件
        header.addEventListener('click', (e) => {
            e.stopPropagation();
            
            // 拖拽刚结束，拦截 click 避免误触发折叠/展开
            if (this.justDragged) {
                e.preventDefault();
                return;
            }
            
            // 展开/折叠策略：
            // - 移动端：一律切换（因为内联收藏页依赖展开状态显示，叶子文件夹也要能收回去）
            // - 桌面端：只有有子文件夹时才切换，保持「选中文件夹在右侧展示内容」的直觉
            const isMobileView = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
            if (isMobileView || hasChildren || bookmarkCount > 0) {
                this.toggleExpand(folder.id);
            }
            
            // 选中文件夹
            this.selectFolder(folder.id);
        });
        
        // 右键菜单
        header.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.selectFolder(folder.id);
            this.showTreeContextMenu(e.clientX, e.clientY, folder.id);
        });
        
        // 长按打开文件夹菜单（移动端）
        let folderPressTimer = null;
        const startFolderPress = (ev) => {
            // 如果 Sortable 正在拖拽，不触发长按菜单
            if (this.justDragged) return;
            // 按住拖拽手柄 ⋮⋮ 时不触发长按菜单，避免与拖拽冲突
            if (ev.target && ev.target.closest('.tree-node-drag')) return;
            folderPressTimer = setTimeout(() => {
                if (this.justDragged) return;
                const rect = header.getBoundingClientRect();
                this.selectFolder(folder.id);
                this.showTreeContextMenu(rect.left + 10, rect.top + rect.height / 2, folder.id);
            }, 500);
        };
        const cancelFolderPress = () => {
            if (folderPressTimer) { clearTimeout(folderPressTimer); folderPressTimer = null; }
        };
        header.addEventListener('touchstart', startFolderPress, { passive: true });
        header.addEventListener('mousedown', startFolderPress);
        header.addEventListener('touchend', cancelFolderPress);
        header.addEventListener('touchmove', cancelFolderPress);
        header.addEventListener('mouseup', cancelFolderPress);
        header.addEventListener('mouseleave', cancelFolderPress);
        
        node.appendChild(header);
        
        // 子节点
        if (hasChildren) {
            const children = document.createElement('div');
            children.className = 'tree-children';
            children.dataset.parentId = folder.id;
            if (isExpanded) {
                children.classList.add('expanded');
            }
            
            folder.children.forEach(child => {
                children.appendChild(this.renderNode(child, depth + 1));
            });
            
            node.appendChild(children);
        }

        // 移动端：展开时在文件夹下面内联展示其下的收藏页
        if (isExpanded && bookmarkCount > 0) {
            const bookmarkList = document.createElement('div');
            bookmarkList.className = 'tree-bookmarks';
            bookmarkList.dataset.parentId = folder.id;
            bookmarkList.style.paddingLeft = '18px';

            const order = (this.data.folderOrder && this.data.folderOrder[folder.id]) || [];
            let bookmarksInFolder = this.data.bookmarks.filter(b => b.folderId === folder.id);
            // 搜索时：仅保留标题或 URL 匹配的收藏
            if (this.searchQuery) {
                bookmarksInFolder = bookmarksInFolder.filter(b =>
                    b.title.toLowerCase().includes(this.searchQuery) ||
                    b.url.toLowerCase().includes(this.searchQuery)
                );
            }
            // 按 folderOrder 排序
            bookmarksInFolder.sort((a, b) => {
                const ia = order.indexOf(a.id);
                const ib = order.indexOf(b.id);
                if (ia === -1 && ib === -1) return 0;
                if (ia === -1) return 1;
                if (ib === -1) return -1;
                return ia - ib;
            });

            // 过滤后无收藏，就不渲染这个容器（避免一个空的 .tree-bookmarks 占位）
            if (bookmarksInFolder.length === 0) {
                // 不再 return node，后面仍可能要添加其它内容；直接跳掉 appendChild
            } else {
            bookmarksInFolder.forEach(bookmark => {
                const item = document.createElement('div');
                item.className = 'tree-bookmark-item';
                item.dataset.bookmarkId = bookmark.id;

                // 拖拽手柄（移动端：用于排序）
                const dragHandle = document.createElement('span');
                dragHandle.className = 'tree-bookmark-drag';
                dragHandle.innerHTML = '⋮⋮';
                dragHandle.title = '拖动排序';
                item.appendChild(dragHandle);

                // 文件图标（与收藏夹的📁图标完全对齐：font-size 14, margin-right 6）
                const icon = document.createElement('span');
                icon.className = 'tree-icon tree-bookmark-file-icon';
                icon.textContent = '📄';
                item.appendChild(icon);

                // 网站小 favicon + 标题（容器起点与 .tree-label 一致）
                const titleWrap = document.createElement('span');
                titleWrap.className = 'tree-bookmark-title-wrap';

                try {
                    const urlObj = new URL(bookmark.url);
                    const domain = urlObj.hostname;
                    const firstChar = (bookmark.title || domain).charAt(0).toUpperCase();

                    // 多源 favicon fallback：DuckDuckGo → Google → 直连域名
                    const faviconSources = [
                        `https://icons.duckduckgo.com/ip3/${domain}.ico`,
                        `https://www.google.com/s2/favicons?domain=${domain}&sz=64`,
                        `${urlObj.protocol}//${domain}/favicon.ico`
                    ];

                    const fav = document.createElement('img');
                    fav.className = 'tree-bookmark-title-favicon';
                    fav.alt = '';
                    fav.loading = 'lazy';

                    // 逐级 fallback：每个源失败后尝试下一个，全部失败则显示首字母
                    let srcIdx = 0;
                    const tryNext = () => {
                        if (srcIdx < faviconSources.length) {
                            fav.src = faviconSources[srcIdx++];
                        } else {
                            // 所有源都失败了，显示首字母占位
                            const fb = document.createElement('span');
                            fb.className = 'tree-bookmark-title-favicon-fallback';
                            fb.textContent = firstChar;
                            titleWrap.insertBefore(fb, titleWrap.firstChild);
                            fav.remove();
                        }
                    };
                    fav.onerror = tryNext;
                    tryNext();  // 开始尝试第一个源

                    titleWrap.appendChild(fav);
                } catch (err) {
                    // URL 解析失败，直接用首字母
                    const firstChar = (bookmark.title || '?').charAt(0).toUpperCase();
                    const fb = document.createElement('span');
                    fb.className = 'tree-bookmark-title-favicon-fallback';
                    fb.textContent = firstChar;
                    titleWrap.appendChild(fb);
                }

                const title = document.createElement('span');
                title.className = 'tree-bookmark-title';
                title.textContent = bookmark.title || bookmark.url;
                titleWrap.appendChild(title);

                item.appendChild(titleWrap);

                // 点击中间区域打开链接
                item.addEventListener('click', (e) => {
                    if (e.target.closest('.tree-bookmark-drag')) {
                        return;
                    }
                    e.stopPropagation();
                    window.open(bookmark.url, '_blank');
                });

                // 长按：弹出右键菜单（移动端操作入口）
                let longPressTimer = null;
                const startPress = (ev) => {
                    // 如果 Sortable 正在拖拽，不触发长按菜单
                    if (this.justDragged) return;
                    // 按住拖拽手柄 ⋮⋮ 时不触发长按菜单，避免与拖拽冲突
                    if (ev.target && ev.target.closest('.tree-bookmark-drag')) return;
                    longPressTimer = setTimeout(() => {
                        // 再次检查：拖拽过程中可能改变状态
                        if (this.justDragged) return;
                        const rect = item.getBoundingClientRect();
                        Bookmarks.contextMenuBookmarkId = bookmark.id;
                        Bookmarks.showContextMenu(rect.left + rect.width / 2, rect.top + rect.height / 2);
                    }, 500);
                };
                const cancelPress = () => {
                    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
                };
                item.addEventListener('touchstart', startPress, { passive: true });
                item.addEventListener('mousedown', startPress);
                item.addEventListener('touchend', cancelPress);
                item.addEventListener('touchmove', cancelPress);
                item.addEventListener('mouseup', cancelPress);
                item.addEventListener('mouseleave', cancelPress);

                bookmarkList.appendChild(item);
            });

                node.appendChild(bookmarkList);
            }
        }
        
        return node;
    },
    
    /**
     * 切换展开/折叠
     */
    toggleExpand(folderId) {
        if (this.expandedNodes.has(folderId)) {
            this.expandedNodes.delete(folderId);
        } else {
            this.expandedNodes.add(folderId);
        }
        this.render();
    },
    
    /**
     * 选中文件夹
     */
    selectFolder(folderId) {
        this.selectedFolderId = folderId;
        this.render();
        this.onSelectFolder(folderId);
    },
    
    /**
     * 搜索/过滤
     */
    search(query) {
        this.searchQuery = query.toLowerCase();
        if (this.searchQuery) {
            // 展开所有匹配的节点
            this.expandMatchingNodes();
        }
        this.render();
    },
    
    /**
     * 展开匹配搜索的节点
     */
    expandMatchingNodes() {
        const matchNodes = (folders) => {
            for (const folder of folders) {
                if (this.nodeMatchesSearch(folder)) {
                    this.expandedNodes.add(folder.id);
                }
                if (folder.children && folder.children.length > 0) {
                    matchNodes(folder.children);
                }
            }
        };
        matchNodes(this.data.folders);
    },
    
    /**
     * 检查节点是否匹配搜索
     */
    nodeMatchesSearch(folder) {
        if (!this.searchQuery) return true;
        
        // 检查文件夹名
        if (folder.name.toLowerCase().includes(this.searchQuery)) {
            return true;
        }
        
        // 检查子文件夹
        if (folder.children && folder.children.length > 0) {
            for (const child of folder.children) {
                if (this.nodeMatchesSearch(child)) {
                    return true;
                }
            }
        }
        
        // 检查收藏标题或 URL
        const bookmarks = this.data.bookmarks.filter(b => b.folderId === folder.id);
        for (const bm of bookmarks) {
            if (bm.title.toLowerCase().includes(this.searchQuery) ||
                bm.url.toLowerCase().includes(this.searchQuery)) {
                return true;
            }
        }
        
        return false;
    },
    
    /**
     * 递归计算收藏数量
     */
    countBookmarks(folderId) {
        return this.data.bookmarks.filter(b => b.folderId === folderId).length;
    },
    
    /**
     * 递归计算子文件夹数量
     */
    countSubfolders(folder) {
        if (!folder.children) return 0;
        return folder.children.length;
    },
    
    /**
     * 查找第一个有收藏的文件夹
     */
    findFirstFolderWithBookmarks(folders = this.data.folders) {
        for (const folder of folders) {
            const bookmarkCount = this.countBookmarks(folder.id);
            if (bookmarkCount > 0) {
                return folder.id;
            }
            if (folder.children && folder.children.length > 0) {
                const found = this.findFirstFolderWithBookmarks(folder.children);
                if (found) return found;
            }
        }
        return null;
    },
    
    /**
     * 展开指定文件夹的父级路径
     */
    expandParentPath(folderId, folders = this.data.folders, path = []) {
        for (const folder of folders) {
            const currentPath = [...path, folder.id];
            if (folder.id === folderId) {
                // 展开路径上的所有父级
                path.forEach(id => this.expandedNodes.add(id));
                return true;
            }
            if (folder.children && folder.children.length > 0) {
                if (this.expandParentPath(folderId, folder.children, currentPath)) {
                    return true;
                }
            }
        }
        return false;
    },
    
    /**
     * 查找文件夹
     */
    findFolder(folderId, folders = this.data.folders) {
        for (const folder of folders) {
            if (folder.id === folderId) {
                return folder;
            }
            if (folder.children) {
                const found = this.findFolder(folderId, folder.children);
                if (found) return found;
            }
        }
        return null;
    },
    
    /**
     * 添加文件夹
     */
    addFolder(name, parentId = null) {
        const newFolder = {
            id: Storage.generateId('folder'),
            name: name,
            children: []
        };
        
        if (parentId) {
            const parent = this.findFolder(parentId);
            if (parent) {
                parent.children = parent.children || [];
                parent.children.push(newFolder);
                this.expandedNodes.add(parentId);
            }
        } else {
            this.data.folders.push(newFolder);
        }
        
        this.onUpdate();
        this.render();
        return newFolder;
    },
    
    /**
     * 重命名文件夹
     */
    renameFolder(folderId, newName) {
        const folder = this.findFolder(folderId);
        if (folder) {
            folder.name = newName;
            this.onUpdate();
            this.render();
        }
    },
    
    /**
     * 删除文件夹及其所有子文件夹和收藏
     */
    deleteFolder(folderId) {
        const folder = this.findFolder(folderId);
        if (!folder) return false;
        
        // 收集所有要删除的文件夹 ID
        const idsToDelete = [];
        const collectIds = (f) => {
            idsToDelete.push(f.id);
            if (f.children) {
                f.children.forEach(collectIds);
            }
        };
        collectIds(folder);
        
        // 删除相关收藏
        this.data.bookmarks = this.data.bookmarks.filter(b => !idsToDelete.includes(b.folderId));
        
        // 从树中删除
        const removeFromTree = (folders) => {
            const index = folders.findIndex(f => f.id === folderId);
            if (index !== -1) {
                folders.splice(index, 1);
                return true;
            }
            for (const f of folders) {
                if (f.children && removeFromTree(f.children)) {
                    return true;
                }
            }
            return false;
        };
        removeFromTree(this.data.folders);
        
        // 清除展开状态
        idsToDelete.forEach(id => this.expandedNodes.delete(id));
        
        if (this.selectedFolderId === folderId) {
            this.selectedFolderId = null;
        }
        
        this.onUpdate();
        this.render();
        return true;
    },
    
    /**
     * 获取所有文件夹列表（扁平，用于下拉选择）
     */
    getFolderList() {
        const list = [];
        const traverse = (folders, depth = 0) => {
            folders.forEach(f => {
                list.push({
                    id: f.id,
                    name: f.name,
                    path: '　'.repeat(depth) + (depth > 0 ? '└ ' : '') + f.name,
                    depth: depth
                });
                if (f.children) {
                    traverse(f.children, depth + 1);
                }
            });
        };
        traverse(this.data.folders);
        return list;
    },
    
    /**
     * 初始化文件夹树的拖拽排序
     * 为顶级容器和每个 .tree-children 都创建 Sortable 实例，共享 group 实现跨层级移动
     */
    initTreeSortable() {
        if (typeof Sortable === 'undefined') return;
        
        // 销毁旧实例
        this.treeSortables.forEach(s => {
            try { s.destroy(); } catch (e) {}
        });
        this.treeSortables = [];
        
        // 顶级容器 + 所有 .tree-children
        const containers = [
            document.getElementById('folderTree'),
            ...document.querySelectorAll('.tree-children')
        ];
        
        containers.forEach(container => {
            // 标记顶级容器的 parent-id 为空（根目录）
            if (container.id === 'folderTree') {
                container.dataset.parentId = '';
            }
            
            const sortable = new Sortable(container, {
                group: 'tree-folders',
                animation: 150,
                handle: '.tree-node-drag',
                draggable: '.tree-node',
                forceFallback: true,
                delay: 200,  // 延迟 200ms 才开始拖拽，区分点击与拖拽
                delayOnTouchOnly: true,
                ghostClass: 'tree-sortable-ghost',
                chosenClass: 'tree-sortable-chosen',
                dragClass: 'tree-sortable-drag',
                onStart: () => {
                    this.justDragged = true;
                },
                onEnd: (evt) => {
                    this.handleTreeDragEnd(evt);
                    // 延迟重置，避免 click 事件误触发折叠/展开
                    setTimeout(() => { this.justDragged = false; }, 300);
                }
            });
            this.treeSortables.push(sortable);
        });
        
        // 为所有 .tree-bookmarks 容器添加拖拽排序（移动端内联收藏页）
        document.querySelectorAll('.tree-bookmarks').forEach(container => {
            const folderId = container.dataset.parentId;
            if (!folderId) return;
            
            const bmSortable = new Sortable(container, {
                animation: 150,
                handle: '.tree-bookmark-drag',
                draggable: '.tree-bookmark-item',
                forceFallback: true,
                ghostClass: 'tree-bookmark-ghost',
                chosenClass: 'tree-bookmark-chosen',
                dragClass: 'tree-bookmark-dragging',
                onStart: () => {
                    this.justDragged = true;
                },
                onEnd: (evt) => {
                    const oldIndex = evt.oldIndex;
                    const newIndex = evt.newIndex;
                    setTimeout(() => { this.justDragged = false; }, 300);
                    
                    if (evt.from === evt.to && oldIndex === newIndex) return;
                    
                    // 更新 folderOrder
                    const order = Storage.getFolderOrder(this.data, folderId);
                    const [movedId] = order.splice(oldIndex, 1);
                    order.splice(newIndex, 0, movedId);
                    Storage.updateFolderOrder(this.data, folderId, order);
                    App.showToast('排序已保存', 'success');
                }
            });
            this.treeSortables.push(bmSortable);
        });
    },
    
    /**
     * 处理文件夹树拖拽结束
     */
    handleTreeDragEnd(evt) {
        const folderId = evt.item.dataset.folderId;
        const fromParentId = evt.from.dataset.parentId || ''; // 空 = 根级
        const toParentId = evt.to.dataset.parentId || '';
        const oldIndex = evt.oldIndex;
        const newIndex = evt.newIndex;
        
        // 没有实际移动
        if (evt.from === evt.to && oldIndex === newIndex) {
            return;
        }
        
        // 禁止将文件夹拖入自己或自己的子文件夹（会形成循环）
        if (toParentId && (folderId === toParentId || this.isDescendant(folderId, toParentId))) {
            App.showToast('不能将文件夹移动到其自身或子文件夹内', 'error');
            this.render();
            return;
        }
        
        // 更新数据结构
        const moved = this.moveFolderInData(folderId, fromParentId, toParentId, newIndex);
        if (!moved) {
            this.render();
            return;
        }
        
        // 展开目标父级，让用户看到拖入结果
        if (toParentId) {
            this.expandedNodes.add(toParentId);
        }
        
        this.onUpdate();
        Storage.save(this.data);
        this.render();
        App.showToast('已移动文件夹', 'success');
    },
    
    /**
     * 在数据中移动文件夹
     */
    moveFolderInData(folderId, fromParentId, toParentId, newIndex) {
        // 找到源父级的 children 数组
        const fromParent = fromParentId ? this.findFolder(fromParentId) : null;
        const fromChildren = fromParent ? (fromParent.children || []) : this.data.folders;
        const folderIndex = fromChildren.findIndex(f => f.id === folderId);
        if (folderIndex === -1) return false;
        
        // 从源父级移除
        const [moved] = fromChildren.splice(folderIndex, 1);
        
        // 找到目标父级的 children 数组（确保存在）
        let toChildren;
        if (toParentId) {
            const toParent = this.findFolder(toParentId);
            if (!toParent) return false;
            if (!toParent.children) toParent.children = [];
            toChildren = toParent.children;
        } else {
            toChildren = this.data.folders;
        }
        
        // 修正索引边界（同级移动且向上拖时索引需 -1）
        let targetIndex = newIndex;
        if (fromParentId === toParentId && folderIndex < newIndex) {
            targetIndex = newIndex - 1;
        }
        targetIndex = Math.max(0, Math.min(targetIndex, toChildren.length));
        
        toChildren.splice(targetIndex, 0, moved);
        return true;
    },
    
    /**
     * 检查 targetId 是否是 folderId 的后代
     */
    isDescendant(folderId, targetId) {
        const folder = this.findFolder(folderId);
        if (!folder || !folder.children) return false;
        for (const child of folder.children) {
            if (child.id === targetId) return true;
            if (this.isDescendant(child.id, targetId)) return true;
        }
        return false;
    },
    
    /**
     * 递归展开所有文件夹（用于移动端，保证内联收藏可见）
     */
    expandAllFolders(folders = this.data.folders) {
        folders.forEach(f => {
            this.expandedNodes.add(f.id);
            if (f.children && f.children.length > 0) {
                this.expandAllFolders(f.children);
            }
        });
    },

    /**
     * 从导入数据重建树
     */
    rebuildTree(newFolders, newBookmarks) {
        this.data.folders = newFolders;
        this.data.bookmarks = newBookmarks;
        this.expandedNodes.clear();
        localStorage.removeItem('tree_expanded_ids');
        this.data.folders.forEach(f => this.expandedNodes.add(f.id));
        if (this.data.folders.length > 0) {
            this.selectedFolderId = this.data.folders[0].id;
        }
        this.onUpdate();
        this.render();
    }
};
