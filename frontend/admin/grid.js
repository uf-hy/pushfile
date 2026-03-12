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
                    alert('请先选择一个具体的文件夹，或在当前目录下新建文件夹');
                    return;
                }

                const key = localStorage.getItem('pushfile_admin_key') || '';
                const formData = new FormData();
                formData.append('file', currentFile);
                formData.append('line_width', String(lineWidthEl.value));
                formData.append('gap', String(gapEl.value));
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
                        alert(`保存成功：${data?.destination || ''}`);
                    } else {
                        throw new Error(data?.detail || '保存失败');
                    }
                } catch (err) {
                    console.error(err);
                    alert(err?.message || '保存失败');
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
