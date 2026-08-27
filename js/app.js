/**
 * 主应用模块 - 初始化和协调所有模块
 */

const App = {
    data: null,
    currentLanguage: 'zh-CN',
    
    // 国际化文案
    translations: {
        'zh-CN': {
            favorites: '收藏夹',
            config: '配置',
            language: '语言',
            searchPlaceholder: '搜索收藏夹',
            addBookmark: '添加收藏页',
            addFolder: '添加收藏夹',
            configTitle: '配置',
            importSection: '导入',
            importFile: '从本地文件导入',
            importUrl: '从 URL 导入',
            urlPlaceholder: '输入在线 txt 文件 URL',
            exportSection: '导出',
            export: '导出为 txt 文件',
            formatSection: '文件格式说明',
            titleLabel: '标题',
            titlePlaceholder: '输入收藏标题',
            urlLabel: 'URL',
            urlPlaceholder2: 'https://example.com',
            folderLabel: '所属文件夹',
            cancel: '取消',
            save: '保存',
            editFolder: '编辑文件夹',
            deleteFolder: '删除文件夹',
            folderNameLabel: '文件夹名称',
            folderNamePlaceholder: '输入文件夹名称',
            parentFolderLabel: '父级文件夹',
            rootFolder: '根目录',
            folder: '收藏夹',
            bookmark: '收藏',
            confirmDelete: '确定删除此收藏夹吗？',
            selectFolder: '请从左侧选择一个收藏夹',
            emptyFolder: '此收藏夹为空',
            noResults: '没有找到匹配的收藏',
            loading: '加载中...',
            edit: '编辑',
            copyLink: '复制链接',
            openNewTab: '在新标签页中打开',
            openNewWindow: '在新窗口中打开',
            openInPrivateWindow: '在 InPrivate 窗口中打开',
            delete: '删除',
            move: '移动到...',
            confirmMove: '移动',
            targetFolderLabel: '目标文件夹',
            createBookmarkHere: '在此文件夹下创建收藏页',
            createFolderHere: '在此文件夹下创建收藏夹',
            createBookmarkSameLevel: '在此创建同级收藏页',
            createFolderInCurrent: '在此文件夹下创建收藏夹',
            emptyFolderTip: '请先创建一个收藏夹',
            searchResultTitle: '搜索结果（{N}条）',
            searchNoResult: '没有找到匹配的收藏'
        },
        'en': {
            favorites: 'Favorites',
            config: 'Config',
            language: 'Language',
            searchPlaceholder: 'Search favorites',
            addBookmark: 'Add Bookmark',
            addFolder: 'Add Folder',
            configTitle: 'Configuration',
            importSection: 'Import',
            importFile: 'Import from File',
            importUrl: 'Import from URL',
            urlPlaceholder: 'Enter txt file URL',
            exportSection: 'Export',
            export: 'Export to txt File',
            formatSection: 'File Format',
            titleLabel: 'Title',
            titlePlaceholder: 'Enter bookmark title',
            urlLabel: 'URL',
            urlPlaceholder2: 'https://example.com',
            folderLabel: 'Folder',
            cancel: 'Cancel',
            save: 'Save',
            editFolder: 'Edit Folder',
            deleteFolder: 'Delete Folder',
            folderNameLabel: 'Folder Name',
            folderNamePlaceholder: 'Enter folder name',
            parentFolderLabel: 'Parent Folder',
            rootFolder: 'Root',
            folder: 'Folder',
            bookmark: 'Bookmark',
            confirmDelete: 'Are you sure to delete this folder?',
            selectFolder: 'Please select a folder from the left',
            emptyFolder: 'This folder is empty',
            noResults: 'No matching bookmarks found',
            loading: 'Loading...',
            edit: 'Edit',
            copyLink: 'Copy Link',
            openNewTab: 'Open in New Tab',
            openNewWindow: 'Open in New Window',
            openInPrivateWindow: 'Open in InPrivate Window',
            delete: 'Delete',
            move: 'Move to...',
            confirmMove: 'Move',
            targetFolderLabel: 'Target Folder',
            createBookmarkHere: 'Create Bookmark in this Folder',
            createFolderHere: 'Create Subfolder Here',
            createBookmarkSameLevel: 'Create Bookmark at Same Level',
            createFolderInCurrent: 'Create Subfolder in Current Folder',
            emptyFolderTip: 'Please create a folder first',
            searchResultTitle: 'Search Results ({N} items)',
            searchNoResult: 'No matching bookmarks found'
        }
    },
    
    /**
     * 应用启动
     */
    init() {
        // 加载数据
        this.data = Storage.load();
        
        // 加载语言设置
        this.currentLanguage = this.data.settings?.language || 'zh-CN';
        
        // 初始化各模块
        // 先初始化 Bookmarks（Tree.init 会调用 onSelectFolder）
        Bookmarks.init(this.data, {
            onUpdate: () => {
                Storage.save(this.data);
            }
        });
        
        Tree.init(this.data, {
            onSelectFolder: (folderId) => {
                Bookmarks.setFolder(folderId);
            },
            onUpdate: () => {
                Storage.save(this.data);
            }
        });
        
        Config.init(this.data, {
            onImport: () => {
                Tree.data = this.data;
                Tree.render();
                Bookmarks.data = this.data;
                Bookmarks.render();
            }
        });
        
        // 绑定全局事件
        this.bindGlobalEvents();
        
        // 绑定移动端侧栏快捷按钮
        this.bindMobileActions();
        
        // 初始化侧边栏拖拽调整
        this.initResizer();
        
        // 窗口宽度跨越 768px 阈值时，保持用户上次的展开状态，
        // 只确保被选中的文件夹本身及父路径可见（不至于切换视口后找不到当前选中项）
        let lastWidth = window.innerWidth;
        window.addEventListener('resize', () => {
            const w = window.innerWidth;
            if ((lastWidth <= 768 && w > 768) || (lastWidth > 768 && w <= 768)) {
                if (Tree.selectedFolderId) {
                    Tree.expandParentPath(Tree.selectedFolderId);
                }
                Tree.render();
            }
            lastWidth = w;
        });
        
        // 应用语言
        this.applyLanguage(this.currentLanguage);
    },
    
    /**
     * 初始化侧边栏拖拽调整
     */
    initResizer() {
        const resizer = document.getElementById('sidebarResizer');
        const sidebar = document.querySelector('.sidebar');
        const main = document.querySelector('.main');
        if (!resizer || !sidebar || !main) return;
        
        const MIN_WIDTH = 200;
        const MAX_WIDTH = 600;
        const MIN_MAIN_WIDTH = 320; // 右侧主内容区最小宽度
        
        // 从 localStorage 恢复宽度
        const savedWidth = localStorage.getItem('sidebar_width');
        if (savedWidth) {
            const w = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, parseInt(savedWidth, 10) || 320));
            sidebar.style.width = w + 'px';
        }
        
        let isResizing = false;
        let startX = 0;
        let startWidth = 0;
        let indicator = null;
        
        // 鼠标按下开始拖拽
        resizer.addEventListener('mousedown', (e) => {
            // 仅左键
            if (e.button !== 0) return;
            
            isResizing = true;
            startX = e.clientX;
            startWidth = sidebar.getBoundingClientRect().width;
            
            resizer.classList.add('active');
            document.body.classList.add('resizing');
            
            // 创建反馈指示线
            indicator = document.createElement('div');
            indicator.className = 'resizer-indicator visible';
            document.body.appendChild(indicator);
            indicator.style.left = startWidth + 'px';
            
            e.preventDefault();
        });
        
        // 鼠标移动更新宽度
        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            
            const newWidth = startWidth + (e.clientX - startX);
            const containerWidth = document.querySelector('.app').getBoundingClientRect().width;
            const maxWidth = Math.min(MAX_WIDTH, containerWidth - MIN_MAIN_WIDTH);
            const clampedWidth = Math.max(MIN_WIDTH, Math.min(maxWidth, newWidth));
            
            // 更新反馈指示线
            if (indicator) {
                indicator.style.left = clampedWidth + 'px';
            }
            
            // 实时更新宽度
            sidebar.style.width = clampedWidth + 'px';
        });
        
        // 鼠标松开结束拖拽
        document.addEventListener('mouseup', () => {
            if (!isResizing) return;
            isResizing = false;
            
            resizer.classList.remove('active');
            document.body.classList.remove('resizing');
            
            // 保存到 localStorage
            const finalWidth = Math.round(sidebar.getBoundingClientRect().width);
            localStorage.setItem('sidebar_width', finalWidth);
            
            // 清理指示线
            if (indicator && indicator.parentNode) {
                indicator.parentNode.removeChild(indicator);
            }
            indicator = null;
            
            // 通知窗口变化，让 Sortable 等组件重新计算位置
            window.dispatchEvent(new Event('resize'));
        });
        
        // 双击 resizer 恢复默认宽度
        resizer.addEventListener('dblclick', () => {
            sidebar.style.width = '320px';
            localStorage.setItem('sidebar_width', '320');
            window.dispatchEvent(new Event('resize'));
        });
        
        // ESC 取消拖拽
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && isResizing) {
                isResizing = false;
                sidebar.style.width = startWidth + 'px';
                
                resizer.classList.remove('active');
                document.body.classList.remove('resizing');
                
                if (indicator && indicator.parentNode) {
                    indicator.parentNode.removeChild(indicator);
                }
                indicator = null;
            }
        });
    },

    /**
     * 绑定全局事件
     */
    bindGlobalEvents() {
        // 搜索框
        document.getElementById('searchInput').addEventListener('input', (e) => {
            const query = e.target.value;
            Tree.search(query);
            Bookmarks.render();
        });

        // 全部展开 / 全部折叠
        document.getElementById('btnExpandAll').addEventListener('click', () => {
            Tree.expandAllFolders();
            Tree.render();
            App.showToast('已全部展开', 'info');
        });
        document.getElementById('btnCollapseAll').addEventListener('click', () => {
            Tree.collapseAllFolders();
            Tree.render();
            App.showToast('已全部折叠', 'info');
        });

        // 语言按钮
        document.getElementById('btnLanguage').addEventListener('click', () => {
            this.toggleLanguage();
        });
        
        // 更多操作按钮
        document.getElementById('btnMore').addEventListener('click', (e) => {
            e.stopPropagation();
            const menu = document.getElementById('moreMenu');
            const rect = e.currentTarget.getBoundingClientRect();
            menu.style.left = `${rect.left}px`;
            menu.style.top = `${rect.bottom + 4}px`;
            menu.classList.toggle('active');
        });
        
        // 编辑文件夹
        document.getElementById('btnEditFolder').addEventListener('click', () => {
            document.getElementById('moreMenu').classList.remove('active');
            if (Tree.selectedFolderId) {
                Bookmarks.openFolderModal(Tree.selectedFolderId);
            } else {
                this.showToast('请先选择一个文件夹', 'error');
            }
        });
        
        // 删除文件夹
        document.getElementById('btnDeleteFolder').addEventListener('click', () => {
            document.getElementById('moreMenu').classList.remove('active');
            if (Tree.selectedFolderId) {
                const folder = Tree.findFolder(Tree.selectedFolderId);
                if (folder) {
                    const bookmarkCount = Tree.countBookmarks(folder.id);
                    const subfolderCount = Tree.countSubfolders(folder);
                    if (confirm(`确定删除"${folder.name}"？\n包含 ${bookmarkCount} 个收藏和 ${subfolderCount} 个子文件夹。`)) {
                        Tree.deleteFolder(Tree.selectedFolderId);
                        Storage.save(this.data);
                        Bookmarks.data = this.data;
                        Bookmarks.setFolder(Tree.selectedFolderId);
                        this.showToast('文件夹已删除', 'success');
                    }
                }
            } else {
                this.showToast('请先选择一个文件夹', 'error');
            }
        });
        
        // 关闭下拉菜单（点击其他地方）
        document.addEventListener('click', (e) => {
            const menu = document.getElementById('moreMenu');
            if (!menu.contains(e.target) && e.target.id !== 'btnMore') {
                menu.classList.remove('active');
            }
        });
        
        // 弹窗关闭按钮
        document.querySelectorAll('[data-close]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const modalId = btn.getAttribute('data-close');
                document.getElementById(modalId).classList.remove('active');
                if (modalId === 'bookmarkModal') {
                    Bookmarks.closeModal('bookmarkModal');
                } else if (modalId === 'folderModal') {
                    Bookmarks.closeModal('folderModal');
                }
            });
        });
        
        // 点击弹窗背景关闭
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.classList.remove('active');
                }
            });
        });
        
        // ESC 键关闭弹窗
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                document.querySelectorAll('.modal.active').forEach(modal => {
                    modal.classList.remove('active');
                });
                document.getElementById('moreMenu').classList.remove('active');
            }
        });
    },
    
    /**
     * JS 运行时文本翻译（支持简单 {变量} 替换）
     * 例：App.t('searchResultTitle', { N: 3 }) => "搜索结果（3条）"
     */
    t(key, vars) {
        const dict = this.translations[this.currentLanguage] || this.translations['zh-CN'] || {};
        let text = dict[key];
        if (text === undefined || text === null) {
            // 回退到中文词典
            const fallback = this.translations['zh-CN'];
            text = (fallback && fallback[key]) !== undefined ? fallback[key] : key;
        }
        if (vars) {
            Object.keys(vars).forEach(v => {
                text = String(text).replace(new RegExp('\\{' + v + '\\}', 'g'), vars[v]);
            });
        }
        return text;
    },

    /**
     * 切换语言
     */
    toggleLanguage() {
        this.currentLanguage = this.currentLanguage === 'zh-CN' ? 'en' : 'zh-CN';
        this.applyLanguage(this.currentLanguage);
        
        // 保存语言设置
        if (!this.data.settings) this.data.settings = {};
        this.data.settings.language = this.currentLanguage;
        Storage.save(this.data);
        
        // 重渲染：搜索结果标题、空状态文本等才会跟随语言切换
        Bookmarks.render();
        
        this.showToast(this.currentLanguage === 'zh-CN' ? '已切换到中文' : 'Switched to English', 'success');
    },
    
    /**
     * 应用语言
     */
    applyLanguage(lang) {
        const dict = this.translations[lang];
        if (!dict) return;
        
        // 更新所有带 data-i18n 属性的元素
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (dict[key]) {
                el.textContent = dict[key];
            }
        });
        
        // 更新所有带 data-i18n-placeholder 的元素
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            if (dict[key]) {
                el.setAttribute('placeholder', dict[key]);
            }
        });
        
        // 更新配置弹窗中的格式说明示例
        const formatExample = document.querySelector('.format-example');
        if (formatExample && lang === 'en') {
            // 保持格式不变，只是 UI 语言变化
        }
    },
    
    /**
     * 显示 Toast 提示
     */
    showToast(message, type = 'info') {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.className = `toast show ${type}`;
        
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    },
    
    /**
     * 绑定移动端侧栏快捷按钮（☆/📁），默认选中当前文件夹
     */
    bindMobileActions() {
        const bm = document.getElementById('btnAddBookmarkMobile');
        const fd = document.getElementById('btnAddFolderMobile');
        if (bm) {
            bm.addEventListener('click', () => {
                if (!Tree.selectedFolderId) {
                    if (this.data.folders && this.data.folders.length > 0) {
                        App.showToast('请先选择一个收藏夹', 'error');
                    } else {
                        App.showToast(App.i18n && App.i18n('emptyFolderTip') ? App.i18n('emptyFolderTip') : '请先创建一个收藏夹', 'error');
                    }
                    return;
                }
                Bookmarks.openBookmarkModal();
            });
        }
        if (fd) {
            fd.addEventListener('click', () => {
                Bookmarks.openFolderModal();
                setTimeout(() => {
                    if (Tree.selectedFolderId) {
                        const parentSelect = document.getElementById('parentFolder');
                        if (parentSelect) parentSelect.value = Tree.selectedFolderId;
                    }
                }, 0);
            });
        }
    }
};

// 启动应用
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
