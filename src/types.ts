export interface MemoryWatch {
  address: string; // Address in hex format, e.g. "0x80000000"
  offset?: string; // If the address is a pointer, this is the offset to read from
  size: number; // Size in bytes
}

export interface EmuBootConfig {
  agentConfig: EmuAgentConfig;
  testConfig: EmuTestConfig;
};

export interface EmuTestConfig {
  id: string;
  gameId: string;
  platform: 'gamecube';
  startStateFilename: string;
  contextMemWatches: Record<string, MemoryWatch>;
  endStateMemWatches: Record<string, MemoryWatch>;
}

export interface EmuTask {
  name: string;
  description: string;
}

export interface EmuAgentConfig {
  systemPrompt: string;
  gameContext: string;
  llmProvider: 'openai' | 'anthropic' | 'google';
  model: string;
  maxIterations: number;
  temperature: number;
  task: EmuTask;
}

// TODO
export interface BenchmarkResult {
  success: boolean;
}

export interface EmuTestState {
  state: 'booting' | 'emulator-ready' | 'server-ready' | 'running' | 'finished';
}

export interface EmuTestMemoryState {
  contextMemWatchValues: Record<string, string>;
  endStateMemWatchValues: Record<string, string>;
}

export interface Turn {
  iteration: number;
  historyItems: EmuHistoryItem[];
}

export interface EmuHistoryItem {
  type: 'message' | 'tool_call';
  screenshotNames: string[];
  timestamp: string;
  llmMessageContent: LlmMessageContentItem[];
}

export interface LlmMessageContentItem {
  type: 'text' | 'image';
  text?: string;
  image?: NonSharedBuffer;
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

export interface LogItem {
  text: string;
  metadata: Record<string, string>;
}

export interface LogBlock {
  title: string;
  logs: LogItem[]
}
