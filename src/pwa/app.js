// ========== IndexedDB for offline caching ==========

const DB_NAME = 'ExpensesDB';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('expenses')) {
        db.createObjectStore('expenses', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'user_id' });
      }
      if (!db.objectStoreNames.contains('sync')) {
        db.createObjectStore('sync', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(store, data) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(data);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbGet(store, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGetAll(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbDelete(store, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbClear(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ========== State ==========

const today = new Date().toISOString().split('T')[0];

const state = {
  userId: null,
  token: null,
  userName: null,
  currency: 'EUR',
  budget: 250000,
  selectedMonth: new Date().toISOString().substring(0, 7),
  expenses: [],
  isRegular: false,
  syncTimestamp: null,
};

// ========== API Helper ==========

async function apiFetch(path, options = {}) {
  const opts = {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  };
  if (state.token) {
    opts.headers['Authorization'] = state.token;
  }
  const res = await fetch(path, opts);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'API error');
  }
  return data;
}

// ========== Haptic Feedback ==========

function hapticTap() {
  if (navigator.vibrate) navigator.vibrate(10);
}

// ========== Keypad Component ==========

function createKeypad(containerId, onNumber, onAction) {
  const container = document.getElementById(containerId);
  const layout = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['clear', '0', '.'],
  ];

  container.innerHTML = '';

  layout.forEach((row) => {
    row.forEach((label) => {
      const btn = document.createElement('button');
      btn.className = 'keypad-btn';

      if (label === 'clear') {
        btn.classList.add('clear');
        btn.textContent = '\u232B';
      } else if (label === '.') {
        btn.textContent = '.';
      } else {
        btn.textContent = label;
      }

      btn.addEventListener('click', () => {
        hapticTap();
        if (label === 'clear') {
          onAction('clear');
        } else {
          onNumber(label);
        }
      });

      container.appendChild(btn);
    });
  });
}

function formatCurrencyDisplay(valueInCents, currency) {
  const amount = valueInCents / 100;
  return `${currency} ${amount.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function parseKeypadValue(text) {
  if (text.includes('.')) {
    const [int, dec] = text.split('.');
    const padded = (dec || '').padEnd(2, '0').substring(0, 2);
    return parseInt(`${int || 0}${padded}`, 10) || 0;
  }
  return parseInt(text, 10) * 100 || 0;
}

// ========== Gauge Component ==========

function drawGauge(spent, budget) {
  const canvas = document.getElementById('gauge-canvas');
  const ctx = canvas.getContext('2d');

  const dpr = window.devicePixelRatio || 1;
  const displayWidth = 300;
  const displayHeight = 160;
  canvas.width = displayWidth * dpr;
  canvas.height = displayHeight * dpr;
  canvas.style.width = `${displayWidth}px`;
  canvas.style.height = `${displayHeight}px`;
  ctx.scale(dpr, dpr);

  const cx = displayWidth / 2;
  const cy = displayHeight - 20;
  const radius = Math.min(displayWidth / 2 - 20, 130);
  const startAngle = Math.PI;
  const endAngle = 2 * Math.PI;

  ctx.clearRect(0, 0, displayWidth, displayHeight);

  // Background arc
  const ratio = budget > 0 ? Math.min(spent / budget, 1.5) : 0;
  const arcEnd = startAngle + ratio * Math.PI;

  // Background track
  ctx.beginPath();
  ctx.arc(cx, cy, radius, startAngle, endAngle);
  ctx.lineWidth = 20;
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineCap = 'round';
  ctx.stroke();

  // Colored arc
  const gradient = ctx.createLinearGradient(cx - radius, cy, cx + radius, cy);
  if (ratio < 0.6) {
    gradient.addColorStop(0, '#34c759');
    gradient.addColorStop(1, '#30d158');
  } else if (ratio < 1.0) {
    gradient.addColorStop(0, '#ffcc02');
    gradient.addColorStop(1, '#ffb340');
  } else {
    gradient.addColorStop(0, '#ff9500');
    gradient.addColorStop(1, '#ff3b30');
  }

  if (ratio > 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, arcEnd);
    ctx.lineWidth = 20;
    ctx.strokeStyle = gradient;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  // Spent text
  const spentAmount = formatCurrencyDisplay(spent, state.currency);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--glass-text').trim();
  ctx.font = '600 18px -apple-system, SF Pro Display, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(spentAmount, cx, cy - 10);

  // Budget percentage
  const pct = budget > 0 ? Math.round((spent / budget) * 100) : 0;
  ctx.font = '300 14px -apple-system, SF Pro Display, sans-serif';
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--glass-text-secondary').trim();
  ctx.fillText(`${pct}% of budget`, cx, cy + 16);
}

function updateGauge() {
  const spent = state.expenses.reduce((sum, e) => sum + e.amount, 0);
  drawGauge(spent, state.budget);

  document.getElementById('spent-label').textContent = formatCurrencyDisplay(spent, state.currency);
}

// ========== Month Navigation ==========

function updateMonthLabel() {
  const d = new Date(state.selectedMonth + '-01');
  const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  document.getElementById('month-label').textContent = label;
}

function buildMonthPicker() {
  updateMonthLabel();

  document.getElementById('month-prev').addEventListener('click', () => {
    hapticTap();
    const parts = state.selectedMonth.split('-');
    const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 2, 1);
    state.selectedMonth = d.toISOString().substring(0, 7);
    updateMonthLabel();
    loadExpenses();
  });

  document.getElementById('month-next').addEventListener('click', () => {
    hapticTap();
    const parts = state.selectedMonth.split('-');
    const d = new Date(parseInt(parts[0]), parseInt(parts[1]), 1);
    state.selectedMonth = d.toISOString().substring(0, 7);
    updateMonthLabel();
    loadExpenses();
  });
}

// ========== Expense List ==========

function renderExpenses() {
  const container = document.getElementById('expenses-container');

  if (!state.expenses.length) {
    container.innerHTML = '<div class="empty-state glass"><p>No expenses this month</p></div>';
    return;
  }

  // Sort by date descending
  const sorted = [...state.expenses].sort((a, b) => new Date(b.date) - new Date(a.date));

  // Group by date
  const groups = {};
  sorted.forEach((exp) => {
    const key = exp.date;
    if (!groups[key]) groups[key] = [];
    groups[key].push(exp);
  });

  container.innerHTML = '';

  Object.entries(groups).forEach(([date, expenses]) => {
    const dateObj = new Date(date + 'T00:00:00');
    const today = new Date();
    let label;
    if (dateObj.toDateString() === today.toDateString()) {
      label = 'Today';
    } else if (dateObj.toDateString() === new Date(today.getTime() - 86400000).toDateString()) {
      label = 'Yesterday';
    } else {
      label = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    }

    const group = document.createElement('div');
    group.className = 'expense-group';

    const header = document.createElement('div');
    header.className = 'expense-group-header';
    header.textContent = label;
    group.appendChild(header);

    expenses.forEach((exp) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'expense-row-wrapper';

      const row = document.createElement('div');
      row.className = 'glass expense-row';
      row.innerHTML = `
        <span class="expense-purpose">${escapeHtml(exp.purpose)}${exp.is_regular ? ' <span style="opacity:0.4">&#9733;</span>' : ''}</span>
        <span class="expense-amount">${formatCurrencyDisplay(exp.amount, exp.currency)}</span>
      `;

      // Swipe to delete
      let startX = 0, currentX = 0, isDragging = false;

      row.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
        isDragging = true;
      });

      row.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        currentX = e.touches[0].clientX - startX;
        if (currentX < 0) {
          wrapper.style.transform = `translateX(${Math.max(currentX, -110)}px)`;
        }
      });

      row.addEventListener('touchend', () => {
        isDragging = false;
        if (currentX < -60) {
          wrapper.style.transform = 'translateX(-110px)';
          const deleteBg = document.createElement('div');
          deleteBg.className = 'swipe-delete-bg';
          deleteBg.textContent = 'Delete';
          wrapper.appendChild(deleteBg);

          deleteBg.addEventListener('click', (e) => {
            e.stopPropagation();
            hapticTap();
            deleteExpense(exp.id);
          });
        } else {
          wrapper.style.transform = '';
        }
        currentX = 0;
      });

      // Tap to edit
      row.addEventListener('click', () => {
        if (Math.abs(currentX) < 5) openEditModal(exp);
      });

      wrapper.appendChild(row);
      group.appendChild(wrapper);
    });

    container.appendChild(group);
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ========== Load & Save Expenses ==========

async function loadExpenses() {
  showSync('Loading...');
  try {
    state.expenses = await apiFetch(`/api/expenses?month=${state.selectedMonth}`);
    renderExpenses();
    updateGauge();

    // Cache locally
    const allExpenses = await dbGetAll('expenses');
    for (const exp of state.expenses) {
      await dbPut('expenses', exp);
    }

    hideSync();
  } catch (err) {
    // Fallback to local cache
    const cached = await dbGetAll('expenses');
    state.expenses = cached.filter(e => e.date && e.date.startsWith(state.selectedMonth));
    renderExpenses();
    updateGauge();
    showSync('Offline', 2000);
  }
}

async function addExpense(amount, currency, purpose, date, isRegular) {
  try {
    const result = await apiFetch('/api/expenses', {
      method: 'POST',
      body: JSON.stringify({ amount, currency, purpose, date, is_regular: isRegular }),
    });

    state.expenses.unshift(result);
    renderExpenses();
    updateGauge();
    await dbPut('expenses', result);
    showSync('Added!', 1500);
  } catch (err) {
    showSync(err.message, 2000);
  }
}

async function updateExpense(id, amount, currency, purpose, date, isRegular) {
  try {
    const result = await apiFetch(`/api/expenses/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ amount, currency, purpose, date, is_regular: isRegular }),
    });

    const idx = state.expenses.findIndex(e => e.id === id);
    if (idx >= 0) state.expenses[idx] = result;
    renderExpenses();
    updateGauge();
    await dbPut('expenses', result);
    showSync('Updated!', 1500);
  } catch (err) {
    showSync(err.message, 2000);
  }
}

