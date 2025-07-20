// TODO
export interface BenchmarkResult {
  success: boolean;
}

export const ToolNames = {
  sendControllerInput: 'sendControllerInput',
  wait: 'wait'
}

export interface SendControllerInputResponse {
  contextMemWatchValues: Record<string, string>;
  endStateMemWatchValues: Record<string, string>;
  screenshot: string;
}

interface Buttons {
  a: boolean;
  b: boolean;
  x: boolean;
  y: boolean;
  z: boolean;
  start: boolean;
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  l: boolean;
  r: boolean;
}

interface StickPosition {
  x: number; // 0-255, center at 128
  y: number; // 0-255, center at 128
}

export interface IpcControllerInputRequest {
  connected: boolean;
  buttons?: Partial<Buttons>;
  mainStick?: StickPosition;
  cStick?: StickPosition;
  frames: number;
}
