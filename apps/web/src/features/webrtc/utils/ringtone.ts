/**
 * 呼び出し音生成ユーティリティ
 * Web Audio APIを使用してベル音を生成（ファイル不要）
 */

export class RingtonePlayer {
  private audioContext: AudioContext | null = null;
  private oscillator: OscillatorNode | null = null;
  private gainNode: GainNode | null = null;
  private isPlaying = false;

  constructor() {
    if (typeof window !== 'undefined' && window.AudioContext) {
      this.audioContext = new AudioContext();
    }
  }

  /**
   * 呼び出し音を再生
   */
  async play(): Promise<void> {
    if (this.isPlaying || !this.audioContext) {
      return;
    }

    this.isPlaying = true;

    // オーディオコンテキストがsuspendedの場合は再開
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    // オシレーターを作成（ベル音の基本周波数）
    this.oscillator = this.audioContext.createOscillator();
    this.gainNode = this.audioContext.createGain();

    // ベル音の特性: 基本周波数でベルらしい音に
    const baseFreq = 800; // 基本周波数

    // メインオシレーター
    this.oscillator.frequency.setValueAtTime(baseFreq, this.audioContext.currentTime);
    this.oscillator.type = 'sine';

    // ゲインノードで音量制御（フェードイン/アウト）
    this.gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
    this.gainNode.gain.linearRampToValueAtTime(0.3, this.audioContext.currentTime + 0.1);
    this.gainNode.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + 0.5);

    // 接続
    this.oscillator.connect(this.gainNode);
    this.gainNode.connect(this.audioContext.destination);

    // 0.5秒後に停止
    this.oscillator.start(this.audioContext.currentTime);
    this.oscillator.stop(this.audioContext.currentTime + 0.5);

    // 停止後にクリーンアップ
    this.oscillator.onended = () => {
      this.isPlaying = false;
      this.oscillator = null;
      this.gainNode = null;
    };
  }

  /**
   * 呼び出し音を停止
   */
  stop(): void {
    if (this.oscillator) {
      try {
        this.oscillator.stop();
      } catch {
        // 既に停止している場合は無視
      }
      this.oscillator = null;
    }
    if (this.gainNode) {
      this.gainNode.disconnect();
      this.gainNode = null;
    }
    this.isPlaying = false;
  }

  /**
   * リソースをクリーンアップ
   */
  dispose(): void {
    this.stop();
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(() => {
        // エラーは無視
      });
    }
    this.audioContext = null;
  }
}

/**
 * 呼び出し音を再生する（簡易版）
 * 繰り返し再生する場合はRingtonePlayerを使用
 */
export async function playRingtone(): Promise<void> {
  const player = new RingtonePlayer();
  await player.play();
  // 0.5秒後にクリーンアップ
  setTimeout(() => {
    player.dispose();
  }, 600);
}

