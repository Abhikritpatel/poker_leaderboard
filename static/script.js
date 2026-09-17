// ==========================================================================
// Poker Tracker Application Script
// ==========================================================================

// --- Group & State Management ---
let currentGroupId = 'main';
let currentGroupName = 'Main Table';
let availableGroups = [];

// Check URL parameters for ?table=slug or fallback to localStorage
const urlParams = new URLSearchParams(window.location.search);
const tableFromUrl = urlParams.get('table');
const tableFromStorage = localStorage.getItem('poker_active_table');
if (tableFromUrl) {
    currentGroupId = tableFromUrl;
} else if (tableFromStorage) {
    currentGroupId = tableFromStorage;
}

const groupSelect = document.getElementById('group_select');
const createGroupBtn = document.getElementById('create_group_btn');
const leaderboardTitle = document.getElementById('leaderboard_title');
const liveSessionTitle = document.getElementById('live_session_title');

function load_groups() {
    fetch('/api/groups')
        .then(res => res.json())
        .then(groups => {
            availableGroups = groups;
            groupSelect.innerHTML = '';
            
            // If currentGroupId is not in returned list, default to first or 'main'
            const match = groups.find(g => g.group_id === currentGroupId);
            if (!match && groups.length > 0) {
                currentGroupId = groups[0].group_id;
                currentGroupName = groups[0].name;
            } else if (match) {
                currentGroupName = match.name;
            }

            groups.forEach(g => {
                const opt = document.createElement('option');
                opt.value = g.group_id;
                opt.textContent = g.name;
                if (g.group_id === currentGroupId) opt.selected = true;
                groupSelect.appendChild(opt);
            });

            update_titles();
            get_leaderboard(timeframeselect.value);
        })
        .catch(err => {
            console.error("Error loading groups:", err);
            get_leaderboard(timeframeselect.value);
        });
}

function update_titles() {
    const found = availableGroups.find(g => g.group_id === currentGroupId);
    currentGroupName = found ? found.name : 'Poker';
    leaderboardTitle.innerText = `${currentGroupName} 🏆`;
    liveSessionTitle.innerText = `Live Session (${currentGroupName})`;
}

groupSelect.addEventListener('change', () => {
    currentGroupId = groupSelect.value;
    localStorage.setItem('poker_active_table', currentGroupId);
    history.replaceState(null, '', `?table=${currentGroupId}`);
    update_titles();
    get_leaderboard(timeframeselect.value);
});

createGroupBtn.addEventListener('click', () => {
    const name = prompt("Enter a name for the new Poker Table (e.g. 'College Gang', 'Friday Crew'):");
    if (!name || !name.trim()) return;

    fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() })
    })
    .then(res => res.json())
    .then(data => {
        if (data.status === 'error') {
            alert("Error: " + data.message);
        } else {
            currentGroupId = data.group_id;
            localStorage.setItem('poker_active_table', currentGroupId);
            history.replaceState(null, '', `?table=${currentGroupId}`);
            load_groups();
        }
    })
    .catch(err => {
        console.error("Failed to create group:", err);
        alert("Server error creating table");
    });
});

// --- Navigation Views ---
const leaderboardView = document.getElementById('leaderboard-view');
const liveGameView = document.getElementById('live-game-view');
const startGameBtn = document.getElementById('start-game-btn');
const cancelGameBtn = document.getElementById('cancel-game-btn');

startGameBtn.addEventListener('click', () => {
    leaderboardView.classList.add('hidden');
    liveGameView.classList.remove('hidden');
    
    // Auto-populate today's date if empty
    const dateInput = document.getElementById('game-date');
    if (!dateInput.value) {
        dateInput.value = new Date().toISOString().split('T')[0];
    }
    calculate_Balance();
});

cancelGameBtn.addEventListener('click', () => {
    liveGameView.classList.add('hidden');
    leaderboardView.classList.remove('hidden');
});

