document.addEventListener('DOMContentLoaded', () => {
    // 简单的交互动画逻辑
    
    // 1. 按钮点击波纹效果 (Apple 风格的轻微缩放)
    const buttons = document.querySelectorAll('.btn, .icon-btn, .action-item, .activity-item');
    
    buttons.forEach(btn => {
        btn.addEventListener('mousedown', function() {
            this.style.transform = 'scale(0.96)';
            this.style.transition = 'transform 0.1s cubic-bezier(0.2, 0.8, 0.2, 1)';
        });
        
        btn.addEventListener('mouseup', function() {
            this.style.transform = '';
            this.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
        });
        
        btn.addEventListener('mouseleave', function() {
            this.style.transform = '';
            this.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
        });
    });

    // 2. 统计图表动画
    const bars = document.querySelectorAll('.bar');
    
    // 初始状态设为 0
    bars.forEach(bar => {
        const targetHeight = bar.style.height;
        bar.dataset.targetHeight = targetHeight;
        bar.style.height = '0%';
    });
    
    // 延迟触发动画，产生生长效果
    setTimeout(() => {
        bars.forEach((bar, index) => {
            setTimeout(() => {
                bar.style.height = bar.dataset.targetHeight;
            }, index * 100); // 错开动画时间
        });
    }, 500);

    // 3. 卡片 3D 悬浮效果 (可选，增加高级感)
    const cards = document.querySelectorAll('.bento-card');
    
    // 4. Bento Grid 卡片错峰入场动画 (Stagger Animation)
    cards.forEach((card, index) => {
        setTimeout(() => {
            card.classList.add('animate-in');
        }, index * 100 + 100); // 基础延迟 100ms，每个卡片间隔 100ms
    });
    
    cards.forEach(card => {
        card.addEventListener('mousemove', e => {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;
            
            const rotateX = ((y - centerY) / centerY) * -2;
            const rotateY = ((x - centerX) / centerX) * 2;
            
            card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-4px)`;
            card.style.transition = 'none';
        });
        
        card.addEventListener('mouseleave', () => {
            card.style.transform = '';
            card.style.transition = 'all 0.4s cubic-bezier(0.2, 0.8, 0.2, 1)';
        });
    });
});