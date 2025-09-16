import { EmuAgent } from "@/agent";
import { EmulationService } from "@/services/emulation.service";
import { ApiService } from "@/services/api.service";
import { EmuSharedTestState, EmuTestState } from "@/shared/types";
import { configDotenv } from "dotenv";
import { LoggerService } from "@/services/logger.service";
import { formatError } from "@/shared/utils/error";
import { freadBootConfig, freadSharedTestState, freadTestState, fwriteTestState } from "@/shared/services/resource-locator.service";

configDotenv();

const authToken = process.env.AUTH_TOKEN;
const testPath = process.env.TEST_PATH;
const testId = process.env.TEST_ID;

if (!authToken || !testPath || !testId) {
  throw new Error('Missing required environment variables');
}

const bootConfig = await freadBootConfig(testId);
if (!bootConfig) {
  throw new Error('Could not read boot config');
}

let testReady = false;
let testStateContent: EmuTestState | null = null;
let sharedStateContent: EmuSharedTestState | null = null;
let googleToken;
const apiService = new ApiService("https://api.emubench.com", authToken);
while (!testReady) {
  try {
    testStateContent = await freadTestState(bootConfig.testConfig.id);
    sharedStateContent = await freadSharedTestState(bootConfig.testConfig.id);
    if (!testStateContent || !sharedStateContent) {
      throw new Error('Could not read test state or shared state');
    }

    googleToken = await apiService.attemptTokenExchange(bootConfig.testConfig.id, sharedStateContent.exchangeToken);
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
  emulationService,
  apiService,
  logger
);

const result = await fwriteTestState(bootConfig.testConfig.id, {
  ...testStateContent!,
  status: 'running'
});
if (!result) {
  throw new Error('Could not update test state to running');
}

try {
  await agent.runBenchmark();

  await apiService.endTest(bootConfig.testConfig.id);
  console.log('Test finished');
  process.exit(0);
} catch (error) {
  console.error(`Test failed: ${formatError(error)}`);
  await apiService.endTest(bootConfig.testConfig.id);
  process.exit(1);
}
