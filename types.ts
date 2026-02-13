
export interface Recording {
  id: string;
  blob: Blob;
  url: string;
  timestamp: number;
  duration: number;
  transcription?: string;
  summary?: string;
}

export interface AudioSettings {
  sensitivity: number; // 0 to 100
  silenceTimeout: number; // ms
  autoStart: boolean;
}

export interface AutomationSettings {
  remoteTriggerId: string; // The ntfy.sh topic ID for incoming audio URLs
  webhookUrl: string;      // The target URL for outgoing recordings
}

export enum RecorderStatus {
  IDLE = 'IDLE',
  LISTENING = 'LISTENING',
  RECORDING = 'RECORDING',
  ERROR = 'ERROR'
}
