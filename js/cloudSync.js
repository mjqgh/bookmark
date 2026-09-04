/**
 * 云端同步模块 —— 用户自带存储，零后端
 *
 * 支持：GitHub (gh-proxy 加速)、WebDAV（坚果云/Nextcloud）、
 *       国内对象存储（七牛/阿里 OSS）等任意能被 fetch 到的 txt URL
 *
 * 工作方式：
 *   拉取模式（所有源）—— 云端 txt 是 Source of Truth，定时/手动拉取
 *   双向同步模式（仅 GitHub + 令牌）—— 定时/手动双向同步，与拉取模式二选一：
 *     · 仅本地变了 → 自动上传本地
 *     · 仅云端变了 → 自动应用云端
 *     · 两边都变了 → 以基线快照做三方合并（新增合并、删除传播），合并结果回写云端
 *   上传（手动"上传到云端"）—— 走 GitHub Contents API
 *     · api.github.com 正确支持 CORS 预检（raw 域名不支持），故上传直连 API，不走 gh-proxy
 *     · 二态写入：远程无文件→创建（不带 sha）；有文件→更新（必须带最新 sha，否则 409）
 *     · 冲突：上传前 GET 远程内容与本地基准快照对比，云端被其他设备改过 → 弹窗二选一
 *   本地改动 → 下次拉取前检测冲突 → 提示用户导出保存再拉取
 */

