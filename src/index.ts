import { EmuAgent } from "@/agent";
import { EmulationService } from "@/services/emulation.service";
import { ApiService } from "@/services/api.service";
import { EmuBootConfig, EmuSharedTestState, EmuTestState } from "@/shared/types";
import { configDotenv } from "dotenv";
import { LoggerService } from "@/services/logger.service";
import { FirebaseCollection, FirebaseFile, firebaseService, FirebaseSubCollection } from "@/services/firebase.service";

configDotenv();

const authToken = process.env.AUTH_TOKEN;
const testPath = process.env.TEST_PATH;
const testId = process.env.TEST_ID;

if (!authToken || !testPath || !testId) {
  throw new Error('Missing required environment variables');
}

// Init services
const bootConfig = (await firebaseService.read({
  collection: FirebaseCollection.SESSIONS,
  subCollection: FirebaseSubCollection.CONFIG,
  file: FirebaseFile.BOOT_CONFIG,
  testId,
}))[0] as unknown as EmuBootConfig;

let testReady = false;
let testStateContent;
let sharedStateContent;
let googleToken;
const apiService = new ApiService("https://api.emubench.com", authToken);
while (!testReady) {
  try {
    testStateContent = (await firebaseService.read({
      collection: FirebaseCollection.SESSIONS,
      subCollection: FirebaseSubCollection.STATE,
      file: FirebaseFile.TEST_STATE,
      testId: bootConfig.testConfig.id
    }))[0] as unknown as EmuTestState;
    sharedStateContent = (await firebaseService.read({
      collection: FirebaseCollection.SESSIONS,
      subCollection: FirebaseSubCollection.STATE,
      file: FirebaseFile.SHARED_STATE,
      testId: bootConfig.testConfig.id
    }))[0] as unknown as EmuSharedTestState;
    googleToken = (await apiService.attemptTokenExchange(bootConfig.testConfig.id, sharedStateContent.exchangeToken))
    const status = testStateContent.status;
    if (testStateContent.status === 'emulator-ready' && sharedStateContent.emulatorUri && googleToken) {
      console.log('Test ready!');
      testReady = true;
    } else {
      console.log(`Waiting for test to be ready; current status: ${status}`);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  } catch (error) {
    console.error('Test file not found yet...');
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
}

if (!sharedStateContent?.emulatorUri) {
  throw new Error('Could not get emulator uri');
}

const emulationService = new EmulationService(sharedStateContent.emulatorUri, googleToken);
const logger = new LoggerService(bootConfig.testConfig.id);
const agent = new EmuAgent(
  bootConfig,
  authToken,
  testPath,
  emulationService,
  apiService,
  logger
);

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
  await apiService.endTest(bootConfig.testConfig.id);
  process.exit(1);
}
