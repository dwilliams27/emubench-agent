import { EmuAgent } from "@/agent";
import { EmulationService } from "@/services/emulation.service";
import { ApiService } from "@/services/api.service";
import { EmuBootConfig, EmuEmulatorState, EmuSharedTestState } from "@/shared/types";
import { configDotenv } from "dotenv";
import { LoggerService } from "@/services/logger.service";
import { formatError } from "@/shared/utils/error";
import { freadBootConfig, freadEmulatorState, freadSharedTestState, freadTestState, fwriteAgentState, fwriteEmulatorState, fwriteTestState } from "@/shared/services/resource-locator.service";
import { AGENT_STATE_ID, genId } from "@/shared/utils/id";

configDotenv();

const authToken = process.env.AUTH_TOKEN;
const testPath = process.env.TEST_PATH;
const testId = process.env.TEST_ID;

let apiService: ApiService | null = null;
let bootConfig: EmuBootConfig | null = null;
let agentState = { id: genId(AGENT_STATE_ID), status: 'booting' as const };

try {
  if (!authToken || !testPath || !testId) {
    throw new Error('Missing required environment variables');
  }

  await fwriteAgentState(testId, agentState);

  bootConfig = await freadBootConfig(testId);
  if (!bootConfig) {
    throw new Error('Could not read boot config');
  }

  let testReady = false;
  let emulatorState: EmuEmulatorState | null = null;
  let sharedState: EmuSharedTestState | null = null;
  let googleToken;
  apiService = new ApiService("https://api.emubench.com", authToken);
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

  const [testState, freshEmulatorState] = await Promise.all([
    freadTestState(bootConfig.testConfig.id),
    freadEmulatorState(bootConfig.testConfig.id)
  ]);
  if (!testState) {
    throw new Error('Could not read test state');
  }
  if (!freshEmulatorState) {
    throw new Error('Could not read emulator state');
  }

  const [testStateResult, emulatorStateResult] = await Promise.all([
    fwriteTestState(bootConfig.testConfig.id, {
      ...testState,
      status: 'running'
    }),
    fwriteEmulatorState(bootConfig.testConfig.id, {
      ...freshEmulatorState,
      status: 'running'
    }),
    fwriteAgentState(testId, { ...agentState, status: 'running' })
  ]);
  
  if (!testStateResult) {
    throw new Error('Could not update test state to running');
  }
  
  if (!emulatorStateResult) {
    throw new Error('Could not update emulator state to running');
  }

  await agent.runBenchmark();

  await apiService.endTest(bootConfig.testConfig.id);
  console.log('Test finished');
  process.exit(0);
} catch (error) {
  console.error(`Test failed: ${formatError(error)}`);

  if (testId) {
    await fwriteAgentState(testId, { ...agentState, status: 'error' });
  }
  if (apiService && bootConfig) {
    await apiService.endTest(bootConfig.testConfig.id);
  }

  process.exit(1);
}
