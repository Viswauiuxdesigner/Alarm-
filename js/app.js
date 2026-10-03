// Duo Main Application Orchestrator
document.addEventListener('DOMContentLoaded', async () => {
  console.log('Initializing Duo Reminders...');

  // Track triggered reminders for today to prevent repeated rapid firing
  const triggeredToday = new Set();

  // Helper to switch onboarding sub-steps
  function showOnboardingStep(stepId) {
    const steps = [
      'onboard-step-welcome',
      'onboard-step-create-name',
      'onboard-step-create-waiting',
      'onboard-step-join',
      'onboard-step-success'
    ];
    steps.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = (id === stepId) ? 'flex' : 'none';
    });
  }

  let waitingPollInterval = null;
  function startWaitingForPartner(pairId) {
    if (waitingPollInterval) clearInterval(waitingPollInterval);
    waitingPollInterval = setInterval(async () => {
      try {
        const res = await fetch(`./api/sync?pairId=${encodeURIComponent(pairId)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.pair && (data.pair.paired || (data.pair.user2 && data.pair.user2.joined))) {
            clearInterval(waitingPollInterval);
            waitingPollInterval = null;

            // Partner has joined! Update local pair and reminders
            const currentPair = window.storage.getPair() || {};
            currentPair.user1 = data.pair.user1;
            currentPair.user2 = data.pair.user2;
            currentPair.paired = true;
            window.storage.setPair(currentPair);
            if (data.reminders) window.storage.setReminders(data.reminders);

            // Populate success screen names and transition
            const u1El = document.getElementById('connected-user1-pill');
            const u2El = document.getElementById('connected-user2-pill');
            if (u1El) u1El.innerText = data.pair.user1?.name || 'Viswa';
            if (u2El) u2El.innerText = data.pair.user2?.name || 'Partner';
            showOnboardingStep('onboard-step-success');
          }
        }
      } catch (e) {
        console.warn('Waiting partner polling check:', e);
      }
    }, 2000);
  }

  // 1. Initial State Check
  const pair = window.storage.getPair();
  const onboardingEl = document.getElementById('onboarding-screen');

  if (!pair) {
    if (onboardingEl) {
      onboardingEl.style.display = 'flex';
      // Check URL parameters (e.g. from invite link)
      const urlParams = new URLSearchParams(window.location.search);
      const paramPairCode = urlParams.get('pair');
      if (paramPairCode) {
        showOnboardingStep('onboard-step-join');
        const inputCode = document.getElementById('onboard-join-code-input');
        if (inputCode) inputCode.value = paramPairCode.toUpperCase().trim();
      } else {
        showOnboardingStep('onboard-step-welcome');
      }
    }
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

  const urlParams = new URLSearchParams(window.location.search);
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
    // 1. Initial Choice: Create Space
    document.getElementById('btn-choice-create')?.addEventListener('click', () => {
      showOnboardingStep('onboard-step-create-name');
      const nameInput = document.getElementById('onboard-create-name-input');
      if (nameInput) {
        nameInput.focus();
      }
    });

    // 1. Initial Choice: Join Space
    document.getElementById('btn-choice-join')?.addEventListener('click', () => {
      const errorBox = document.getElementById('join-error-box');
      if (errorBox) errorBox.style.display = 'none';
      showOnboardingStep('onboard-step-join');
      const nameInput = document.getElementById('onboard-join-name-input');
      if (nameInput) {
        nameInput.focus();
      }
    });

    // Back buttons
    document.getElementById('btn-back-from-create-name')?.addEventListener('click', () => {
      showOnboardingStep('onboard-step-welcome');
    });

    document.getElementById('btn-back-from-join')?.addEventListener('click', () => {
      const errorBox = document.getElementById('join-error-box');
      if (errorBox) errorBox.style.display = 'none';
      showOnboardingStep('onboard-step-welcome');
    });

    // 2. Phone 1: Submit Create Space
    document.getElementById('btn-submit-create-space')?.addEventListener('click', async () => {
      const nameInput = document.getElementById('onboard-create-name-input');
      const userName = (nameInput?.value || '').trim() || 'Viswa';

      const createBtn = document.getElementById('btn-submit-create-space');
      createBtn.innerHTML = '<span>Creating space...</span>';
      createBtn.disabled = true;

      const newPair = await window.sync.createPair(userName, 'Partner');
      createBtn.innerHTML = '<span>Create Space</span>';
      createBtn.disabled = false;

      if (newPair && newPair.id) {
        const bigCodeEl = document.getElementById('onboard-big-code');
        if (bigCodeEl) bigCodeEl.innerText = newPair.id;

        showOnboardingStep('onboard-step-create-waiting');
        startWaitingForPartner(newPair.id);
      }
    });

    // Phone 1 Waiting: Copy Code
    document.getElementById('btn-onboard-copy-code')?.addEventListener('click', () => {
      const code = document.getElementById('onboard-big-code')?.innerText || '';
      if (code && code !== '------') {
        navigator.clipboard.writeText(code);
        window.ui.showToast(`Pair code copied: ${code} 📋`);
      }
    });

    // Phone 1 Waiting: Share Link
    document.getElementById('btn-onboard-share-code')?.addEventListener('click', () => {
      const code = document.getElementById('onboard-big-code')?.innerText || '';
      if (!code || code === '------') return;

      const shareUrl = `${window.location.origin}${window.location.pathname}?pair=${code}`;
      if (navigator.share) {
        navigator.share({
          title: 'Join my Duo reminder space',
          text: `Join my Duo reminder space with code ${code} so we can stay accountable together!`,
          url: shareUrl
        }).catch(() => {});
      } else {
        navigator.clipboard.writeText(shareUrl);
        window.ui.showToast('Invite link copied to clipboard! 🔗');
      }
    });

    // 3. Phone 2: Submit Join Space
    document.getElementById('btn-submit-join-space')?.addEventListener('click', async () => {
      const nameInput = document.getElementById('onboard-join-name-input');
      const codeInput = document.getElementById('onboard-join-code-input');
      const errorBox = document.getElementById('join-error-box');
      const errorText = document.getElementById('join-error-text');

      const userName = (nameInput?.value || '').trim() || 'Partner';
      const pairCode = (codeInput?.value || '').trim().toUpperCase();

      if (!pairCode) {
        if (errorBox && errorText) {
          errorText.innerText = "Please enter the 6-character partner code.";
          errorBox.style.display = 'flex';
        }
        return;
      }

      if (errorBox) errorBox.style.display = 'none';

      const joinBtn = document.getElementById('btn-submit-join-space');
      joinBtn.innerHTML = '<span>Connecting...</span>';
      joinBtn.disabled = true;

      const result = await window.sync.joinPair(pairCode, userName);
      joinBtn.innerHTML = '<span>Join Space</span>';
      joinBtn.disabled = false;

      if (result.success && result.pair) {
        const u1El = document.getElementById('connected-user1-pill');
        const u2El = document.getElementById('connected-user2-pill');
        if (u1El) u1El.innerText = result.pair.user1?.name || 'Viswa';
        if (u2El) u2El.innerText = result.pair.user2?.name || userName;

        showOnboardingStep('onboard-step-success');
      } else {
        if (errorBox && errorText) {
          errorText.innerText = result.error || "That code doesn't match. Check the code on your partner's phone and try again.";
          errorBox.style.display = 'flex';
        }
      }
    });

    // 4. Finish Onboarding & Enter App (Both Devices)
    document.getElementById('btn-onboard-finish')?.addEventListener('click', () => {
      if (waitingPollInterval) {
        clearInterval(waitingPollInterval);
        waitingPollInterval = null;
      }

      const onboardingEl = document.getElementById('onboarding-screen');
      if (onboardingEl) onboardingEl.style.display = 'none';

      window.sync.startPolling();
      window.ui.render();
      window.ui.showToast("Your reminder space is ready! 🎉");

      // Show gentle notification permission prompt
      setTimeout(() => {
        if (window.notifications.getPermissionState() === 'default') {
          window.ui.promptNotificationPermission();
        }
      }, 800);
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
