(function() {
    // Theme Toggle
    function initTheme() {
        var saved = localStorage.getItem('ai-notes-theme');
        if (saved) {
            document.documentElement.setAttribute('data-theme', saved);
        } else if (window.matchMedia('(prefers-color-scheme: light)').matches) {
            document.documentElement.setAttribute('data-theme', 'light');
        } else {
            document.documentElement.setAttribute('data-theme', 'dark');
        }
        updateToggleIcon();
    }

    function updateToggleIcon() {
        var btn = document.querySelector('.theme-toggle');
        if (!btn) return;
        var theme = document.documentElement.getAttribute('data-theme');
        btn.textContent = theme === 'dark' ? '☀' : '☽';
    }

    var toggleBtn = document.querySelector('.theme-toggle');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', function() {
            var current = document.documentElement.getAttribute('data-theme');
            var next = current === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', next);
            localStorage.setItem('ai-notes-theme', next);
            updateToggleIcon();
        });
    }
    initTheme();

    // Mobile Hamburger
    var hamburger = document.querySelector('.hamburger');
    var sidebar = document.querySelector('.sidebar');
    var backdrop = document.querySelector('.sidebar-backdrop');

    if (hamburger && sidebar) {
        hamburger.addEventListener('click', function() {
            sidebar.classList.toggle('open');
            if (backdrop) backdrop.classList.toggle('active');
        });
        if (backdrop) {
            backdrop.addEventListener('click', function() {
                sidebar.classList.remove('open');
                backdrop.classList.remove('active');
            });
        }
    }

    // Search
    var searchInput = document.querySelector('.search-input');
    var searchResults = document.querySelector('.search-results');
    var searchIndex = null;

    if (searchInput && searchResults) {
        searchInput.addEventListener('focus', function() {
            if (!searchIndex) {
                var base = document.querySelector('meta[name="base-path"]');
                var basePath = base ? base.content : '.';
                fetch(basePath + '/js/search-index.json')
                    .then(function(r) { return r.json(); })
                    .then(function(data) { searchIndex = data; })
                    .catch(function() {});
            }
        });

        searchInput.addEventListener('input', function() {
            var query = searchInput.value.trim().toLowerCase();
            if (!query || !searchIndex) {
                searchResults.classList.remove('active');
                return;
            }
            var matches = searchIndex.filter(function(note) {
                return note.title.toLowerCase().includes(query) ||
                    (note.summary && note.summary.toLowerCase().includes(query)) ||
                    note.tags.some(function(t) { return t.toLowerCase().includes(query); }) ||
                    note.content.toLowerCase().includes(query);
            }).slice(0, 10);

            if (matches.length === 0) {
                searchResults.classList.remove('active');
                return;
            }

            var base = document.querySelector('meta[name="base-path"]');
            var basePath = base ? base.content : '.';
            searchResults.innerHTML = matches.map(function(m) {
                var snippet = m.summary || m.content.slice(0, 80);
                return '<a class="search-result-item" href="' + basePath + '/' + m.url + '">' +
                    '<div class="search-result-title">' + escapeHtml(m.title) + '</div>' +
                    '<div class="search-result-snippet">' + escapeHtml(snippet) + '</div></a>';
            }).join('');
            searchResults.classList.add('active');
        });

        searchInput.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                searchResults.classList.remove('active');
                searchInput.blur();
            }
        });

        document.addEventListener('click', function(e) {
            if (!e.target.closest('.search-container')) {
                searchResults.classList.remove('active');
            }
        });
    }

    // Table of Contents — scroll spy
    var tocLinks = document.querySelectorAll('.toc a');
    if (tocLinks.length > 0) {
        var headings = [];
        tocLinks.forEach(function(link) {
            var id = link.getAttribute('href').slice(1);
            var el = document.getElementById(id);
            if (el) headings.push({ el: el, link: link });
        });

        var observer = new IntersectionObserver(function(entries) {
            entries.forEach(function(entry) {
                if (entry.isIntersecting) {
                    tocLinks.forEach(function(l) { l.classList.remove('active'); });
                    var match = headings.find(function(h) { return h.el === entry.target; });
                    if (match) match.link.classList.add('active');
                }
            });
        }, { rootMargin: '0px 0px -70% 0px', threshold: 0 });

        headings.forEach(function(h) { observer.observe(h.el); });
    }

    // Hover Previews
    var previewData = null;
    var previewEl = document.querySelector('.hover-preview');
    var previewTimeout = null;

    document.querySelectorAll('a[data-note-slug]').forEach(function(link) {
        link.addEventListener('mouseenter', function(e) {
            if (!previewEl) return;
            if (!previewData) {
                var base = document.querySelector('meta[name="base-path"]');
                var basePath = base ? base.content : '.';
                fetch(basePath + '/js/preview-data.json')
                    .then(function(r) { return r.json(); })
                    .then(function(data) { previewData = data; showPreview(e, link); })
                    .catch(function() {});
                return;
            }
            showPreview(e, link);
        });

        link.addEventListener('mouseleave', function() {
            clearTimeout(previewTimeout);
            previewTimeout = setTimeout(function() {
                if (previewEl) previewEl.classList.remove('active');
            }, 100);
        });
    });

    function showPreview(e, link) {
        var slug = link.getAttribute('data-note-slug');
        if (!previewData || !previewData[slug]) return;
        var data = previewData[slug];
        previewTimeout = setTimeout(function() {
            previewEl.innerHTML = '<div class="hover-preview-title">' + escapeHtml(data.title) + '</div>' +
                '<div class="hover-preview-summary">' + escapeHtml(data.summary || data.snippet) + '</div>';
            var rect = link.getBoundingClientRect();
            previewEl.style.left = rect.left + 'px';
            previewEl.style.top = (rect.bottom + window.scrollY + 8) + 'px';
            previewEl.classList.add('active');
        }, 300);
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // Smooth scroll for TOC links
    document.querySelectorAll('.toc a').forEach(function(link) {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            var target = document.getElementById(link.getAttribute('href').slice(1));
            if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    });
})();
