(() => {
    const STORAGE_KEY = 'pushfile_admin_key';

    function getBase() {
        return window.__BASE__ || '';
    }

    function getKey() {
        return localStorage.getItem(STORAGE_KEY) || '';
    }

    function setKey(key) {
        localStorage.setItem(STORAGE_KEY, key);
    }

    function clearKey() {
        localStorage.removeItem(STORAGE_KEY);
    }

    async function validateKey(key, base = '') {
        try {
            const url = new URL((base || '') + '/api/tokens', window.location.origin);
            url.searchParams.append('key', key);
            const res = await fetch(url);
            if (res.status === 401) return false;
            return res.ok;
        } catch (_) {
            return true;
        }
    }

    async function ensureKey(options = {}) {
        const base = options.base ?? getBase();
        const promptText = options.promptText || '请输入管理员密码：';

        let key = getKey();
        while (true) {
            if (!key) {
                key = prompt(promptText) || '';
                if (!key) continue;
                setKey(key);
            }

            const ok = await validateKey(key, base);
            if (ok) return key;

            clearKey();
            key = '';
            alert('密码错误，请重试');
        }
    }

    async function apiGet(path, options = {}) {
        const base = options.base ?? getBase();
        const key = await ensureKey({ base });
        const url = new URL((base || '') + path, window.location.origin);
        url.searchParams.append('key', key);
        const res = await fetch(url);
        if (res.status === 401) {
            clearKey();
            return apiGet(path, options);
        }
        return res.json();
    }

    async function apiPost(path, body, options = {}) {
        const base = options.base ?? getBase();
        const key = await ensureKey({ base });
        const res = await fetch((base || '') + path, {
            method: 'POST',
            headers: {
                'X-Upload-Key': key,
                ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
            },
            body: body,
        });
        if (res.status === 401) {
            clearKey();
            return apiPost(path, body, options);
        }
        return res.json();
    }

    async function guardPage(options = {}) {
        try {
            await ensureKey(options);
        } finally {
            document.documentElement.style.visibility = 'visible';
        }
    }

    window.PushFileAuth = {
        STORAGE_KEY,
        getBase,
        getKey,
        setKey,
        clearKey,
        ensureKey,
        apiGet,
        apiPost,
        guardPage,
    };
})();
