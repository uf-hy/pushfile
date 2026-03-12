document.addEventListener('DOMContentLoaded', () => {
    const base = window.__BASE__ || '';
    PushFileAuth.guardPage({ base });

    const uploadZone = document.getElementById('uploadZone');
    const fileInput = document.getElementById('fileInput');
    const paramsEl = document.getElementById('params');
    const lineWidthEl = document.getElementById('lineWidth');
    const gapEl = document.getElementById('gap');
    const previewEl = document.getElementById('preview');
    const previewImg = document.getElementById('previewImg');
    const tilesEl = document.getElementById('tiles');
    const actionsEl = document.getElementById('actions');
    const saveBtn = document.getElementById('saveBtn');
    const downloadBtn = document.getElementById('downloadBtn');

    let currentFile = null;
    let debounceTimer = null;

    function showUI() {
        paramsEl.style.display = 'grid';
        previewEl.style.display = 'block';
        actionsEl.style.display = 'flex';
    }

    async function updatePreview() {
        if (!currentFile) return;

        const key = localStorage.getItem('pushfile_admin_key') || '';
        const formData = new FormData();
        formData.append('file', currentFile);
        formData.append('line_width', String(lineWidthEl.value));
        formData.append('gap', String(gapEl.value));

        const res = await fetch(`${base}/api/grid/preview`, {
            method: 'POST',
            headers: { 'X-Upload-Key': key },
            body: formData,
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(text || '预览生成失败');
        }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        previewImg.src = url;
        showUI();
    }

    function handleFiles(files) {
        if (!files || !files.length) return;
        const file = files[0];
        if (!file.type || !file.type.startsWith('image/')) return;
        currentFile = file;
        updatePreview().catch((err) => {
            console.error(err);
            alert(err?.message || '预览生成失败');
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

    function debouncePreview() {
        if (!currentFile) return;
        if (debounceTimer) window.clearTimeout(debounceTimer);
        debounceTimer = window.setTimeout(() => {
            updatePreview().catch((err) => {
                console.error(err);
            });
        }, 200);
    }

    lineWidthEl.addEventListener('input', debouncePreview);
    gapEl.addEventListener('input', debouncePreview);

    saveBtn.addEventListener('click', async () => {
        if (!currentFile) return;
        const key = localStorage.getItem('pushfile_admin_key') || '';
        const formData = new FormData();
        formData.append('file', currentFile);
        formData.append('line_width', String(lineWidthEl.value));
        formData.append('gap', String(gapEl.value));

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
                alert(`保存成功：${data?.destination || '九宫格'}`);
            } else {
                throw new Error(data?.detail || '保存失败');
            }
        } catch (err) {
            console.error(err);
            alert(err?.message || '保存失败');
        } finally {
            saveBtn.disabled = false;
        }
    });

    downloadBtn.addEventListener('click', async () => {
        if (!currentFile) return;
        const key = localStorage.getItem('pushfile_admin_key') || '';
        const formData = new FormData();
        formData.append('file', currentFile);
        formData.append('line_width', String(lineWidthEl.value));
        formData.append('gap', String(gapEl.value));

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
            alert(err?.message || '下载失败');
        } finally {
            downloadBtn.disabled = false;
        }
    });

    tilesEl.style.display = 'none';
});
