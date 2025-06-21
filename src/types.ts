export interface MemoryWatch {
  address: string; // Address in hex format, e.g. "0x80000000"
  offset?: string; // If the address is a pointer, this is the offset to read from
  size: number; // Size in bytes
}

export interface BootConfig {
  agentConfig: AgentConfig;
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

export interface AgentConfig {
  systemPrompt: string;
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
  state: 'booting' | 'ready' | 'running' | 'finished';
}

export interface EmuTestMemoryState {
  contextMemWatchValues: Record<string, string>;
  endStateMemWatchValues: Record<string, string>;
}
