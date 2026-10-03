// Duo Web Audio Sound Synthesizer
// Clean, gentle, high-fidelity chimes without external audio dependencies.
class SoundEngine {
  constructor() {
    this.audioCtx = null;
  }

  init() {
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  // Play a pleasant double-chime reminder alert
  playReminderChime() {
    try {
      this.init();
      if (!this.audioCtx) return;

      const now = this.audioCtx.currentTime;
      
      // Note 1: E5 (659.25 Hz)
      this._playBellNote(659.25, now, 0.4);
      // Note 2: A5 (880 Hz)
      this._playBellNote(880, now + 0.18, 0.6);
      // Note 3: C#6 (1108.7 Hz)
      this._playBellNote(1108.73, now + 0.36, 0.8);
    } catch (e) {
      console.warn('Audio play failed:', e);
    }
  }

  // Play a gentle subtle click/tap feedback
  playSuccessSound() {
    try {
      this.init();
      if (!this.audioCtx) return;

      const now = this.audioCtx.currentTime;
      this._playBellNote(587.33, now, 0.2); // D5
      this._playBellNote(880, now + 0.08, 0.3); // A5
    } catch (e) {}
  }

  _playBellNote(freq, startTime, duration) {
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, startTime);

    gain.gain.setValueAtTime(0.001, startTime);
    gain.gain.exponentialRampToValueAtTime(0.3, startTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(gain);
    gain.connect(this.audioCtx.destination);

    osc.start(startTime);
    osc.stop(startTime + duration);
  }
}

window.sound = new SoundEngine();
