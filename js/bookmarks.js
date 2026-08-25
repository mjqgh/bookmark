/**
 * 收藏管理模块 - 管理右侧收藏列表（含拖拽排序、右键菜单）
 */

const Bookmarks = {
    data: null,
    currentFolderId: null,
    editingBookmarkId: null,
    onUpdate: null,
    sortable: null,
    contextMenuBookmarkId: null,
    justDragged: false,
    
    /**
     * 初始化
     */
    init(data, callbacks) {
        this.data = data;
        this.onUpdate = callbacks.onUpdate || function() {};
        this.bindEvents();
        this.initSortable();
    },
    
    /**
     * 初始化 Sortable.js 拖拽
     */
    initSortable() {
        const list = document.getElementById('bookmarkList');
        if (!list || typeof Sortable === 'undefined') return;
        
        this.sortable = new Sortable(list, {
            animation: 150,
            filter: '.bookmark-actions, .bookmark-delete, .context-menu',
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            dragClass: 'sortable-drag',
            onStart: () => {
                this.justDragged = true;
            },
            onEnd: (evt) => {
                // 保存新排序
                this.saveOrderAfterDrag(evt.oldIndex, evt.newIndex);
                // 延迟重置，防止 click 事件触发打开链接
                setTimeout(() => { this.justDragged = false; }, 300);
            }
        });

        // 拖拽结束后 Sortable 会在 mouseup 派发 click，这里在捕获阶段拦截
        list.addEventListener('click', (e) => {
            if (this.justDragged) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
        }, true);
    },
    
    /**
     * 拖拽后保存排序
     */
    saveOrderAfterDrag(oldIndex, newIndex) {
        if (!this.currentFolderId) return;
        
        const bookmarkIds = Storage.getFolderOrder(this.data, this.currentFolderId);
        const [movedId] = bookmarkIds.splice(oldIndex, 1);
        bookmarkIds.splice(newIndex, 0, movedId);
        
        Storage.updateFolderOrder(this.data, this.currentFolderId, bookmarkIds);
        App.showToast('排序已保存', 'success');
    },
    
    /**
     * 绑定事件
     */
    bindEvents() {
        // 添加收藏按钮
        document.getElementById('btnAddBookmark').addEventListener('click', () => {
            this.openBookmarkModal();
        });
        
        // 添加文件夹按钮
        document.getElementById('btnAddFolder').addEventListener('click', () => {
            this.openFolderModal();
        });
        
        // 保存收藏
        document.getElementById('saveBookmark').addEventListener('click', () => {
            this.saveBookmark();
        });
        
        // 保存文件夹
        document.getElementById('saveFolder').addEventListener('click', () => {
            this.saveFolder();
        });
        
        // 确认移动收藏按钮
        const confirmMoveBtn = document.getElementById('confirmMoveBookmark');
        if (confirmMoveBtn) {
            confirmMoveBtn.addEventListener('click', () => {
                const folderId = document.getElementById('moveBookmarkFolder').value;
                if (!folderId) {
                    App.showToast('请选择目标文件夹', 'error');
                    return;
                }
                if (this.moveBookmarkToFolder(this.contextMenuBookmarkId, folderId)) {
                    this.closeModal('moveBookmarkModal');
                }
            });
        }
        
        // 右键菜单事件委托
        document.getElementById('bookmarkList').addEventListener('contextmenu', (e) => {
            const item = e.target.closest('.bookmark-item');
            if (!item) return;
            
            e.preventDefault();
            e.stopPropagation();
            
            const bookmarkId = item.dataset.bookmarkId;
            this.contextMenuBookmarkId = bookmarkId;
            this.showContextMenu(e.clientX, e.clientY);
        });
        
        // 右键菜单项点击
        document.getElementById('bookmarkContextMenu').addEventListener('click', (e) => {
            const action = e.target.closest('.context-menu-item')?.dataset?.action;
            if (!action) return;
            
            this.handleContextMenuAction(action);
            this.hideContextMenu();
        });
        
        // 全局：点击其他地方关闭右键菜单
        document.addEventListener('click', (e) => {
            const menu = document.getElementById('bookmarkContextMenu');
            if (menu.classList.contains('active') && !menu.contains(e.target)) {
                this.hideContextMenu();
            }
        });
        
        // 全局：Escape 键关闭右键菜单
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hideContextMenu();
            }
        });
    },
    
    /**
     * 显示右键菜单
     */
    showContextMenu(x, y) {
        const menu = document.getElementById('bookmarkContextMenu');
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
     * 隐藏右键菜单
     */
    hideContextMenu() {
        document.getElementById('bookmarkContextMenu').classList.remove('active');
        this.contextMenuBookmarkId = null;
    },
    
    /**
     * 处理右键菜单操作
     */
    handleContextMenuAction(action) {
        if (!this.contextMenuBookmarkId) return;
        
        const bookmark = this.data.bookmarks.find(b => b.id === this.contextMenuBookmarkId);
        if (!bookmark) return;
        
        switch (action) {
            case 'edit':
                this.openBookmarkModal(bookmark.id);
                break;
            case 'copy-link':
                this.copyToClipboard(bookmark.url);
                break;
            case 'open-new-tab':
                window.open(bookmark.url, '_blank');
                break;
            case 'open-new-window':
                window.open(bookmark.url, '', 'width=800,height=600');
                break;
            case 'open-inprivate-window':
                // 浏览器安全限制下无法直接打开 InPrivate 窗口
                // 改为打开新窗口并提示用户使用 Ctrl+Shift+N
                window.open(bookmark.url, '_blank', 'width=800,height=600');
                App.showToast('已在新窗口中打开，如需 InPrivate 模式请使用 Ctrl+Shift+N', 'info');
                break;
            case 'delete':
                this.deleteBookmark(bookmark.id);
                break;
            case 'create-bookmark-here':
                // 在当前收藏页所属文件夹下创建新收藏页（同级）
                this.openBookmarkModal();
                setTimeout(() => {
                    const folderSelect = document.getElementById('bookmarkFolder');
                    folderSelect.value = bookmark.folderId;
                }, 0);
                break;
            case 'create-folder-here':
                // 在当前收藏页所属文件夹下创建子文件夹
                this.openFolderModal();
                setTimeout(() => {
                    const parentSelect = document.getElementById('parentFolder');
                    parentSelect.value = bookmark.folderId;
                }, 0);
                break;
            case 'move':
                // 打开移动到文件夹弹窗
                this.openMoveBookmarkModal(bookmark.id);
                break;
        }
    },
    
    /**
     * 打开"移动到文件夹"弹窗
     */
    openMoveBookmarkModal(bookmarkId) {
        this.contextMenuBookmarkId = bookmarkId;
        const modal = document.getElementById('moveBookmarkModal');
        const select = document.getElementById('moveBookmarkFolder');
        this.fillFolderSelect(select);
        
        // 预设当前文件夹
        const bookmark = this.data.bookmarks.find(b => b.id === bookmarkId);
        if (bookmark) {
            select.value = bookmark.folderId;
        }
        
        modal.classList.add('active');
    },
    
    /**
     * 执行移动收藏到文件夹
     */
    moveBookmarkToFolder(bookmarkId, targetFolderId) {
        if (!bookmarkId || !targetFolderId) return false;
        
        const bookmark = this.data.bookmarks.find(b => b.id === bookmarkId);
        if (!bookmark) return false;
        if (bookmark.folderId === targetFolderId) {
            App.showToast('收藏已在目标文件夹', 'info');
            return false;
        }
        
        const oldFolderId = bookmark.folderId;
        
        // 从旧文件夹排序中移除
        if (this.data.folderOrder && this.data.folderOrder[oldFolderId]) {
            this.data.folderOrder[oldFolderId] = this.data.folderOrder[oldFolderId].filter(id => id !== bookmarkId);
        }
        
        // 更新文件夹归属
        bookmark.folderId = targetFolderId;
        
        // 添加到新文件夹排序末尾
        if (!this.data.folderOrder) this.data.folderOrder = {};
        if (!this.data.folderOrder[targetFolderId]) {
            this.data.folderOrder[targetFolderId] = [];
        }
        if (!this.data.folderOrder[targetFolderId].includes(bookmarkId)) {
            this.data.folderOrder[targetFolderId].push(bookmarkId);
        }
        
        Storage.save(this.data);
        this.render();
        Tree.render();
        App.showToast('已移动', 'success');
        return true;
    },
    
    /**
     * 复制到剪贴板
     */
    copyToClipboard(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                App.showToast('链接已复制到剪贴板', 'success');
            }).catch(() => {
                this.fallbackCopy(text);
            });
        } else {
            this.fallbackCopy(text);
        }
    },
    
    fallbackCopy(text) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
            App.showToast('链接已复制到剪贴板', 'success');
        } catch {
            App.showToast('复制失败', 'error');
        }
        document.body.removeChild(textarea);
    },
    
    /**
     * 设置当前文件夹并渲染列表
     */
    setFolder(folderId) {
        this.currentFolderId = folderId;
        this.render();
    },
    
    /**
     * 渲染收藏列表
     */
    render() {
        const list = document.getElementById('bookmarkList');
        const title = document.getElementById('currentFolderTitle');
        
        // 隐藏右键菜单
        this.hideContextMenu();
        
        // 搜索关键词：以 Tree.searchQuery 为真源，与左侧树搜索保持一致
        const searchQuery = (Tree.searchQuery || '').toLowerCase();
        const isSearchMode = !!searchQuery;
        
        if (isSearchMode) {
            // 全库搜索：标题或 URL 包含关键词
            const matches = this.data.bookmarks.filter(b =>
                b.title.toLowerCase().includes(searchQuery) ||
                b.url.toLowerCase().includes(searchQuery)
            );
            
            title.textContent = App.t('searchResultTitle', { N: matches.length });
            
            if (matches.length === 0) {
                list.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-icon">📭</div>
                        <div class="empty-text">${App.t('searchNoResult')}</div>
                    </div>
                `;
                return;
            }
            
            list.innerHTML = '';
            matches.forEach(bookmark => {
                const folderPath = this.getFolderPathText(bookmark.folderId);
                const item = this.createBookmarkItem(bookmark, folderPath);
                list.appendChild(item);
            });
            return;
        }
        
        // 无搜索：按当前选中文件夹展示
        if (!this.currentFolderId) {
            title.textContent = '收藏夹';
            list.innerHTML = '<div class="empty-state"><div class="empty-text">请从左侧选择一个收藏夹</div></div>';
            return;
        }
        
        const folder = Tree.findFolder(this.currentFolderId);
        if (!folder) {
            list.innerHTML = `<div class="empty-state"><div class="empty-text">收藏夹不存在 (ID: ${this.currentFolderId})</div></div>`;
            return;
        }
        
        title.textContent = folder.name;
        
        const bookmarks = this.getOrderedBookmarks(this.currentFolderId);
        
        if (bookmarks.length === 0) {
            list.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📭</div>
                    <div class="empty-text">此收藏夹为空，点击"添加收藏页"创建第一个收藏</div>
                </div>
            `;
            return;
        }
        
        list.innerHTML = '';
        bookmarks.forEach(bookmark => {
            list.appendChild(this.createBookmarkItem(bookmark));
        });
    },
    
    /**
     * 获取文件夹路径（根/父/子）用于搜索结果标注
     */
    getFolderPathText(folderId) {
        if (!folderId) return '';
        // 找到目标父路径数组（从顶层到该文件夹）
        const foundPath = [];
        const walk = (folders, path) => {
            for (const f of folders) {
                const newPath = [...path, f.name];
                if (f.id === folderId) { foundPath.push(...newPath); return true; }
                if (f.children && walk(f.children, newPath)) return true;
            }
            return false;
        };
        walk(this.data.folders, []);
        return foundPath.join(' / ');
    },
    
    /**
     * 获取排序后的收藏
     */
    getOrderedBookmarks(folderId) {
        const bookmarks = this.data.bookmarks.filter(b => b.folderId === folderId);
        const order = Storage.getFolderOrder(this.data, folderId);
        const bookmarkMap = {};
        bookmarks.forEach(b => { bookmarkMap[b.id] = b; });
        
        const result = order
            .map(id => bookmarkMap[id])
            .filter(b => b !== undefined);
        
        // 如果排序结果为空（数据不一致），回退到直接返回书签
        if (result.length === 0 && bookmarks.length > 0) {
            return bookmarks;
        }
        
        return result;
    },
    
    /**
     * 创建收藏项 DOM
     */
    createBookmarkItem(bookmark, folderPath = null) {
        const item = document.createElement('div');
        item.className = 'bookmark-item';
        item.dataset.bookmarkId = bookmark.id;
        item.dataset.folderId = bookmark.folderId;
        
        // 拖拽手柄
        const handle = document.createElement('div');
        handle.className = 'drag-handle';
        handle.innerHTML = '⋮⋮';
        handle.title = '拖动排序';
        // 阻止拖拽手柄的点击冒泡到书签项
        handle.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
        item.appendChild(handle);
        
        // Favicon - 多源 fallback
        const favicon = document.createElement('div');
        favicon.className = 'bookmark-favicon';
        const domain = this.getDomain(bookmark.url);
        const firstChar = (bookmark.title || domain).charAt(0).toUpperCase();
        const urlObj = (() => { try { return new URL(bookmark.url); } catch(e) { return null; } })();
        
        const faviconSources = [
            `https://icons.duckduckgo.com/ip3/${domain}.ico`,
            `https://www.google.com/s2/favicons?domain=${domain}&sz=64`,
            urlObj ? `${urlObj.protocol}//${domain}/favicon.ico` : null
        ].filter(Boolean);
        
        const img = document.createElement('img');
        img.alt = '';
        let srcIdx = 0;
        const tryNext = () => {
            if (srcIdx < faviconSources.length) {
                img.src = faviconSources[srcIdx++];
            } else {
                // 所有源都失败了，保留首字母占位
                favicon.innerHTML = firstChar;
            }
        };
        img.onerror = tryNext;
        img.onload = () => {
            favicon.innerHTML = '';
            favicon.appendChild(img);
        };
        favicon.innerHTML = firstChar;
        tryNext();
        
        // 信息
        const info = document.createElement('div');
        info.className = 'bookmark-info';
        
        const title = document.createElement('div');
        title.className = 'bookmark-title';
        title.textContent = bookmark.title;
        title.title = bookmark.title;
        
        const url = document.createElement('div');
        url.className = 'bookmark-url';
        url.textContent = bookmark.url;
        url.title = bookmark.url;
        
        info.appendChild(title);
        info.appendChild(url);
        
        // 搜索结果标注所属文件夹路径
        if (folderPath) {
            const path = document.createElement('div');
            path.className = 'bookmark-folder-path';
            path.textContent = '📁 ' + folderPath;
            info.appendChild(path);
        }
        
        // 操作按钮
        const actions = document.createElement('div');
        actions.className = 'bookmark-actions';
        
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'bookmark-delete';
        deleteBtn.innerHTML = '×';
        deleteBtn.title = '删除';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            this.deleteBookmark(bookmark.id);
        });
        
        actions.appendChild(deleteBtn);
        
        // 组装
        item.appendChild(favicon);
        item.appendChild(info);
        item.appendChild(actions);
        
        // 左键点击跳转（拖拽手柄和删除按钮的点击已在捕获阶段处理）
        item.addEventListener('click', (e) => {
            // 避免拖拽手柄和删除按钮的点击
            if (e.target.closest('.drag-handle') || e.target.closest('.bookmark-delete')) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            window.open(bookmark.url, '_blank');
        });
        
        return item;
    },
    
    /**
     * 获取域名
     */
    getDomain(url) {
        try {
            const u = new URL(url);
            return u.hostname;
        } catch {
            return '';
        }
    },
    
    /**
     * 打开添加收藏弹窗
     */
    openBookmarkModal(bookmarkId = null) {
        this.editingBookmarkId = bookmarkId;
        const modal = document.getElementById('bookmarkModal');
        const title = document.getElementById('bookmarkModalTitle');
        const folderSelect = document.getElementById('bookmarkFolder');
        
        this.fillFolderSelect(folderSelect);
        
        if (bookmarkId) {
            const bookmark = this.data.bookmarks.find(b => b.id === bookmarkId);
            if (bookmark) {
                title.textContent = '编辑收藏';
                document.getElementById('bookmarkTitle').value = bookmark.title;
                document.getElementById('bookmarkUrl').value = bookmark.url;
                folderSelect.value = bookmark.folderId;
            }
        } else {
            title.textContent = '添加收藏页';
            document.getElementById('bookmarkTitle').value = '';
            document.getElementById('bookmarkUrl').value = '';
            if (this.currentFolderId) {
                folderSelect.value = this.currentFolderId;
            }
        }
        
        modal.classList.add('active');
    },
    
    /**
     * 填充文件夹选择下拉
     */
    fillFolderSelect(select) {
        const folders = Tree.getFolderList();
        select.innerHTML = '';
        
        folders.forEach(f => {
            const option = document.createElement('option');
            option.value = f.id;
            option.textContent = f.path;
            select.appendChild(option);
        });
    },
    
    /**
     * 保存收藏
     */
    saveBookmark() {
        const title = document.getElementById('bookmarkTitle').value.trim();
        const url = document.getElementById('bookmarkUrl').value.trim();
        const folderId = document.getElementById('bookmarkFolder').value;
        
        if (!title) {
            App.showToast('请输入标题', 'error');
            return;
        }
        if (!url) {
            App.showToast('请输入URL', 'error');
            return;
        }
        if (!folderId) {
            App.showToast('请选择文件夹', 'error');
            return;
        }
        
        if (this.editingBookmarkId) {
            const bookmark = this.data.bookmarks.find(b => b.id === this.editingBookmarkId);
            if (bookmark) {
                const oldFolderId = bookmark.folderId;
                bookmark.title = title;
                bookmark.url = url;
                bookmark.folderId = folderId;
                
                // 如果文件夹变更，更新排序
                if (oldFolderId !== folderId) {
                    // 从旧文件夹移除
                    if (this.data.folderOrder && this.data.folderOrder[oldFolderId]) {
                        this.data.folderOrder[oldFolderId] = this.data.folderOrder[oldFolderId].filter(id => id !== bookmark.id);
                    }
                    // 添加到新文件夹
                    if (!this.data.folderOrder) this.data.folderOrder = {};
                    if (!this.data.folderOrder[folderId]) this.data.folderOrder[folderId] = [];
                    this.data.folderOrder[folderId].push(bookmark.id);
                }
            }
            App.showToast('收藏已更新', 'success');
        } else {
            const newBookmark = {
                id: Storage.generateId('bookmark'),
                folderId: folderId,
                title: title,
                url: url
            };
            this.data.bookmarks.push(newBookmark);
            
            // 添加到排序
            if (!this.data.folderOrder) this.data.folderOrder = {};
            if (!this.data.folderOrder[folderId]) this.data.folderOrder[folderId] = [];
            this.data.folderOrder[folderId].push(newBookmark.id);
            
            App.showToast('收藏已添加', 'success');
        }
        
        Storage.save(this.data);
        this.closeModal('bookmarkModal');
        this.render();
        Tree.render();
    },
    
    /**
     * 删除收藏
     */
    deleteBookmark(bookmarkId) {
        if (!confirm('确定要删除此收藏吗？')) return;
        
        const bookmark = this.data.bookmarks.find(b => b.id === bookmarkId);
        if (bookmark && this.data.folderOrder && this.data.folderOrder[bookmark.folderId]) {
            this.data.folderOrder[bookmark.folderId] = this.data.folderOrder[bookmark.folderId].filter(id => id !== bookmarkId);
        }
        
        this.data.bookmarks = this.data.bookmarks.filter(b => b.id !== bookmarkId);
        Storage.save(this.data);
        this.render();
        Tree.render();
        App.showToast('收藏已删除', 'success');
    },
    
    /**
     * 打开添加文件夹弹窗
     */
    openFolderModal(folderId = null) {
        const modal = document.getElementById('folderModal');
        const title = document.getElementById('folderModalTitle');
        const parentSelect = document.getElementById('parentFolder');
        const nameInput = document.getElementById('folderName');
        
        this.fillParentFolderSelect(parentSelect);
        
        if (folderId) {
            const folder = Tree.findFolder(folderId);
            if (folder) {
                title.textContent = '编辑收藏夹';
                nameInput.value = folder.name;
                const parentFolder = this.findParentFolder(folderId);
                parentSelect.value = parentFolder ? parentFolder.id : '';
            }
        } else {
            title.textContent = '添加收藏夹';
            nameInput.value = '';
            parentSelect.value = '';
        }
        
        this._editingFolderId = folderId;
        modal.classList.add('active');
    },
    
    /**
     * 填充父文件夹选择
     */
    fillParentFolderSelect(select) {
        const folders = Tree.getFolderList();
        select.innerHTML = '<option value="">根目录</option>';
        
        folders.forEach(f => {
            const option = document.createElement('option');
            option.value = f.id;
            option.textContent = f.path;
            select.appendChild(option);
        });
    },
    
    /**
     * 查找父文件夹
     */
    findParentFolder(folderId, folders = this.data.folders, parent = null) {
        for (const folder of folders) {
            if (folder.id === folderId) {
                return parent;
            }
            if (folder.children) {
                const found = this.findParentFolder(folderId, folder.children, folder);
                if (found !== null) return found;
            }
        }
        return null;
    },
    
    /**
     * 保存文件夹
     */
    saveFolder() {
        const name = document.getElementById('folderName').value.trim();
        const parentId = document.getElementById('parentFolder').value;
        
        if (!name) {
            App.showToast('请输入文件夹名称', 'error');
            return;
        }
        
        if (this._editingFolderId) {
            Tree.renameFolder(this._editingFolderId, name);
            App.showToast('文件夹已更新', 'success');
        } else {
            Tree.addFolder(name, parentId || null);
            App.showToast('文件夹已创建', 'success');
        }
        
        Storage.save(this.data);
        this.closeModal('folderModal');
        this.render();
    },
    
    /**
     * 关闭弹窗
     */
    closeModal(modalId) {
        document.getElementById(modalId).classList.remove('active');
        this._editingFolderId = null;
    }
};
