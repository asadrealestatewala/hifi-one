// ===== MOBILE MENU TOGGLE =====
function toggleMenu() {
    const menu = document.getElementById('navMenu');
    if (menu) {
        menu.classList.toggle('open');
        menu.classList.toggle('show');
    }
}

// Close menu on link click (mobile)
document.addEventListener('DOMContentLoaded', function() {
    const navLinks = document.querySelectorAll('#navMenu a');
    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            const menu = document.getElementById('navMenu');
            if (menu) {
                menu.classList.remove('open');
                menu.classList.remove('show');
            }
        });
    });
});

// ===== FAQ TOGGLE =====
function toggleFaq(el) {
    if (el) {
        el.classList.toggle('open');
        const icon = el.querySelector('.icon');
        if (icon) {
            icon.textContent = el.classList.contains('open') ? '−' : '+';
        }
    }
}

// ===== HOVER BOX (Mouse ke sath image show) =====
document.addEventListener('DOMContentLoaded', function() {
    const hoverBox = document.getElementById('hoverBox');
    const hoverImage = document.getElementById('hoverImage');
    const hoverTitle = document.getElementById('hoverTitle');
    const hoverDesc = document.getElementById('hoverDesc');

    if (hoverBox && hoverImage && hoverTitle && hoverDesc) {
        const serviceRows = document.querySelectorAll('.service-row');

        serviceRows.forEach(row => {
            row.addEventListener('mouseenter', function(e) {
                const img = this.dataset.image;
                const title = this.dataset.title;
                const desc = this.dataset.desc;

                if (img) hoverImage.src = img;
                if (title) hoverTitle.textContent = title;
                if (desc) hoverDesc.textContent = desc;

                hoverBox.classList.add('show');
                hoverBox.classList.add('visible');
                updateHoverBoxPosition(e);
            });

            row.addEventListener('mousemove', function(e) {
                updateHoverBoxPosition(e);
            });

            row.addEventListener('mouseleave', function() {
                hoverBox.classList.remove('show');
                hoverBox.classList.remove('visible');
            });
        });
    }

    function updateHoverBoxPosition(e) {
        if (!hoverBox) return;
        let x = e.clientX + 20;
        let y = e.clientY + 20;

        const boxWidth = hoverBox.offsetWidth || 260;
        const boxHeight = hoverBox.offsetHeight || 220;
        const winWidth = window.innerWidth;
        const winHeight = window.innerHeight;

        if (x + boxWidth > winWidth) x = e.clientX - boxWidth - 20;
        if (y + boxHeight > winHeight) y = e.clientY - boxHeight - 20;

        hoverBox.style.left = x + 'px';
        hoverBox.style.top = y + 'px';
    }
});

// ===== SET ACTIVE NAV LINK =====
document.addEventListener('DOMContentLoaded', function() {
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    const navLinks = document.querySelectorAll('nav ul li a');
    
    navLinks.forEach(link => {
        const href = link.getAttribute('href');
        if (href === currentPage) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });
});

// ========================================
// THEME TOGGLE FUNCTIONALITY
// ========================================
function toggleTheme() {
    const body = document.body;
    const toggle = document.getElementById('themeToggle');
    
    if (!body || !toggle) return;
    
    body.classList.toggle('dark-mode');
    
    // Save preference to localStorage
    if (body.classList.contains('dark-mode')) {
        localStorage.setItem('theme', 'dark');
    } else {
        localStorage.setItem('theme', 'light');
    }
}

// ===== LOAD SAVED THEME ON PAGE LOAD =====
document.addEventListener('DOMContentLoaded', function() {
    const savedTheme = localStorage.getItem('theme');
    const body = document.body;
    
    if (savedTheme === 'dark') {
        body.classList.add('dark-mode');
    } else {
        body.classList.remove('dark-mode');
    }
});

// ===== EXPAND/SHRINK SERVICE (for services page) =====
function toggleService(btn) {
    if (!btn) return;
    const row = btn.closest('.service-row');
    if (!row) return;
    const content = row.querySelector('.service-content');
    const icon = btn.querySelector('i');
    
    if (content) {
        content.classList.toggle('open');
    }
    btn.classList.toggle('active');
    if (icon) {
        icon.className = content && content.classList.contains('open') ? 'fas fa-minus' : 'fas fa-plus';
    }
}

console.log('✅ main.js loaded successfully');