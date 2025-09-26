import { EmuBootConfig, EmuLogBlock } from "@/shared/types";
import { EmuTestResult } from "@/shared/types/result";

export interface EmuHistory {
  id: string;
  testId: string;
  testRun: EmuTestRun;
};

export interface EmuTestRun {
  id: string;
  replay: EmuReplaySlice[];
  bootConfig: EmuBootConfig;
  result: EmuTestResult;
};

export interface EmuReplaySlice {
  id: string;
  turn: number;
  images: EmuHistoryAtom[];
  agentLogs: EmuHistoryAtom[];
  memoryWatches: EmuHistoryAtom[];
};

export interface EmuHistoryAtom {
  id: string;
  eventTimestamp: Date;
  type: 'screenshot' | 'log' | 'memory-watch';
  screenshot?: string;
  log?: EmuLogBlock;
  memoryWatch?: Record<string, any>;
};