async function deleteExpense(id) {
  try {
    await apiFetch(`/api/expenses/${id}`, { method: 'DELETE' });
    state.expenses = state.expenses.filter(e => e.id !== id);
    renderExpenses();
    updateGauge();
    await dbDelete('expenses', id);
    showSync('Deleted!', 1500);
  } catch (err) {
    showSync(err.message, 2000);
  }
}

// ========== Sync Engine ==========

async function syncPushPull() {
  showSync('Syncing...');
  try {
    // Get last sync timestamp
    const syncState = await dbGet('sync', 'lastSync');
    const lastSync = syncState ? syncState.timestamp : '1970-01-01';

    // Push local changes
    const localExpenses = await dbGetAll('expenses');
    const localChanges = localExpenses.filter(e => new Date(e.updated_at || e.created_at) > new Date(lastSync));
    if (localChanges.length) {
      try {
        await apiFetch('/api/sync/push', {
          method: 'POST',
          body: JSON.stringify({ expenses: localChanges, lastSyncTimestamp: lastSync }),
        });
      } catch (e) { /* push is best-effort */ }
    }

    // Pull remote changes
    const pullResult = await apiFetch('/api/sync/pull', {
      method: 'POST',
      body: JSON.stringify({ lastSyncTimestamp: lastSync }),
    });

    // Merge: just insert any remote expenses not already local (no conflict)
    const localIds = new Set(localExpenses.map(e => e.id));
    let merged = 0;
    for (const exp of pullResult.expenses) {
      if (!localIds.has(exp.id)) {
        await dbPut('expenses', exp);
        merged++;
      }
    }

    // Update sync timestamp
    await dbPut('sync', { key: 'lastSync', timestamp: new Date().toISOString() });

    // Reload
    await loadExpenses();

    if (merged) {
      showSync(`Synced ${merged} from other user!`, 2500);
    } else {
      showSync('Synced', 1500);
    }
  } catch (err) {
    showSync('Sync failed', 2000);
  }
}

