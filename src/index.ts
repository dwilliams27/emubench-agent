import { EmuAgent } from "@/agent";
import { EmulationService } from "@/services/emulation.service";
import { ApiService } from "@/services/api.service";
import { EmuBootConfig, EmuTestState } from "@/types/shared";
import { configDotenv } from "dotenv";
import { readFileSync } from 'fs';
import path from "path";
import { LoggerService } from "@/services/logger.service";
import { FirebaseCollection, FirebaseFile, FirebaseService, FirebaseSubCollection } from "@/services/firebase.service";

configDotenv();

const authToken = process.env.AUTH_TOKEN;
const googleToken = process.env.GOOGLE_TOKEN;
const gameUrl = process.env.GAME_URL;
const testPath = process.env.TEST_PATH;
const testId = process.env.TEST_ID;

if (!authToken || !googleToken || !gameUrl || !testPath || !testId) {
  throw new Error('Missing required environment variables');
}

// Init services
const firebaseService = new FirebaseService();
const bootConfig = (await firebaseService.read({
  collection: FirebaseCollection.SESSIONS,
  subCollection: FirebaseSubCollection.CONFIG,
  file: FirebaseFile.BOOT_CONFIG,
  testId,
}))[0] as unknown as EmuBootConfig;
const emulationService = new EmulationService(gameUrl, googleToken);
const logger = new LoggerService(bootConfig.testConfig.id, firebaseService);
const apiService = new ApiService("https://api.emubench.com", authToken);
const agent = new EmuAgent(
  bootConfig,
  authToken,
  testPath,
  emulationService,
  firebaseService,
  logger
);

let testReady = false;
let testStateContent;
while (!testReady) {
  try {
    testStateContent = (await firebaseService.read({
      collection: FirebaseCollection.SESSIONS,
      subCollection: FirebaseSubCollection.STATE,
      file: FirebaseFile.TEST_STATE,
      testId: bootConfig.testConfig.id
    }))[0] as unknown as EmuTestState;
    const status = testStateContent.status;
    if (status === 'emulator-ready') {
      console.log('Test ready!');
      testReady = true;
    } else {
      console.log(`Waiting for test to be ready; current status: ${status}`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch (error) {
    console.error('Test file not found yet...');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

await firebaseService.write({
  collection: FirebaseCollection.SESSIONS,
  subCollection: FirebaseSubCollection.STATE,
  file: FirebaseFile.AGENT_STATE,
  testId: bootConfig.testConfig.id,
  payload: [{
    ...testStateContent,
    status: 'running'
  }]
});

try {
  await agent.runBenchmark();

  await apiService.endTest(bootConfig.testConfig.id);
  console.log('Test finished');
  process.exit(0);
} catch (error) {
  console.log(`Test failed: ${(error as any).message}`);
  process.exit(1);
}