// --- Math Engine & Balance Checker ---
const chipRatioInput = document.getElementById('chip-ratio');
const buyInAmtInput = document.getElementById('buy-in-amt');
const liveBalanceText = document.getElementById('live-balance');
const submitGameBtn = document.getElementById('submit-game-btn');
const liveTotalBuyins = document.getElementById('live-total-buyins');
const liveTotalPot = document.getElementById('live-total-pot');
const liveTotalChips = document.getElementById('live-total-chips');
const rosterBuyinsBadge = document.getElementById('roster-buyins-badge');

function calculate_Balance() {
    const chipratio = parseFloat(chipRatioInput.value) || 5;
    const buyinamt = parseFloat(buyInAmtInput.value) || 100;
    
    let total_balance = 0;
    let total_buyins = 0;
    const rows = document.querySelectorAll('.player-row');

    rows.forEach(row => {
        const buyins = parseFloat(row.querySelector('.p-buyins').value) || 0;
        const endchips = parseFloat(row.querySelector('.p-chips').value) || 0;
        const profitLoss = (endchips / chipratio) - (buyinamt * buyins);
        total_balance += profitLoss;
        total_buyins += buyins;
    });

    // Update Total Buy-ins count and live session metrics
    const formattedBuyins = Number.isInteger(total_buyins) ? total_buyins : total_buyins.toFixed(1);
    if (rosterBuyinsBadge) rosterBuyinsBadge.innerText = formattedBuyins;
    if (liveTotalBuyins) liveTotalBuyins.innerText = formattedBuyins;
    if (liveTotalPot) liveTotalPot.innerText = `₹${(total_buyins * buyinamt).toLocaleString()}`;
    if (liveTotalChips) liveTotalChips.innerText = `${Math.round(total_buyins * buyinamt * chipratio).toLocaleString()}`;

    total_balance = Math.round(total_balance * 100) / 100;

    if (total_balance === 0) {
        liveBalanceText.innerText = "Discrepancy: 0 (Perfect Match!)";
        liveBalanceText.classList.remove('balance-discrepancy');
        liveBalanceText.classList.add('balance-match');
        submitGameBtn.disabled = false;          
        submitGameBtn.innerText = "Settle Up & Save Game";
    } else {
        const chipDiscrepancy = Math.round(total_balance * chipratio);
        liveBalanceText.innerText = `Discrepancy: ${chipDiscrepancy} chips`;
        liveBalanceText.classList.remove('balance-match');
        liveBalanceText.classList.add('balance-discrepancy');
        submitGameBtn.disabled = true;           
        submitGameBtn.innerText = "Math Doesn't Match";
    }
}

// --- Player Rows in Live Session ---
const addPlayerBtn = document.getElementById('add-player-btn');
const playerContainer = document.getElementById('players-container');
const playerTemplate = document.getElementById('player-row-template');        

function add_player_row() {
    const newrow = playerTemplate.content.cloneNode(true);
    const removebtn = newrow.querySelector('.remove-btn');
    removebtn.addEventListener('click', (event) => {
        event.target.closest('.player-row').remove();
        calculate_Balance();
    });
    playerContainer.appendChild(newrow);
    calculate_Balance();
}

addPlayerBtn.addEventListener('click', () => {
    add_player_row();
});
add_player_row();
add_player_row();

