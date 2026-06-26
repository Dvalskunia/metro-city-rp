const SERVER_IP = '141.94.184.106:1381';
const REFRESH_INTERVAL = 5 * 60 * 1000;

function copyIP() {
    navigator.clipboard.writeText(SERVER_IP).then(() => {
        const btn = document.querySelector('.copy-btn');
        btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
        btn.style.background = '#00ff88';
        setTimeout(() => {
            btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';
            btn.style.background = '';
        }, 2000);
    });
}

async function fetchServerInfo() {
    try {
        const res = await fetch('/api/server-info');
        const data = await res.json();
        updateUI(data);
    } catch (err) {
        console.error('Error:', err);
    }
}

function updateUI(data) {
    const isOnline = data.status === 'online';

    // Status dot + text
    const dot = document.getElementById('statusDot');
    const txt = document.getElementById('statusText');
    dot.className = 'status-dot ' + (isOnline ? 'online' : 'offline');
    txt.textContent = isOnline ? 'ონლაინ' : 'ოფლაინ';
    txt.style.color = isOnline ? '#00ff88' : '#ff4444';

    // Big players number
    const cur = data.currentPlayers || 0;
    const max = data.maxPlayers || 0;
    document.getElementById('playersOnlineBig').textContent = cur;
    document.getElementById('playersMaxBig').textContent = max;

    // Mini stats
    const avgPing = data.avgPing || 0;
    document.getElementById('serverPing2').textContent = avgPing > 0 ? avgPing + ' ms' : '-- ms';
    document.getElementById('peakPlayers2').textContent = data.peakPlayers || '--';
    document.getElementById('serverMap2').textContent = data.map || 'N/A';

    // Progress bar
    const percent = max > 0 ? (cur / max) * 100 : 0;
    document.getElementById('playersBar2').style.width = percent + '%';

    // Players list
    const list = document.getElementById('playersList2');
    if (data.players && data.players.length > 0) {
        list.innerHTML = data.players.map((p, i) => {
            const ping = data.playerPings && data.playerPings[i] ? ' <span class="player-ping">[' + data.playerPings[i] + ']</span>' : '';
            return '<span class="player-tag">' + esc(p) + ping + '</span>';
        }).join('');
    } else {
        list.innerHTML = '<div class="players-empty">სერვერზე ამჟამად არავინ არის</div>';
    }

    // Update time
    document.getElementById('lastUpdate2').textContent = data.time || '--';
}

function esc(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

function updateActiveNav() {
    const scrollY = window.scrollY + 100;
    document.querySelectorAll('section[id]').forEach(s => {
        if (scrollY >= s.offsetTop && scrollY < s.offsetTop + s.offsetHeight) {
            document.querySelectorAll('.nav-link').forEach(l => {
                l.classList.toggle('active', l.getAttribute('href') === '#' + s.id);
            });
        }
    });
}

function initAnimations() {
    const obs = new IntersectionObserver(entries => {
        entries.forEach(e => {
            if (e.isIntersecting) {
                e.target.style.opacity = '1';
                e.target.style.transform = 'translateY(0)';
            }
        });
    }, { threshold: 0.1 });
    document.querySelectorAll('.rule').forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(30px)';
        el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        obs.observe(el);
    });
}

document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', function(e) {
        e.preventDefault();
        const t = document.querySelector(this.getAttribute('href'));
        if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
        document.querySelector('.nav-links').classList.remove('open');
    });
});

window.addEventListener('scroll', updateActiveNav);
window.addEventListener('load', () => {
    fetchServerInfo();
    initAnimations();
    setInterval(fetchServerInfo, REFRESH_INTERVAL);
});