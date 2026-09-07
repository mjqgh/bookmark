/**
 * 云端同步模块 —— 用户自带存储，零后端
 *
 * 存储源：GitHub（Contents API 读写统一链路，githubToken 负责鉴权）
 * 其他源（WebDAV/七牛/阿里云）：暂未支持统一链路，保留 fetchRawUrl 直读
 *
 * 工作方式：
 *   单向拉取（GitHub + 令牌）—— Contents API 读，sha 变才应用
 *   双向同步（GitHub + 令牌）—— 定时/手动双向同步，与拉取模式二选一：
 *     · 仅本地变了 → 自动上传本地
 *     · 仅云端变了 → 自动应用云端
 *     · 两边都变了 → 以基线快照做三方合并（新增合并、删除传播），合并结果回写云端
 *   手动上传 —— GitHub Contents API PUT（二态写入：无文件创建 / 有文件更新）
 *   本地改动 → 下次拉取前检测冲突 → 提示用户导出保存再拉取
 *
 * URL 字段说明：
 *   rawUrl       — 用户填的 GitHub raw 链接（仅用于解析 owner/repo/branch/path，
 *                  鉴权走 githubToken 字段，不再把 URL 作为鉴权凭证）
 *   fetchUrl     — 已废弃（之前 gh-proxy 加速用，现在 Contents API 直连）
 *   githubToken  — GitHub 个人访问令牌（repo 权限，存本机 localStorage）
 */

