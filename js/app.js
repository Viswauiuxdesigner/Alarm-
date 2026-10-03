// Duo Main Application Orchestrator
document.addEventListener('DOMContentLoaded', async () => {
  console.log('Initializing Duo Reminders...');

  // Track triggered reminders for today to prevent repeated rapid firing
  const triggeredToday = new Set();

  // 1. Initial State Check
  const pair = window.storage.getPair();
  const onboardingEl = document.getElementById('onboarding-screen');

  if (!pair) {
    if (onboardingEl) onboardingEl.style.display = 'flex';
  } else {
    if (onboardingEl) onboardingEl.style.display = 'none';
    window.sync.startPolling();
  }

  // 2. Setup Event Listeners
  setupNavigationEvents();
  setupOnboardingEvents();
  setupReminderFormEvents();
  setupResponseModalEvents();
  setupSettingsEvents();
  setupNotificationPermissionModal();

  // 3. Initial Render
  window.ui.render();

  // 4. Listen for external sync & notification events
  window.addEventListener('duo:state_synced', () => {
    window.ui.render();
  });

  window.addEventListener('duo:notification_action', (event) => {
    const { action, reminderId } = event.detail;
    if (reminderId) {
      if (action === 'going' || action === 'skipped' || action === 'snooze') {
        const reminder = window.storage.getReminders().find(r => r.id === reminderId);
        if (reminder) {
          window.ui.activeReminderForResponse = reminder;
          window.ui.handleResponseAction(action);
        }
      } else {
        window.ui.openResponseModal(reminderId);
      }
    }
  });

  // Check URL parameters (e.g. from notification click or share link)
  const urlParams = new URLSearchParams(window.location.search);
  const paramPairCode = urlParams.get('pair');
  if (paramPairCode && !pair) {
    const joinTab = document.getElementById('tab-join-space');
    const inputCode = document.getElementById('onboard-join-code');
    if (joinTab && inputCode) {
      joinTab.click();
      inputCode.value = paramPairCode.toUpperCase();
    }
  }

  const paramReminderId = urlParams.get('reminderId');
  const paramAction = urlParams.get('action');
  if (paramReminderId) {
    setTimeout(() => {
      if (paramAction && ['going', 'skipped', 'snooze'].includes(paramAction)) {
        const reminder = window.storage.getReminders().find(r => r.id === paramReminderId);
        if (reminder) {
          window.ui.activeReminderForResponse = reminder;
          window.ui.handleResponseAction(paramAction);
        }
      } else {
        window.ui.openResponseModal(paramReminderId);
      }
    }, 500);
  }

  // 5. Periodic Scheduler Loop (Checks every 10s for reminder triggers & relative time updates)
  setInterval(() => {
    checkScheduledReminders();
    if (window.ui.currentTab === 'today') {
      window.ui.renderToday();
    }
  }, window.CONFIG.TIME_CHECK_INTERVAL_MS);

  function checkScheduledReminders() {
    const today = new Date();
    const currentHour = String(today.getHours()).padStart(2, '0');
    const currentMinute = String(today.getMinutes()).padStart(2, '0');
    const currentTimeStr = `${currentHour}:${currentMinute}`;
    const todayKey = window.reminders.getDateKey(today);

    const reminders = window.storage.getReminders();
    const responses = window.storage.getResponses();
    const currentUser = window.storage.getCurrentUser();
    const pair = window.storage.getPair();
    const myId = currentUser ? currentUser.id : (pair ? pair.user1.id : 'u_1');

    reminders.forEach(reminder => {
      if (!window.reminders.isReminderActiveOnDate(reminder, today)) return;

      const triggerKey = `${reminder.id}_${todayKey}_${currentTimeStr}`;
      
      // Check for scheduled time trigger
      const isScheduledTime = reminder.time === currentTimeStr;

      // Check for snoozed trigger
      const myResp = responses.find(
        r => r.reminderId === reminder.id && r.date === todayKey && r.userId === myId
      );
      let isSnoozeTime = false;
      if (myResp && myResp.status === 'snoozed' && myResp.snoozeUntil) {
        const snoozeDate = new Date(myResp.snoozeUntil);
        if (today >= snoozeDate && !triggeredToday.has(`${triggerKey}_snooze`)) {
          isSnoozeTime = true;
        }
      }

      if ((isScheduledTime || isSnoozeTime) && !triggeredToday.has(triggerKey)) {
        triggeredToday.add(triggerKey);
        if (isSnoozeTime) triggeredToday.add(`${triggerKey}_snooze`);

        // Trigger push notification & audio chime
        window.notifications.triggerReminderNotification(reminder);

        // If user is currently looking at the app, open the response sheet!
        if (document.visibilityState === 'visible') {
          window.ui.openResponseModal(reminder.id);
        }
      }
    });
  }

  // ==========================================
  // Event Bindings
  // ==========================================

  function setupNavigationEvents() {
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        window.ui.switchTab(btn.dataset.tab);
      });
    });

    document.getElementById('fab-add-reminder')?.addEventListener('click', () => {
      window.ui.openCreateModal();
    });
  }

  function setupOnboardingEvents() {
    const tabCreate = document.getElementById('tab-create-space');
    const tabJoin = document.getElementById('tab-join-space');
    const formCreate = document.getElementById('form-create-space');
    const formJoin = document.getElementById('form-join-space');

    tabCreate?.addEventListener('click', () => {
      tabCreate.classList.add('active');
      tabJoin.classList.remove('active');
      formCreate.style.display = 'block';
      formJoin.style.display = 'none';
    });

    tabJoin?.addEventListener('click', () => {
      tabJoin.classList.add('active');
      tabCreate.classList.remove('active');
      formJoin.style.display = 'block';
      formCreate.style.display = 'none';
    });

    // Submit Create Space
    document.getElementById('btn-onboard-create')?.addEventListener('click', async () => {
      const userName = (document.getElementById('onboard-user-name').value || '').trim() || 'Viswa';
      const partnerName = (document.getElementById('onboard-partner-name').value || '').trim() || 'Friend';

      const createBtn = document.getElementById('btn-onboard-create');
      createBtn.innerText = 'Creating space...';
      createBtn.disabled = true;

      const newPair = await window.sync.createPair(userName, partnerName);
      createBtn.innerText = 'Continue';
      createBtn.disabled = false;

      document.getElementById('onboarding-screen').style.display = 'none';
      window.sync.startPolling();
      window.ui.showToast(`Pair space created! Code: ${newPair.id}`);
      window.ui.render();

      // Show gentle notification permission prompt
      setTimeout(() => {
        if (window.notifications.getPermissionState() === 'default') {
          window.ui.promptNotificationPermission();
        }
      }, 1000);
    });

    // Submit Join Space
    document.getElementById('btn-onboard-join')?.addEventListener('click', async () => {
      const pairCode = (document.getElementById('onboard-join-code').value || '').trim();
      const userName = (document.getElementById('onboard-join-user-name').value || '').trim() || 'Partner';

      if (!pairCode) {
        alert('Please enter your 6-character pair code');
        return;
      }

      const joinBtn = document.getElementById('btn-onboard-join');
      joinBtn.innerText = 'Connecting...';
      joinBtn.disabled = true;

      const result = await window.sync.joinPair(pairCode, userName);
      joinBtn.innerText = 'Join Space';
      joinBtn.disabled = false;

      if (result.success) {
        document.getElementById('onboarding-screen').style.display = 'none';
        window.sync.startPolling();
        window.ui.showToast(`Connected to pair space! 🎉`);
        window.ui.render();
      } else {
        alert(result.error || 'Pair code not found. Please verify and try again.');
      }
    });
  }

  function setupReminderFormEvents() {
    const repeatSelect = document.getElementById('select-repeat');
    const customDaysWrap = document.getElementById('wrap-custom-days');

    repeatSelect?.addEventListener('change', (e) => {
      if (e.target.value === 'custom') {
        customDaysWrap.style.display = 'flex';
      } else {
        customDaysWrap.style.display = 'none';
      }
    });

    // Save Reminder Submit
    document.getElementById('btn-save-reminder')?.addEventListener('click', async () => {
      const modal = document.getElementById('modal-create-reminder');
      const editId = modal.dataset.editId;
      const selectedOption = document.querySelector('.activity-option.selected');

      let title = selectedOption ? selectedOption.dataset.name : 'Walking';
      let icon = selectedOption ? selectedOption.dataset.icon : '🚶';

      if (selectedOption && selectedOption.dataset.id === 'custom') {
        const customTitle = (document.getElementById('input-custom-title').value || '').trim();
        title = customTitle || 'Custom Activity';
        icon = '✏️';
      }

      const time = document.getElementById('input-reminder-time').value || '06:00';
      const repeat = document.getElementById('select-repeat').value || 'daily';
      const customDays = repeat === 'custom' ? window.ui.selectedDays : null;
      const pair = window.storage.getPair();

      const reminder = {
        id: editId || 'rem_' + Math.random().toString(36).substring(2, 9),
        pairId: pair ? pair.id : 'DUO_LOCAL',
        title,
        icon,
        time,
        repeat,
        customDays,
        active: true,
        createdAt: new Date().toISOString()
      };

      await window.sync.saveReminder(reminder);
      window.ui.closeModal('modal-create-reminder');
      window.ui.showToast(`Reminder saved: ${title} at ${window.reminders.formatTime(time)}`);
      window.ui.render();
    });

    // Delete Reminder Submit
    document.getElementById('btn-delete-reminder')?.addEventListener('click', async () => {
      const modal = document.getElementById('modal-create-reminder');
      const editId = modal.dataset.editId;
      if (editId && confirm('Delete this reminder?')) {
        await window.sync.deleteReminder(editId);
        window.ui.closeModal('modal-create-reminder');
        window.ui.showToast('Reminder deleted');
        window.ui.render();
      }
    });
  }

  function setupResponseModalEvents() {
    document.getElementById('btn-action-going')?.addEventListener('click', () => {
      window.ui.handleResponseAction('going');
    });

    document.getElementById('btn-action-skip')?.addEventListener('click', () => {
      window.ui.handleResponseAction('skipped');
    });

    document.getElementById('btn-action-snooze')?.addEventListener('click', () => {
      window.ui.handleResponseAction('snooze');
    });
  }

  function setupSettingsEvents() {
    // Copy Pair Code
    document.getElementById('btn-copy-code')?.addEventListener('click', () => {
      const pair = window.storage.getPair();
      if (pair && pair.id) {
        navigator.clipboard.writeText(pair.id);
        window.ui.showToast(`Copied pair code: ${pair.id} 📋`);
      }
    });

    // Share Pair Link
    document.getElementById('btn-share-pair')?.addEventListener('click', () => {
      const pair = window.storage.getPair();
      if (!pair || !pair.id) return;
      const shareUrl = `${window.location.origin}${window.location.pathname}?pair=${pair.id}`;

      if (navigator.share) {
        navigator.share({
          title: 'Join my Duo reminder space',
          text: `Let's share reminders and stay accountable on Duo! Use code: ${pair.id}`,
          url: shareUrl
        }).catch(() => {});
      } else {
        navigator.clipboard.writeText(shareUrl);
        window.ui.showToast('Pair link copied to clipboard! 🔗');
      }
    });

    // Update Profile Names
    document.getElementById('settings-user-name')?.addEventListener('change', (e) => {
      const currentUser = window.storage.getCurrentUser();
      const pair = window.storage.getPair();
      const newName = (e.target.value || '').trim();
      if (newName && currentUser) {
        currentUser.name = newName;
        window.storage.setCurrentUser(currentUser);
        if (pair) {
          if (currentUser.id === pair.user1.id) pair.user1.name = newName;
          else pair.user2.name = newName;
          window.storage.setPair(pair);
        }
        window.ui.showToast('Name updated');
        window.ui.render();
      }
    });

    document.getElementById('settings-partner-name')?.addEventListener('change', (e) => {
      const currentUser = window.storage.getCurrentUser();
      const pair = window.storage.getPair();
      const newPartnerName = (e.target.value || '').trim();
      if (newPartnerName && pair) {
        const isUser1 = currentUser && currentUser.id === pair.user1.id;
        if (isUser1) pair.user2.name = newPartnerName;
        else pair.user1.name = newPartnerName;
        window.storage.setPair(pair);
        window.ui.showToast('Partner name updated');
        window.ui.render();
      }
    });

    // Test Reminder Trigger (Simulate in 3 seconds)
    document.getElementById('btn-test-notification')?.addEventListener('click', () => {
      window.ui.showToast('⏰ Simulating reminder trigger in 3 seconds...');
      setTimeout(() => {
        const reminders = window.storage.getReminders();
        const testReminder = reminders[0] || {
          id: 'test_rem',
          title: 'Walking',
          icon: '🚶',
          time: '06:00'
        };
        window.notifications.triggerReminderNotification(testReminder);
        window.ui.openResponseModal(testReminder.id);
      }, 3000);
    });

    // Install PWA Button
    document.getElementById('btn-install-app')?.addEventListener('click', async () => {
      if (window.ui.deferredPrompt) {
        window.ui.deferredPrompt.prompt();
        const choice = await window.ui.deferredPrompt.userChoice;
        if (choice.outcome === 'accepted') {
          window.ui.showToast('Thank you for installing Duo! 🎉');
        }
        window.ui.deferredPrompt = null;
      } else {
        alert('To install Duo on Android, tap the browser menu (⋮) and choose "Install App" or "Add to Home Screen".');
      }
    });

    // Reset Space
    document.getElementById('btn-reset-space')?.addEventListener('click', () => {
      if (confirm('Are you sure you want to leave this reminder space and reset data?')) {
        window.storage.clearAll();
        window.location.reload();
      }
    });
  }

  function setupNotificationPermissionModal() {
    document.getElementById('btn-enable-notif-confirm')?.addEventListener('click', () => {
      window.ui.confirmNotificationPermission();
    });

    document.getElementById('btn-enable-notif-later')?.addEventListener('click', () => {
      window.ui.closeModal('modal-notif-permission');
    });
  }
});
