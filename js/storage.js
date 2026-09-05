/**
 * 存储模块 - 管理 localStorage 和默认数据
 */

const Storage = {
    STORAGE_KEY: 'custom_favorites_data_v3',

    /**
     * 默认数据结构（首次打开的初始收藏数据）
     */
    getDefaultData() {
        return {
            folders: [
                {
                    id: 'f_01',
                    name: '一级目录01',
                    children: [
                        {
                            id: 'f_01_02',
                            name: '二级目录',
                            children: []
                        }
                    ]
                },
                {
                    id: 'f_02',
                    name: '一级目录02',
                    children: []
                }
            ],
            bookmarks: [
                { id: 'b_01_1', title: '百度', url: 'https://www.baidu.com/', folderId: 'f_01' },
                { id: 'b_01_2', title: '必应', url: 'https://cn.bing.com/', folderId: 'f_01' },
                { id: 'b_01_3', title: '搜狗', url: 'https://www.sogou.com/', folderId: 'f_01' },
                { id: 'b_01_02_1', title: '必应', url: 'https://cn.bing.com/', folderId: 'f_01_02' },
                { id: 'b_02_1', title: '百度', url: 'https://www.baidu.com/', folderId: 'f_02' },
                { id: 'b_02_2', title: '必应', url: 'https://cn.bing.com/', folderId: 'f_02' },
                { id: 'b_02_3', title: '搜狗', url: 'https://www.sogou.com/', folderId: 'f_02' }
            ],
            folderOrder: {},
            settings: {
                language: 'zh-CN'
            }
        };
    },
    
    /**
     * 加载数据
     */
    load() {
        try {
            let data = localStorage.getItem(this.STORAGE_KEY);
            if (data) {
                data = JSON.parse(data);
                return this.ensureDataCompatible(data);
            }
        } catch (e) {
            console.error('加载存储数据失败:', e);
        }
        // 首次加载默认数据
        const defaultData = this.getDefaultData();
        this.ensureDataCompatible(defaultData);
        this.save(defaultData);
        return defaultData;
    },
    
    /**
     * 保存数据
     */
    save(data) {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
            return true;
        } catch (e) {
            console.error('保存数据失败:', e);
            return false;
        }
    },
    
    /**
     * 清空数据
     */
    clear() {
        localStorage.removeItem(this.STORAGE_KEY);
    },
    
    /**
     * 生成唯一 ID
     */
    generateId(prefix = 'id') {
        return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    },
    
    /**
     * 确保数据兼容（加载旧数据时添加缺失字段）
     */
    ensureDataCompatible(data) {
        if (!data.folderOrder) {
            data.folderOrder = {};
        }
        
        // 回收站结构（旧数据没有该字段时补全）
        if (!data.trash || typeof data.trash !== 'object') {
            data.trash = { folders: [], bookmarks: [] };
        }
        if (!Array.isArray(data.trash.folders)) data.trash.folders = [];
        if (!Array.isArray(data.trash.bookmarks)) data.trash.bookmarks = [];
        
        // 回收站保留 30 天，过期自动清理
        const RETAIN_MS = 30 * 24 * 60 * 60 * 1000;
        const now = Date.now();
        const before = data.trash.bookmarks.length + data.trash.folders.length;
        data.trash.bookmarks = data.trash.bookmarks.filter(b => b.deletedAt && (now - b.deletedAt) < RETAIN_MS);
        data.trash.folders = data.trash.folders.filter(e => e.deletedAt && (now - e.deletedAt) < RETAIN_MS);
        if (before !== data.trash.bookmarks.length + data.trash.folders.length) {
            this.save(data);
        }
        
        // 强制重建 folderOrder 以确保一致性
        this.buildFolderOrderFromBookmarks(data);
        return data;
    },
    
    /**
     * 从 bookmarks 数组构建 folderOrder
     */
    buildFolderOrderFromBookmarks(data) {
        const orderMap = {};
        for (const bm of data.bookmarks) {
            if (!orderMap[bm.folderId]) {
                orderMap[bm.folderId] = [];
            }
            if (!orderMap[bm.folderId].includes(bm.id)) {
                orderMap[bm.folderId].push(bm.id);
            }
        }
        // 合并：保留已有的排序，补全缺失的
        for (const folderId of Object.keys(orderMap)) {
            if (!data.folderOrder[folderId] || data.folderOrder[folderId].length === 0) {
                // 没有排序或排序为空，使用书签的默认顺序
                data.folderOrder[folderId] = orderMap[folderId];
            } else {
                // 确保所有收藏都在排序中
                for (const id of orderMap[folderId]) {
                    if (!data.folderOrder[folderId].includes(id)) {
                        data.folderOrder[folderId].push(id);
                    }
                }
                // 移除已删除的书签 ID
                data.folderOrder[folderId] = data.folderOrder[folderId].filter(id => 
                    orderMap[folderId].includes(id)
                );
            }
        }
        // 移除不再有书签的文件夹排序
        for (const folderId of Object.keys(data.folderOrder)) {
            if (!orderMap[folderId]) {
                delete data.folderOrder[folderId];
            }
        }
    },
    
    /**
     * 为指定文件夹获取排序后的收藏 ID 列表
     */
    getFolderOrder(data, folderId) {
        if (data.folderOrder && data.folderOrder[folderId] && data.folderOrder[folderId].length > 0) {
            return [...data.folderOrder[folderId]];
        }
        // 没有排序，从 bookmarks 构建
        return data.bookmarks
            .filter(b => b.folderId === folderId)
            .map(b => b.id);
    },
    
    /**
     * 更新文件夹排序
     */
    updateFolderOrder(data, folderId, orderedIds) {
        if (!data.folderOrder) {
            data.folderOrder = {};
        }
        data.folderOrder[folderId] = orderedIds;
        this.save(data);
    }
};
