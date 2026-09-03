/**
 * 主应用模块 - 初始化和协调所有模块
 */

const App = {
    data: null,
    currentLanguage: 'zh-CN',

    // 搜索引擎列表（engineId 作为主键）
    SEARCH_ENGINES: [
        { id: 'baidu',  url: 'https://www.baidu.com/s?wd={q}' },
        { id: 'bing',   url: 'https://www.bing.com/search?q={q}' },
        { id: 'google', url: 'https://www.google.com/search?q={q}' },
        { id: 'sogou',  url: 'https://www.sogou.com/web?query={q}' }
    ],

    // 拖拽锁按钮 SVG 图标（解锁=开口锁，锁定=闭口锁）
    SVG_UNLOCK: '<svg viewBox="0 0 1024 1024" width="16" height="16" fill="currentColor"><path d="M768.25422 0q48.810328 0 94.061569 18.303873t80.333664 50.33565 56.436941 74.740814 21.354518 91.519364l0 150.49851-123.042701 0 0-122.025819q0-64.063555-36.099305-99.654419t-97.112214-35.590864q-54.911619 0-88.468719 35.590864t-33.5571 99.654419l0 124.059583-128.12711 0 0-152.532274q0-48.810328 19.320755-91.519364t53.386296-74.740814 80.333664-50.33565 101.179742-18.303873zM766.220457 693.513406l0 87.451837 0 47.793446q0 27.455809-9.660377 51.860973t-26.438928 41.692155-39.658391 27.455809-50.33565 10.168818l-514.542205 0q-27.455809 0-49.82721-9.660377t-38.641509-26.438928-24.913605-39.14995-8.643496-47.793446l0-323.368421q0-28.472691 19.829196-47.793446t46.268123-19.320755l629.449851 0q28.472691 0 47.793446 19.320755t19.320755 47.793446l0 179.988083z"></path></svg>',
    SVG_LOCK: '<svg viewBox="0 0 1024 1024" width="16" height="16" fill="currentColor"><path d="M385.150849 385.662338l-128.895105 0 0-150.377622q0-49.102897 19.436563-91.556444t53.706294-74.677323 80.815185-50.637363 101.786214-18.413586q49.102897 0 94.625375 18.413586t80.815185 50.637363 56.263736 74.677323 20.971029 91.556444l0 150.377622-123.78022 0 0-121.734266q0-64.447552-35.804196-99.74026t-97.182817-35.292707q-55.240759 0-88.999001 35.292707t-33.758242 99.74026l0 121.734266zM826.053946 447.040959q27.62038 0 47.568432 19.948052t19.948052 47.568432l0 317.122877q0 27.62038-9.718282 51.66034t-26.597403 41.942058-39.896104 28.131868-50.637363 10.22977l-516.603397 0q-27.62038 0-50.125874-10.22977t-38.361638-27.108891-24.551449-39.384615-8.695305-48.07992l0-324.283716q0-27.62038 19.436563-47.568432t47.056943-19.948052l61.378621 0 128.895105 0 255.744256 0 123.78022 0 61.378621 0z"></path></svg>',
    
    // 国际化文案
    translations: {
        'zh-CN': {
            favorites: '收藏夹',
            config: '配置',
            language: '语言',
            searchPlaceholder: '搜索本地或网络',
            defaultSearchEngine: '默认搜索引擎',
            searchEngineHint: '网络搜索的默认引擎，也可在搜索框长按 🌐 按钮临时切换',
            engine_baidu: '百度 (Baidu)',
            engine_bing: '必应 (Bing)',
            engine_google: 'Google',
            engine_sogou: '搜狗 (Sogou)',
            webSearchEmpty: '请先输入要搜索的关键词',
            webSearchHolding: '已切为默认引擎：{name}',
            webSearchTitle: '选择默认搜索引擎',
            addBookmark: '添加收藏页',
            addFolder: '添加收藏夹',
            configTitle: '配置',
            importSection: '导入',
            importFile: '从本地文件导入（支持 txt / html）',
            cloudSyncTitle: '云端自动同步',
            cloudSyncEnabled: '启用自动拉取',
            cloudProvider: '存储源',
            cloudProviderCustom: '其他（自定义 URL）',
            cloudRawUrl: 'txt 文件 URL',
            cloudFetchUrl: '实际拉取地址（自动加速）',
            cloudInterval: '拉取间隔',
            cloudIntervalManual: '仅手动拉取',
            cloudTestFetch: '立即拉取',
            cloudSave: '保存配置',
            cloudStatusFetching: '正在拉取...',
            cloudStatusOk: '上次同步：',
            cloudNeverSynced: '从未同步',
            cloudHint: '首次使用：在 GitHub 新建仓库 + 上传 txt → 打开 raw 文件 → 复制 URL 粘贴到上面。数据完全由你自己掌握，我们不会存储你的任何数据。',
            exportSection: '导出',
            exportTxt: '导出为 txt',
            exportHtml: '导出为 html（浏览器书签格式）',
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
            searchNoResult: '没有找到匹配的收藏',
            trash: '回收站',
            trashTitle: '回收站',
            trashHint: '回收站中的内容保留 30 天，之后自动清除',
            trashBookmarks: '收藏',
            trashFolders: '收藏夹',
            trashEmpty: '回收站是空的',
            openTrash: '打开回收站',
            restore: '恢复',
            deleteForever: '彻底删除',
            emptyTrash: '清空回收站',
            deletedToTrash: '已移入回收站',
            confirmDeleteToTrash: '确定删除？内容将移入回收站（保留30天）',
            confirmDeleteForever: '确定彻底删除？此操作不可恢复！',
            confirmEmptyTrash: '确定清空回收站？所有回收站内容将被永久删除！',
            restored: '已恢复',
            purged: '已彻底删除',
            importFile: '从本地文件导入（支持 txt / html）',
            importHintHtml: '支持 txt 备份文件和浏览器导出的 bookmarks.html',
            deletedFolderInfo: '{N} 个子项'
        },
        'en': {
            favorites: 'Favorites',
            config: 'Config',
            language: 'Language',
            searchPlaceholder: 'Search local or web',
            defaultSearchEngine: 'Default Search Engine',
            searchEngineHint: 'Default engine for web search. Long-press the 🌐 button in search box to switch.',
            engine_baidu: 'Baidu',
            engine_bing: 'Bing',
            engine_google: 'Google',
            engine_sogou: 'Sogou',
            webSearchEmpty: 'Please enter a keyword to search',
            webSearchHolding: 'Default engine changed to {name}',
            webSearchTitle: 'Choose default search engine',
            addBookmark: 'Add Bookmark',
            addFolder: 'Add Folder',
            configTitle: 'Configuration',
            importSection: 'Import',
            importFile: 'Import from File (txt / html)',
            cloudSyncTitle: 'Cloud Auto Sync',
            cloudSyncEnabled: 'Enable auto-fetch',
            cloudProvider: 'Provider',
            cloudProviderCustom: 'Other (Custom URL)',
            cloudRawUrl: 'txt File URL',
            cloudFetchUrl: 'Fetch URL (auto-accelerated)',
            cloudInterval: 'Fetch Interval',
            cloudIntervalManual: 'Manual only',
            cloudTestFetch: 'Fetch Now',
            cloudSave: 'Save Config',
            cloudStatusFetching: 'Fetching...',
            cloudStatusOk: 'Last sync: ',
            cloudNeverSynced: 'Never synced',
            cloudHint: 'First time: create a repo on GitHub + upload your txt → open the raw file → copy the URL above. Your data stays entirely with you.',
            exportSection: 'Export',
            exportTxt: 'Export as txt',
            exportHtml: 'Export as html (browser bookmarks)',
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
            searchNoResult: 'No matching bookmarks found',
            trash: 'Trash',
            trashTitle: 'Trash',
            trashHint: 'Items are kept for 30 days, then removed automatically',
            trashBookmarks: 'Bookmarks',
            trashFolders: 'Folders',
            trashEmpty: 'Trash is empty',
            openTrash: 'Open Trash',
            restore: 'Restore',
            deleteForever: 'Delete Forever',
            emptyTrash: 'Empty Trash',
            deletedToTrash: 'Moved to Trash',
            confirmDeleteToTrash: 'Delete? It will be moved to Trash (kept for 30 days)',
            confirmDeleteForever: 'Delete forever? This cannot be undone!',
            confirmEmptyTrash: 'Empty Trash? All items will be permanently deleted!',
            restored: 'Restored',
            purged: 'Deleted forever',
            importFile: 'Import from File',
            importHintHtml: 'Supports txt backup and browser-exported bookmarks.html',
            deletedFolderInfo: '{N} items'
        }
    },
    
    /**
     * 应用启动
     */
    init() {
        // 加载数据
        this.data = Storage.load();

        // 拖拽排序总开关（默认解锁；持久化到 localStorage）
        this.dragUnlocked = localStorage.getItem('dragUnlocked') !== '0';
        
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
            },
            onAfterRender: () => {
                this.updateToggleExpandBtn();
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
        
        // 回收站模块（与 App.data 共享同一引用）
        Trash.init(this.data);
        
        // 绑定全局事件
        this.bindGlobalEvents();
        this.applyDragLock();
        this.updateToggleExpandBtn();
        // 初始化搜索引擎配置：填充下拉默认值
        this.renderSearchEngineSelect();
        
        // 绑定移动端侧栏快捷按钮
        this.bindMobileActions();
        
        // 初始化侧边栏拖拽调整
        this.initResizer();

        // 初始化云端同步（P0）
        CloudSync.init();
        this.initCloudSyncUI();
        
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

    // ========== 搜索引擎 ==========

    /**
     * 根据 engineId 返回引擎配置，或默认引擎
     */
    getSearchEngine(engineId) {
        const id = engineId || this.getDefaultEngineId();
        return this.SEARCH_ENGINES.find(e => e.id === id) || this.SEARCH_ENGINES[0];
    },

    /**
     * 读取默认搜索引擎 id：优先 settings.searchEngine → 语言默认（en→bing / 其他→baidu）
     */
    getDefaultEngineId() {
        const stored = this.data?.settings?.searchEngine;
        if (stored && this.SEARCH_ENGINES.some(e => e.id === stored)) return stored;
        // 英文用户默认 Bing（Google 在部分地区受限）
        const lang = this.currentLanguage;
        if (lang === 'en') return 'bing';
        return 'baidu';
    },

    /**
     * 写入默认搜索引擎并持久化，同步 UI
     */
    setDefaultEngineId(engineId) {
        if (!this.SEARCH_ENGINES.some(e => e.id === engineId)) return;
        if (!this.data.settings) this.data.settings = {};
        this.data.settings.searchEngine = engineId;
        Storage.save(this.data);
        this.renderSearchEngineSelect();
    },

    /**
     * 获取引擎显示名（多语言）
     */
    getEngineName(engineId) {
        return this.t('engine_' + engineId);
    },

    /**
     * 渲染配置里的搜索引擎下拉：按当前语言重建 option 文本并同步选中
     */
    renderSearchEngineSelect() {
        const sel = document.getElementById('searchEngineSelect');
        if (!sel) return;
        const current = this.getDefaultEngineId();
        // 重写 option 文本（多语言），保持 value 不变
        Array.from(sel.options).forEach(opt => {
            opt.textContent = this.getEngineName(opt.value);
        });
        sel.value = current;
    },

    /**
     * 云端同步 UI 事件绑定（P0）
     */
    initCloudSyncUI() {
        const enabledCb = document.getElementById('cloudSyncEnabled');
        const providerSel = document.getElementById('cloudProvider');
        const rawUrlInput = document.getElementById('cloudRawUrl');
        const intervalSel = document.getElementById('cloudInterval');
        const fetchUrlRow = document.getElementById('cloudFetchUrlRow');
        const fetchUrlCode = document.getElementById('cloudFetchUrl');
        const statusEl = document.getElementById('cloudStatus');
        const btnSave = document.getElementById('cloudSaveConfig');
        const btnTest = document.getElementById('cloudTestFetch');

        // 填充已有配置到表单
        const fillForm = () => {
            const cfg = CloudSync.getConfig();
            enabledCb.checked = !!cfg.enabled;
            providerSel.value = cfg.provider || 'github';
            rawUrlInput.value = cfg.rawUrl || '';
            intervalSel.value = String(cfg.intervalMin || 15);
            statusEl.textContent = CloudSync.formatLastFetch();
            if (cfg.lastFetchTs) statusEl.classList.add('has-fetch');
            else statusEl.classList.remove('has-fetch');
            updateFetchUrlPreview();
        };

        // 实时预览：raw URL → gh-proxy 加速转换
        const updateFetchUrlPreview = () => {
            const raw = rawUrlInput.value.trim();
            const provider = providerSel.value;
            if (!raw) {
                fetchUrlRow.style.display = 'none';
                return;
            }
            const fetched = CloudSync._buildFetchUrl(raw, provider);
            if (fetched !== raw) {
                fetchUrlCode.textContent = fetched;
                fetchUrlRow.style.display = '';
            } else {
                fetchUrlRow.style.display = 'none';
            }
        };

        // 事件绑定
        rawUrlInput.addEventListener('input', updateFetchUrlPreview);
        providerSel.addEventListener('change', updateFetchUrlPreview);

        btnSave.addEventListener('click', () => {
            const rawUrl = rawUrlInput.value.trim();
            if (!rawUrl) {
                App.showToast('请先填写 txt 文件 URL', 'error');
                return;
            }
            const newCfg = CloudSync.saveConfig({
                enabled: enabledCb.checked,
                provider: providerSel.value,
                rawUrl: rawUrl,
                intervalMin: parseInt(intervalSel.value, 10) || 15
            });
            statusEl.textContent = CloudSync.formatLastFetch();
            App.showToast('配置已保存' + (newCfg.enabled ? '，启用自动拉取' : ''), 'success');
        });

        btnTest.addEventListener('click', async () => {
            if (!rawUrlInput.value.trim()) {
                App.showToast('请先填写 txt 文件 URL', 'error');
                return;
            }
            // 先保存再拉取（用最新表单值）
            CloudSync.saveConfig({
                enabled: enabledCb.checked,
                provider: providerSel.value,
                rawUrl: rawUrlInput.value.trim(),
                intervalMin: parseInt(intervalSel.value, 10) || 15
            });
            const result = await CloudSync.fetchManual();
            if (result.ok) {
                statusEl.textContent = CloudSync.formatLastFetch();
                statusEl.classList.add('has-fetch');
                // 拉取成功 → 存本地快照（冲突检测基准）
                CloudSync._saveLocalSnapshot();
            }
        });

        // 配置弹窗打开时填充
        document.getElementById('btnConfig').addEventListener('click', () => {
            // 延迟一帧让 modal 先渲染
            setTimeout(fillForm, 0);
        });

        // 初始填充一次（首次打开配置前就有配置的情况）
        fillForm();
    },

    /**
     * 执行网络搜索
     * @param {string} engineId 可选，临时指定引擎（仅本次搜索生效，不改默认）
     * @param {boolean} alsoSetDefault 本次选择后也设为默认引擎（长按选择器用）
     */
    openWebSearch(engineId, alsoSetDefault) {
        const input = document.getElementById('searchInput');
        const q = (input && input.value || '').trim();
        if (!q) {
            this.showToast(this.t('webSearchEmpty'), 'error');
            input && input.focus();
            return;
        }
        const eng = this.getSearchEngine(engineId);
        if (alsoSetDefault) this.setDefaultEngineId(eng.id);
        const url = eng.url.replace('{q}', encodeURIComponent(q));
        window.open(url, '_blank', 'noopener');
    },

    /**
     * 显示"长按切换默认引擎"弹出菜单
     */
    showEnginePicker(x, y) {
        // 清除旧的
        this.hideEnginePicker();
        const wrap = document.createElement('div');
        wrap.id = 'enginePicker';
        wrap.className = 'engine-picker';
        const title = document.createElement('div');
        title.className = 'engine-picker-title';
        title.textContent = this.t('webSearchTitle');
        wrap.appendChild(title);
        const current = this.getDefaultEngineId();
        this.SEARCH_ENGINES.forEach(e => {
            const item = document.createElement('div');
            item.className = 'engine-picker-item';
            if (e.id === current) item.classList.add('is-current');
            item.dataset.engineId = e.id;
            item.innerHTML =
                '<span class="engine-check">✓</span>'
                + '<span class="engine-name">' + this.getEngineName(e.id) + '</span>';
            item.addEventListener('click', (ev) => {
                ev.stopPropagation();
                this.setDefaultEngineId(e.id);
                this.showToast(this.t('webSearchHolding', { name: this.getEngineName(e.id) }), 'info');
                this.hideEnginePicker();
            });
            wrap.appendChild(item);
        });
        document.body.appendChild(wrap);
        // 定位：优先点击坐标，超出视口则收边
        const maxW = window.innerWidth - 16;
        const maxH = window.innerHeight - 16;
        const targetX = Math.max(8, Math.min(maxW - 40, x));
        const targetY = Math.max(8, Math.min(maxH - 40, y));
        wrap.style.left = targetX + 'px';
        wrap.style.top  = targetY + 'px';
        // 先占位定位，再对齐到右下方（弹出框贴住按钮右下展开）
        requestAnimationFrame(() => {
            const rect = wrap.getBoundingClientRect();
            let left = targetX - rect.width + 8;
            let top  = targetY + 10;
            if (left < 8) left = 8;
            if (top + rect.height > window.innerHeight - 8) top = Math.max(8, targetY - rect.height - 10);
            if (left + rect.width > window.innerWidth - 8) left = window.innerWidth - 8 - rect.width;
            wrap.style.left = left + 'px';
            wrap.style.top  = top  + 'px';
            wrap.classList.add('visible');
        });
        // 任意外部触摸/点击/滚动 → 关闭
        // 【移动端】长按弹出后手指抬起可能合成 click 落在本按钮上；外部点击又可能
        // 落在 stopPropagation 元素上或根本不合成 click。故用非 once 监听 + 在
        // hideEnginePicker 中统一移除，touchstart 作为主要关闭信号（不依赖 click）。
        const closer = (e) => {
            // 触摸/点击发生在选择器内部 → 交给条目自己的 click 处理，不关闭
            if (e && e.target && wrap.contains(e.target)) return;
            // 长按弹出瞬间，手指抬起合成的 click 落在 🌐 按钮上 → 不关闭
            const btn = document.getElementById('btnWebSearch');
            if (e && e.type === 'click' && btn && btn.contains(e.target)) return;
            this.hideEnginePicker();
        };
        wrap._closers = closer;
        document.addEventListener('click', closer);
        document.addEventListener('touchstart', closer, { passive: true });
        document.addEventListener('scroll', closer, { capture: true });
    },

    hideEnginePicker() {
        const p = document.getElementById('enginePicker');
        if (!p) return;
        if (p._closers) {
            document.removeEventListener('click', p._closers);
            document.removeEventListener('touchstart', p._closers);
            document.removeEventListener('scroll', p._closers, { capture: true });
        }
        p.remove();
    },

    /**
     * 应用拖拽排序锁状态
     * 锁定时：隐藏所有拖拽手柄（CSS）+ 禁用 Sortable 实例（双保险）
     */
    applyDragLock() {
        const locked = !this.dragUnlocked;
        document.body.classList.toggle('drag-locked', locked);
        (Tree.treeSortables || []).forEach(s => s.option('disabled', locked));
        if (Bookmarks.sortable) Bookmarks.sortable.option('disabled', locked);

        const btn = document.getElementById('btnLockDrag');
        if (btn) {
            // 已解锁=显示开口锁（可点击锁定）；已锁定=显示闭口锁（可点击解锁）
            btn.innerHTML = this.dragUnlocked ? this.SVG_UNLOCK : this.SVG_LOCK;
            btn.classList.toggle('lock-active', locked);
            btn.title = this.currentLanguage === 'en-US'
                ? (this.dragUnlocked ? 'Drag sorting unlocked (click to lock)' : 'Drag sorting locked (click to unlock)')
                : (this.dragUnlocked ? '拖拽已解锁（点击锁定）' : '拖拽已锁定（点击解锁）');
        }
    },

    /**
     * 更新展开/折叠切换按钮的图标和 tooltip
     * 只要有任意一个文件夹处于展开状态 → 显示"全部折叠"图标（双向上箭头）
     * 所有文件夹都是折叠的 → 显示"全部展开"图标（双向下箭头）
     */
    updateToggleExpandBtn() {
        const btn = document.getElementById('btnToggleExpand');
        if (!btn) return;
        const anyExpanded = Tree.expandedNodes.size > 0;
        // 全部展开图标：双向下箭头；全部折叠图标：双向上箭头
        const expandSvg = '<svg viewBox="0 0 1024 1024" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M476.612887 1009.12034L169.240699 695.380437a51.981345 51.981345 0 0 1 0-72.319045 49.382277 49.382277 0 0 1 70.824582 0l271.959897 277.645356 271.862433-277.645356a49.382277 49.382277 0 0 1 70.824582 0 51.981345 51.981345 0 0 1 0 72.319045l-307.307212 313.739903a49.447254 49.447254 0 0 1-70.792094 0z m307.274724-608.116755L511.99269 123.455693l-271.959897 277.645357a49.382277 49.382277 0 0 1-70.824582 0 51.981345 51.981345 0 0 1 0-72.319045L476.580399 15.042102a49.382277 49.382277 0 0 1 70.727117 0l307.372188 313.739903a51.981345 51.981345 0 0 1 0 72.319045 49.414766 49.414766 0 0 1-70.824582 0z"></path></svg>';
        const collapseSvg = '<svg viewBox="0 0 1024 1024" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M783.915092 1009.031953l-271.898251-277.615587-271.930737 277.550617a49.214558 49.214558 0 0 1-70.752018 0 51.780862 51.780862 0 0 1 0-72.246322l307.274261-313.706262a49.279528 49.279528 0 0 1 70.784503 0l307.33923 313.706262a51.975771 51.975771 0 0 1 0 72.311292 49.409467 49.409467 0 0 1-70.816988 0z m-307.306745-608.05155L169.269117 87.274141A51.975771 51.975771 0 0 1 169.269117 14.96285a49.409467 49.409467 0 0 1 70.816987 0l271.930737 277.615586L783.850122 14.96285a49.409467 49.409467 0 0 1 70.816988 0 51.975771 51.975771 0 0 1 0 72.311291l-307.33923 313.706262a49.376982 49.376982 0 0 1-70.719533 0z"></path></svg>';
        btn.innerHTML = anyExpanded ? collapseSvg : expandSvg;
        btn.title = anyExpanded ? '全部折叠' : '全部展开';
    },

    /**
     * 绑定全局事件
     */
    bindGlobalEvents() {
        // 搜索框
        const searchInput = document.getElementById('searchInput');
        const searchBox = document.getElementById('searchBox');
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value;
            // 有内容时显示清除按钮
            searchBox.classList.toggle('has-text', query.length > 0);
            // 每次输入变化 → 回到搜索结果视图（放弃之前在搜索中选中的文件夹）
            Bookmarks.folderSelectedInSearch = false;
            Tree.search(query);
            Bookmarks.render();
        });

        // 清除搜索按钮：清空输入并恢复完整列表
        document.getElementById('btnClearSearch').addEventListener('click', () => {
            searchInput.value = '';
            searchBox.classList.remove('has-text');
            Tree.search('');
            Bookmarks.render();
            searchInput.focus();
        });

        // 网络搜索按钮：点击 → 用默认引擎搜索；长按 450ms → 弹出选择器切换默认引擎
        const btnWebSearch = document.getElementById('btnWebSearch');
        let webPressTimer = null;
        let webPressTriggered = false;
        let webPressStartX = 0;
        let webPressStartY = 0;
        const clearWebPress = () => {
            if (webPressTimer) { clearTimeout(webPressTimer); webPressTimer = null; }
        };
        const startWebPress = (ev) => {
            webPressTriggered = false;
            const pt = (ev.touches && ev.touches[0]) || ev;
            webPressStartX = pt.clientX || 0;
            webPressStartY = pt.clientY || 0;
            const rect = btnWebSearch.getBoundingClientRect();
            const px = webPressStartX || (rect.left + rect.width / 2);
            const py = webPressStartY || (rect.bottom);
            clearWebPress();
            webPressTimer = setTimeout(() => {
                webPressTriggered = true;
                if (navigator.vibrate) { try { navigator.vibrate(20); } catch (_) {} }
                this.showEnginePicker(px, py);
            }, 450);
        };
        const cancelWebPressIfMoved = (ev) => {
            const pt = (ev.touches && ev.touches[0]) || ev;
            const dx = (pt.clientX || 0) - webPressStartX;
            const dy = (pt.clientY || 0) - webPressStartY;
            if (Math.abs(dx) > 8 || Math.abs(dy) > 8) clearWebPress();
        };
        btnWebSearch.addEventListener('touchstart', startWebPress, { passive: true });
        btnWebSearch.addEventListener('mousedown', startWebPress);
        btnWebSearch.addEventListener('touchmove', cancelWebPressIfMoved, { passive: true });
        btnWebSearch.addEventListener('mousemove', cancelWebPressIfMoved);
        btnWebSearch.addEventListener('touchend', (e) => {
            clearWebPress();
            if (webPressTriggered) { e.preventDefault(); }
        });
        btnWebSearch.addEventListener('mouseup', clearWebPress);
        btnWebSearch.addEventListener('mouseleave', clearWebPress);
        btnWebSearch.addEventListener('touchcancel', clearWebPress);
        btnWebSearch.addEventListener('click', (ev) => {
            clearWebPress();
            if (webPressTriggered) {
                // 长按已触发选择器，不要再次点击搜索
                ev.stopPropagation();
                ev.preventDefault();
                webPressTriggered = false;
                return;
            }
            this.openWebSearch();
        });
        // 搜索框回车键：若本地收藏无匹配且文件夹也无匹配 → 触发网络搜索
        searchInput.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            const q = (searchInput.value || '').trim();
            if (!q) return;
            const ql = q.toLowerCase();
            // 收藏标题/URL 匹配 OR 文件夹名匹配
            const hasBookmarkHit = this.data.bookmarks.some(b =>
                b.title.toLowerCase().includes(ql)
                || b.url.toLowerCase().includes(ql));
            const hasFolderHit = (function walk(folders) {
                for (const f of folders) {
                    if (f.name.toLowerCase().includes(ql)) return true;
                    if (f.children && walk(f.children)) return true;
                }
                return false;
            })(this.data.folders);
            if (!hasBookmarkHit && !hasFolderHit) this.openWebSearch();
        });

        // 配置弹窗：默认搜索引擎下拉
        const selEl = document.getElementById('searchEngineSelect');
        if (selEl) {
            selEl.addEventListener('change', (ev) => {
                this.setDefaultEngineId(ev.target.value);
                this.showToast(this.t('webSearchHolding', { name: this.getEngineName(ev.target.value) }), 'success');
            });
        }

        // 拖拽排序总开关（锁）：解锁=显示 ⋮⋮ 并允许拖拽；锁定=隐藏手柄并禁用拖拽
        document.getElementById('btnLockDrag').addEventListener('click', () => {
            this.dragUnlocked = !this.dragUnlocked;
            localStorage.setItem('dragUnlocked', this.dragUnlocked ? '1' : '0');
            this.applyDragLock();
            this.showToast(this.dragUnlocked
                ? (this.currentLanguage === 'en-US' ? 'Drag sorting unlocked' : '已解锁拖拽排序')
                : (this.currentLanguage === 'en-US' ? 'Drag sorting locked' : '已锁定拖拽排序'), 'info');
        });

        // 全部展开 / 全部折叠（一个按钮自动切换）
        const btnToggleExpand = document.getElementById('btnToggleExpand');
        btnToggleExpand.addEventListener('click', () => {
            const anyExpanded = Tree.expandedNodes.size > 0;
            if (anyExpanded) {
                // 只要有任意一个展开 → 全部折叠
                Tree.collapseAllFolders();
                App.showToast('已全部折叠', 'info');
            } else {
                // 全部折叠态 → 全部展开
                Tree.expandAllFolders();
                App.showToast('已全部展开', 'info');
            }
            Tree.render();
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
                    if (confirm(`确定删除"${folder.name}"？\n将移入回收站（保留30天），包含 ${bookmarkCount} 个收藏和 ${subfolderCount} 个子文件夹。`)) {
                        Tree.deleteFolder(Tree.selectedFolderId);
                        Storage.save(this.data);
                        Bookmarks.data = this.data;
                        const newSel = Tree.selectedFolderId;
                        if (newSel) {
                            Tree.selectFolder(newSel);
                        } else {
                            Bookmarks.setFolder(null);
                        }
                        this.showToast(App.t('deletedToTrash'), 'success');
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

        // 语言切换后，同步刷新：配置下拉的引擎选项名、拖拽锁按钮 title
        this.renderSearchEngineSelect();
        this.applyDragLock();
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
                        App.showToast(App.t('emptyFolderTip'), 'error');
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

        // 移动端浮动按钮：回到当前选中的文件夹（P0-3）
        const goBtn = document.getElementById('btnGoCurrentFolder');
        if (goBtn) {
            goBtn.addEventListener('click', () => {
                // 搜索模式下树被过滤，先清除搜索
                const input = document.getElementById('searchInput');
                if (input && input.value) {
                    input.value = '';
                    Tree.search('');
                }
                if (!Tree.selectedFolderId) return;

                // 展开父路径并重新渲染，确保选中节点在 DOM 中
                Tree.expandParentPath(Tree.selectedFolderId);
                Tree.render();

                // 滚动到选中节点并闪烁提示
                setTimeout(() => {
                    const header = document.querySelector('.tree-node-header.selected');
                    if (header) {
                        header.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        header.classList.add('flash-highlight');
                        setTimeout(() => header.classList.remove('flash-highlight'), 1500);
                    }
                }, 60);
            });

            // 首屏不显示，滚动文件夹树时才出现，停止滚动 2 秒后淡出
            const treeEl = document.getElementById('folderTree');
            if (treeEl) {
                let hideTimer = null;
                treeEl.addEventListener('scroll', () => {
                    goBtn.classList.add('visible');
                    if (hideTimer) clearTimeout(hideTimer);
                    hideTimer = setTimeout(() => goBtn.classList.remove('visible'), 2000);
                }, { passive: true });
            }
        }
    }
};

// 启动应用
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
