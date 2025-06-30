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
  mcpServerEndpoint: string;
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
  content: string;
  screenshotName?: string;
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
