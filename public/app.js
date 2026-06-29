const SERVER_IP = '141.94.184.106:1381';
const REFRESH_INTERVAL = 5 * 60 * 1000;
const DAILY_REFRESH = 30 * 1000;
const ONLINE_REFRESH = 5 * 1000;

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

async function fetchDailyStats() {
    try {
        const res = await fetch('/api/daily-stats');
        const data = await res.json();
        updateDailyUI(data);
    } catch (err) {
        console.error('Daily stats error:', err);
    }
}

function updateDailyUI(data) {
    const activeEl = document.getElementById('dailyActivePlayers');
    const peakEl = document.getElementById('dailyPeakOnline');
    const onlineEl = document.getElementById('dailyCurrentlyOnline');
    const dateEl = document.getElementById('dailyDate');
    const resetEl = document.getElementById('dailyResetTime');
    const listEl = document.getElementById('dailyPlayersList');

    if (activeEl) activeEl.textContent = data.activePlayers || 0;
    if (peakEl) peakEl.textContent = data.peakOnline || 0;
    if (onlineEl) {
        const serverOnline = document.getElementById('playersOnlineBig');
        onlineEl.textContent = serverOnline ? serverOnline.textContent : '--';
    }
    if (dateEl) dateEl.textContent = data.date || '--';
    if (resetEl) resetEl.textContent = 'მონაცემები შუაღამისას ინახლება';

    if (listEl && data.playerNames && data.playerNames.length > 0) {
        listEl.innerHTML = data.playerNames.map(name =>
            '<span class="activity-player-tag">' + esc(name) + '</span>'
        ).join('');
    } else if (listEl) {
        listEl.innerHTML = '<div class="players-loading">დღეს ჯერ არავინ შემოსულა</div>';
    }
}

async function fetchVisitorStats() {
    try {
        const res = await fetch('/api/visitor-stats');
        const data = await res.json();
        updateVisitorUI(data);
    } catch (err) {
        console.error('Visitor stats error:', err);
    }
}

async function fetchOnlineCount() {
    try {
        const res = await fetch('/api/server-info');
        const data = await res.json();
        const cur = data.currentPlayers || 0;
        const onlineEl = document.getElementById('dailyCurrentlyOnline');
        const playersListEl = document.getElementById('playersList2');

        if (onlineEl) {
            onlineEl.textContent = cur > 0 ? cur : 'Guest';
            onlineEl.style.color = cur > 0 ? '#00d4ff' : 'rgba(255,255,255,0.3)';
        }

        if (playersListEl && data.players && data.players.length > 0) {
            playersListEl.innerHTML = data.players.map((p, i) => {
                const ping = data.playerPings && data.playerPings[i] ? ' <span class="player-ping">[' + data.playerPings[i] + ']</span>' : '';
                return '<span class="player-tag">' + esc(p) + ping + '</span>';
            }).join('');
        } else if (playersListEl) {
            playersListEl.innerHTML = '<div class="players-empty">Guest</div>';
        }

        if (data.time) {
            document.getElementById('lastUpdate2').textContent = data.time;
        }
    } catch (err) {
        console.error('Online count error:', err);
    }
}

function updateVisitorUI(data) {
    const visitorsEl = document.getElementById('dailyUniqueVisitors');
    const viewsEl = document.getElementById('dailyPageViews');
    const peakEl = document.getElementById('dailyPeakVisitors');
    const dateEl = document.getElementById('dailyDate');

    if (visitorsEl) visitorsEl.textContent = data.uniqueVisitors || 0;
    if (viewsEl) viewsEl.textContent = data.totalPageViews || 0;
    if (peakEl) peakEl.textContent = data.peakVisitors || 0;
    if (dateEl && (!dateEl.textContent || dateEl.textContent === '--')) {
        dateEl.textContent = data.date || '--';
    }
}

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
    fetchDailyStats();
    fetchVisitorStats();
    initAnimations();
    setInterval(fetchServerInfo, REFRESH_INTERVAL);
    setInterval(fetchDailyStats, DAILY_REFRESH);
    setInterval(fetchVisitorStats, DAILY_REFRESH);
    setInterval(fetchOnlineCount, ONLINE_REFRESH);
});