(() => {
    const STORAGE_KEY = 'pushfile_admin_key';

    function getBase() {
        return window.__BASE__ || '';
    }

    function getKey() {
        return localStorage.getItem(STORAGE_KEY) || sessionStorage.getItem(STORAGE_KEY) || '';
    }

    function setKey(key, remember = true) {
        if (remember) {
            localStorage.setItem(STORAGE_KEY, key);
            sessionStorage.removeItem(STORAGE_KEY);
            return;
        }
        sessionStorage.setItem(STORAGE_KEY, key);
        localStorage.removeItem(STORAGE_KEY);
    }

    function clearKey() {
        localStorage.removeItem(STORAGE_KEY);
        sessionStorage.removeItem(STORAGE_KEY);
    }

    async function validateKey(key, base = '') {
        try {
            const res = await fetch((base || '') + '/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key }),
            });
            return res.ok;
        } catch (_) {
            return true;
        }
    }

    async function ensureKey(options = {}) {
        const base = options.base ?? getBase();

        let key = getKey();
        if (!key) {
            window.location.href = (base || '') + '/login?redirect=' + encodeURIComponent(window.location.pathname + window.location.search);
            return new Promise(() => {}); // Never resolves, stops execution
        }

        const ok = await validateKey(key, base);
        if (ok) return key;

        clearKey();
        window.location.href = (base || '') + '/login?redirect=' + encodeURIComponent(window.location.pathname + window.location.search);
        return new Promise(() => {}); // Never resolves, stops execution
    }

    async function apiGet(path, options = {}) {
        const base = options.base ?? getBase();
        const key = await ensureKey({ base });
        const url = new URL((base || '') + path, window.location.origin);
        url.searchParams.append('key', key);
        const res = await fetch(url);
        if (res.status === 401) {
            clearKey();
            await fetch((base || '') + '/api/auth/logout', { method: 'POST' });
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
            await fetch((base || '') + '/api/auth/logout', { method: 'POST' });
            return apiPost(path, body, options);
        }
        return res.json();
    }

    async function guardPage(options = {}) {
        try {
            if (sessionStorage.getItem('pushfile_guest_mode') === 'true') {
                return;
            }
            await ensureKey(options);
        } finally {
            document.documentElement.style.visibility = 'visible';
            window.scrollTo(0, 0);
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
