import { EmuAgent } from "@/agent";
import { EmulationService } from "@/emulation.service";
import { EmuBootConfig, EmuTestState } from "@/types";
import { configDotenv } from "dotenv";
import { readFileSync } from 'fs';
import path from "path";

configDotenv();

const authToken = process.env.AUTH_TOKEN;
const gameUrl = process.env.GAME_URL;
const testPath = process.env.TEST_PATH;

if (!authToken || !gameUrl || !testPath) {
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

const emulationService = new EmulationService(gameUrl);
const agent = new EmuAgent(
  bootConfig,
  authToken,
  testPath,
  emulationService
);

await agent.runBenchmark();