// --- Leaderboard Fetching ---
function get_leaderboard(time_frame = 'all') {
    let url = `/api/leaderboard?group_id=${encodeURIComponent(currentGroupId)}&timeframe=${encodeURIComponent(time_frame)}`;
    if (time_frame.startsWith('custom&')) {
        url = `/api/leaderboard?group_id=${encodeURIComponent(currentGroupId)}&${time_frame}`;
    }

    fetch(url, { method: 'GET' })
        .then(response => response.json())
        .then(result => {
            if (!result || result.length === 0) {
                document.getElementById('leaderboard_display').innerHTML = `
                    <div class="input-card empty-state-card">
                        No games logged for <strong>${currentGroupName}</strong> in this timeframe yet.<br><br>
                        Click the <strong>+</strong> button below to log the first session!
                    </div>`;
                return;
            }

            let tableHTML = "<table>";
            let headertext = "All Time Winning (INR)";
            if (time_frame == 'week') headertext = "Past 7 days";
            if (time_frame == 'month') headertext = "Past 30 days";
            if (time_frame.startsWith('custom')) headertext = "Custom Range";
            tableHTML += `<tr><th>Rank</th><th>Player</th><th>${headertext}</th></tr>`;

            for (let i = 0; i < result.length; i++) {
                let player = result[i];
                let scoreClass = (player.total_winning >= 0) ? "profit-winning" : "profit-losing";
                let emoji = "";
                if (i === 0) emoji = "👑";
                if (i === 1) emoji = "🥈";
                if (i === 2) emoji = "🥉";
                if (i === result.length - 1 && player.total_winning < 0) emoji = "💀";
                tableHTML += `<tr><td>${i + 1}</td><td>${player.name} ${emoji}</td><td class="${scoreClass}">₹${player.total_winning.toLocaleString()}</td></tr>`;
            }
            tableHTML += "</table>";
            document.getElementById('leaderboard_display').innerHTML = tableHTML;
        })
        .catch(error => {
            console.error('Error details: ', error);
            document.getElementById('leaderboard_display').innerHTML = "<p class='leaderboard-error'>Failed to fetch leaderboard.</p>";
        });
}

document.addEventListener('input', (event) => {
    if (event.target.type === 'number') {
        calculate_Balance();
    }
});

// --- Submit Game ---
submitGameBtn.addEventListener('click', () => {
    const rows = document.querySelectorAll('.player-row');
    const transaction = [];
    rows.forEach(row => {
        const Playername = row.querySelector('.p-name').value.trim();
        const buyins = parseFloat(row.querySelector('.p-buyins').value) || 0;
        const endchips = parseFloat(row.querySelector('.p-chips').value) || 0;

        if (Playername !== "") {
            transaction.push({
                name: Playername,
                buy_ins: buyins,
                end_chips: endchips
            });
        }
    });

    const payload = {
        group_id: currentGroupId,
        date: document.getElementById('game-date').value,
        chip_ratio: parseFloat(document.getElementById('chip-ratio').value) || 5,
        buy_in_amt: parseFloat(document.getElementById('buy-in-amt').value) || 100,
        transactions: transaction
    };

    fetch('/api/add_game', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    .then(response => response.json())
    .then(data => {
        if (data.status === "error") {
            alert("Error: " + data.message);
        } else {
            alert("Game saved successfully!");
            liveGameView.classList.add('hidden');
            leaderboardView.classList.remove('hidden');
            get_leaderboard(timeframeselect.value);
            
            document.getElementById('players-container').innerHTML = '';
            add_player_row();
            add_player_row();
            calculate_Balance();
        }
    })
    .catch(err => {
        console.error("Save error:", err);
        alert("Network error saving game");
    });
});

// --- Timeframe Filters ---
const timeframeselect = document.getElementById('time_frame_select');
const customDateControls = document.getElementById('custom_date_controls');
const applyCustomDatebtn = document.getElementById('apply_custom_date_btn');
const startDate = document.getElementById('start_date');
const endDate = document.getElementById('end_date');

timeframeselect.addEventListener('change', () => {
    const selected_value = timeframeselect.value;
    if (selected_value === 'custom') {
        customDateControls.style.display = 'flex';
    } else {
        customDateControls.style.display = 'none';
        get_leaderboard(selected_value);
    }
});

applyCustomDatebtn.addEventListener('click', () => {
    const start = startDate.value;
    const end = endDate.value;
    if (!start || !end) {
        alert('Please select both start and end dates');
        return;
    }
    const daterange = `custom&start=${start}&end=${end}`;
    get_leaderboard(daterange);
});

// Initial Load
load_groups();
