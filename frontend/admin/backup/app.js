document.addEventListener('DOMContentLoaded', () => {
    // Fake Data
    const stats = {
        albums: 12,
        photos: 328,
        storage: '1.2 GB'
    };

    const activities = [
        {
            id: 1,
            type: 'upload',
            title: '上传了 15 张照片到 "2023 冰岛之旅"',
            time: '10 分钟前',
            icon: 'ph-upload-simple',
            colorClass: 'bg-blue-light text-blue'
        },
        {
            id: 2,
            type: 'create',
            title: '创建了新相册 "家庭聚会"',
            time: '2 小时前',
            icon: 'ph-folder-plus',
            colorClass: 'bg-green-light text-green'
        },
        {
            id: 3,
            type: 'share',
            title: '分享了相册 "设计素材"',
            time: '昨天 14:30',
            icon: 'ph-link',
            colorClass: 'bg-purple-light text-purple'
        }
    ];

    // Initialize Stats
    document.getElementById('stat-albums').textContent = stats.albums;
    document.getElementById('stat-photos').textContent = stats.photos;
    document.getElementById('stat-storage').textContent = stats.storage;

    // Render Activities
    const activityList = document.getElementById('activity-list');
    
    activities.forEach((activity, index) => {
        const item = document.createElement('div');
        item.className = 'activity-item';
        // Add staggered animation delay
        item.style.animation = `slideIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.1) ${index * 0.1}s both`;
        
        item.innerHTML = `
            <div class="activity-icon ${activity.colorClass}">
                <i class="ph-fill ${activity.icon}"></i>
            </div>
            <div class="activity-content">
                <div class="activity-title">${activity.title}</div>
                <div class="activity-time">${activity.time}</div>
            </div>
            <i class="ph ph-caret-right text-gray"></i>
        `;
        
        activityList.appendChild(item);
    });

    // Add entrance animations to bento cards
    const cards = document.querySelectorAll('.bento-card');
    cards.forEach((card, index) => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(20px)';
        
        setTimeout(() => {
            card.style.transition = 'opacity 0.6s ease-out, transform 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.1)';
            card.style.opacity = '1';
            card.style.transform = 'translateY(0)';
            
            // Reset transition after animation for hover effects
            setTimeout(() => {
                card.style.transition = 'transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.1), box-shadow 0.4s cubic-bezier(0.25, 0.8, 0.25, 1)';
            }, 600);
        }, index * 100);
    });
});

// Add keyframes for slideIn
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            opacity: 0;
            transform: translateX(-20px);
        }
        to {
            opacity: 1;
            transform: translateX(0);
        }
    }
`;
document.head.appendChild(style);