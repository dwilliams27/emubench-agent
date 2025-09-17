import { EmuAgent } from "@/agent";
import { EmulationService } from "@/services/emulation.service";
import { ApiService } from "@/services/api.service";
import { EmuEmulatorState, EmuSharedTestState, EmuTestState } from "@/shared/types";
import { configDotenv } from "dotenv";
import { LoggerService } from "@/services/logger.service";
import { formatError } from "@/shared/utils/error";
import { freadBootConfig, freadEmulatorState, freadSharedTestState, freadTestState, fwriteTestState } from "@/shared/services/resource-locator.service";

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
let emulatorState: EmuEmulatorState | null = null;
let sharedState: EmuSharedTestState | null = null;
let googleToken;
const apiService = new ApiService("https://api.emubench.com", authToken);
while (!testReady) {
  try {
    emulatorState = await freadEmulatorState(bootConfig.testConfig.id);
    sharedState = await freadSharedTestState(bootConfig.testConfig.id);
    if (!emulatorState || !sharedState) {
      throw new Error('Could not read emulator state or shared state');
    }

    googleToken = await apiService.attemptTokenExchange(bootConfig.testConfig.id, sharedState.exchangeToken);
    const status = emulatorState.status;
    if (status === 'emulator-ready' && sharedState.emulatorUri && googleToken) {
      console.log('Test ready!');
      testReady = true;
    } else {
      console.log(`Waiting for test to be ready; current status: ${status}`);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  } catch (error) {
    console.error(`Test file not found yet... cause: ${formatError(error)}`);
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
}

if (!sharedState?.emulatorUri) {
  throw new Error('Could not get emulator uri');
}

const emulationService = new EmulationService(sharedState.emulatorUri, googleToken);
const logger = new LoggerService(bootConfig.testConfig.id);
const agent = new EmuAgent(
  bootConfig,
  emulationService,
  apiService,
  logger
);

// TODO: Partial updates
const testState = await freadTestState(bootConfig.testConfig.id);
if (!testState) {
  throw new Error('Could not read test state');
}
const result = await fwriteTestState(bootConfig.testConfig.id, {
  ...testState!,
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
