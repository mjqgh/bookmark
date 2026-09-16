/**
 * 本地双向同步模块 —— 用 File System Access API 读写本地 txt 文件
 *
 * 瓶颈：普通 <input type="file"> 只返回只读 File 对象，无法写回。
 *       必须用 window.showOpenFilePicker() 获取 FileSystemFileHandle，
 *       才能在后续会话中持续读写同一文件。
 *
 * 存储：FileSystemFileHandle 不能序列化到 localStorage，存 IndexedDB。
 *       每次页面重载后需重新 queryPermission / requestPermission。
 *
 * 兼容：仅 Chromium 系浏览器（Chrome/Edge 86+）支持。
 *       Firefox/Safari 不支持，自动降级并显示提示。
 *
 * 同步策略（仿照 CloudSync 的基线快照）：
 *   - 定时轮询文件内容 → 与基线快照比较 → 仅文件变则导入本地
 *   - 本地数据改动 → 自动检测 → 仅本地变则写回文件
 *   - 两边都变 → 三选一弹窗（拉取 / 强制覆盖 / 取消）
 */

const LocalSync = {
    _config: null,      // { enabled, intervalMin, fileName }
    _handle: null,      // FileSystemFileHandle
    _timer: null,

    // IndexedDB 简易封装（FileSystemHandle 只能存 IndexedDB）
    _openDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('LocalSync', 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains('handles')) {
                    db.createObjectStore('handles');
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },
    async _saveHandle(handle) {
        const db = await this._openDB();
        await new Promise((res, rej) => {
            const tx = db.transaction('handles', 'readwrite');
            tx.objectStore('handles').put(handle, 'file_handle');
            tx.oncomplete = res;
            tx.onerror = rej;
        });
    },
    async _loadHandle() {
        try {
            const db = await this._openDB();
            return await new Promise((res, rej) => {
                const tx = db.transaction('handles', 'readonly');
                const req = tx.objectStore('handles').get('file_handle');
                req.onsuccess = () => res(req.result || null);
                req.onerror = rej;
            });
        } catch (e) {
            return null;
        }
    },
    async _clearHandle() {
        try {
            const db = await this._openDB();
            await new Promise((res, rej) => {
                const tx = db.transaction('handles', 'readwrite');
                tx.objectStore('handles').delete('file_handle');
                tx.oncomplete = res;
                tx.onerror = rej;
            });
        } catch (e) { /* ignore */ }
    },

    // =====================================================
    // 初始化
    // =====================================================
    async init() {
        this._config = this._loadConfig();

        // 浏览器兼容检测
        this._supported = 'showOpenFilePicker' in window;
        if (!this._supported) {
            return;
        }

        // 从 IndexedDB 恢复 handle
        this._handle = await this._loadHandle();

        // 检查权限（页面重载后权限会回到 prompt，需要用户再次点击按钮触发 requestPermission）
        if (this._handle) {
            try {
                const perm = await this._handle.queryPermission({ mode: 'readwrite' });
                this._permission = perm;
                // 权限已授予 → 自动开启定时
                if (perm === 'granted' && this._config.enabled) {
                    this._startTimer();
                    // 加载文件基线（首次或文件被外部改过）
                    await this._loadBaseline();
                }
            } catch (e) {
                this._permission = 'unknown';
            }
        }
    },

    _defaultConfig() {
        return {
            enabled: false,
            intervalMin: 15,
            fileName: '',
            lastFetchTs: 0
        };
    },
    _loadConfig() {
        try {
            const raw = localStorage.getItem('local_sync_config');
            if (raw) return { ...this._defaultConfig(), ...JSON.parse(raw) };
        } catch (e) { /* ignore */ }
        return this._defaultConfig();
    },
    _saveConfig(partial) {
        this._config = { ...this._config, ...partial };
        localStorage.setItem('local_sync_config', JSON.stringify(this._config));
        // 互斥：启用本地同步 → 自动关闭云端同步
        if (partial.enabled === true) {
            const cloudCfg = CloudSync.getConfig();
            if (cloudCfg.enabled || cloudCfg.twoWay) {
                CloudSync.saveConfig({ enabled: false, twoWay: false });
            }
        }
        // 启停定时器
        if (this._config.enabled) {
            this._startTimer();
        } else {
            this._stopTimer();
        }
        return this._config;
    },
    getConfig() {
        return { ...this._config };
    },
    isSupported() {
        return this._supported !== false;
    },
    getHandle() {
        return this._handle;
    },
    hasPermission() {
        return this._permission === 'granted';
    },

    // =====================================================
    // 选文件（showOpenFilePicker）
    // =====================================================
    async pickFile() {
        if (!this._supported) {
            App.showToast('当前浏览器不支持本地同步，请使用 Chrome / Edge', 'error');
            return null;
        }
        try {
            const [handle] = await window.showOpenFilePicker({
                types: [{
                    description: 'Bookmarks File',
                    accept: { 'text/plain': ['.txt'] }
                }]
            });
            // 立即请求读写权限（用户手势内调用）
            const perm = await handle.requestPermission({ mode: 'readwrite' });
            if (perm !== 'granted') {
                App.showToast('未授予文件读写权限', 'error');
                return null;
            }
            this._handle = handle;
            this._permission = 'granted';
            await this._saveHandle(handle);

            // 记录文件名
            this._saveConfig({ fileName: handle.name });

            // 读取文件作为基线（允许空文件作为初始状态）
            try {
                const content = await this._readFile();
                localStorage.setItem('local_sync_last_snapshot', content || '');
            } catch (e) { /* 文件可能暂时不可读 */ }

            App.showToast(`已绑定：${handle.name}`, 'success');
            return handle;
        } catch (e) {
            if (e.name === 'AbortError') {
                // 用户取消了文件选择
                return null;
            }
            console.error('[LocalSync] pickFile error:', e);
            App.showToast('选择文件失败：' + e.message, 'error');
            return null;
        }
    },

    // =====================================================
    // 读文件 / 写文件
    // =====================================================
    async _readFile() {
        if (!this._handle) throw new Error('未绑定文件');
        const file = await this._handle.getFile();
        return await file.text();
    },
    async _writeFile(content) {
        if (!this._handle) throw new Error('未绑定文件');
        const writable = await this._handle.createWritable();
        await writable.write(content);
        await writable.close();
    },

    // =====================================================
    // 基线快照（用于冲突检测）
    // =====================================================
    _saveBaseline(content) {
        localStorage.setItem('local_sync_last_snapshot', content || '');
    },
    async _loadBaseline() {
        const snap = localStorage.getItem('local_sync_last_snapshot');
        if (snap !== null) return snap;
        // 没有基线 → 从文件读取一次作为初始基线
        try {
            const content = await this._readFile();
            this._saveBaseline(content);
            return content || '';
        } catch (e) {
            return '';
        }
    },

    // 判定文件内容是否包含有效同步数据
    _hasValidContent(txt) {
        return /^#+\s*\S/m.test(txt || '');
    },
    _normalizeContent(txt) {
        return String(txt || '').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
    },

    // =====================================================
    // 定时轮询文件
    // =====================================================
    _startTimer() {
        this._stopTimer();
        if (!this._config.intervalMin) return;
        const self = this;
        const scheduleNext = () => {
            const interval = (this._config.intervalMin || 15) * 60 * 1000;
            self._timer = setTimeout(async () => {
                if (self._config.enabled) {
                    await self.syncPull(true);
                    scheduleNext();
                }
            }, interval);
        };
        scheduleNext();
    },
    _stopTimer() {
        if (this._timer) {
            clearTimeout(this._timer);
            this._timer = null;
        }
    },

    // =====================================================
    // 双向同步核心：定时轮询文件 → 检测变化 → 导入
    // =====================================================
    /**
     * 拉取本地文件改动 → 应用到本地数据
     * @param {boolean} silent true=定时静默，无 toast；false=手动触发
     */
    async syncPull(silent) {
        if (!this._handle) {
            if (!silent) App.showToast('未绑定本地同步文件', 'error');
            return { ok: false, reason: 'no_handle' };
        }

        // 检查权限
        try {
            const perm = await this._handle.queryPermission({ mode: 'readwrite' });
            if (perm !== 'granted') {
                this._permission = perm;
                if (!silent) App.showToast('文件权限已丢失，请重新点击"选择本地同步文件"', 'error');
                return { ok: false, reason: 'no_permission' };
            }
        } catch (e) {
            return { ok: false, reason: 'perm_error' };
        }

        try {
            const fileRaw = await this._readFile();
            const file = this._normalizeContent(fileRaw);
            const baseline = this._normalizeContent(localStorage.getItem('local_sync_last_snapshot') || '');
            const local = this._normalizeContent(Config.serializeData());

            // 文件没变
            if (file === baseline) {
                this._config.lastFetchTs = Date.now();
                localStorage.setItem('local_sync_config', JSON.stringify(this._config));
                return { ok: true, action: 'in_sync' };
            }

            // 有效同步数据判定
            const fileValid = this._hasValidContent(file);
            const baselineValid = this._hasValidContent(baseline);

            // 文件变了：应用到本地
            if (fileValid) {
                const applied = Config.processImport(file, true);
                if (!applied) {
                    if (!silent) App.showToast('本地文件内容无法识别，已跳过', 'error');
                    return { ok: false, reason: 'unparseable' };
                }
                this._saveBaseline(file);
                this._config.lastFetchTs = Date.now();
                localStorage.setItem('local_sync_config', JSON.stringify(this._config));
                if (!silent) App.showToast('已从本地文件同步', 'success');
                return { ok: true, action: 'pulled' };
            } else if (file === '' || !fileValid) {
                // 文件被清空/无效 → 本地优先，写回文件
                const localRaw = Config.serializeData();
                if (this._hasValidContent(localRaw)) {
                    await this._writeFile(localRaw);
                    this._saveBaseline(this._normalizeContent(localRaw));
                    this._config.lastFetchTs = Date.now();
                    localStorage.setItem('local_sync_config', JSON.stringify(this._config));
                    if (!silent) App.showToast('文件为空，已将本地数据写回', 'success');
                    return { ok: true, action: 'pushed' };
                }
            }
        } catch (e) {
            if (!silent) App.showToast('读取本地文件失败：' + e.message, 'error');
        }
        return { ok: false, reason: 'unknown' };
    },

    /**
     * 本地改动 → 写回文件
     * 检查基线：只有"本地变了且文件没变"时才安全写回；两边都变则提示冲突
     */
    async syncPush(silent) {
        if (!this._handle) {
            if (!silent) App.showToast('未绑定本地同步文件', 'error');
            return { ok: false, reason: 'no_handle' };
        }
        try {
            const fileRaw = await this._readFile();
            const file = this._normalizeContent(fileRaw);
            const baseline = this._normalizeContent(localStorage.getItem('local_sync_last_snapshot') || '');
            const local = this._normalizeContent(Config.serializeData());

            // 本地没变
            if (local === baseline) {
                return { ok: true, action: 'no_local_change' };
            }

            // 本地变了但文件也变了 → 冲突
            if (file !== baseline) {
                if (!silent) {
                    const choice = await this._confirmConflict();
                    if (choice === 'pull') {
                        Config.processImport(fileRaw, true);
                        this._saveBaseline(file);
                        this._config.lastFetchTs = Date.now();
                        localStorage.setItem('local_sync_config', JSON.stringify(this._config));
                        App.showToast('已用文件内容覆盖本地', 'success');
                        return { ok: true, action: 'pulled' };
                    } else if (choice === 'force') {
                        await this._writeFile(local);
                        this._saveBaseline(local);
                        this._config.lastFetchTs = Date.now();
                        localStorage.setItem('local_sync_config', JSON.stringify(this._config));
                        App.showToast('已用本地数据覆盖文件', 'success');
                        return { ok: true, action: 'forced' };
                    } else {
                        return { ok: false, reason: 'cancelled' };
                    }
                }
                return { ok: false, reason: 'conflict' };
            }

            // 仅本地变了 → 安全写回
            await this._writeFile(Config.serializeData());
            this._saveBaseline(local);
            this._config.lastFetchTs = Date.now();
            localStorage.setItem('local_sync_config', JSON.stringify(this._config));
            if (!silent) App.showToast('已写入本地文件', 'success');
            return { ok: true, action: 'pushed' };
        } catch (e) {
            if (!silent) App.showToast('写入本地文件失败：' + e.message, 'error');
            return { ok: false, reason: e.message };
        }
    },

    /**
     * 手动双向同步（云端有 syncNow，这里也提供）
     */
    async syncNow() {
        // 先检查权限（手动操作需要 prompt 用户重新授权）
        if (this._handle) {
            try {
                const perm = await this._handle.queryPermission({ mode: 'readwrite' });
                if (perm !== 'granted') {
                    // 用户手势内请求授权
                    const newPerm = await this._handle.requestPermission({ mode: 'readwrite' });
                    this._permission = newPerm;
                    if (newPerm !== 'granted') {
                        App.showToast('未授予文件读写权限', 'error');
                        return { ok: false, reason: 'no_permission' };
                    }
                }
            } catch (e) {
                // requestPermission 可能抛错（非用户手势等）
                App.showToast('无法获取文件权限：' + e.message, 'error');
                return { ok: false, reason: 'perm_error' };
            }
        }

        // 先拉取（文件变化先应用），再推送（本地变化再写回）
        await this.syncPull(false);
        return await this.syncPush(false);
    },

    /**
     * 冲突确认弹窗（复用 syncConflictModal，或用原生 confirm 简化）
     */
    _confirmConflict() {
        return new Promise(resolve => {
            const choice = confirm(
                '检测到本地文件和应用内数据都发生了变化。\n\n' +
                '点击"确定" → 强制用应用内数据覆盖文件\n' +
                '点击"取消" → 用文件内容覆盖应用内数据'
            );
            resolve(choice ? 'force' : 'pull');
        });
    },

    /**
     * 格式化上次同步时间
     */
    formatLastSync() {
        const ts = this._config.lastFetchTs;
        if (!ts) return '从未同步';
        const d = new Date(ts);
        const pad = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    },

    /**
     * 清除绑定（用户想换文件）
     */
    async unbind() {
        await this._clearHandle();
        this._handle = null;
        this._permission = null;
        this._saveConfig({ fileName: '', enabled: false });
        localStorage.removeItem('local_sync_last_snapshot');
    }
};

// 显式挂 window：const 在 script 块内不自动污染 window，
// 但同页面后续脚本需要能直接访问 LocalSync
window.LocalSync = LocalSync;
