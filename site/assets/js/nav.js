/* The Fragility Brief — Shared Navigation & Footer */

(function () {
    'use strict';

    const SUBSTACK_URL = 'https://fragilitybriefing.substack.com';

    const NAV_LINKS = [
        { label: 'Dashboard', href: '/dashboard/' },
        { label: 'Systems Map', href: '/systems-map/' },
        { label: 'Newsletter', href: '/newsletter/' },
        { label: 'About', href: '/about/' },
        { label: 'Pricing', href: '/pricing/' },
    ];

    function getCurrentPath() {
        const path = window.location.pathname;
        // Normalize: ensure trailing slash for directory pages
        if (!path.endsWith('/') && !path.includes('.')) return path + '/';
        return path;
    }

    function injectNav() {
        const currentPath = getCurrentPath();

        const nav = document.createElement('nav');
        nav.className = 'site-nav';
        nav.setAttribute('role', 'navigation');
        nav.setAttribute('aria-label', 'Main navigation');
        nav.innerHTML = `
            <div class="nav-inner">
                <a href="/" class="nav-brand" aria-label="The Fragility Brief — Home">
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                        <circle cx="10" cy="10" r="8" stroke="#58a6ff" stroke-width="1.5" fill="none"/>
                        <path d="M6 10 Q10 4 14 10 Q10 16 6 10Z" stroke="#f85149" stroke-width="1" fill="rgba(248,81,73,0.15)"/>
                    </svg>
                    The Fragility Brief
                </a>
                <button class="nav-toggle" aria-label="Toggle menu" aria-expanded="false">&#9776;</button>
                <ul class="nav-links">
                    ${NAV_LINKS.map(link =>
                        `<li><a href="${link.href}"${currentPath === link.href ? ' class="active"' : ''}>${link.label}</a></li>`
                    ).join('')}
                    <li><a href="${SUBSTACK_URL}" class="nav-cta" target="_blank" rel="noopener">Subscribe</a></li>
                </ul>
            </div>
        `;

        document.body.prepend(nav);

        // Mobile toggle
        const toggle = nav.querySelector('.nav-toggle');
        const links = nav.querySelector('.nav-links');
        toggle.addEventListener('click', function () {
            const isOpen = links.classList.toggle('open');
            toggle.setAttribute('aria-expanded', isOpen);
        });

        // Close menu when clicking a link (mobile)
        links.querySelectorAll('a').forEach(function (a) {
            a.addEventListener('click', function () {
                links.classList.remove('open');
                toggle.setAttribute('aria-expanded', 'false');
            });
        });
    }

    function injectFooter() {
        const footer = document.createElement('footer');
        footer.className = 'site-footer';
        footer.setAttribute('role', 'contentinfo');
        footer.innerHTML = `
            <div class="footer-inner">
                <ul class="footer-links">
                    <li><a href="/about/">About</a></li>
                    <li><a href="/pricing/">Pricing</a></li>
                    <li><a href="${SUBSTACK_URL}" target="_blank" rel="noopener">Substack</a></li>
                </ul>
                <p>&copy; ${new Date().getFullYear()} The Fragility Brief. Systems-level intelligence on global risk.</p>
            </div>
        `;

        document.body.appendChild(footer);
    }

    document.addEventListener('DOMContentLoaded', function () {
        injectNav();
        injectFooter();
    });
})();
