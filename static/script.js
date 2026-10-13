// ==========================================================================
// Poker Tracker Application Script
// ==========================================================================

// --- 1. State Management & LocalStorage ---
let currentGroupId = 'main';
let currentGroupName = 'Main Table';
let availableGroups = [];
let isCurrentTableAdmin = false;

function getAdminPin(groupId) {
    try {
        const keys = JSON.parse(localStorage.getItem('poker_admin_keys') || '{}');
        return keys[groupId] || null;
    } catch (e) {
        return null;
    }
}

function setAdminPin(groupId, pin) {
    try {
        const keys = JSON.parse(localStorage.getItem('poker_admin_keys') || '{}');
        keys[groupId] = String(pin).trim();
        localStorage.setItem('poker_admin_keys', JSON.stringify(keys));
    } catch (e) {
        console.error("Error saving admin key:", e);
    }
}

// Parse the table from the query string. The admin key travels in the URL
// fragment (#key=...) so it is never sent to the server or written to logs.
const urlParams = new URLSearchParams(window.location.search);
const tableFromUrl = urlParams.get('table');
const keyFromUrl = new URLSearchParams(window.location.hash.slice(1)).get('key');
const tableFromStorage = localStorage.getItem('poker_active_table');

if (tableFromUrl) {
    currentGroupId = tableFromUrl;
} else if (tableFromStorage) {
    currentGroupId = tableFromStorage;
}

if (keyFromUrl && currentGroupId) {
    setAdminPin(currentGroupId, keyFromUrl);
    const cleanUrl = `${window.location.pathname}?table=${encodeURIComponent(currentGroupId)}`;
    history.replaceState(null, '', cleanUrl);
}

// --- 2. DOM Elements ---
// Navigation & Header
const groupSelect = document.getElementById('group_select');
const createGroupBtn = document.getElementById('create_group_btn');
const leaderboardTitle = document.getElementById('leaderboard_title');
const liveSessionTitle = document.getElementById('live_session_title');
const roleBadge = document.getElementById('role_badge');
const adminActionBtn = document.getElementById('admin_action_btn');
const startGameBtn = document.getElementById('start-game-btn');
const cancelGameBtn = document.getElementById('cancel-game-btn');
const leaderboardView = document.getElementById('leaderboard-view');
const liveGameView = document.getElementById('live-game-view');

// Math Engine & Live Session Inputs
const chipRatioInput = document.getElementById('chip-ratio');
const buyInAmtInput = document.getElementById('buy-in-amt');
const liveBalanceText = document.getElementById('live-balance');
const submitGameBtn = document.getElementById('submit-game-btn');
const liveTotalBuyins = document.getElementById('live-total-buyins');
const liveTotalPot = document.getElementById('live-total-pot');
const liveTotalChips = document.getElementById('live-total-chips');
const rosterBuyinsBadge = document.getElementById('roster-buyins-badge');

// Player Rows
const addPlayerBtn = document.getElementById('add-player-btn');
const playerContainer = document.getElementById('players-container');
const playerTemplate = document.getElementById('player-row-template');

// Timeframe Filters
const timeframeselect = document.getElementById('time_frame_select');
const customDateControls = document.getElementById('custom_date_controls');
const applyCustomDatebtn = document.getElementById('apply_custom_date_btn');
const startDate = document.getElementById('start_date');
const endDate = document.getElementById('end_date');

// Unlock Admin Modal
const unlockModal = document.getElementById('unlock_modal');
const unlockTableName = document.getElementById('unlock_table_name');
const adminPinInput = document.getElementById('admin_pin_input');
const unlockError = document.getElementById('unlock_error');
const unlockSubmitBtn = document.getElementById('unlock_submit_btn');
const unlockCancelBtn = document.getElementById('unlock_cancel_btn');
const unlockModalClose = document.getElementById('unlock_modal_close');

// Share Admin Modal
const shareModal = document.getElementById('share_modal');
const shareTableName = document.getElementById('share_table_name');
const sharePinDisplay = document.getElementById('share_pin_display');
const shareLinkDisplay = document.getElementById('share_link_display');
const copyPinBtn = document.getElementById('copy_pin_btn');
const copyLinkBtn = document.getElementById('copy_link_btn');
const shareDoneBtn = document.getElementById('share_done_btn');
const shareModalClose = document.getElementById('share_modal_close');

// Create Table Modal
const createModal = document.getElementById('create_modal');
const newTableNameInput = document.getElementById('new_table_name_input');
const newTablePinInput = document.getElementById('new_table_pin_input');
const createTableError = document.getElementById('create_table_error');
const createSubmitBtn = document.getElementById('create_submit_btn');
const createCancelBtn = document.getElementById('create_cancel_btn');
const createModalClose = document.getElementById('create_modal_close');

