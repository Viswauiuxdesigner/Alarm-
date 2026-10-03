// Duo UI Rendering & Interaction Engine
class UIManager {
  constructor() {
    this.currentTab = 'today';
    this.selectedActivity = 'walking';
    this.selectedRepeat = 'daily';
    this.selectedDays = [1, 2, 3, 4, 5]; // Mon-Fri default for custom
    this.activeReminderForResponse = null;
    this.deferredPrompt = null;

    // Capture PWA install prompt
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredPrompt = e;
      const installBtn = document.getElementById('btn-install-app');
      if (installBtn) installBtn.style.display = 'flex';
    });

    // Listen to network status
    window.addEventListener('duo:network_status', (e) => {
      this.renderNetworkStatus(e.detail.online);
    });
  }

  // Helper to format status badge HTML
  renderStatusBadge(status, timestamp, snoozeTime) {
    switch (status) {
      case window.CONFIG.STATUS.GOING:
        return `<span class="status-pill status-going">✅ Going</span>
                <span class="status-time">${timestamp || ''}</span>`;
      case window.CONFIG.STATUS.SKIPPED:
        return `<span class="status-pill status-skipped">❌ Skipped</span>
                <span class="status-time">${timestamp || ''}</span>`;
      case window.CONFIG.STATUS.SNOOZED:
        return `<span class="status-pill status-snoozed">⏰ Snoozed</span>
                <span class="status-time">${snoozeTime ? 'until ' + snoozeTime : timestamp || ''}</span>`;
      case window.CONFIG.STATUS.PENDING:
      default:
        return `<span class="status-pill status-pending">⏳ Pending</span>`;
    }
  }

  // Render Dev Mode Switcher Banner (Disabled in consumer UI)
  renderUserBar() {
    const barEl = document.getElementById('user-bar');
    if (barEl) barEl.style.display = 'none';
  }

  // Render Network Status Badge
  renderNetworkStatus(isOnline = navigator.onLine) {
    const badgeEl = document.getElementById('network-status-badge');
    if (!badgeEl) return;

    if (isOnline) {
      badgeEl.innerHTML = `<span style="color: #10B981;">● Connected</span>`;
      badgeEl.title = 'Real-time server sync active';
    } else {
      badgeEl.innerHTML = `<span style="color: #F59E0B;">● Offline (Cached)</span>`;
      badgeEl.title = 'Offline mode. Changes will sync when reconnected.';
    }
  }

  // Render Top Header
  renderHeader() {
    const currentUser = window.storage.getCurrentUser();
    const pair = window.storage.getPair();
    const greetingEl = document.getElementById('header-greeting');
    const partnerStatusEl = document.getElementById('header-partner-status');

    const name = currentUser ? currentUser.name : (pair ? pair.user1.name : 'You');
    const isUser1 = currentUser && pair ? currentUser.id === pair.user1.id : true;
    const partnerName = pair ? (isUser1 ? pair.user2.name : pair.user1.name) : 'Partner';
    
    // Time of day greeting
    const hour = new Date().getHours();
    let timeGreeting = 'Good Morning';
    if (hour >= 12 && hour < 17) timeGreeting = 'Good Afternoon';
    if (hour >= 17) timeGreeting = 'Good Evening';

    if (greetingEl) greetingEl.innerHTML = `${timeGreeting}, ${name} 👋`;
    if (partnerStatusEl) partnerStatusEl.innerText = `Connected with ${partnerName}`;

    this.renderNetworkStatus();
  }

  // Render Today Screen
  renderToday() {
    const listEl = document.getElementById('today-reminders-list');
    if (!listEl) return;

    const items = window.reminders.getTodayReminders();
    const currentUser = window.storage.getCurrentUser();
    const myName = currentUser ? currentUser.name : 'You';

    if (items.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">⏰</div>
          <h4>No Reminders Today</h4>
          <p>Create a shared reminder for both of you to stay accountable.</p>
          <button class="btn-primary" id="btn-empty-add" style="max-width: 200px; margin: 0 auto; height: 44px;">
            + Add Reminder
          </button>
        </div>
      `;
      document.getElementById('btn-empty-add')?.addEventListener('click', () => this.openCreateModal());
      return;
    }

    listEl.innerHTML = items.map(item => {
      const { reminder, myStatus, myRespondedAt, partnerName, partnerStatus, partnerRespondedAt, relativeStatus, isPast, isActiveNow, isSnoozed, snoozeTimeStr } = item;
      const formattedTime = window.reminders.formatTime(reminder.time);

      let repeatLabel = 'Every day';
      if (reminder.repeat === 'weekdays') repeatLabel = 'Weekdays';
      if (reminder.repeat === 'once') repeatLabel = 'Once';
      if (reminder.repeat === 'custom') repeatLabel = 'Selected days';

      const cardClasses = ['reminder-card'];
      if (isActiveNow) cardClasses.push('active-reminder');
      if (isPast && myStatus !== 'pending') cardClasses.push('past-reminder');

      const isPendingMyResponse = myStatus === 'pending';

      return `
        <div class="${cardClasses.join(' ')}" data-id="${reminder.id}">
          <div class="card-header">
            <div class="card-title-wrap">
              <div class="card-emoji">${reminder.icon || '⏰'}</div>
              <div class="card-title-text">
                <h3>${reminder.title}</h3>
                <div class="card-time-badge">
                  <span>${formattedTime}</span>
                  <span class="repeat-badge">${repeatLabel}</span>
                </div>
              </div>
            </div>
            <button class="card-actions-menu" onclick="ui.openEditModal('${reminder.id}')" title="Edit reminder">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="1"></circle>
                <circle cx="12" cy="5" r="1"></circle>
                <circle cx="12" cy="19" r="1"></circle>
              </svg>
            </button>
          </div>

          <div class="status-grid">
            <div class="status-column">
              <span class="user-label">You (${myName})</span>
              ${this.renderStatusBadge(myStatus, myRespondedAt, snoozeTimeStr)}
            </div>
            <div class="status-column partner">
              <span class="user-label">${partnerName}</span>
              ${this.renderStatusBadge(partnerStatus, partnerRespondedAt, null)}
            </div>
          </div>

          <div class="card-footer">
            <span class="next-reminder-tag">
              ${isActiveNow ? '🔥 Active Now' : relativeStatus}
            </span>
            <button class="btn-respond ${isPendingMyResponse ? '' : 'secondary'}" onclick="ui.openResponseModal('${reminder.id}')">
              ${isPendingMyResponse ? '👉 Respond' : 'Change Response'}
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  // Render 7-Day History Screen
  renderHistory() {
    const containerEl = document.getElementById('history-content');
    if (!containerEl) return;

    const historyGroups = window.reminders.getHistory(7);
    const currentUser = window.storage.getCurrentUser();
    const myName = currentUser ? currentUser.name : 'You';

    if (historyGroups.length === 0) {
      containerEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📜</div>
          <h4>No History Yet</h4>
          <p>As you and your partner respond to daily reminders, your real accountability timeline will appear here.</p>
        </div>
      `;
      return;
    }

    containerEl.innerHTML = historyGroups.map(group => {
      const itemsHtml = group.items.map(item => {
        const { reminder, myStatus, myTime, partnerName, partnerStatus, partnerTime } = item;
        const formattedTime = window.reminders.formatTime(reminder.time);

        return `
          <div class="history-card">
            <div class="history-card-header">
              <div class="history-title">
                <span>${reminder.icon || '⏰'}</span>
                <span>${reminder.title}</span>
              </div>
              <span class="history-time">${formattedTime}</span>
            </div>
            <div class="history-responses-row">
              <div class="history-user-cell">
                <strong>You:</strong> ${this.formatHistoryStatus(myStatus, myTime)}
              </div>
              <div class="history-user-cell">
                <strong>${partnerName}:</strong> ${this.formatHistoryStatus(partnerStatus, partnerTime)}
              </div>
            </div>
          </div>
        `;
      }).join('');

      return `
        <div class="history-group">
          <div class="history-date-header">${group.dateLabel}</div>
          ${itemsHtml}
        </div>
      `;
    }).join('');
  }

  formatHistoryStatus(status, time) {
    if (status === 'going') return `<span style="color:var(--success);font-weight:600;">✅ Going (${time || 'done'})</span>`;
    if (status === 'skipped') return `<span style="color:var(--danger);font-weight:600;">❌ Skipped (${time || ''})</span>`;
    if (status === 'snoozed') return `<span style="color:var(--primary);font-weight:600;">⏰ Snoozed</span>`;
    return `<span style="color:var(--text-muted);">⏳ Pending</span>`;
  }

  // Render Settings Screen
  renderSettings() {
    const pair = window.storage.getPair();
    const currentUser = window.storage.getCurrentUser();
    const permission = window.notifications.getPermissionState();

    const userNameInput = document.getElementById('settings-user-name');
    const partnerNameInput = document.getElementById('settings-partner-name');
    const notifStatusEl = document.getElementById('settings-notif-status');

    if (pair && currentUser) {
      if (userNameInput) userNameInput.value = currentUser.name;
      const isUser1 = currentUser.id === pair.user1.id;
      const partnerName = isUser1 ? pair.user2.name : pair.user1.name;
      if (partnerNameInput) partnerNameInput.value = partnerName;
    }

    if (notifStatusEl) {
      if (permission === 'granted') {
        notifStatusEl.innerHTML = '<span style="color:var(--success);font-weight:700;">✅ Enabled</span>';
      } else if (permission === 'denied') {
        notifStatusEl.innerHTML = '<span style="color:var(--danger);font-weight:700;">🚫 Blocked</span>';
      } else {
        notifStatusEl.innerHTML = '<button class="user-bar-btn" onclick="ui.promptNotificationPermission()">Enable</button>';
      }
    }
  }

  openDeactivateModal() {
    const modal = document.getElementById('modal-deactivate-confirm');
    if (modal) modal.classList.add('active');
  }

  // Switch Navigation Tab
  switchTab(tabName) {
    this.currentTab = tabName;
    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.tab === tabName);
    });
    document.querySelectorAll('.view-section').forEach(el => {
      el.classList.toggle('active', el.id === `view-${tabName}`);
    });

    const fabEl = document.getElementById('fab-add-reminder');
    if (fabEl) {
      fabEl.style.display = tabName === 'today' ? 'flex' : 'none';
    }

    this.render();
  }

  // Open Create/Edit Reminder Modal
  openCreateModal(existingReminderId = null) {
    const modal = document.getElementById('modal-create-reminder');
    const formTitle = document.getElementById('create-modal-title');
    const submitBtn = document.getElementById('btn-save-reminder');
    const deleteBtn = document.getElementById('btn-delete-reminder');
    const customTitleGroup = document.getElementById('group-custom-title');
    const customTitleInput = document.getElementById('input-custom-title');
    const timeInput = document.getElementById('input-reminder-time');
    const repeatSelect = document.getElementById('select-repeat');
    const customDaysWrap = document.getElementById('wrap-custom-days');

    const editingReminder = existingReminderId
      ? window.storage.getReminders().find(r => r.id === existingReminderId)
      : null;

    if (editingReminder) {
      formTitle.innerText = 'Edit Reminder';
      submitBtn.innerText = 'Save Changes';
      if (deleteBtn) deleteBtn.style.display = 'block';
      timeInput.value = editingReminder.time;
      repeatSelect.value = editingReminder.repeat;
      this.selectedActivity = editingReminder.icon ? editingReminder.icon : 'walking';
      
      if (editingReminder.repeat === 'custom') {
        customDaysWrap.style.display = 'flex';
        this.selectedDays = editingReminder.customDays || [1, 2, 3, 4, 5];
      } else {
        customDaysWrap.style.display = 'none';
      }

      if (customTitleGroup) {
        const isPreset = window.CONFIG.ACTIVITIES.some(a => a.name === editingReminder.title);
        if (!isPreset) {
          customTitleGroup.style.display = 'block';
          customTitleInput.value = editingReminder.title;
        } else {
          customTitleGroup.style.display = 'none';
        }
      }
    } else {
      formTitle.innerText = 'Create Reminder';
      submitBtn.innerText = 'Create Reminder';
      if (deleteBtn) deleteBtn.style.display = 'none';
      timeInput.value = '06:00';
      repeatSelect.value = 'daily';
      this.selectedActivity = 'walking';
      if (customTitleGroup) customTitleGroup.style.display = 'none';
      if (customDaysWrap) customDaysWrap.style.display = 'none';
    }

    this.renderActivityPicker(editingReminder ? editingReminder.title : 'Walking');
    this.renderDayButtons();

    modal.dataset.editId = existingReminderId || '';
    modal.classList.add('active');
  }

  openEditModal(id) {
    this.openCreateModal(id);
  }

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('active');
  }

  renderActivityPicker(selectedTitle = 'Walking') {
    const grid = document.getElementById('activity-picker-grid');
    if (!grid) return;

    grid.innerHTML = window.CONFIG.ACTIVITIES.map(act => {
      const isSelected = act.name.toLowerCase() === selectedTitle.toLowerCase() ||
        (act.id === 'custom' && !window.CONFIG.ACTIVITIES.some(a => a.id !== 'custom' && a.name.toLowerCase() === selectedTitle.toLowerCase()));

      return `
        <div class="activity-option ${isSelected ? 'selected' : ''}" data-id="${act.id}" data-name="${act.name}" data-icon="${act.icon}">
          <div class="activity-option-icon">${act.icon}</div>
          <div class="activity-option-name">${act.name}</div>
        </div>
      `;
    }).join('');

    grid.querySelectorAll('.activity-option').forEach(el => {
      el.addEventListener('click', () => {
        grid.querySelectorAll('.activity-option').forEach(o => o.classList.remove('selected'));
        el.classList.add('selected');
        const isCustom = el.dataset.id === 'custom';
        const customGroup = document.getElementById('group-custom-title');
        if (customGroup) {
          customGroup.style.display = isCustom ? 'block' : 'none';
          if (isCustom) document.getElementById('input-custom-title')?.focus();
        }
      });
    });
  }

  renderDayButtons() {
    const daysWrap = document.getElementById('day-buttons-wrap');
    if (!daysWrap) return;
    const dayNames = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

    daysWrap.innerHTML = dayNames.map((name, idx) => {
      const isSelected = this.selectedDays.includes(idx);
      return `<button type="button" class="day-btn ${isSelected ? 'selected' : ''}" data-day="${idx}">${name}</button>`;
    }).join('');

    daysWrap.querySelectorAll('.day-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const day = parseInt(btn.dataset.day, 10);
        if (this.selectedDays.includes(day)) {
          this.selectedDays = this.selectedDays.filter(d => d !== day);
        } else {
          this.selectedDays.push(day);
        }
        this.renderDayButtons();
      });
    });
  }

  // Open Response Modal (Active Reminder Action)
  openResponseModal(reminderId) {
    const reminder = window.storage.getReminders().find(r => r.id === reminderId);
    if (!reminder) return;

    this.activeReminderForResponse = reminder;
    const modal = document.getElementById('modal-reminder-response');
    const heroEmoji = document.getElementById('resp-hero-emoji');
    const heroTitle = document.getElementById('resp-hero-title');
    const heroSubtitle = document.getElementById('resp-hero-subtitle');

    if (heroEmoji) heroEmoji.innerText = reminder.icon || '⏰';
    if (heroTitle) heroTitle.innerText = reminder.title;
    if (heroSubtitle) heroSubtitle.innerText = `It's time for your ${reminder.title.toLowerCase()} reminder.`;

    modal.classList.add('active');
  }

  // Submit Active Response
  async handleResponseAction(action) {
    if (!this.activeReminderForResponse) return;
    const reminder = this.activeReminderForResponse;
    const currentUser = window.storage.getCurrentUser();
    const pair = window.storage.getPair();
    const userId = currentUser ? currentUser.id : (pair ? pair.user1.id : 'u_1');
    const todayKey = window.reminders.getDateKey(new Date());

    let status = window.CONFIG.STATUS.GOING;
    let snoozeUntil = null;

    if (action === 'going') {
      status = window.CONFIG.STATUS.GOING;
      window.sound.playSuccessSound();
      this.showToast(`Logged: You're Going ✅`);
    } else if (action === 'skipped') {
      status = window.CONFIG.STATUS.SKIPPED;
      this.showToast(`Skipped for today ❌`);
    } else if (action === 'snooze') {
      status = window.CONFIG.STATUS.SNOOZED;
      const snoozeDate = new Date();
      snoozeDate.setMinutes(snoozeDate.getMinutes() + window.CONFIG.SNOOZE_MINUTES);
      snoozeUntil = snoozeDate.toISOString();
      const timeStr = snoozeDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      this.showToast(`Snoozed until ${timeStr} ⏰`);
    }

    await window.sync.submitResponse(
      reminder.id,
      todayKey,
      userId,
      status,
      new Date().toISOString(),
      snoozeUntil
    );

    this.closeModal('modal-reminder-response');
    this.render();
  }

  // Toast Notification
  showToast(message) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
      toast.style.transition = 'all 0.2s ease';
      setTimeout(() => toast.remove(), 200);
    }, 2800);
  }

  // Explainer Modal before requesting Notification Permission
  promptNotificationPermission() {
    const modal = document.getElementById('modal-notif-permission');
    if (modal) modal.classList.add('active');
  }

  async confirmNotificationPermission() {
    this.closeModal('modal-notif-permission');
    const result = await window.notifications.requestPermission();
    if (result === 'granted') {
      this.showToast('🔔 Notifications enabled!');
    } else if (result === 'denied') {
      this.showToast('⚠️ Notifications blocked in browser settings.');
    }
    this.renderSettings();
  }

  // Master Render
  render() {
    this.renderUserBar();
    this.renderHeader();
    if (this.currentTab === 'today') this.renderToday();
    if (this.currentTab === 'history') this.renderHistory();
    if (this.currentTab === 'settings') this.renderSettings();
  }
}

window.ui = new UIManager();
