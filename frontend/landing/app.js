const motionImport = import('https://cdn.jsdelivr.net/npm/motion@12.23.24/+esm').catch(() => null);

(async () => {
    const root = document.documentElement;
    const body = document.body;
    const prefersReducedMotion = Boolean(window.__LANDING__?.reducedMotion);
    const surfaceShell = document.querySelector('.surface-shell');

    const revealTargets = Array.from(document.querySelectorAll('.reveal-on-scroll'));
    const scenes = Array.from(document.querySelectorAll('[data-scene]'));
    const navLinks = Array.from(document.querySelectorAll('[data-nav-target]'));
    const scrollMeter = document.getElementById('scrollMeter');
    const progressText = document.getElementById('progressText');
    const sceneCode = document.getElementById('sceneCode');
    const sceneName = document.getElementById('sceneName');
    const workflowTabs = Array.from(document.querySelectorAll('[data-workflow-tab]'));
    const workflowPanels = Array.from(document.querySelectorAll('[data-workflow-panel]'));
    const terminalLines = Array.from(document.querySelectorAll('#terminalLines > div'));
    const heroTitle = document.querySelector('.hero__title');
    const heroGhost = document.querySelector('.hero__title-ghost');
    const displayTitles = Array.from(document.querySelectorAll('.section-copy h3, .repository-copy h3'));
    const panels = Array.from(document.querySelectorAll('.update-card, .capability-card, .rail-card, .section-side-note, .terminal-card, .repository-copy'));

    body.classList.add('js-ready');

    const markVisible = (element) => {
        element.classList.add('is-visible');
    };

    const activateScene = (sceneKey) => {
        const currentIndex = scenes.findIndex((scene) => scene.dataset.scene === sceneKey);
        scenes.forEach((scene) => {
            scene.classList.toggle('is-current', scene.dataset.scene === sceneKey);
        });
        navLinks.forEach((link) => {
            link.classList.toggle('is-active', link.dataset.navTarget === sceneKey);
        });
        const scene = scenes.find((item) => item.dataset.scene === sceneKey);
        if (sceneCode && scene?.dataset.sceneLabel) {
            sceneCode.textContent = scene.dataset.sceneLabel;
        }
        if (sceneName && scene?.dataset.sceneName) {
            sceneName.textContent = scene.dataset.sceneName;
        }
        if (progressText && currentIndex >= 0) {
            progressText.textContent = `${String(currentIndex + 1).padStart(2, '0')} / ${String(scenes.length).padStart(2, '0')}`;
        }
    };

    const activateWorkflow = (name) => {
        workflowTabs.forEach((tab) => {
            const isActive = tab.dataset.workflowTab === name;
            tab.classList.toggle('is-active', isActive);
            tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
        workflowPanels.forEach((panel) => {
            panel.classList.toggle('is-active', panel.dataset.workflowPanel === name);
        });
    };

    workflowTabs.forEach((tab) => {
        tab.addEventListener('click', () => {
            activateWorkflow(tab.dataset.workflowTab || 'handoff');
        });
    });

    if ('IntersectionObserver' in window) {
        const revealObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    markVisible(entry.target);
                    revealObserver.unobserve(entry.target);
                }
            });
        }, {
            threshold: 0.14,
            rootMargin: '0px 0px -8% 0px',
        });

        revealTargets.forEach((target) => {
            revealObserver.observe(target);
        });

        const sceneObserver = new IntersectionObserver((entries) => {
            let active = null;
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    active = entry.target.dataset.scene || null;
                }
            });
            if (active) {
                activateScene(active);
            }
        }, {
            threshold: 0.42,
        });

        scenes.forEach((scene) => {
            sceneObserver.observe(scene);
        });
    } else {
        revealTargets.forEach(markVisible);
    }

    const updateScrollMeter = () => {
        if (!scrollMeter) {
            return;
        }
        const maxScroll = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
        const progress = Math.min((window.scrollY / maxScroll) * 100, 100);
        scrollMeter.style.width = `${progress.toFixed(2)}%`;
        root.style.setProperty('--scroll-progress', progress.toFixed(2));
    };

    let terminalIndex = 0;
    const rotateTerminal = () => {
        if (!terminalLines.length) {
            return;
        }
        terminalLines.forEach((line, index) => {
            line.classList.toggle('is-active', index === terminalIndex);
        });
        terminalIndex = (terminalIndex + 1) % terminalLines.length;
    };

    activateWorkflow('handoff');
    activateScene('overview');
    updateScrollMeter();
    rotateTerminal();

    window.addEventListener('scroll', updateScrollMeter, { passive: true });
    window.addEventListener('resize', updateScrollMeter, { passive: true });

    if (prefersReducedMotion) {
        revealTargets.forEach(markVisible);
        if (scrollMeter) {
            scrollMeter.style.width = '100%';
        }
        return;
    }

    const motion = await motionImport;
    if (motion && surfaceShell) {
        surfaceShell.classList.add('is-enhanced');
        const { animate, inView, stagger } = motion;

        if (heroTitle) {
            animate(heroTitle, {
                opacity: [0.5, 1],
                filter: ['blur(12px)', 'blur(0px)'],
                transform: ['translateY(16px)', 'translateY(0px)'],
            }, {
                duration: 0.82,
                easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            });
        }

        if (heroGhost) {
            animate(heroGhost, {
                opacity: [0.16, 0.32, 0.16],
                transform: ['translate3d(0px, 0px, 0px)', 'translate3d(10px, -4px, 0px)', 'translate3d(0px, 0px, 0px)'],
            }, {
                duration: 8,
                repeat: Infinity,
                easing: 'ease-in-out',
            });
        }

        animate('.surface-glow--a', {
            transform: ['translate3d(0px,0px,0px) scale(1)', 'translate3d(24px,18px,0px) scale(1.1)', 'translate3d(0px,0px,0px) scale(1)'],
            opacity: [0.12, 0.18, 0.12],
        }, {
            duration: 12,
            repeat: Infinity,
            easing: 'ease-in-out',
        });

        animate('.surface-glow--b', {
            transform: ['translate3d(0px,0px,0px) scale(1)', 'translate3d(-18px,14px,0px) scale(1.08)', 'translate3d(0px,0px,0px) scale(1)'],
            opacity: [0.1, 0.16, 0.1],
        }, {
            duration: 14,
            repeat: Infinity,
            easing: 'ease-in-out',
        });

        displayTitles.forEach((title) => {
            inView(title, () => {
                animate(title, {
                    opacity: [0.38, 1],
                    filter: ['blur(10px)', 'blur(0px)'],
                    transform: ['translateY(18px)', 'translateY(0px)'],
                }, {
                    duration: 0.6,
                    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
                });
            }, { margin: '0px 0px -15% 0px' });
        });

        panels.forEach((panel) => {
            inView(panel, () => {
                animate(panel, {
                    opacity: [0.35, 1],
                    transform: ['translateY(22px)', 'translateY(0px)'],
                    filter: ['blur(8px)', 'blur(0px)'],
                }, {
                    duration: 0.52,
                    delay: stagger(0.04),
                    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
                });
            }, { margin: '0px 0px -12% 0px' });
        });
    }

    window.setInterval(rotateTerminal, 1800);
})();
