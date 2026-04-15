(function initAsyncFeedback(global) {
    let overlay = null;
    let titleEl = null;
    let messageEl = null;
    let iconEl = null;
    let progressEl = null;
    let progressFillEl = null;
    let metaEl = null;
    let percentEl = null;
    let activeRunId = 0;
    let showTimer = null;
    let hideTimer = null;
    let visibleAt = 0;

    function ensureElements() {
        if (overlay) return;
        overlay = document.createElement('div');
        overlay.className = 'async-feedback-overlay';
        overlay.dataset.tone = 'default';
        overlay.setAttribute('aria-hidden', 'true');
        overlay.innerHTML = `
            <div class="async-feedback-card" role="status" aria-live="polite" aria-atomic="true">
                <div class="async-feedback-head">
                    <div class="async-feedback-icon" id="asyncFeedbackIcon"><i class="ph ph-spinner-gap"></i></div>
                    <div class="async-feedback-copy">
                        <div class="async-feedback-title" id="asyncFeedbackTitle">正在处理</div>
                        <div class="async-feedback-message" id="asyncFeedbackMessage">请稍候…</div>
                    </div>
                </div>
                <div class="async-feedback-progress is-indeterminate" id="asyncFeedbackProgress">
                    <div class="async-feedback-progress-fill" id="asyncFeedbackProgressFill"></div>
                </div>
                <div class="async-feedback-meta" id="asyncFeedbackMeta">
                    <span>已经收到这次操作，正在处理中…</span>
                    <span class="async-feedback-percent" id="asyncFeedbackPercent"></span>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        titleEl = overlay.querySelector('#asyncFeedbackTitle');
        messageEl = overlay.querySelector('#asyncFeedbackMessage');
        iconEl = overlay.querySelector('#asyncFeedbackIcon i');
        progressEl = overlay.querySelector('#asyncFeedbackProgress');
        progressFillEl = overlay.querySelector('#asyncFeedbackProgressFill');
        metaEl = overlay.querySelector('#asyncFeedbackMeta span');
        percentEl = overlay.querySelector('#asyncFeedbackPercent');
    }

    function clearTimers() {
        if (showTimer) {
            window.clearTimeout(showTimer);
            showTimer = null;
        }
        if (hideTimer) {
            window.clearTimeout(hideTimer);
            hideTimer = null;
        }
    }

    function clampProgress(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return null;
        return Math.max(0, Math.min(100, Math.round(n)));
    }

    function render(options) {
        ensureElements();
        const tone = options.tone || 'default';
        const progress = clampProgress(options.progress);
        overlay.dataset.tone = tone;
        titleEl.textContent = options.title || '正在处理';
        messageEl.textContent = options.message || '请稍候…';
        metaEl.textContent = options.meta || '已经收到这次操作，正在处理中…';
        if (tone === 'success') {
            iconEl.className = 'ph ph-check';
        } else if (tone === 'danger') {
            iconEl.className = 'ph ph-warning-circle';
        } else {
            iconEl.className = 'ph ph-spinner-gap';
        }
        if (progress == null) {
            progressEl.classList.add('is-indeterminate');
            progressFillEl.style.width = '42%';
            percentEl.textContent = '';
        } else {
            progressEl.classList.remove('is-indeterminate');
            progressFillEl.style.width = `${progress}%`;
            percentEl.textContent = `${progress}%`;
        }
    }

    function showNow(options) {
        render(options);
        overlay.setAttribute('aria-hidden', 'false');
        requestAnimationFrame(() => {
            if (!overlay) return;
            overlay.classList.add('is-visible');
        });
        visibleAt = Date.now();
    }

    function hideNow() {
        clearTimers();
        if (!overlay) return;
        overlay.classList.remove('is-visible');
        overlay.setAttribute('aria-hidden', 'true');
    }

    function hideAfter(delay) {
        if (!overlay) return;
        hideTimer = window.setTimeout(() => {
            hideTimer = null;
            hideNow();
        }, Math.max(0, delay || 0));
    }

    function remainingVisibleTime(minVisibleMs) {
        if (!visibleAt || !minVisibleMs) return 0;
        return Math.max(0, minVisibleMs - (Date.now() - visibleAt));
    }

    function normalizeConfig(options) {
        return Object.assign({
            title: '正在处理',
            message: '请稍候…',
            meta: '已经收到这次操作，正在处理中…',
            progress: null,
            delay: 0,
            minVisibleMs: 320,
            showSuccess: false,
            showError: false,
            successDuration: 720,
            errorDuration: 1300,
        }, options || {});
    }

    async function run(options, executor) {
        const runId = ++activeRunId;
        const config = normalizeConfig(options);
        let shown = false;

        clearTimers();

        const open = (next) => {
            Object.assign(config, next || {});
            if (shown) {
                render(config);
                return;
            }
            shown = true;
            showNow(config);
        };

        if (config.delay > 0) {
            showTimer = window.setTimeout(() => {
                showTimer = null;
                if (runId !== activeRunId) return;
                open();
            }, config.delay);
        } else {
            open();
        }

        const controls = {
            show(next) {
                open(next);
            },
            update(next) {
                open(next);
            },
            setProgress(value, next = {}) {
                open(Object.assign({}, next, { progress: value }));
            },
        };

        try {
            const result = await executor(controls);
            clearTimers();
            if (runId !== activeRunId) return result;
            if (!shown) return result;
            const waitMs = remainingVisibleTime(config.minVisibleMs);
            if (config.showSuccess) {
                render({
                    title: config.successTitle || config.title || '处理完成',
                    message: config.successMessage || config.message || '已经完成啦',
                    meta: config.successMeta || '可以继续下一步了',
                    progress: typeof config.progress === 'number' ? 100 : config.progress,
                    tone: 'success',
                });
                hideAfter(waitMs + config.successDuration);
                return result;
            }
            hideAfter(waitMs);
            return result;
        } catch (error) {
            clearTimers();
            if (runId !== activeRunId) throw error;
            if (!shown) throw error;
            const waitMs = remainingVisibleTime(config.minVisibleMs);
            if (config.showError) {
                render({
                    title: config.errorTitle || '处理失败',
                    message: config.errorMessage || error?.message || '请稍后重试',
                    meta: config.errorMeta || '这次操作没有成功完成',
                    progress: null,
                    tone: 'danger',
                });
                hideAfter(waitMs + config.errorDuration);
                throw error;
            }
            hideAfter(waitMs);
            throw error;
        }
    }

    global.AsyncFeedback = {
        run,
        show(options) {
            clearTimers();
            showNow(normalizeConfig(options));
        },
        update(options) {
            render(normalizeConfig(options));
        },
        hide: hideNow,
    };
})(window);