function showSync(message, duration = 3000) {
  const indicator = document.getElementById('sync-indicator');
  const statusText = document.getElementById('sync-status-text');
  const spinner = indicator.querySelector('.sync-spinner');

  statusText.textContent = message;

  if (message === 'Syncing...') {
    spinner.style.display = 'block';
  } else if (message.startsWith('Synced')) {
    spinner.style.display = 'none';
  } else {
    spinner.style.display = 'none';
  }

  indicator.classList.add('visible');

  if (duration > 0) {
    setTimeout(() => indicator.classList.remove('visible'), duration);
  }
}

function hideSync() {
  document.getElementById('sync-indicator').classList.remove('visible');
}

// ========== Modals ==========

function showModal(id) {
  const modal = document.getElementById(id);
  modal.classList.add('visible');

  // Animate in
  const inner = modal.querySelector('.glass-giant');
  requestAnimationFrame(() => {
    inner.classList.add('modal-enter-active');
  });
}

function hideModal(id) {
  const modal = document.getElementById(id);
  const inner = modal.querySelector('.glass-giant');
  inner.classList.remove('modal-enter-active');
  modal.classList.remove('visible');
}

// ========== Edit Modal for Expenses ==========

function openEditModal(expense) {
  document.getElementById('edit-expense-id').value = expense.id;
  document.getElementById('edit-purpose').value = expense.purpose;
  document.getElementById('edit-date').value = expense.date;
  document.getElementById('edit-regular-toggle').classList.toggle('active', expense.is_regular);

  editKeypadValue = String(expense.amount / 100);
  updateEditDisplay();

  createKeypad('edit-keypad-grid', (num) => {
    editKeypadValue += num;
    updateEditDisplay();
  }, (action) => {
    if (action === 'clear') editKeypadValue = '';
    updateEditDisplay();
  });

  // Add OK button
  const container = document.getElementById('edit-keypad-grid');
  const okBtn = document.createElement('button');
  okBtn.className = 'keypad-btn action wide';
  okBtn.textContent = 'OK';
  okBtn.style.gridColumn = 'span 3';
  okBtn.addEventListener('click', () => {
    document.getElementById('save-expense-btn').click();
  });
  container.appendChild(okBtn);

  showModal('edit-modal');
}