// --- 3. Math Engine & Balance Checker ---
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

// --- 4. Role & Authorization Management ---
function updateRoleUI(isAdmin) {
    if (isAdmin) {
        roleBadge.className = 'role-badge role-admin';
        roleBadge.innerText = '🛡️ Admin';
        adminActionBtn.innerText = 'Share Admin';
        startGameBtn.classList.remove('hidden');
    } else {
        roleBadge.className = 'role-badge role-viewer';
        roleBadge.innerText = '👀 Viewer';
        adminActionBtn.innerText = 'Unlock Admin';
        startGameBtn.classList.add('hidden');
    }
}

function checkAdminStatus(groupId = currentGroupId) {
    const pin = getAdminPin(groupId);
    if (!pin) {
        isCurrentTableAdmin = false;
        updateRoleUI(false);
        return Promise.resolve(false);
    }

    return fetch('/api/groups/verify_admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group_id: groupId, pin: pin })
    })
    .then(res => res.json())
    .then(data => {
        isCurrentTableAdmin = !!(data.status === 'success' && data.is_admin);
        updateRoleUI(isCurrentTableAdmin);
        return isCurrentTableAdmin;
    })
    .catch(err => {
        console.error("Auth verification error:", err);
        isCurrentTableAdmin = false;
        updateRoleUI(false);
        return false;
    });
}

// --- 5. Groups & Leaderboard Management ---
function update_titles() {
    const found = availableGroups.find(g => g.group_id === currentGroupId);
    currentGroupName = found ? found.name : 'Poker';
    leaderboardTitle.innerText = `${currentGroupName} 🏆`;
    liveSessionTitle.innerText = `Live Session (${currentGroupName})`;
}

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

function load_groups() {
    fetch('/api/groups')
        .then(res => res.json())
        .then(groups => {
            availableGroups = groups;
            groupSelect.innerHTML = '';
            
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
            checkAdminStatus(currentGroupId);
            get_leaderboard(timeframeselect.value);
        })
        .catch(err => {
            console.error("Error loading groups:", err);
            checkAdminStatus(currentGroupId);
            get_leaderboard(timeframeselect.value);
        });
}

// --- 6. Event Handlers ---
groupSelect.addEventListener('change', () => {
    currentGroupId = groupSelect.value;
    localStorage.setItem('poker_active_table', currentGroupId);
    history.replaceState(null, '', `?table=${currentGroupId}`);
    update_titles();
    checkAdminStatus(currentGroupId);
    get_leaderboard(timeframeselect.value);
});

// Admin Action Button (Unlock vs Share)
adminActionBtn.addEventListener('click', () => {
    if (isCurrentTableAdmin) {
        shareTableName.innerText = currentGroupName;
        const pin = getAdminPin(currentGroupId) || '••••';
        sharePinDisplay.innerText = pin;
        const inviteUrl = `${window.location.origin}/?table=${encodeURIComponent(currentGroupId)}#key=${encodeURIComponent(pin)}`;
        shareLinkDisplay.innerText = inviteUrl;
        copyPinBtn.innerText = 'Copy PIN';
        copyLinkBtn.innerText = 'Copy Link';
        shareModal.classList.remove('hidden');
    } else {
        unlockTableName.innerText = currentGroupName;
        adminPinInput.value = '';
        unlockError.style.display = 'none';
        unlockModal.classList.remove('hidden');
        setTimeout(() => adminPinInput.focus(), 100);
    }
});

// Unlock Modal Handlers
function closeUnlockModal() {
    unlockModal.classList.add('hidden');
    adminPinInput.value = '';
    unlockError.style.display = 'none';
}
unlockModalClose.addEventListener('click', closeUnlockModal);
unlockCancelBtn.addEventListener('click', closeUnlockModal);

unlockSubmitBtn.addEventListener('click', () => {
    const enteredPin = adminPinInput.value.trim();
    if (!enteredPin) {
        unlockError.innerText = 'Please enter an Admin PIN';
        unlockError.style.display = 'block';
        return;
    }

    unlockSubmitBtn.disabled = true;
    unlockSubmitBtn.innerText = 'Verifying...';

    fetch('/api/groups/verify_admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group_id: currentGroupId, pin: enteredPin })
    })
    .then(res => res.json())
    .then(data => {
        unlockSubmitBtn.disabled = false;
        unlockSubmitBtn.innerText = 'Verify & Unlock';
        if (data.status === 'success' && data.is_admin) {
            setAdminPin(currentGroupId, enteredPin);
            isCurrentTableAdmin = true;
            updateRoleUI(true);
            closeUnlockModal();
            alert(`🎉 Table Admin unlocked for ${currentGroupName}!`);
        } else {
            unlockError.innerText = data.message || 'Invalid PIN. Please try again.';
            unlockError.style.display = 'block';
        }
    })
    .catch(err => {
        console.error("Unlock error:", err);
        unlockSubmitBtn.disabled = false;
        unlockSubmitBtn.innerText = 'Verify & Unlock';
        unlockError.innerText = 'Network error verifying PIN';
        unlockError.style.display = 'block';
    });
});

