/**
 * 云端同步模块 —— 用户自带存储，零后端
 * 
 * 支持：GitHub (jsDelivr 加速)、WebDAV（坚果云/Nextcloud）、
 *       国内对象存储（七牛/阿里 OSS）等任意能被 fetch 到的 txt URL
 * 
 * 工作方式：
 *   只读拉取模式 —— 云端 txt 是 Source of Truth
 *   本地改动 → 下次拉取前检测冲突 → 提示用户导出保存再拉取
 */

const CloudSync = {
    // 配置结构：
    // {
    //   provider: 'github' | 'webdav' | 'qiniu' | 'aliyun' | 'custom',
    //   rawUrl:  'https://raw.githubusercontent.com/...',   // 用户填的原始 URL
    //   fetchUrl:'https://cdn.jsdelivr.net/gh/...',         // 实际拉取的（加速后）URL
    //   intervalMin: 15,                                      // 拉取间隔（分钟）
    //   enabled: true,
    //   lastFetchTs: 0,
    //   lastETag: '',
    //   localBackupTs: 0                                      // 冲突检测用：上次拉取时本地数据快照
    // }
    _config: null,
    _timer: null,

    // =====================================================
    // 初始化
    // =====================================================
    init() {
        this._config = this._loadConfig();
        if (this._config.enabled && this._config.fetchUrl) {
            this._startAutoFetch();
        }
        // 页面重新可见时立刻检查一次
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && this._config.enabled && this._config.fetchUrl) {
                // 节流：距离上次拉取 > 1 分钟才触发
                if (Date.now() - (this._config.lastFetchTs || 0) > 60 * 1000) {
                    this.fetchSilent();
                }
            }
        });
    },

    // =====================================================
    // 配置存取（localStorage）
    // =====================================================
    _loadConfig() {
        try {
            const raw = localStorage.getItem('cloud_sync_config');
            if (raw) return JSON.parse(raw);
        } catch (e) { /* ignore */ }
        return {
            provider: 'github',
            rawUrl: '',
            fetchUrl: '',
            intervalMin: 15,
            enabled: false,
            lastFetchTs: 0,
            lastETag: '',
            localBackupTs: 0
        };
    },

    saveConfig(partial) {
        // 如果 URL 变了，自动转换加速
        if (partial.rawUrl !== undefined) {
            partial.fetchUrl = this._buildFetchUrl(partial.rawUrl, partial.provider || this._config.provider);
        }
        this._config = { ...this._config, ...partial };
        localStorage.setItem('cloud_sync_config', JSON.stringify(this._config));
        
        // 如果启用了，启动定时
        if (this._config.enabled && this._config.fetchUrl) {
            this._startAutoFetch();
        } else {
            this._stopAutoFetch();
        }
        return this._config;
    },

    getConfig() {
        return { ...this._config };
    },

    // =====================================================
    // URL 智能转换
    // =====================================================
    
    /**
     * 检测存储源类型
     */
    detectProvider(url) {
        if (!url) return 'custom';
        if (url.includes('raw.githubusercontent.com') || url.includes('githubusercontent')) return 'github';
        if (url.includes('dav.jianguoyun.com') || url.includes('dav.') || url.includes('webdav')) return 'webdav';
        if (url.includes('qiniu') || url.includes('127.0.0.1:7074')) return 'qiniu';
        if (url.includes('aliyuncs') || url.includes('oss-')) return 'aliyun';
        return 'custom';
    },

    /**
     * 根据存储源 + raw URL 构造实际拉取 URL
     * 核心逻辑：GitHub raw → jsDelivr CDN
     */
    _buildFetchUrl(rawUrl, provider) {
        if (!rawUrl) return '';
        provider = provider || this.detectProvider(rawUrl);

        if (provider === 'github') {
            return this._githubRawToJsDelivr(rawUrl);
        }
        // 其他源直接用 rawUrl（本身就是 CDN 或内网服务）
        return rawUrl;
    },

    /**
     * GitHub raw URL → jsDelivr CDN URL
     * 
     * GitHub 有三种 raw URL 格式：
     *   旧版: https://raw.githubusercontent.com/owner/repo/main/path/to/file.txt
     *   新版: https://raw.githubusercontent.com/owner/repo/refs/heads/main/path/to/file.txt
     *   标签: https://raw.githubusercontent.com/owner/repo/refs/tags/v1.0/path/to/file.txt
     * 
     * jsDelivr 只认 branch/tag 名，不认 refs/heads/ 前缀
     *   https://cdn.jsdelivr.net/gh/{owner}/{repo}@{branch}/{path...}
     */
    _githubRawToJsDelivr(raw) {
        try {
            const url = new URL(raw);
            const path = url.pathname.split('/').filter(Boolean);
            if (path.length < 3) return raw;

            const owner = path[0];
            const repo = path[1];
            let branch, fileStartIdx;

            // 判断 branch 的位置
            if (path[2] === 'refs' && path[3] === 'heads' && path.length >= 4) {
                // refs/heads/main/... 新版分支格式
                branch = path[4];
                fileStartIdx = 5;
            } else if (path[2] === 'refs' && path[3] === 'tags' && path.length >= 4) {
                // refs/tags/v1.0/... 标签格式
                branch = path[4];
                fileStartIdx = 5;
            } else if (path[2] === 'refs' && path[3] === 'pull' && path[5] === 'head' && path.length >= 6) {
                // refs/pull/123/head PR 特殊处理——jsDelivr 不认，fallback 用 main
                // 但这种场景极罕见，用户应该用正常分支
                branch = 'main';
                fileStartIdx = 6;
            } else {
                // 旧版 main/... 直接就是 branch
                branch = path[2];
                fileStartIdx = 3;
            }

            const filePath = path.slice(fileStartIdx).join('/');
            return `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/${filePath}`;
        } catch (e) {
            return raw;
        }
    },

    // =====================================================
    // 拉取
    // =====================================================

    /**
     * 定时自动拉取（静默，失败不弹 toast）
     */
    async fetchSilent() {
        if (!this._config.fetchUrl) return;
        try {
            const result = await this._doFetch();
            if (result.changed) {
                Config.processImport(result.content, true);
                this._config.lastFetchTs = Date.now();
                localStorage.setItem('cloud_sync_config', JSON.stringify(this._config));
            } else {
                // ETag 没变，仅更新拉取时间
                this._config.lastFetchTs = Date.now();
                localStorage.setItem('cloud_sync_config', JSON.stringify(this._config));
            }
        } catch (e) {
            // 静默失败，不打扰用户
            console.warn('[CloudSync] silent fetch failed:', e.message);
        }
    },

    /**
     * 手动拉取（UI 按钮调用，有 toast + 冲突检测）
     * @returns {Promise<{ok:boolean, reason?:string}>}
     */
    async fetchManual() {
        if (!this._config.fetchUrl) {
            App.showToast('请先配置云端 URL', 'error');
            return { ok: false, reason: 'no_url' };
        }

        // 冲突检测：上次拉取后，本地数据是否有被改过？
        if (this._hasLocalChanges()) {
            const proceed = confirm(
                '检测到本地有未同步的改动（上次拉取后数据已变更）。\n\n' +
                '继续拉取云端数据会覆盖当前本地数据。建议先导出备份。\n\n' +
                '点击"确定"继续拉取，点击"取消"先导出备份。'
            );
            if (!proceed) return { ok: false, reason: 'user_abort' };
        }

        App.showToast('正在从云端拉取...', 'info');
        try {
            const result = await this._doFetch();
            if (result.changed) {
                Config.processImport(result.content, true);
                App.showToast('拉取成功，数据已更新', 'success');
                this._config.lastFetchTs = Date.now();
                localStorage.setItem('cloud_sync_config', JSON.stringify(this._config));
            } else {
                App.showToast('云端数据无变化（ETag 一致）', 'info');
                this._config.lastFetchTs = Date.now();
                localStorage.setItem('cloud_sync_config', JSON.stringify(this._config));
            }
            return { ok: true };
        } catch (e) {
            const msg = this._friendlyError(e);
            App.showToast('拉取失败：' + msg, 'error');
            return { ok: false, reason: e.message };
        }
    },

    /**
     * 实际 fetch 逻辑
     * 
     * 关键点：绝对不能手动加自定义 headers（如 Accept / If-None-Match），
     * 否则会触发浏览器发 OPTIONS 预检请求，而 GitHub raw 域名对 OPTIONS 返回 403。
     * 
     * 策略：
     * 1. 不带自定义 headers → 不会发 OPTIONS 预检 → 直接 GET → 能拿到数据
     * 2. cache: 'no-cache' → 告诉浏览器每次都向服务器发条件请求（自动带 If-None-Match）
     * 3. jsDelivr 失败 → fallback 到 raw URL
     */
    async _doFetch() {
        const urlsToTry = [];
        if (this._config.fetchUrl && this._config.fetchUrl !== this._config.rawUrl) {
            urlsToTry.push(this._config.fetchUrl); // 加速 URL 优先
        }
        if (this._config.rawUrl) {
            urlsToTry.push(this._config.rawUrl);    // raw URL fallback
        }

        let lastErr = null;
        for (const url of urlsToTry) {
            try {
                // 不带任何自定义 headers！避免触发 OPTIONS 预检
                // cache: 'no-cache' 让浏览器自动发 If-None-Match 条件请求
                const resp = await fetch(url, { 
                    mode: 'cors',
                    cache: 'no-cache'
                });

                if (resp.status === 304) {
                    return { changed: false, content: null };
                }
                if (!resp.ok) {
                    lastErr = new Error(`HTTP ${resp.status}`);
                    continue;
                }

                const etag = resp.headers.get('ETag');
                if (etag) this._config.lastETag = etag;

                const content = await resp.text();
                return { changed: true, content };
            } catch (e) {
                lastErr = e;
                console.warn('[CloudSync] fetch failed for', url, ':', e.message);
            }
        }
        throw lastErr || new Error('所有 URL 均拉取失败');
    },

    // =====================================================
    // 冲突检测
    // =====================================================

    /**
     * 判断上次拉取后，本地数据是否有改动
     * 
     * 策略：对比"当前数据序列化结果"和"上次拉取时存的本地快照"
     * 如果从未存过快照（localBackupTs === 0），说明是首次拉取或清除了状态，
     * 为安全起见也视为"无本地改动"
     */
    _hasLocalChanges() {
        if (!this._config.localBackupTs) return false; // 首次，不拦
        try {
            const snapshot = localStorage.getItem('cloud_sync_last_local_snapshot');
            if (!snapshot) return false;
            const current = Config.serializeData();
            return current !== snapshot;
        } catch (e) {
            return false;
        }
    },

    /**
     * 拉取成功后存一份当前数据快照，用于下次冲突检测
     */
    _saveLocalSnapshot() {
        try {
            const content = Config.serializeData();
            localStorage.setItem('cloud_sync_last_local_snapshot', content);
            this._config.localBackupTs = Date.now();
            localStorage.setItem('cloud_sync_config', JSON.stringify(this._config));
        } catch (e) { /* ignore */ }
    },

    // =====================================================
    // 定时拉取
    // =====================================================
    _startAutoFetch() {
        this._stopAutoFetch();
        const self = this;
        const scheduleNext = () => {
            const interval = (this._config.intervalMin || 15) * 60 * 1000;
            self._timer = setTimeout(async () => {
                await self.fetchSilent();
                if (self._config.enabled) scheduleNext(); // 递归排下一次
            }, interval);
        };
        scheduleNext();
    },
    _stopAutoFetch() {
        if (this._timer) {
            clearTimeout(this._timer);
            this._timer = null;
        }
    },

    // =====================================================
    // 工具
    // =====================================================
    _friendlyError(err) {
        const msg = err.message || String(err);
        if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('TypeError') || msg.includes('ORB')) {
            return '网络错误或 CORS/ORB 拦截。GitHub URL 请选"GitHub (jsDelivr 加速)"存储源，raw.githubusercontent.com 不支持跨域；jsDelivr 和国内七牛/OSS 均自带 CORS' ;
        }
        if (msg.includes('HTTP 404')) return 'URL 找不到文件（404）—— 检查仓库路径、分支名和文件名是否正确';
        if (msg.includes('HTTP 403')) return '无权访问（403）—— 可能是私有仓库或文件权限限制';
        if (msg.includes('HTTP 400')) return '请求错误（400）—— 可能是 jsDelivr CDN 上文件未同步，等待几分钟或确认文件已存在';
        return msg;
    },

    /**
     * 格式化上次同步时间（给 UI 显示）
     */
    formatLastFetch() {
        const ts = this._config.lastFetchTs;
        if (!ts) return '从未同步';
        const d = new Date(ts);
        const pad = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
};
