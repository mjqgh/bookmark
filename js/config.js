/**
 * 配置模块 - 导出、导入、在线加载
 */

const Config = {
    data: null,
    onImport: null,
    
    /**
     * 初始化
     */
    init(data, callbacks) {
        this.data = data;
        this.onImport = callbacks.onImport || function() {};
        this.bindEvents();
    },
    
    /**
     * 绑定事件
     */
    bindEvents() {
        // 配置按钮
        document.getElementById('btnConfig').addEventListener('click', () => {
            document.getElementById('configModal').classList.add('active');
        });
        
        // 本地文件导入按钮
        document.getElementById('btnImportFile').addEventListener('click', () => {
            document.getElementById('importFileInput').click();
        });
        
        // 文件选择处理
        document.getElementById('importFileInput').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                this.importFromFile(file);
            }
            e.target.value = ''; // 重置
        });
        
        // URL 导入按钮
        document.getElementById('btnImportUrl').addEventListener('click', () => {
            const url = document.getElementById('urlInput').value.trim();
            if (!url) {
                App.showToast('请输入 URL', 'error');
                return;
            }
            this.importFromUrl(url);
        });
        
        // 导出按钮
        document.getElementById('btnExport').addEventListener('click', () => {
            this.exportToFile();
        });
    },
    
    /**
     * 导出为 txt 文件
     */
    exportToFile() {
        const content = this.serializeData();
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `收藏夹备份_${this.getTimestamp()}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        App.showToast('导出成功', 'success');
    },
    
    /**
     * 序列化数据为 txt 格式
     */
    serializeData() {
        const lines = [];
        
        const traverse = (folders, level) => {
            for (const folder of folders) {
                const prefix = '#'.repeat(level);
                lines.push(`${prefix}${folder.name}`);
                
                // 获取该文件夹下的收藏（按排序）
                const orderedBookmarks = this.getOrderedBookmarksForExport(folder.id);
                for (const bm of orderedBookmarks) {
                    lines.push(`${bm.title},${bm.url}`);
                }
                
                // 递归处理子文件夹
                if (folder.children && folder.children.length > 0) {
                    traverse(folder.children, level + 1);
                }
            }
        };
        
        traverse(this.data.folders, 1);
        return lines.join('\n');
    },
    
    /**
     * 获取排序后的收藏（用于导出）
     */
    getOrderedBookmarksForExport(folderId) {
        const bookmarks = this.data.bookmarks.filter(b => b.folderId === folderId);
        const order = this.data.folderOrder && this.data.folderOrder[folderId] 
            ? this.data.folderOrder[folderId] 
            : bookmarks.map(b => b.id);
        const bookmarkMap = {};
        bookmarks.forEach(b => { bookmarkMap[b.id] = b; });
        return order.map(id => bookmarkMap[id]).filter(b => b !== undefined);
    },
    
    /**
     * 从本地文件导入
     */
    importFromFile(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const content = e.target.result;
                this.processImport(content);
            } catch (err) {
                App.showToast('导入失败：' + err.message, 'error');
            }
        };
        reader.onerror = () => {
            App.showToast('读取文件失败', 'error');
        };
        reader.readAsText(file, 'UTF-8');
    },
    
    /**
     * 从 URL 在线加载
     */
    async importFromUrl(url) {
        App.showToast('正在加载...', 'info');
        
        try {
            const response = await fetch(url, {
                headers: {
                    'Accept': 'text/plain'
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const content = await response.text();
            this.processImport(content);
        } catch (err) {
            let msg = '加载失败';
            if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
                msg = '网络错误或 CORS 限制。请使用支持跨域的 URL（如 GitHub raw 文件链接）';
            } else {
                msg = msg + '：' + err.message;
            }
            App.showToast(msg, 'error');
        }
    },
    
    /**
     * 处理导入内容
     */
    processImport(content) {
        try {
            const result = this.parseData(content);
            
            if (!result.folders || result.folders.length === 0) {
                App.showToast('导入失败：未找到有效的文件夹数据', 'error');
                return;
            }
            
            const count = result.bookmarks.length;
            const folderCount = this.countAllFolders(result.folders);
            
            if (!confirm(`导入将覆盖现有数据。\n检测到 ${folderCount} 个文件夹，${count} 个收藏。\n是否继续？`)) {
                return;
            }
            
            // 更新数据
            this.data.folders = result.folders;
            this.data.bookmarks = result.bookmarks;
            
            // 重建 folderOrder 排序数据
            Storage.ensureDataCompatible(this.data);
            
            // 清空展开状态
            Tree.expandedNodes.clear();
            this.data.folders.forEach(f => Tree.expandedNodes.add(f.id));
            Tree.selectedFolderId = this.data.folders.length > 0 ? this.data.folders[0].id : null;
            
            // 保存
            Storage.save(this.data);
            
            // 重新渲染
            Tree.data = this.data;
            Tree.render();
            Bookmarks.data = this.data;
            
            // 设置当前选中的文件夹
            if (Tree.selectedFolderId) {
                Bookmarks.setFolder(Tree.selectedFolderId);
            } else {
                Bookmarks.render();
            }
            
            document.getElementById('configModal').classList.remove('active');
            App.showToast(`导入成功：${folderCount} 个文件夹，${count} 个收藏`, 'success');
            
        } catch (err) {
            console.error('导入解析错误:', err);
            App.showToast('导入失败：' + err.message, 'error');
        }
    },
    
    /**
     * 解析 txt 格式数据
     */
    parseData(content) {
        const lines = content.split(/\r?\n/);
        const rootFolders = [];
        const bookmarkList = [];
        
        // 使用栈来跟踪当前层级
        const stack = []; // [{ level, folder }]
        
        for (const line of lines) {
            const trimmed = line.trim();
            
            // 跳过空行
            if (!trimmed) continue;
            
            // 检查是否为文件夹行（以 # 开头）
            if (trimmed.startsWith('#')) {
                const match = trimmed.match(/^(#+)\s*(.+)$/);
                if (match) {
                    const level = match[1].length;
                    const name = match[2].trim();
                    
                    const newFolder = {
                        id: Storage.generateId('folder'),
                        name: name,
                        children: []
                    };
                    
                    // 清除栈中所有同级或更深层的节点
                    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
                        stack.pop();
                    }
                    
                    // 添加到父节点或根
                    if (stack.length === 0) {
                        rootFolders.push(newFolder);
                    } else {
                        const parent = stack[stack.length - 1].folder;
                        parent.children = parent.children || [];
                        parent.children.push(newFolder);
                    }
                    
                    stack.push({ level: level, folder: newFolder });
                }
            } else if (trimmed.includes(',')) {
                // 收藏条目：标题,URL
                const commaIndex = trimmed.indexOf(',');
                const title = trimmed.substring(0, commaIndex).trim();
                const url = trimmed.substring(commaIndex + 1).trim();
                
                // 获取当前最内层文件夹
                const currentFolder = stack.length > 0 ? stack[stack.length - 1].folder : null;
                
                if (currentFolder) {
                    bookmarkList.push({
                        id: Storage.generateId('bookmark'),
                        folderId: currentFolder.id,
                        title: title,
                        url: url
                    });
                }
            }
        }
        
        return {
            folders: rootFolders,
            bookmarks: bookmarkList
        };
    },
    
    /**
     * 统计所有文件夹数量
     */
    countAllFolders(folders) {
        let count = 0;
        const traverse = (f) => {
            count += f.length;
            for (const folder of f) {
                if (folder.children) {
                    traverse(folder.children);
                }
            }
        };
        traverse(folders);
        return count;
    },
    
    /**
     * 获取时间戳
     */
    getTimestamp() {
        const now = new Date();
        return now.getFullYear() + 
            String(now.getMonth() + 1).padStart(2, '0') + 
            String(now.getDate()).padStart(2, '0') + '_' +
            String(now.getHours()).padStart(2, '0') + 
            String(now.getMinutes()).padStart(2, '0');
    }
};