let editKeypadValue = '';

function updateEditDisplay() {
  const display = document.getElementById('edit-amount-display');
  if (!editKeypadValue) {
    display.textContent = '0.00';
  } else {
    const cents = parseKeypadValue(editKeypadValue);
    const amount = cents / 100;
    display.textContent = `${amount.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}

// ========== Settings / Budget Modal ==========

let budgetKeypadValue = '';

function openBudgetModal() {
  budgetKeypadValue = String(Math.round(state.budget / 100));
  updateBudgetDisplay();
  createKeypad('budget-keypad-grid', (num) => {
    budgetKeypadValue += num;
    updateBudgetDisplay();
  }, (action) => {
    if (action === 'clear') budgetKeypadValue = '';
    updateBudgetDisplay();
  });

  // Add OK button
  const container = document.getElementById('budget-keypad-grid');
  const okBtn = document.createElement('button');
  okBtn.className = 'keypad-btn action wide';
  okBtn.textContent = 'OK';
  okBtn.style.gridColumn = 'span 3';
  okBtn.addEventListener('click', () => {
    document.getElementById('save-budget-btn').click();
  });
  container.appendChild(okBtn);

  showModal('budget-modal');
}

function updateBudgetDisplay() {
  const display = document.getElementById('budget-display');
  if (!budgetKeypadValue) {
    display.textContent = '0.00';
  } else {
    const cents = parseKeypadValue(budgetKeypadValue);
    const amount = cents / 100;
    display.textContent = `${amount.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}

async function saveBudget() {
  hapticTap();
  const targetCents = parseKeypadValue(budgetKeypadValue);

  try {
    const settings = await apiFetch('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ target_budget: targetCents, currency: state.currency }),
    });

    state.budget = settings.target_budget;
    state.currency = settings.currency;
    await dbPut('settings', { user_id: state.userId, target_budget: settings.target_budget, currency: settings.currency });
    updateGauge();
    hideModal('budget-modal');
    showSync('Budget updated!', 1500);
  } catch (err) {
    showSync(err.message, 2000);
  }
}

// ========== App Initialization ==========

let amountKeypadValue = '';
const keypadOverlay = document.getElementById('amount-keypad');

function showAmountKeypad() {
  amountKeypadValue = '';
  updateAmountDisplay();
  createKeypad('amount-keypad-grid', (num) => {
    amountKeypadValue += num;
    updateAmountDisplay();
  }, (action) => {
    if (action === 'clear') amountKeypadValue = '';
    updateAmountDisplay();
  });

  // Add Enter button
  const container = document.getElementById('amount-keypad-grid');
  const enterBtn = document.createElement('button');
  enterBtn.className = 'keypad-btn action wide';
  enterBtn.textContent = '✓';
  enterBtn.style.gridColumn = 'span 3';
  enterBtn.addEventListener('click', () => {
    hapticTap();
    const mainDisplay = document.getElementById('amount-preview');
    if (amountKeypadValue) {
      const cents = parseKeypadValue(amountKeypadValue);
      const amount = cents / 100;
      mainDisplay.textContent = `${amount.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    keypadOverlay.classList.remove('visible');
  });
  container.appendChild(enterBtn);

  keypadOverlay.classList.add('visible');
}

function updateAmountDisplay() {
  const display = document.getElementById('amount-display');
  if (!amountKeypadValue) {
    display.textContent = '0.00';
  } else {
    const cents = parseKeypadValue(amountKeypadValue);
    const amount = cents / 100;
    display.textContent = `${amount.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}

function init() {
  // Set default date to today
  document.getElementById('expense-date').value = today;

  setupApp();
}

function setupApp() {
  // Load user from local storage
  const savedUser = localStorage.getItem('expenses-user');
  if (savedUser) {
    try {
      const user = JSON.parse(savedUser);
      state.userId = user.userId;
      state.token = user.token;
      state.userName = user.userName;
    } catch { /* ignore */ }
  }

  // Load settings from IndexedDB
  async function loadSettings() {
    try {
      const settings = await dbGet('settings', state.userId);
      if (settings) {
        state.budget = settings.target_budget;
        state.currency = settings.currency;
      }
    } catch { /* use defaults */ }

    // Fallback to server if budget not set
    if (!state.budget || state.budget === 0) {
      try {
        const apiSettings = await apiFetch('/api/settings');
        state.budget = apiSettings.target_budget;
        state.currency = apiSettings.currency || 'EUR';
      } catch { /* use defaults */ }
    }

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('debug')) {
      // Debug mode: prompt for user setup
      showModal('user-modal');
    } else if (!state.token) {
      showModal('user-modal');
    }

    // Initialize data
    buildMonthPicker();
    syncPushPull();
  }

  loadSettings();

  // User modal handlers
  document.getElementById('save-user-btn').addEventListener('click', async () => {
    hapticTap();
    const userId = document.getElementById('user-id-input').value.trim();
    const name = document.getElementById('user-display-name').value.trim();

    if (!userId) return;

    try {
      const result = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ userId, apiKey: 'sharedsecret' }),
      });

      state.userId = result.userId;
      state.token = result.token;
      state.userName = name || result.userName;
    } catch (err) {
      showSync('Invalid credentials. Use "pascal" or "claudia".', 3000);
      return;
    }

    localStorage.setItem('expenses-user', JSON.stringify({ userId: state.userId, token: state.token, userName: state.userName }));
    hideModal('user-modal');

    // Load settings after auth
    const settings = await apiFetch('/api/settings');
    state.budget = settings.target_budget;
    state.currency = settings.currency;

    buildMonthPicker();
    loadExpenses();
  });

  document.getElementById('cancel-user-btn').addEventListener('click', () => hideModal('user-modal'));

  // Sync button
  document.getElementById('sync-button').addEventListener('click', () => {
    hapticTap();
    syncPushPull();
  });

  // Settings (user) button
  document.getElementById('settings-button').addEventListener('click', () => {
    hapticTap();
    showModal('user-modal');
  });

  // Edit budget button
  document.getElementById('edit-budget-btn').addEventListener('click', () => {
    hapticTap();
    openBudgetModal();
  });

  document.getElementById('cancel-budget-btn').addEventListener('click', () => {
    hapticTap();
    hideModal('budget-modal');
  });

  document.getElementById('save-budget-btn').addEventListener('click', saveBudget);

  // Regular toggle
  document.getElementById('regular-toggle').addEventListener('click', () => {
    hapticTap();
    state.isRegular = !state.isRegular;
    document.getElementById('regular-toggle').classList.toggle('active', state.isRegular);
  });

  // Amount display tap → show keypad
  document.getElementById('amount-preview').addEventListener('click', () => {
    hapticTap();
    showAmountKeypad();
  });

  // Add expense button
  document.getElementById('add-expense-btn').addEventListener('click', async () => {
    hapticTap();

    const amountCents = parseKeypadValue(amountKeypadValue);
    if (!amountCents) {
      showSync('Enter amount (tap the value)', 2000);
      return;
    }

    const purpose = document.getElementById('expense-purpose').value.trim();
    const date = document.getElementById('expense-date').value || today;

    if (!purpose) {
      showSync('Enter a purpose', 2000);
      return;
    }

    await addExpense(amountCents, state.currency, purpose, date, state.isRegular);

    // Reset form
    document.getElementById('expense-purpose').value = '';
    amountKeypadValue = '';
    updateAmountDisplay();
  });

  // Save expense in edit modal
  document.getElementById('save-expense-btn').addEventListener('click', () => {
    hapticTap();
    const id = document.getElementById('edit-expense-id').value;
    const purpose = document.getElementById('edit-purpose').value.trim();
    const date = document.getElementById('edit-date').value;
    const isRegular = document.getElementById('edit-regular-toggle').classList.contains('active');
    const amountCents = parseKeypadValue(editKeypadValue);

    if (!purpose || !date) {
      showSync('Fill all fields', 2000);
      return;
    }

    updateExpense(id, amountCents || state.expenses.find(e => e.id === id)?.amount || 0,
      state.currency, purpose, date, isRegular);
    hideModal('edit-modal');
  });

  document.getElementById('cancel-edit-btn').addEventListener('click', () => {
    hapticTap();
    hideModal('edit-modal');
  });

  document.getElementById('delete-expense-btn').addEventListener('click', () => {
    hapticTap();
    const id = document.getElementById('edit-expense-id').value;
    deleteExpense(id);
    hideModal('edit-modal');
  });

  // Close modals on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) hideModal(overlay.id);
    });
  });

  // Set current month active in picker
  buildMonthPicker();
}

// Override init to run setup
init();
