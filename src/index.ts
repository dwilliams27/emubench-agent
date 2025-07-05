import { EmuAgent } from "@/agent";
import { EmulationService } from "@/services/emulation.service";
import { ApiService } from "@/services/api.service";
import { EmuBootConfig, EmuTestState } from "@/types";
import { configDotenv } from "dotenv";
import { readFileSync } from 'fs';
import path from "path";
import { LoggerService } from "@/services/logger.service";

configDotenv();

const authToken = process.env.AUTH_TOKEN;
const googleToken = process.env.GOOGLE_TOKEN;
const gameUrl = process.env.GAME_URL;
const testPath = process.env.TEST_PATH;

if (!authToken || !googleToken || !gameUrl || !testPath) {
  throw new Error('Missing required environment variables');
}

// Wait for test to be ready
let testReady = false;
while (!testReady) {
  try {
    const testStateContent = readFileSync(path.join(testPath, 'test_state.json'), 'utf-8');
    const emuTestState = JSON.parse(testStateContent) as EmuTestState;
    if (emuTestState.state === 'server-ready') {
      console.log('Test ready!');
      testReady = true;
    } else {
      console.log(`Waiting for test to be ready; current status: ${emuTestState.state}`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch (error) {
    console.error('Test file not found yet...');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

const configContent = readFileSync(path.join(testPath, 'test_config.json'), 'utf-8');
const bootConfig = JSON.parse(configContent) as EmuBootConfig;

const emulationService = new EmulationService(gameUrl, googleToken);
const logger = new LoggerService(testPath);
const apiService = new ApiService("https://api.emubench.com", authToken);
const agent = new EmuAgent(
  bootConfig,
  authToken,
  testPath,
  emulationService,
  logger
);

try {
  await agent.runBenchmark();
  await apiService.endTest(bootConfig.testConfig.id);

  console.log('Test finished');
  process.exit(0);
} catch (error) {
  console.log(`Test failed: ${(error as any).message}`);
  process.exit(1);
}