const CloudSync = {
    // 配置结构：
    // {
    //   provider: 'github',
    //   rawUrl:  'https://raw.githubusercontent.com/owner/repo/refs/heads/main/bookmark.txt',
    //   githubToken: 'ghp_xxx',     // 统一鉴权字段（单向/双向都用）
    //   intervalMin: 15,            // 定时间隔（分钟）
    //   enabled: false,             // 自动拉取模式（与 twoWay 互斥）
    //   twoWay: false,              // 自动双向同步模式（与 enabled 互斥）
    //   lastFetchTs: 0,
    //   lastSha: '',                // 上次读到的云端 sha，用于去重
    //   localBackupTs: 0
    // }
    _config: null,
    _timer: null,

    // =====================================================
    // 初始化
    // =====================================================
    init() {
        this._config = this._loadConfig();

        // 所有拉取路径统一走 Contents API + githubToken，不再使用 raw/gh-proxy 直连：
        // 1. 剥掉 rawUrl 里残留的 ?token= 临时签名（GitHub 网页端"复制链接"生成，会过期）
        //    鉴权统一用 githubToken 字段，URL 里的签名既多余又会过期
        if (this._config.provider === 'github' && this._config.rawUrl && this._config.rawUrl.includes('?')) {
            this._config.rawUrl = this._config.rawUrl.replace(/\?.*$/, '');
            localStorage.setItem('cloud_sync_config', JSON.stringify(this._config));
        }
        // 2. 老用户迁移：jsdelivr 加速链接彻底废弃，改为 GitHub 直链
        if (this._config.rawUrl && this._config.rawUrl.includes('jsdelivr')) {
            localStorage.removeItem('cloud_sync_config'); // 重置，让用户重配
            this._config = this._loadConfig();
        }

        // 迁移：旧 bug 可能把"空云端应用失败"误存成基线快照（导致本地永远不上传）。
        // 基线应该始终包含有效的文件夹数据（#xxx 行）。如果基线里没有 → 清空让 syncTwoWay 重新走首次同步逻辑。
        try {
            const baseline = localStorage.getItem('cloud_sync_last_local_snapshot');
            if (baseline !== null && !this._hasValidContent(baseline)) {
                localStorage.removeItem('cloud_sync_last_local_snapshot');
            }
        } catch (e) { /* ignore */ }

        if (this._config.enabled || this._config.twoWay) {
            this._startAutoFetch();
        }
        // 页面重新可见时立刻检查一次
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && (this._config.enabled || this._config.twoWay)) {
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
            if (raw) {
                const cfg = JSON.parse(raw);
                // 老用户迁移：fetchUrl / lastETag 字段已废弃
                if ('fetchUrl' in cfg) delete cfg.fetchUrl;
                if ('lastETag' in cfg) delete cfg.lastETag;
                return { ...this._defaultConfig(), ...cfg };
            }
        } catch (e) { /* ignore */ }
        return this._defaultConfig();
    },

    _defaultConfig() {
        return {
            provider: 'github',
            rawUrl: '',
            githubToken: '',
            intervalMin: 15,
            enabled: false,
            twoWay: false,
            lastFetchTs: 0,
            lastSha: '',
            localBackupTs: 0
        };
    },

    saveConfig(partial) {
        // rawUrl 变更 → 剥掉 GitHub 网页端带的 ?token= 临时签名（所有模式统一走 githubToken 字段鉴权）
        if (partial.rawUrl !== undefined) {
            if (typeof partial.rawUrl === 'string') {
                partial.rawUrl = partial.rawUrl.replace(/\?.*$/, '');
            }
        }
        // 二选一互斥：启用一个自动关闭另一个
        if (partial.twoWay === true) partial.enabled = false;
        if (partial.enabled === true) partial.twoWay = false;

        this._config = { ...this._config, ...partial };
        localStorage.setItem('cloud_sync_config', JSON.stringify(this._config));

        // 如果启用了任一模式，启动定时
        if (this._config.enabled || this._config.twoWay) {
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

    // =====================================================
    // 拉取（统一走 GitHub Contents API + githubToken）
    // =====================================================

    /**
     * 定时自动拉取（静默，失败不弹 toast）
     * 统一走 Contents API + githubToken（和双向同步同一条鉴权链路）
     */
    async fetchSilent() {
        if (!this._config.rawUrl) return;
        const parsed = this._parseGithubRawUrl(this._config.rawUrl);
        if (!parsed) return;

        try {
            const remote = await this._getRemoteFile(parsed);
            if (!remote.exists) return; // 文件不存在，静默跳过

            // sha 没变 → 跳过（Contents API 每次都返回 sha，比 raw ETag 更可靠）
            if (remote.sha && remote.sha === this._config.lastSha) {
                this._config.lastFetchTs = Date.now();
                localStorage.setItem('cloud_sync_config', JSON.stringify(this._config));
                return;
            }

            // 规范化后有效才应用（空文件不覆盖本地）
            const content = this._normalizeContent(remote.content);
            if (!this._hasValidContent(content)) return;

            const applied = Config.processImport(content, true);
            if (applied) {
                this._saveLocalSnapshot();
                this._config.lastSha = remote.sha;
                this._config.lastFetchTs = Date.now();
                localStorage.setItem('cloud_sync_config', JSON.stringify(this._config));
            }
        } catch (e) {
            console.warn('[CloudSync] silent fetch failed:', e.message);
        }
    },

    /**
     * 手动拉取（UI 按钮调用，有 toast + 冲突检测）
     * 统一走 Contents API + githubToken（和双向同步同一条鉴权链路）
     */
    async fetchManual() {
        const parsed = this._parseGithubRawUrl(this._config.rawUrl);
        if (!parsed) {
            App.showToast('txt URL 格式无法解析，请使用 raw.githubusercontent.com 链接', 'error');
            return { ok: false, reason: 'bad_url' };
        }
        if (!this._config.githubToken) {
            App.showToast('单向拉取已改用 GitHub Contents API，需要填写令牌（需 repo 权限）', 'error');
            return { ok: false, reason: 'no_token' };
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
            const remote = await this._getRemoteFile(parsed);
            if (!remote.exists) {
                App.showToast('云端文件不存在', 'error');
                return { ok: false, reason: 'not_found' };
            }

            // sha 没变 → 跳过
            if (remote.sha && remote.sha === this._config.lastSha) {
                this._config.lastFetchTs = Date.now();
                localStorage.setItem('cloud_sync_config', JSON.stringify(this._config));
                App.showToast('云端数据无变化', 'info');
                return { ok: true, reason: 'no_change' };
            }

            const content = this._normalizeContent(remote.content);
            const applied = Config.processImport(content, true);
            if (!applied) {
                App.showToast('云端文件内容为空或格式无法识别，本地数据未改动', 'error');
                return { ok: false, reason: 'unparseable' };
            }
            this._saveLocalSnapshot();
            this._config.lastSha = remote.sha;
            this._config.lastFetchTs = Date.now();
            localStorage.setItem('cloud_sync_config', JSON.stringify(this._config));
            App.showToast('拉取成功，数据已更新', 'success');
            return { ok: true };
        } catch (e) {
            const msg = this._friendlyError(e);
            App.showToast('拉取失败：' + msg, 'error');
            return { ok: false, reason: e.message };
        }
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
     * 冲突三选一弹窗（替代原生 confirm：原生弹窗"取消"只能绑定一个动作，
     * 无法表达"什么都不做、先退出备份"）
     * @returns {Promise<'pull'|'force'|'cancel'>}
     *   pull   = 拉取云端版本覆盖本地
     *   force  = 强制用本地覆盖云端
     *   cancel = 中止（点"取消"按钮 / × / 遮罩 / Esc 均视为 cancel）
     */
    _confirmConflict() {
        return new Promise(resolve => {
            const modal = document.getElementById('syncConflictModal');
            const btnPull = document.getElementById('conflictPull');
            const btnForce = document.getElementById('conflictForce');
            const btnCancel = document.getElementById('conflictCancel');
            const closeBtn = modal.querySelector('.modal-close');

            let done = false;
            const finish = (choice) => {
                if (done) return;
                done = true;
                modal.classList.remove('active');
                btnPull.removeEventListener('click', onPull);
                btnForce.removeEventListener('click', onForce);
                btnCancel.removeEventListener('click', onCancel);
                closeBtn.removeEventListener('click', onCancel);
                modal.removeEventListener('click', onOverlay);
                document.removeEventListener('keydown', onKey);
                resolve(choice);
            };
            const onPull = () => finish('pull');
            const onForce = () => finish('force');
            const onCancel = () => finish('cancel');
            const onOverlay = (e) => { if (e.target === modal) finish('cancel'); };
            // 注意：不能依赖 modal.classList.contains('active') 判断——app.js 的全局
            // Esc 处理先执行并移除了 active 类，会导致这里不 resolve、Promise 永久挂起。
            // 此监听仅在弹窗打开期间注册，finish 后立即移除，无需 active 判断。
            const onKey = (e) => {
                if (e.key === 'Escape') finish('cancel');
            };

            btnPull.addEventListener('click', onPull);
            btnForce.addEventListener('click', onForce);
            btnCancel.addEventListener('click', onCancel);
            closeBtn.addEventListener('click', onCancel);
            modal.addEventListener('click', onOverlay);
            document.addEventListener('keydown', onKey);
            modal.classList.add('active');
        });
    },

    /**
     * 手动上传到 GitHub（UI 按钮调用）
     * 冲突决策：
     *   远程无文件               → 直接创建
     *   远程==本地               → 已是最新，无需上传
     *   远程!=本地 且 远程==基准  → 仅本地改过，安全更新
     *   远程!=本地 且 远程!=基准  → 云端被其他设备改过：三选一弹窗（拉取 / 强制覆盖 / 取消备份）
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
        const localRaw = Config.serializeData();
        let remote;
        try {
            remote = await this._getRemoteFile(parsed);
        } catch (e) {
            App.showToast('读取云端失败：' + this._friendlyError(e), 'error');
            return { ok: false, reason: e.message };
        }

        // 情况 1：远程无文件 → 创建
        if (!remote.exists) {
            return this._doUpload(parsed, localRaw, null);
        }

        // 情况 2：内容一致（normalize 后） → 无需上传
        const localNorm = this._normalizeContent(localRaw);
        const remoteNorm = this._normalizeContent(remote.content);
        if (remoteNorm === localNorm) {
            this._saveLocalSnapshot();
            this._setSyncedNow();
            App.showToast('云端已是最新，无需上传', 'info');
            return { ok: true, reason: 'up_to_date' };
        }

        // 情况 3/4：远程与本地不一致。用基准快照判断云端是否被其他设备改过
        const baselineRaw = (() => {
            try { return localStorage.getItem('cloud_sync_last_local_snapshot'); }
            catch (e) { return null; }
        })();
        const baseline = baselineRaw !== null ? this._normalizeContent(baselineRaw) : null;
        // 无基准（首次上传但远程已有文件）也视为"云端有未知内容"，走冲突确认更安全
        const cloudChangedByOther = baseline ? (remoteNorm !== baseline) : true;

        if (cloudChangedByOther) {
            const choice = await this._confirmConflict();

            if (choice === 'cancel') {
                // 什么都不做，用户可先去配置面板导出 txt / html 备份
                App.showToast('已取消，本地与云端均未改动', 'info');
                return { ok: false, reason: 'user_abort' };
            }

            if (choice === 'pull') {
                // 拉取云端内容并应用（静默导入，保留浏览状态）
                const applied = Config.processImport(remote.content, true);
                if (applied) {
                    this._saveLocalSnapshot();
                    this._setSyncedNow();
                    App.showToast('已拉取云端版本，本地未上传的改动未发送', 'success');
                } else {
                    App.showToast('云端内容为空或无法识别，已取消', 'error');
                }
                return { ok: applied, reason: applied ? 'pulled_instead' : 'remote_unparseable' };
            }
            // choice === 'force' → 继续向下，带 sha 强制覆盖
        }

        return this._doUpload(parsed, localRaw, remote.sha);
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

        // 成功：当前数据 == 云端，刷新基准快照、同步时间和云端 sha
        // PUT 响应 JSON 格式：{ content: { sha, name, path, ... }, commit: { sha, ... } }
        const putResp = await resp.json().catch(() => ({}));
        const newSha = (putResp.content && putResp.content.sha) || sha || null;
        this._saveLocalSnapshot();
        this._setSyncedNow();
        this._config.lastSha = newSha;
        localStorage.setItem('cloud_sync_config', JSON.stringify(this._config));
        if (!silent) App.showToast('上传成功，云端已更新', 'success');
        return { ok: true, sha: newSha };
    },

    /**
     * 更新"上次同步时间"并持久化配置
     */
    _setSyncedNow() {
        this._config.lastFetchTs = Date.now();
        localStorage.setItem('cloud_sync_config', JSON.stringify(this._config));
    },

    /**
     * 判断 txt 内容是否包含有效同步数据（至少一个 #folder 行）。
     * 空文件 / 纯空白 / 纯乱码 一律算"无效"，不会被当作"云端版本"应用到本地。
     */
    _hasValidContent(txt) {
        return /^#+\s*\S/m.test(txt || '');
    },

    /**
     * 规范化 txt 内容以便比较 / 存储：
     *   \r\n → \n（Windows Git 提交常带 CRLF）
     *   去掉末尾所有 \n（GitHub Contents API 返回的文本文件末尾通常带 \n，
     *     但 Config.serializeToTxt 用 lines.join('\n') 不带末尾换行，
     *     这种格式差异不该被视为"数据变了"）
     */
    _normalizeContent(txt) {
        return String(txt || '').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
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
     * 手动同步入口（"立即拉取"按钮调用）：
     *   双向模式 → syncTwoWay（包含读 + 写）
     *   单向模式 → fetchManual（只读）
     * 两条链路统一走 Contents API + githubToken，拉取私有仓库都需要令牌。
     */
    async syncNow() {
        return this._config.twoWay
            ? this.syncTwoWay(false)
            : this.fetchManual();
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
        if (!this._config.rawUrl) {
            if (!silent) App.showToast('请先配置云端 URL', 'error');
            return { ok: false, reason: 'no_url' };
        }
        if (!this._config.githubToken) {
            if (!silent) App.showToast('双向同步需要填写 GitHub 令牌（需 repo 权限）', 'error');
            return { ok: false, reason: 'no_token' };
        }
        const parsed = this._parseGithubRawUrl(this._config.rawUrl);
        if (!parsed) {
            if (!silent) App.showToast('txt URL 格式无法解析，请使用 raw.githubusercontent.com 链接', 'error');
            return { ok: false, reason: 'bad_url' };
        }

        if (!silent) App.showToast('正在双向同步...', 'info');
        try {
            // 用 Contents API 读远程（自带 sha，上传时直接可用）
            const remoteRaw = await this._getRemoteFile(parsed);
            const localRaw = Config.serializeData();

            // 统一 normalize 后再比较：
            //  - Windows Git 提交可能带 \r\n（CRLF）
            //  - GitHub 网页端编辑保存会在末尾自动加 \n
            // 这两种格式差异都不应被视为"数据变了"
            const local = this._normalizeContent(localRaw);
            const remote = {
                exists: remoteRaw.exists,
                sha: remoteRaw.sha,
                content: this._normalizeContent(remoteRaw.content)
            };
            let baseline = null;
            try {
                const b = localStorage.getItem('cloud_sync_last_local_snapshot');
                baseline = b !== null ? this._normalizeContent(b) : null;
            } catch (e) { /* ignore */ }

            // 有效同步数据的判定：至少包含一个文件夹行（#开头）。
            // GitHub 网页端新建的空文件 content 为 ''，不能当作"云端版本"应用到本地
            const localValid = this._hasValidContent(local);
            const remoteValid = remote.exists && this._hasValidContent(remote.content);

            // —— 云端无有效数据（文件不存在 / 空占位 / 内容损坏）——
            // 本地有数据 → 首次同步，上传本地（文件存在但为空时带 sha 更新）；两边都空 → 无事可做
            if (!remoteValid) {
                if (!localValid) {
                    this._setSyncedNow();
                    if (!silent) App.showToast('本地与云端都没有有效数据', 'info');
                    return { ok: true, action: 'noop' };
                }
                const r = await this._doUpload(parsed, localRaw, remote.exists ? remote.sha : null, silent);
                if (r.ok && !silent) {
                    App.showToast(remote.exists ? '云端文件为空，已上传本地数据' : '首次同步：本地数据已上传云端', 'success');
                }
                return r.ok ? { ok: true, action: 'uploaded' } : r;
            }

            // —— 完全一致 → 无事发生 ——
            if (remote.content === local) {
                this._setSyncedNow();
                if (!silent) App.showToast('本地与云端已一致', 'info');
                return { ok: true, action: 'in_sync' };
            }

            // 有基线则按基线判断双方改动；无基线时：
            //   本地有数据 + 云端有数据但不一致 → 双方都视为"已改"，走并集合并（不丢任何一边）
            //   本地为空 → 视为仅云端变（直接应用云端）
            const baselineValid = this._hasValidContent(baseline);
            const localChanged = baselineValid ? (local !== baseline) : localValid;
            const remoteChanged = baselineValid ? (remote.content !== baseline) : remoteValid;

            // —— 仅本地变 → 上传本地 ——
            if (localChanged && !remoteChanged) {
                const r = await this._doUpload(parsed, localRaw, remote.sha, silent);
                if (r.ok && !silent) App.showToast('本地改动已上传云端', 'success');
                return r.ok ? { ok: true, action: 'uploaded' } : r;
            }

            // —— 仅云端变（或本地为空的首次同步）→ 应用云端 ——
            if (!localChanged && remoteChanged) {
                const applied = Config.processImport(remote.content, true);
                if (!applied) {
                    if (!silent) App.showToast('云端内容为空或无法识别，本地数据未改动', 'error');
                    return { ok: false, reason: 'remote_unparseable' };
                }
                this._saveLocalSnapshot();
                this._config.lastSha = remote.sha;
                localStorage.setItem('cloud_sync_config', JSON.stringify(this._config));
                this._setSyncedNow();
                if (!silent) App.showToast('云端更新已应用到本地', 'success');
                return { ok: true, action: 'pulled' };
            }

            // —— 双方都变 → 三方合并（无基线时为双方并集）——
            const merged = this._mergeContents(baselineValid ? baseline : null, local, remote.content);
            if (!merged) {
                if (!silent) App.showToast('合并失败：请手动导出备份后重试', 'error');
                return { ok: false, reason: 'merge_failed' };
            }
            if (merged === remote.content) {
                // 合并结果与云端一致（本地改动是云端的子集）→ 仅应用云端
                const applied = Config.processImport(remote.content, true);
                if (!applied) {
                    if (!silent) App.showToast('云端内容无法识别，本地数据未改动', 'error');
                    return { ok: false, reason: 'remote_unparseable' };
                }
                this._saveLocalSnapshot();
                this._config.lastSha = remote.sha;
                localStorage.setItem('cloud_sync_config', JSON.stringify(this._config));
                this._setSyncedNow();
                if (!silent) App.showToast('已与云端对齐', 'success');
                return { ok: true, action: 'pulled' };
            }

            // 先应用合并结果到本地（失败则中止，避免快照错乱）
            const applied = Config.processImport(merged, true);
            if (!applied) {
                if (!silent) App.showToast('合并结果无法应用，本地数据未改动', 'error');
                return { ok: false, reason: 'merge_unapplyable' };
            }
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
