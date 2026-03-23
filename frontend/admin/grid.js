document.addEventListener('DOMContentLoaded', () => {
    const base = window.__BASE__ || '';
    PushFileAuth.guardPage({ base });

    const uploadZone = document.getElementById('uploadZone');
    const fileInput = document.getElementById('fileInput');
    const gridPageEl = document.querySelector('.grid-page');
    const introEl = document.getElementById('intro');
    const uploadTitleEl = document.getElementById('uploadTitle');
    const uploadSubEl = document.getElementById('uploadSub');
    const panelEl = document.getElementById('panel');
    const lineWidthEl = document.getElementById('lineWidth');
    const lineWidthNumberEl = document.getElementById('lineWidthNumber');
    const gapEl = document.getElementById('gap');
    const gapNumberEl = document.getElementById('gapNumber');
    const paddingEl = document.getElementById('padding');
    const paddingNumberEl = document.getElementById('paddingNumber');
    const lineColorEl = document.getElementById('lineColor');
    const lineColorTextEl = document.getElementById('lineColorText');
    const bgColorEl = document.getElementById('bgColor');
    const bgColorTextEl = document.getElementById('bgColorText');
    const outputFormatEl = document.getElementById('outputFormat');
    const transparentBgEl = document.getElementById('transparentBg');
    const resetBtn = document.getElementById('resetBtn');
    const previewEl = document.getElementById('preview');
    const stageEmptyEl = document.getElementById('stageEmpty');
    const previewCanvas = document.getElementById('previewCanvas');
    const previewMetaEl = document.getElementById('previewMeta');
    const downloadPreviewBtn = document.getElementById('downloadPreviewBtn');
    const togglePanelBtn = document.getElementById('togglePanelBtn');
    const closePanelBtn = document.getElementById('closePanelBtn');
    const tilesEl = document.getElementById('tiles');
    const tilesGridEl = document.getElementById('tilesGrid');
    const tilesMetaEl = document.getElementById('tilesMeta');
    const actionsEl = document.getElementById('actions');
    const saveBtn = document.getElementById('saveBtn');
    const downloadBtn = document.getElementById('downloadBtn');
    const mobileSheetBackdrop = document.getElementById('mobileSheetBackdrop');

    let currentFile = null;
    let currentBitmap = null;
    let renderScheduled = false;

    const DEFAULTS = {
        lineWidth: 0,
        gap: 0,
        padding: 0,
        lineColor: '#ffffff',
        bgColor: '#ffffff',
        outputFormat: 'JPEG',
        transparentBg: false,
    };

    const state = { ...DEFAULTS };

    function isMobileViewport() {
        return window.matchMedia('(max-width: 768px)').matches;
    }

    function closeMobileControls() {
        if (!gridPageEl) return;
        gridPageEl.classList.remove('mobile-controls-open');
        document.body.classList.remove('grid-sheet-open');
        if (mobileSheetBackdrop) mobileSheetBackdrop.hidden = true;
    }

    function openMobileControls() {
        if (!gridPageEl || !gridPageEl.classList.contains('has-image') || !isMobileViewport()) return;
        if (mobileSheetBackdrop) mobileSheetBackdrop.hidden = false;
        gridPageEl.classList.add('mobile-controls-open');
        document.body.classList.add('grid-sheet-open');
    }

    function notify(message) {
        const text = String(message || '').trim();
        if (!text) return;
        if (typeof window.showToast === 'function') {
            window.showToast(text);
            return;
        }
        console.warn(text);
    }

    function clampInt(value, min, max) {
        const v = Number.parseInt(String(value), 10);
        if (Number.isNaN(v)) return min;
        return Math.max(min, Math.min(max, v));
    }

    function normalizeHexColor(value, fallback) {
        const s = String(value || '').trim();
        const hex = s.startsWith('#') ? s : `#${s}`;
        if (/^#[0-9a-fA-F]{6}$/.test(hex)) return hex.toLowerCase();
        return fallback;
    }

    function showUI() {
        if (gridPageEl) gridPageEl.classList.add('has-image');
        if (stageEmptyEl) stageEmptyEl.style.display = 'none';
        panelEl.style.display = 'block';
        previewEl.style.display = 'block';
        tilesEl.style.display = 'block';
        actionsEl.style.display = 'flex';
        if (introEl) introEl.style.display = 'none';
        if (downloadPreviewBtn) downloadPreviewBtn.disabled = false;
        saveBtn.disabled = false;
        downloadBtn.disabled = false;
        closeMobileControls();
    }

    function setExportDisabled(disabled) {
        if (downloadPreviewBtn) downloadPreviewBtn.disabled = disabled;
        saveBtn.disabled = disabled;
        downloadBtn.disabled = disabled;
    }

    function updateTransparentToggle() {
        const fmt = String(outputFormatEl.value || 'JPEG').toUpperCase();
        const enable = fmt === 'PNG';
        transparentBgEl.disabled = !enable;
        if (!enable) {
            transparentBgEl.checked = false;
            state.transparentBg = false;
        }
    }

    function scheduleRender() {
        if (!currentBitmap) return;
        if (renderScheduled) return;
        renderScheduled = true;
        window.requestAnimationFrame(() => {
            renderScheduled = false;
            renderAll();
        });
    }

    function getTileLayout(bitmap) {
        const w = bitmap.width;
        const h = bitmap.height;
        const w1 = Math.floor(w / 3);
        const w2 = Math.floor(w / 3);
        const w3 = w - w1 - w2;
        const h1 = Math.floor(h / 3);
        const h2 = Math.floor(h / 3);
        const h3 = h - h1 - h2;

        const colWidths = [w1, w2, w3];
        const rowHeights = [h1, h2, h3];

        const rects = [];
        let y = 0;
        for (let r = 0; r < 3; r += 1) {
            let x = 0;
            for (let c = 0; c < 3; c += 1) {
                rects.push({ sx: x, sy: y, sw: colWidths[c], sh: rowHeights[r] });
                x += colWidths[c];
            }
            y += rowHeights[r];
        }
        return { colWidths, rowHeights, rects };
    }

    function drawPreviewToCanvas(bitmap) {
        const ctx = previewCanvas.getContext('2d');
        if (!ctx) return;

        const { colWidths, rowHeights, rects } = getTileLayout(bitmap);

        const lineWidth = clampInt(state.lineWidth, 0, 40);
        const gap = clampInt(state.gap, 0, 60);
        const padding = clampInt(state.padding, 0, 120);
        const sep = lineWidth + gap * 2;
        const outW = bitmap.width + sep * 2 + padding * 2;
        const outH = bitmap.height + sep * 2 + padding * 2;

        const maxPreview = 1200;
        const scale = Math.min(1, maxPreview / Math.max(outW, outH));
        const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
        previewCanvas.width = Math.max(1, Math.round(outW * scale * dpr));
        previewCanvas.height = Math.max(1, Math.round(outH * scale * dpr));

        ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        const fmt = String(state.outputFormat || 'JPEG').toUpperCase();
        const transparent = Boolean(state.transparentBg) && fmt === 'PNG';
        if (transparent) {
            ctx.clearRect(0, 0, outW, outH);
        } else {
            ctx.fillStyle = state.bgColor;
            ctx.fillRect(0, 0, outW, outH);
        }

        let idx = 0;
        let dy = padding;
        for (let r = 0; r < 3; r += 1) {
            let dx = padding;
            for (let c = 0; c < 3; c += 1) {
                const { sx, sy, sw, sh } = rects[idx];
                idx += 1;
                ctx.drawImage(bitmap, sx, sy, sw, sh, dx, dy, sw, sh);
                dx += colWidths[c];
                if (c < 2) dx += sep;
            }
            dy += rowHeights[r];
            if (r < 2) dy += sep;
        }

        if (sep > 0 && lineWidth > 0) {
            const lineColor = state.lineColor;
            ctx.fillStyle = lineColor;

            const contentLeft = padding;
            const contentTop = padding;
            const contentW = bitmap.width + sep * 2;
            const contentH = bitmap.height + sep * 2;

            const v1 = contentLeft + colWidths[0];
            const v2 = contentLeft + colWidths[0] + sep + colWidths[1];
            const h1 = contentTop + rowHeights[0];
            const h2 = contentTop + rowHeights[0] + sep + rowHeights[1];

            const lineOffset = gap;
            const lx1 = v1 + lineOffset;
            const lx2 = v2 + lineOffset;
            ctx.fillRect(lx1, contentTop, lineWidth, contentH);
            ctx.fillRect(lx2, contentTop, lineWidth, contentH);

            const ly1 = h1 + lineOffset;
            const ly2 = h2 + lineOffset;
            ctx.fillRect(contentLeft, ly1, contentW, lineWidth);
            ctx.fillRect(contentLeft, ly2, contentW, lineWidth);
        }

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        previewMetaEl.textContent = `原图 ${bitmap.width}×${bitmap.height}  |  预览 ${outW}×${outH}  |  分割线 ${lineWidth}px · 间距 ${gap}px · 外边距 ${padding}px · ${fmt}${state.transparentBg && fmt === 'PNG' ? '（透明背景）' : ''}`;
    }

    function renderTiles(bitmap) {
        const { rects } = getTileLayout(bitmap);
        const lineWidth = clampInt(state.lineWidth, 0, 40);
        const gap = clampInt(state.gap, 0, 60);
        tilesGridEl.style.setProperty('--tile-gap', `${lineWidth + gap}px`);

        const tilePreviewMax = 240;
        tilesGridEl.innerHTML = '';
        rects.forEach((r, i) => {
            const wrap = document.createElement('div');
            wrap.className = 'tile';
            wrap.title = `第 ${i + 1} 张`;

            const c = document.createElement('canvas');
            const scale = Math.min(1, tilePreviewMax / Math.max(r.sw, r.sh));
            c.width = Math.max(1, Math.round(r.sw * scale));
            c.height = Math.max(1, Math.round(r.sh * scale));
            const ctx = c.getContext('2d');
            if (ctx) {
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(bitmap, r.sx, r.sy, r.sw, r.sh, 0, 0, c.width, c.height);
            }
            wrap.appendChild(c);
            tilesGridEl.appendChild(wrap);
        });

        tilesMetaEl.textContent = `点击“下载 ZIP / 保存到文件夹”会导出原始尺寸切图 · 分割线 ${lineWidth}px / 间距 ${gap}px`;
    }

    function renderAll() {
        if (!currentBitmap) return;
        drawPreviewToCanvas(currentBitmap);
        renderTiles(currentBitmap);
        showUI();
    }

    async function loadBitmap(file) {
        try {
            if (typeof createImageBitmap === 'function') {
                return await createImageBitmap(file);
            }
        } catch (e) {
            console.warn('createImageBitmap 失败，回退到兼容模式', e);
        }

        return await new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(file);
            img.onload = () => {
                URL.revokeObjectURL(url);
                const c = document.createElement('canvas');
                c.width = img.naturalWidth;
                c.height = img.naturalHeight;
                const ctx = c.getContext('2d');
                if (!ctx) {
                    reject(new Error('预览初始化失败'));
                    return;
                }
                ctx.drawImage(img, 0, 0);
                resolve(c);
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('图片加载失败'));
            };
            img.src = url;
        });
    }

    function syncRangeNumber(rangeEl, numberEl, min, max, key) {
        const apply = (value) => {
            const v = clampInt(value, min, max);
            rangeEl.value = String(v);
            numberEl.value = String(v);
            state[key] = v;
            scheduleRender();
        };
        rangeEl.addEventListener('input', () => apply(rangeEl.value));
        numberEl.addEventListener('change', () => apply(numberEl.value));
        apply(rangeEl.value);
    }

    function syncColor(colorEl, textEl, key) {
        const apply = (value) => {
            const v = normalizeHexColor(value, DEFAULTS[key]);
            colorEl.value = v;
            textEl.value = v;
            state[key] = v;
            scheduleRender();
        };
        colorEl.addEventListener('input', () => apply(colorEl.value));
        textEl.addEventListener('change', () => apply(textEl.value));
        apply(colorEl.value);
    }

    function collectParamsToFormData(file) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('line_width', String(clampInt(state.lineWidth, 0, 40)));
        formData.append('gap', String(clampInt(state.gap, 0, 100)));
        formData.append('padding', String(clampInt(state.padding, 0, 200)));
        formData.append('line_color', String(state.lineColor));
        formData.append('bg_color', String(state.bgColor));
        formData.append('output_format', String(state.outputFormat));
        formData.append('transparent_bg', state.transparentBg ? 'true' : 'false');
        return formData;
    }

    function handleFiles(files) {
        if (!files || !files.length) return;
        const file = files[0];
        if (!file.type || !file.type.startsWith('image/')) return;
        currentFile = file;
        setExportDisabled(true);
        if (uploadTitleEl) uploadTitleEl.textContent = file.name || '已选择图片';
        if (uploadSubEl) uploadSubEl.textContent = '点击更换图片，或拖拽替换';
        if (currentBitmap && typeof currentBitmap.close === 'function') {
            try {
                currentBitmap.close();
            } catch (e) {
                console.warn('ImageBitmap.close 失败', e);
            }
        }
        loadBitmap(file)
            .then((bitmap) => {
                currentBitmap = bitmap;
                renderAll();
            })
            .catch((err) => {
                console.error(err);
                notify(err?.message || '预览生成失败');
                setExportDisabled(true);
            });
    }

    uploadZone.addEventListener('click', () => fileInput.click());
    uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
    });
    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        handleFiles(e.dataTransfer.files);
    });
    fileInput.addEventListener('change', (e) => handleFiles(e.target.files));

    togglePanelBtn?.addEventListener('click', () => {
        if (gridPageEl?.classList.contains('mobile-controls-open')) {
            closeMobileControls();
            return;
        }
        openMobileControls();
    });

    closePanelBtn?.addEventListener('click', closeMobileControls);
    mobileSheetBackdrop?.addEventListener('click', closeMobileControls);
    window.addEventListener('resize', () => {
        if (!isMobileViewport()) closeMobileControls();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeMobileControls();
    });

    syncRangeNumber(lineWidthEl, lineWidthNumberEl, 0, 40, 'lineWidth');
    syncRangeNumber(gapEl, gapNumberEl, 0, 60, 'gap');
    syncRangeNumber(paddingEl, paddingNumberEl, 0, 120, 'padding');
    syncColor(lineColorEl, lineColorTextEl, 'lineColor');
    syncColor(bgColorEl, bgColorTextEl, 'bgColor');
    outputFormatEl.addEventListener('change', () => {
        state.outputFormat = String(outputFormatEl.value || 'JPEG').toUpperCase();
        updateTransparentToggle();
        scheduleRender();
    });
    transparentBgEl.addEventListener('change', () => {
        state.transparentBg = Boolean(transparentBgEl.checked);
        scheduleRender();
    });
    updateTransparentToggle();

    resetBtn.addEventListener('click', () => {
        state.lineWidth = DEFAULTS.lineWidth;
        state.gap = DEFAULTS.gap;
        state.padding = DEFAULTS.padding;
        state.lineColor = DEFAULTS.lineColor;
        state.bgColor = DEFAULTS.bgColor;
        state.outputFormat = DEFAULTS.outputFormat;
        state.transparentBg = DEFAULTS.transparentBg;

        lineWidthEl.value = String(state.lineWidth);
        lineWidthNumberEl.value = String(state.lineWidth);
        gapEl.value = String(state.gap);
        gapNumberEl.value = String(state.gap);
        paddingEl.value = String(state.padding);
        paddingNumberEl.value = String(state.padding);
        lineColorEl.value = state.lineColor;
        lineColorTextEl.value = state.lineColor;
        bgColorEl.value = state.bgColor;
        bgColorTextEl.value = state.bgColor;
        outputFormatEl.value = state.outputFormat;
        transparentBgEl.checked = state.transparentBg;
        updateTransparentToggle();
        scheduleRender();
    });

    downloadPreviewBtn.addEventListener('click', async () => {
        if (!currentBitmap) return;
        const fmt = String(state.outputFormat || 'JPEG').toUpperCase();
        const type = fmt === 'PNG' ? 'image/png' : 'image/jpeg';
        const quality = fmt === 'JPEG' ? 0.95 : undefined;
        const name = `grid_preview_${Date.now()}.${fmt === 'PNG' ? 'png' : 'jpg'}`;

        previewCanvas.toBlob((blob) => {
            if (!blob) return;
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, type, quality);
    });

    function splitPath(path) {
        const parts = String(path || '').split('/').filter(Boolean);
        if (parts.length === 0) return { destination: '', folderName: '' };
        return {
            destination: parts.slice(0, -1).join('/'),
            folderName: parts[parts.length - 1] || '',
        };
    }

    saveBtn.addEventListener('click', () => {
        if (!currentFile) return;

        const folderSelector = new FolderSelector({
            base,
            title: '选择保存位置',
            onSelect: async (selectedPath) => {
                if (!currentFile) return;

                const { destination, folderName } = splitPath(selectedPath);
                if (!folderName) {
                    notify('请先选择一个具体的文件夹，或在当前目录下新建文件夹');
                    return;
                }

                const key = localStorage.getItem('pushfile_admin_key') || '';
                const formData = collectParamsToFormData(currentFile);
                formData.append('destination', destination);
                formData.append('folder_name', folderName);

                try {
                    saveBtn.disabled = true;
                    const res = await fetch(`${base}/api/grid/save`, {
                        method: 'POST',
                        headers: { 'X-Upload-Key': key },
                        body: formData,
                    });
                    if (!res.ok) {
                        const text = await res.text().catch(() => '');
                        throw new Error(text || '保存失败');
                    }
                    const data = await res.json();
                    if (data?.ok) {
                        notify(`保存成功：${data?.destination || ''}`);
                    } else {
                        throw new Error(data?.detail || '保存失败');
                    }
                } catch (err) {
                    console.error(err);
                    notify(err?.message || '保存失败');
                } finally {
                    saveBtn.disabled = false;
                }
            }
        });
        folderSelector.show();
    });

    downloadBtn.addEventListener('click', async () => {
        if (!currentFile) return;
        const key = localStorage.getItem('pushfile_admin_key') || '';
        const formData = collectParamsToFormData(currentFile);

        try {
            downloadBtn.disabled = true;
            const res = await fetch(`${base}/api/grid/split`, {
                method: 'POST',
                headers: { 'X-Upload-Key': key },
                body: formData,
            });
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                throw new Error(text || '下载失败');
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `grid_${Date.now()}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error(err);
            notify(err?.message || '下载失败');
        } finally {
            downloadBtn.disabled = false;
        }
    });

    setExportDisabled(true);
    tilesEl.style.display = 'none';
});