// Share Modal Handlers
function closeShareModal() {
    shareModal.classList.add('hidden');
}
shareModalClose.addEventListener('click', closeShareModal);
shareDoneBtn.addEventListener('click', closeShareModal);

copyPinBtn.addEventListener('click', () => {
    const pin = getAdminPin(currentGroupId);
    if (pin) {
        navigator.clipboard.writeText(pin).then(() => {
            copyPinBtn.innerText = 'Copied!';
            setTimeout(() => { copyPinBtn.innerText = 'Copy PIN'; }, 2000);
        });
    }
});

copyLinkBtn.addEventListener('click', () => {
    const pin = getAdminPin(currentGroupId);
    if (pin) {
        const inviteUrl = `${window.location.origin}/?table=${encodeURIComponent(currentGroupId)}#key=${encodeURIComponent(pin)}`;
        navigator.clipboard.writeText(inviteUrl).then(() => {
            copyLinkBtn.innerText = 'Copied!';
            setTimeout(() => { copyLinkBtn.innerText = 'Copy Link'; }, 2000);
        });
    }
});

// Create Table Modal Handlers
createGroupBtn.addEventListener('click', () => {
    newTableNameInput.value = '';
    newTablePinInput.value = '';
    createTableError.style.display = 'none';
    createModal.classList.remove('hidden');
    setTimeout(() => newTableNameInput.focus(), 100);
});

function closeCreateModal() {
    createModal.classList.add('hidden');
    createTableError.style.display = 'none';
}
createModalClose.addEventListener('click', closeCreateModal);
createCancelBtn.addEventListener('click', closeCreateModal);

createSubmitBtn.addEventListener('click', () => {
    const name = newTableNameInput.value.trim();
    const pin = newTablePinInput.value.trim();

    if (!name) {
        createTableError.innerText = 'Please enter a Table Name';
        createTableError.style.display = 'block';
        return;
    }

    createSubmitBtn.disabled = true;
    createSubmitBtn.innerText = 'Creating...';

    fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, pin: pin })
    })
    .then(res => res.json())
    .then(data => {
        createSubmitBtn.disabled = false;
        createSubmitBtn.innerText = 'Create Table';

        if (data.status === 'error') {
            createTableError.innerText = data.message || 'Error creating table';
            createTableError.style.display = 'block';
        } else {
            currentGroupId = data.group_id;
            currentGroupName = data.name;
            if (data.admin_pin) {
                setAdminPin(currentGroupId, data.admin_pin);
            }
            localStorage.setItem('poker_active_table', currentGroupId);
            history.replaceState(null, '', `?table=${currentGroupId}`);
            closeCreateModal();
            load_groups();
            alert(`🎉 Table "${data.name}" created!\n\nYour Admin PIN is: ${data.admin_pin}\n(Saved automatically to this device)`);
        }
    })
    .catch(err => {
        console.error("Failed to create group:", err);
        createSubmitBtn.disabled = false;
        createSubmitBtn.innerText = 'Create Table';
        createTableError.innerText = 'Server error creating table';
        createTableError.style.display = 'block';
    });
});

// Live Session Navigation Handlers
startGameBtn.addEventListener('click', () => {
    if (!isCurrentTableAdmin) {
        adminActionBtn.click();
        return;
    }

    leaderboardView.classList.add('hidden');
    liveGameView.classList.remove('hidden');
    
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

// Player Rows
addPlayerBtn.addEventListener('click', () => {
    add_player_row();
});

// Dynamic Number Inputs Listener
document.addEventListener('input', (event) => {
    if (event.target.type === 'number') {
        calculate_Balance();
    }
});

// Submit Game Handler
submitGameBtn.addEventListener('click', () => {
    if (!isCurrentTableAdmin) {
        alert("Admin authorization required to submit games.");
        adminActionBtn.click();
        return;
    }

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

    const adminPin = getAdminPin(currentGroupId) || '';

    fetch('/api/add_game', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'X-Admin-Key': adminPin
        },
        body: JSON.stringify(payload)
    })
    .then(response => response.json())
    .then(data => {
        if (data.status === "error") {
            alert("Error: " + data.message);
            if (data.message.toLowerCase().includes("admin authorization")) {
                checkAdminStatus(currentGroupId);
            }
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

// Timeframe Filter Handlers
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

// --- 7. Initial Page Setup ---
add_player_row();
add_player_row();
load_groups();
