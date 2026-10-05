// Duo Configuration & Constants
const CONFIG = {
  APP_NAME: 'Duo',
  VERSION: '1.0.0',
  SYNC_INTERVAL_MS: 4000, // Background sync polling interval
  TIME_CHECK_INTERVAL_MS: 10000, // Frequency to check scheduled reminders
  SNOOZE_MINUTES: 10,

  STATUS: {
    PENDING: 'pending',
    GOING: 'going',
    SKIPPED: 'skipped',
    SNOOZED: 'snoozed'
  },

  REPEAT: {
    DAILY: 'daily',
    WEEKDAYS: 'weekdays',
    CUSTOM: 'custom',
    ONCE: 'once'
  },

  ACTIVITIES: [
    { id: 'walking', name: 'Walking', icon: '🚶' },
    { id: 'workout', name: 'Workout', icon: '💪' },
    { id: 'study', name: 'Study', icon: '📚' },
    { id: 'water', name: 'Drink Water', icon: '💧' },
    { id: 'meditation', name: 'Meditation', icon: '🧘' },
    { id: 'custom', name: 'Custom', icon: '✏️' }
  ],

  STORAGE_KEYS: {
    ACTIVE_SESSION: 'duo_active_session',
    PAIR: 'duo_pair_data',
    USER: 'duo_current_user',
    REMINDERS: 'duo_reminders',
    RESPONSES: 'duo_responses',
    SETTINGS: 'duo_settings',
    LAST_SYNC: 'duo_last_sync'
  }
};

window.CONFIG = CONFIG;

