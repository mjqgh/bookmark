/**
 * 回收站模块 - 已删除内容的展示、恢复、彻底删除
 * 数据结构：data.trash = { folders: [{folder, originalParentId, deletedAt}], bookmarks: [{..., deletedAt}] }
 */

const Trash = {
    data: null,

    /**
     * 初始化（与 App.data 共享同一引用）
     */
    init(data) {
        this.data = data;
        this.bindEvents();
    },

    /**
     * HTML 转义（标题等用户输入经 innerHTML 拼接前必须转义）
     */
    escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    bindEvents() {
        // 回收站入口按钮（侧栏顶栏）
        const btn = document.getElementById('btnTrash');
        if (btn) {
            btn.addEventListener('click', () => this.open());
        }

        // 清空回收站
        const emptyBtn = document.getElementById('btnEmptyTrash');
        if (emptyBtn) {
            emptyBtn.addEventListener('click', () => this.emptyTrash());
        }
    },

    /**
     * 打开回收站弹窗
     */
    open() {
        this.render();
        const modal = document.getElementById('trashModal');
        if (modal) modal.classList.add('active');
    },

    /**
     * 渲染回收站列表
     */
    render() {
        const listEl = document.getElementById('trashList');
        if (!listEl) return;

        const folders = (this.data.trash && this.data.trash.folders) || [];
        const bookmarks = (this.data.trash && this.data.trash.bookmarks) || [];

        if (folders.length === 0 && bookmarks.length === 0) {
            listEl.innerHTML = `<div class="trash-empty">${App.t('trashEmpty')}</div>`;
            return;
        }

        listEl.innerHTML = '';
        folders.forEach(entry => listEl.appendChild(this.createFolderRow(entry)));
        bookmarks.forEach(bm => listEl.appendChild(this.createBookmarkRow(bm)));
    },

    /**
     * 文件夹条目行
     */
    createFolderRow(entry) {
        const row = document.createElement('div');
        row.className = 'trash-item';

        const info = document.createElement('div');
        info.className = 'trash-item-info';
        const name = document.createElement('div');
        name.className = 'trash-item-name';
        name.innerHTML = '<span style="color:#f5a623;display:inline-flex">' + Tree.SVG_FOLDER_CLOSED + '</span>'
            + '<span class="trash-item-title">' + this.escapeHtml(entry.folder ? entry.folder.name : '?') + '</span>';
        const meta = document.createElement('div');
        meta.className = 'trash-item-meta';
        meta.textContent = App.t('deletedFolderInfo', { N: this.countFolderChildren(entry) })
            + ' · ' + this.formatDate(entry.deletedAt);
        info.appendChild(name);
        info.appendChild(meta);

        const ops = document.createElement('div');
        ops.className = 'trash-item-ops';
        ops.appendChild(this.createBtn(App.t('restore'), 'btn-restore', () => this.restoreFolderEntry(entry)));
        ops.appendChild(this.createBtn(App.t('deleteForever'), 'btn-purge', () => this.deleteFolderForever(entry)));

        row.appendChild(info);
        row.appendChild(ops);
        return row;
    },

    /**
     * 收藏条目行
     */
    createBookmarkRow(bm) {
        const row = document.createElement('div');
        row.className = 'trash-item';

        const info = document.createElement('div');
        info.className = 'trash-item-info';
        const name = document.createElement('div');
        name.className = 'trash-item-name';
        name.innerHTML = '<span style="color:#8a97a6;display:inline-flex">' + Tree.SVG_FILE + '</span>'
            + '<span class="trash-item-title">' + this.escapeHtml(bm.title || bm.url || '') + '</span>';
        const meta = document.createElement('div');
        meta.className = 'trash-item-meta';
        meta.textContent = bm.url + ' · ' + this.formatDate(bm.deletedAt);
        info.appendChild(name);
        info.appendChild(meta);

        const ops = document.createElement('div');
        ops.className = 'trash-item-ops';
        ops.appendChild(this.createBtn(App.t('restore'), 'btn-restore', () => this.restoreBookmark(bm)));
        ops.appendChild(this.createBtn(App.t('deleteForever'), 'btn-purge', () => this.purgeBookmark(bm)));

        row.appendChild(info);
        row.appendChild(ops);
        return row;
    },

    createBtn(text, cls, onClick) {
        const btn = document.createElement('button');
        btn.className = 'btn ' + cls;
        btn.textContent = text;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            onClick();
        });
        return btn;
    },

    /**
     * 统计回收站文件夹子树内的子项数（子收藏 + 子文件夹）
     */
    countFolderChildren(entry) {
        if (!entry.folder) return 0;
        const ids = [];
        const collect = (f) => { ids.push(f.id); if (f.children) f.children.forEach(collect); };
        collect(entry.folder);
        const trashedBms = (this.data.trash && this.data.trash.bookmarks) || [];
        const bmCount = trashedBms.filter(b => ids.includes(b.folderId)).length;
        const subFolderCount = ids.length - 1; // 不含自身
        return bmCount + subFolderCount;
    },

    /**
     * 恢复文件夹（委托给 Tree.restoreFolder，含收藏与排序快照）
     */
    restoreFolderEntry(entry) {
        if (Tree.restoreFolder(entry)) {
            Bookmarks.render();
            this.render();
            App.showToast(App.t('restored'), 'success');
        }
    },

    /**
     * 彻底删除回收站文件夹（含子树内收藏残片）
     */
    deleteFolderForever(entry) {
        if (!confirm(App.t('confirmDeleteForever'))) return;
        const ids = [];
        const collect = (f) => { ids.push(f.id); if (f.children) f.children.forEach(collect); };
        if (entry.folder) collect(entry.folder);

        this.data.trash.bookmarks = (this.data.trash.bookmarks || []).filter(b => !ids.includes(b.folderId));
        this.data.trash.folders = (this.data.trash.folders || []).filter(e => e !== entry);

        Storage.save(this.data);
        this.render();
        App.showToast(App.t('purged'), 'success');
    },

    /**
     * 恢复收藏：原文件夹不存在时回退到第一个根文件夹
     */
    restoreBookmark(bm) {
        if (!Tree.findFolder(bm.folderId)) {
            if (!this.data.folders || this.data.folders.length === 0) {
                App.showToast(App.t('emptyFolderTip'), 'error');
                return;
            }
            bm.folderId = this.data.folders[0].id;
        }
        delete bm.deletedAt;
        this.data.trash.bookmarks = (this.data.trash.bookmarks || []).filter(b => b.id !== bm.id);
        this.data.bookmarks.push(bm);

        // 恢复排序（追加到末尾）
        if (!this.data.folderOrder) this.data.folderOrder = {};
        if (!this.data.folderOrder[bm.folderId]) this.data.folderOrder[bm.folderId] = [];
        if (!this.data.folderOrder[bm.folderId].includes(bm.id)) {
            this.data.folderOrder[bm.folderId].push(bm.id);
        }

        Storage.save(this.data);
        Tree.render();
        Bookmarks.render();
        this.render();
        App.showToast(App.t('restored'), 'success');
    },

    /**
     * 彻底删除回收站收藏
     */
    purgeBookmark(bm) {
        if (!confirm(App.t('confirmDeleteForever'))) return;
        this.data.trash.bookmarks = (this.data.trash.bookmarks || []).filter(b => b.id !== bm.id);
        Storage.save(this.data);
        this.render();
        App.showToast(App.t('purged'), 'success');
    },

    /**
     * 清空回收站
     */
    emptyTrash() {
        if (!confirm(App.t('confirmEmptyTrash'))) return;
        this.data.trash = { folders: [], bookmarks: [] };
        Storage.save(this.data);
        this.render();
        App.showToast(App.t('purged'), 'success');
    },

    /**
     * 格式化删除日期
     */
    formatDate(ts) {
        if (!ts) return '';
        const d = new Date(ts);
        const p = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }
};