const CloudSync = {
    // 配置结构：
    // {
    //   provider: 'github' | 'webdav' | 'qiniu' | 'aliyun' | 'custom',
    //   rawUrl:  'https://raw.githubusercontent.com/...',   // 用户填的原始 URL
    //   fetchUrl:'https://gh-proxy.com/https://raw.githubusercontent.com/...',  // 实际拉取的（加速后）URL
    //   githubToken: 'ghp_xxx',                             // GitHub 个人访问令牌（仅 github 双向同步用，仅存本机）
    //   intervalMin: 15,                                      // 拉取间隔（分钟）
    //   enabled: true,                                        // 自动拉取模式（与 twoWay 互斥）
    //   twoWay: false,                                        // 自动双向同步模式（与 enabled 互斥，需 GitHub + 令牌）
    //   lastFetchTs: 0,
    //   lastETag: '',
    //   localBackupTs: 0                                      // 冲突检测用：上次同步时本地数据快照
    // }
    _config: null,
    _timer: null,

    // =====================================================
    // 初始化
    // =====================================================
    init() {
        this._config = this._loadConfig();

        // 老用户迁移：如果 fetchUrl 还是旧的 jsDelivr 格式，自动切换为 gh-proxy
        if (this._config.provider === 'github' 
            && this._config.rawUrl 
            && this._config.fetchUrl 
            && this._config.fetchUrl.includes('jsdelivr')) {
            this._config.fetchUrl = this._githubRawToGhProxy(this._config.rawUrl);
            localStorage.setItem('cloud_sync_config', JSON.stringify(this._config));
        }

        if ((this._config.enabled || this._config.twoWay) && this._config.fetchUrl) {
            this._startAutoFetch();
        }
        // 页面重新可见时立刻检查一次
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && this._config.fetchUrl && (this._config.enabled || this._config.twoWay)) {
                // 节流：距离上次拉取 > 1 分钟才触发
                if (Date.now() - (this._config.lastFetchTs || 0) > 60 * 1000) {
                    if (this._config.twoWay) {
                        this.syncTwoWay(true);
                    } else {
                        this.fetchSilent();
                    }
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
            githubToken: '',
            intervalMin: 15,
            enabled: false,
            twoWay: false,
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
        // 二选一互斥：启用一个自动关闭另一个
        if (partial.twoWay === true) partial.enabled = false;
        if (partial.enabled === true) partial.twoWay = false;

        this._config = { ...this._config, ...partial };
        localStorage.setItem('cloud_sync_config', JSON.stringify(this._config));

        // 如果启用了任一模式，启动定时
        if ((this._config.enabled || this._config.twoWay) && this._config.fetchUrl) {
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
     * 核心逻辑：GitHub raw → gh-proxy 加速（gh-proxy 直接在原始 URL 前加前缀即可，
     * 缓存失效远快于 jsDelivr——jsDelivr CDN 缓存经常延迟数小时才同步更新）
     */
    _buildFetchUrl(rawUrl, provider) {
        if (!rawUrl) return '';
        provider = provider || this.detectProvider(rawUrl);

        if (provider === 'github') {
            return this._githubRawToGhProxy(rawUrl);
        }
        // 其他源直接用 rawUrl（本身就是 CDN 或内网服务）
        return rawUrl;
    },

    /**
     * GitHub raw URL → gh-proxy 加速 URL
     * 
     * gh-proxy 用法极简：直接把完整的 raw URL 拼到前缀后面
     *   https://gh-proxy.com/{完整的 raw URL}
     * 
     * 不需要解析 owner/repo/branch/path 结构，任何 GitHub raw 格式都能处理：
     *   旧版: https://raw.githubusercontent.com/owner/repo/main/path/to/file.txt
     *   新版: https://raw.githubusercontent.com/owner/repo/refs/heads/main/path/to/file.txt
     *   标签: https://raw.githubusercontent.com/owner/repo/refs/tags/v1.0/path/to/file.txt
     */
    _githubRawToGhProxy(raw) {
        try {
            new URL(raw); // 验证 URL 合法性
            return `https://gh-proxy.com/${raw}`;
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
                // 云端内容已应用为当前数据 → 刷新基准快照（上传冲突检测以此为准）
                this._saveLocalSnapshot();
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
                this._saveLocalSnapshot();
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
     * 3. gh-proxy 失败 → fallback 到 raw URL
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
    // 上传（仅 GitHub + 令牌）
    // =====================================================

    /**
     * 是否具备上传能力（GitHub 源 + 已填令牌 + URL 可解析）
     */
    canUpload() {
        return this._config.provider === 'github'
            && !!this._config.githubToken
            && !!this._config.rawUrl
            && !!this._parseGithubRawUrl(this._config.rawUrl);
    },

    /**
     * 从 GitHub raw URL 解析出 API 所需四要素
     * 支持两种格式：
     *   /{owner}/{repo}/{branch}/{path...}
     *   /{owner}/{repo}/refs/heads/{branch}/{path...}（新版/标签）
     */
    _parseGithubRawUrl(rawUrl) {
        try {
            const u = new URL(rawUrl);
            if (!u.hostname.endsWith('githubusercontent.com')) return null;
            const parts = u.pathname.split('/').filter(Boolean);
            if (parts.length < 4) return null;
            const owner = parts[0];
            const repo = parts[1];
            let branch, pathParts;
            if (parts[2] === 'refs' && (parts[3] === 'heads' || parts[3] === 'tags')) {
                branch = decodeURIComponent(parts[4]);
                pathParts = parts.slice(5);
            } else {
                branch = decodeURIComponent(parts[2]);
                pathParts = parts.slice(3);
            }
            if (!branch || !pathParts.length) return null;
            // path 保持 percent-encoded（中文路径），API URL 直接可用
            const path = pathParts.join('/');
            return { owner, repo, branch, path };
        } catch (e) {
            return null;
        }
    },

    /**
     * 读取远程文件当前内容与 sha（GitHub Contents API）
     * @returns {Promise<{exists:boolean, sha:string|null, content:string|null}>}
     */
    async _getRemoteFile(parsed) {
        const apiUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents/${parsed.path}?ref=${encodeURIComponent(parsed.branch)}`;
        const resp = await fetch(apiUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${this._config.githubToken}`,
                'Accept': 'application/vnd.github+json'
            },
            cache: 'no-store'
        });
        if (resp.status === 404) {
            return { exists: false, sha: null, content: null };
        }
        if (!resp.ok) {
            const data = await resp.json().catch(() => ({}));
            throw new Error(`HTTP ${resp.status} ${data.message || ''}`.trim());
        }
        const data = await resp.json();
        if (Array.isArray(data)) {
            // Contents API 在 path 指向目录时返回数组
            throw new Error('URL 指向的是文件夹，请填写具体的 .txt 文件路径');
        }
        return { exists: true, sha: data.sha, content: this._base64ToUtf8(data.content || '') };
    },

    /**
     * 手动上传到 GitHub（UI 按钮调用）
     * 冲突决策：
     *   远程无文件               → 直接创建
     *   远程==本地               → 已是最新，无需上传
     *   远程!=本地 且 远程==基准  → 仅本地改过，安全更新
     *   远程!=本地 且 远程!=基准  → 云端被其他设备改过：弹窗【确定=先拉取 / 取消=强制覆盖】
     */
    async uploadManual() {
        if (this._config.provider !== 'github') {
            App.showToast('当前存储源仅支持拉取；选择 GitHub 并配置令牌后可双向同步', 'error');
            return { ok: false, reason: 'unsupported_provider' };
        }
        if (!this._config.githubToken) {
            App.showToast('请先填写 GitHub 令牌（需勾选 repo 权限）', 'error');
            return { ok: false, reason: 'no_token' };
        }
        const parsed = this._parseGithubRawUrl(this._config.rawUrl);
        if (!parsed) {
            App.showToast('txt URL 格式无法解析，请使用 raw.githubusercontent.com 链接', 'error');
            return { ok: false, reason: 'bad_url' };
        }

        App.showToast('正在检查云端状态...', 'info');
        const localContent = Config.serializeData();
        let remote;
        try {
            remote = await this._getRemoteFile(parsed);
        } catch (e) {
            App.showToast('读取云端失败：' + this._friendlyError(e), 'error');
            return { ok: false, reason: e.message };
        }

        // 情况 1：远程无文件 → 创建
        if (!remote.exists) {
            return this._doUpload(parsed, localContent, null);
        }

        // 情况 2：内容一致 → 无需上传
        if (remote.content === localContent) {
            App.showToast('云端已是最新，无需上传', 'info');
            return { ok: true, reason: 'up_to_date' };
        }

        // 情况 3/4：远程与本地不一致。用基准快照判断云端是否被其他设备改过
        const baseline = (() => {
            try { return localStorage.getItem('cloud_sync_last_local_snapshot'); }
            catch (e) { return null; }
        })();
        // 无基准（首次上传但远程已有文件）也视为"云端有未知内容"，走冲突确认更安全
        const cloudChangedByOther = baseline ? (remote.content !== baseline) : true;

        if (cloudChangedByOther) {
            const pullFirst = confirm(
                '云端内容与本地不一致（可能其他设备已上传新版本）。\n\n' +
                '【确定】先拉取云端版本（覆盖本地数据，建议先导出备份）\n' +
                '【取消】强制用当前本地数据覆盖云端'
            );
            if (pullFirst) {
                // 拉取云端内容并应用（静默导入，保留浏览状态）
                Config.processImport(remote.content, true);
                this._saveLocalSnapshot();
                this._config.lastFetchTs = Date.now();
                localStorage.setItem('cloud_sync_config', JSON.stringify(this._config));
                App.showToast('已拉取云端版本，本地未上传的改动未发送', 'success');
                return { ok: true, reason: 'pulled_instead' };
            }
            // 用户选择强制覆盖 → 带 sha 更新
        }

        return this._doUpload(parsed, localContent, remote.sha);
    },

    /**
     * 执行 PUT 写入（二态：sha 为 null 创建，否则更新）
     * @param {boolean} silent 静默模式（自动双向同步用）：不弹过程/结果 toast，仅错误时 console.warn
     */
    async _doUpload(parsed, content, sha, silent) {
        const apiUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents/${parsed.path}`;
        const body = {
            message: `sync: bookmarks update ${new Date().toLocaleString()}`,
            content: this._utf8ToBase64(content),
            branch: parsed.branch
        };
        if (sha) body.sha = sha;

        if (!silent) App.showToast('正在上传到 GitHub...', 'info');
        let resp;
        try {
            resp = await fetch(apiUrl, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${this._config.githubToken}`,
                    'Accept': 'application/vnd.github+json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });
        } catch (e) {
            if (!silent) App.showToast('上传失败：网络错误或被 CORS 拦截', 'error');
            return { ok: false, reason: e.message };
        }

        if (!resp.ok) {
            const data = await resp.json().catch(() => ({}));
            const err = new Error(`HTTP ${resp.status} ${data.message || ''}`.trim());
            if (!silent) App.showToast('上传失败：' + this._friendlyError(err), 'error');
            return { ok: false, reason: err.message };
        }

        // 成功：当前数据 == 云端，刷新基准快照与同步时间（拉/上传共用同一基准）
        this._saveLocalSnapshot();
        this._setSyncedNow();
        if (!silent) App.showToast('上传成功，云端已更新', 'success');
        return { ok: true };
    },

    /**
     * 更新"上次同步时间"并持久化配置
     */
    _setSyncedNow() {
        this._config.lastFetchTs = Date.now();
        localStorage.setItem('cloud_sync_config', JSON.stringify(this._config));
    },

    /**
     * UTF-8 文本 → base64（btoa 不支持中文，必须经 TextEncoder）
     */
    _utf8ToBase64(str) {
        const bytes = new TextEncoder().encode(str);
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return btoa(bin);
    },

    /**
     * base64 → UTF-8 文本
     */
    _base64ToUtf8(b64) {
        const bin = atob((b64 || '').replace(/\s/g, ''));
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new TextDecoder().decode(bytes);
    },

    // =====================================================
    // 自动双向同步（与"自动拉取"二选一；需 GitHub + 令牌）
    // =====================================================

    /**
     * 手动同步入口（"立即拉取"按钮调用）：双向模式走双向同步，否则走原拉取
     */
    async syncNow() {
        if (this._config.twoWay) {
            if (!this.canUpload()) {
                App.showToast('双向同步需要 GitHub 存储源 + 令牌，本次仅执行拉取', 'info');
                return this.fetchManual();
            }
            return this.syncTwoWay(false);
        }
        return this.fetchManual();
    },

    /**
     * 双向同步核心。
     * 以"基线快照"（上次同步时本地数据）为共同祖先做三方对比：
     *   仅本地变   → 上传本地
     *   仅云端变   → 应用云端
     *   双方都变   → 三方合并（新增合并、删除传播），合并结果应用本地并回写云端
     *   无基线     → 视为"仅云端变"（云端优先，与拉取模式语义一致）
     * @param {boolean} silent true=定时/页面可见触发，无 toast；false=手动触发，有 toast
     * @returns {Promise<{ok:boolean, action?:string, reason?:string}>}
     */
    async syncTwoWay(silent) {
        if (!this._config.fetchUrl) {
            if (!silent) App.showToast('请先配置云端 URL', 'error');
            return { ok: false, reason: 'no_url' };
        }
        const parsed = this._parseGithubRawUrl(this._config.rawUrl);
        if (!parsed) {
            if (!silent) App.showToast('txt URL 格式无法解析，请使用 raw.githubusercontent.com 链接', 'error');
            return { ok: false, reason: 'bad_url' };
        }

        if (!silent) App.showToast('正在双向同步...', 'info');
        try {
            // 用 Contents API 读远程（自带 sha，上传时直接可用）
            const remote = await this._getRemoteFile(parsed);
            const local = Config.serializeData();
            let baseline = null;
            try { baseline = localStorage.getItem('cloud_sync_last_local_snapshot'); } catch (e) { /* ignore */ }

            // —— 云端无文件 → 首次同步，直接上传本地 ——
            if (!remote.exists) {
                if (!local) {
                    if (!silent) App.showToast('本地与云端都没有数据', 'info');
                    return { ok: true, action: 'noop' };
                }
                const r = await this._doUpload(parsed, local, null, silent);
                if (r.ok && !silent) App.showToast('首次同步：本地数据已上传云端', 'success');
                return r.ok ? { ok: true, action: 'uploaded' } : r;
            }

            // —— 完全一致 → 无事发生 ——
            if (remote.content === local) {
                this._setSyncedNow();
                if (!silent) App.showToast('本地与云端已一致', 'info');
                return { ok: true, action: 'in_sync' };
            }

            const localChanged = baseline ? (local !== baseline) : false;
            const remoteChanged = baseline ? (remote.content !== baseline) : true; // 无基线时按"云端已变"处理

            // —— 仅本地变 → 上传本地 ——
            if (localChanged && !remoteChanged) {
                const r = await this._doUpload(parsed, local, remote.sha, silent);
                if (r.ok && !silent) App.showToast('本地改动已上传云端', 'success');
                return r.ok ? { ok: true, action: 'uploaded' } : r;
            }

            // —— 仅云端变（或无基线）→ 应用云端 ——
            if (!localChanged && remoteChanged) {
                Config.processImport(remote.content, true);
                this._saveLocalSnapshot();
                this._setSyncedNow();
                if (!silent) App.showToast('云端更新已应用到本地', 'success');
                return { ok: true, action: 'pulled' };
            }

            // —— 双方都变 → 三方合并 ——
            const merged = this._mergeContents(baseline, local, remote.content);
            if (!merged) {
                if (!silent) App.showToast('合并失败：请手动导出备份后重试', 'error');
                return { ok: false, reason: 'merge_failed' };
            }
            if (merged === remote.content) {
                // 合并结果与云端一致（本地改动是云端的子集）→ 仅应用云端
                Config.processImport(remote.content, true);
                this._saveLocalSnapshot();
                this._setSyncedNow();
                if (!silent) App.showToast('已与云端对齐', 'success');
                return { ok: true, action: 'pulled' };
            }

            // 先应用合并结果到本地（失败则中止，避免快照错乱）
            Config.processImport(merged, true);
            this._saveLocalSnapshot();

            // 回写云端（sha 仍有效：读取后云端未被本进程改过）
            const r = await this._doUpload(parsed, Config.serializeData(), remote.sha, silent);
            if (r.ok) {
                if (!silent) App.showToast('双向同步完成：本地与云端改动已合并', 'success');
                return { ok: true, action: 'merged' };
            }
            // 上传失败：本地已是合并结果，下个周期会检测到本地有改动并重新上传
            if (!silent) App.showToast('合并已应用到本地，但回写云端失败，稍后自动重试', 'info');
            return r;
        } catch (e) {
            if (silent) {
                console.warn('[CloudSync] two-way sync failed:', e.message);
            } else {
                App.showToast('双向同步失败：' + this._friendlyError(e), 'error');
            }
            return { ok: false, reason: e.message };
        }
    },

    /**
     * 把 txt 内容解析为带路径信息的树（供三方合并用）
     * 路径规则：根文件夹名 / 子文件夹名 / ...（与 Tree.getFolderPath 的显示路径对应）
     * @returns {{folders:Array, folderSet:Set<string>, bmMap:Map<string,string>}}
     *   folders 节点结构 { name, children:[], bookmarks:[{url,title}] }
     *   bmMap   key = path + '\u0000' + url → title
     */
    _parseTree(content) {
        const { folders, bookmarks } = Config.parseData(content || '');
        const bmByFolder = new Map();
        bookmarks.forEach(b => {
            if (!bmByFolder.has(b.folderId)) bmByFolder.set(b.folderId, []);
            bmByFolder.get(b.folderId).push({ url: b.url, title: b.title });
        });

        const folderSet = new Set();
        const bmMap = new Map();
        const assign = (nodes, prefix) => {
            nodes.forEach(f => {
                const p = prefix ? prefix + '/' + f.name : f.name;
                folderSet.add(p);
                f.bookmarks = bmByFolder.get(f.id) || [];
                f.children = f.children || [];
                (f.bookmarks).forEach(b => bmMap.set(p + '\u0000' + b.url, b.title));
                assign(f.children, p);
            });
        };
        assign(folders, '');
        return { folders, folderSet, bmMap };
    },

    /**
     * 三方合并：baseline（共同祖先）+ 本地 + 云端
     * 规则（文件夹与收藏同律，收藏以"路径+URL"为键）：
     *   祖先中存在 → 两侧都还在才保留（任一侧删除即删除，删除可传播）
     *   祖先中没有 → 任一侧新增即保留（新增不丢）
     *   标题冲突   → 本地优先
     * 结构上以本地树为骨架（保留本地排序），远端新增追加到对应父级末尾
     * @returns {string|null} 合并后的 txt 内容；失败返回 null
     */
    _mergeContents(baseline, localContent, remoteContent) {
        try {
            const B = this._parseTree(baseline || '');
            const L = this._parseTree(localContent || '');
            const R = this._parseTree(remoteContent || '');
            const keyOf = (p, url) => p + '\u0000' + url;

            // ---- 1) 合并文件夹集合（按路径）----
            const mergedFolders = new Set();
            new Set([...B.folderSet, ...L.folderSet, ...R.folderSet]).forEach(p => {
                const b = B.folderSet.has(p), l = L.folderSet.has(p), r = R.folderSet.has(p);
                if (b ? (l && r) : (l || r)) mergedFolders.add(p);
            });

            // ---- 2) 合并收藏集合（路径 + URL）----
            const mergedBm = new Map(); // key → title
            new Set([...B.bmMap.keys(), ...L.bmMap.keys(), ...R.bmMap.keys()]).forEach(k => {
                const p = k.substring(0, k.indexOf('\u0000'));
                if (!mergedFolders.has(p)) return;
                const b = B.bmMap.has(k), l = L.bmMap.has(k), r = R.bmMap.has(k);
                if (b ? (l && r) : (l || r)) {
                    mergedBm.set(k, l ? L.bmMap.get(k) : R.bmMap.get(k)); // 标题本地优先
                }
            });

            // ---- 3) 以本地树为骨架剪枝：删除不该保留的文件夹/收藏 ----
            const prune = (nodes, prefix) => {
                const out = [];
                nodes.forEach(f => {
                    const p = prefix ? prefix + '/' + f.name : f.name;
                    if (!mergedFolders.has(p)) return;
                    f.bookmarks = (f.bookmarks || []).filter(b => mergedBm.has(keyOf(p, b.url)));
                    f.children = prune(f.children || [], p);
                    out.push(f);
                });
                return out;
            };
            const mergedTree = prune(JSON.parse(JSON.stringify(L.folders)), '');

            // ---- 4) 追加远端新增（按远端先序遍历，父先于子）----
            const findNode = (path) => {
                let list = mergedTree, node = null;
                const parts = path.split('/');
                for (let i = 0; i < parts.length; i++) {
                    node = list.find(x => x.name === parts[i]);
                    if (!node) return null;
                    list = node.children || [];
                }
                return node;
            };
            const ensureFolder = (path) => {
                // 路径上不存在的节点逐级创建（远端新增的嵌套文件夹）
                let list = mergedTree, node = null;
                path.split('/').forEach(name => {
                    let cur = list.find(x => x.name === name);
                    if (!cur) { cur = { name, children: [], bookmarks: [] }; list.push(cur); }
                    node = cur;
                    list = cur.children || [];
                });
                return node;
            };
            const ancestorsKept = (path) => {
                const parts = path.split('/');
                for (let i = 1; i < parts.length; i++) {
                    if (!mergedFolders.has(parts.slice(0, i).join('/'))) return false;
                }
                return true;
            };
            const addRemote = (nodes, prefix) => {
                nodes.forEach(f => {
                    const p = prefix ? prefix + '/' + f.name : f.name;
                    if (mergedFolders.has(p)) {
                        if (!L.folderSet.has(p)) {
                            // 远端新增文件夹 → 逐级挂到本地树（祖先必须都保留，否则放弃）
                            if (ancestorsKept(p)) {
                                const node = ensureFolder(p);
                                (f.bookmarks || []).forEach(b => {
                                    if (mergedBm.has(keyOf(p, b.url)) && !node.bookmarks.some(x => x.url === b.url)) {
                                        node.bookmarks.push({ url: b.url, title: b.title });
                                    }
                                });
                            }
                        } else {
                            // 共有文件夹 → 追加远端新增的收藏
                            const node = findNode(p);
                            if (node) {
                                (f.bookmarks || []).forEach(b => {
                                    if (mergedBm.has(keyOf(p, b.url)) && !node.bookmarks.some(x => x.url === b.url)) {
                                        node.bookmarks.push({ url: b.url, title: b.title });
                                    }
                                });
                            }
                        }
                    }
                    addRemote(f.children || [], p);
                });
            };
            addRemote(R.folders, '');

            // ---- 5) 合并结果为空树守卫：processImport 无法应用空数据，放弃本轮 ----
            if (!mergedTree.length) return null;

            return this._treeToTxt(mergedTree);
        } catch (e) {
            console.error('[CloudSync] merge error:', e);
            return null;
        }
    },

    /**
     * 合并树 → txt 内容（与 Config.serializeToTxt 的行格式一致）
     */
    _treeToTxt(folders) {
        const lines = [];
        const walk = (nodes, level) => {
            nodes.forEach(f => {
                lines.push('#'.repeat(level) + f.name);
                (f.bookmarks || []).forEach(b => lines.push(`${b.title},${b.url}`));
                walk(f.children || [], level + 1);
            });
        };
        walk(folders, 1);
        return lines.join('\n');
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
    // 定时同步（按模式分派：自动拉取 / 自动双向同步）
    // =====================================================
    _startAutoFetch() {
        this._stopAutoFetch();
        if (!this._config.intervalMin) return; // "仅手动"不排定时
        const self = this;
        const scheduleNext = () => {
            const interval = (this._config.intervalMin || 15) * 60 * 1000;
            self._timer = setTimeout(async () => {
                if (self._config.twoWay) {
                    await self.syncTwoWay(true);
                } else {
                    await self.fetchSilent();
                }
                if (self._config.enabled || self._config.twoWay) scheduleNext(); // 递归排下一次
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
        // —— GitHub Contents API（上传/读取远程状态）——
        if (msg.includes('HTTP 401')) return '令牌无效或已过期（401）—— 请重新生成并填写 GitHub 令牌';
        if (msg.includes('HTTP 403')) return '无权访问（403）—— 令牌需勾选 repo 权限；私有仓库令牌必须有完整 repo 范围，也可能是触发了 API 限流，请稍后再试';
        if (msg.includes('HTTP 404')) return '找不到目标（404）—— 检查仓库名、分支名、文件路径是否正确，私有仓库请确认令牌有 repo 权限';
        if (msg.includes('HTTP 409')) return '云端文件刚被其他设备修改（409），请重新点击上传以再次检测冲突';
        if (msg.includes('HTTP 422')) return '请求内容有误（422）—— 通常是分支名或文件路径不合法';
        // —— 拉取（raw / gh-proxy / 其他源）——
        if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('TypeError') || msg.includes('ORB')) {
            return '网络错误或 CORS/ORB 拦截。GitHub URL 请选"GitHub (gh-proxy 加速)"存储源，raw.githubusercontent.com 不支持跨域；gh-proxy 和国内七牛/OSS 均自带 CORS' ;
        }
        if (msg.includes('HTTP 400')) return '请求错误（400）—— 可能是 gh-proxy 加速失败，稍等重试或检查 URL 格式';
        if (msg.includes('文件夹')) return msg; // _getRemoteFile 的目录提示，原样返回
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
