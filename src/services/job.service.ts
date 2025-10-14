import { EmuAgent } from "@/agent";
import { ApiService } from "@/services/api.service";
import { EmulationService } from "@/services/emulation.service";
import { LoggerService } from "@/services/logger.service";
import { freadBootConfig, freadEmulatorState, freadSharedTestState, freadAgentState, freadTestState, fwriteTestState, fwriteEmulatorState, fwriteAgentState, fwriteAgentJobs } from "@/shared/services/resource-locator.service";
import { EmuBootConfig, EmuEmulatorState, EmuSharedTestState } from "@/shared/types";
import { EmuAgentJob } from "@/shared/types/agent";
import { formatError } from "@/shared/utils/error";

export class JobService {
  async handleIncomingJob(job: EmuAgentJob, apiService: ApiService) {
    await fwriteAgentJobs([{ ...job, status: "running" }], { update: true });

    const authToken = job.authToken;
    const testPath = job.testPath;
    const testId = job.testId;

    let bootConfig: EmuBootConfig | null = null;

    try {
      if (!authToken || !testPath || !testId) {
        throw new Error('Missing required environment variables');
      }

      bootConfig = await freadBootConfig(testId);
      if (!bootConfig) {
        throw new Error('Could not read boot config');
      }

      let testReady = false;
      let emulatorState: EmuEmulatorState | null = null;
      let sharedState: EmuSharedTestState | null = null;
      let googleToken;
      let retries = 20;
      
      while (!testReady && retries-- > 0) {
        try {
          emulatorState = await freadEmulatorState(bootConfig.testConfig.id);
          sharedState = await freadSharedTestState(bootConfig.testConfig.id);
          if (!emulatorState || !sharedState) {
            throw new Error('Could not read emulator state or shared state');
          }
          if (!sharedState.exchangeToken) {
            throw new Error('No exchange token yet');
          }

          googleToken = await apiService.attemptTokenExchange(bootConfig.testConfig.id, authToken, sharedState.exchangeToken);
          const status = emulatorState.status;
          if (status === 'emulator-ready' && sharedState.emulatorUri && googleToken) {
            console.log('Test ready!');
            testReady = true;
          } else {
            console.log(`Waiting for test to be ready; current status: ${status}`);
            if (status === 'error' || status === 'finished') {
              const error = 'Something wrong with test, cannot proceed';
              await fwriteAgentJobs([{ ...job, status: 'error', error }], { update: true });
              console.error(error);
              return;
            }
            await new Promise(resolve => setTimeout(resolve, 3000));
          }
        } catch (error) {
          console.error(`Test file not found yet... cause: ${formatError(error)}`);
          await new Promise(resolve => setTimeout(resolve, 10_000));
        }
      }

      if (!testReady) {
        throw new Error('Test not ready in time');
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
        logger,
        authToken
      );

      const [agentState, testState, freshEmulatorState] = await Promise.all([
        freadAgentState(bootConfig.testConfig.id),
        freadTestState(bootConfig.testConfig.id),
        freadEmulatorState(bootConfig.testConfig.id)
      ]);
      if (!agentState || !testState || !freshEmulatorState) {
        throw new Error('Could not read state');
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
    
      await this.runJob(agent, apiService, bootConfig, authToken);
      await fwriteAgentJobs([{ ...job, status: "completed" }], { update: true });
    } catch (error) {
      console.error(`Test setup failed: ${formatError(error)}`);

      if (testId) {
        const state = await freadTestState(testId);
        if (state) {
          await fwriteAgentState(testId, { ...state, status: 'error' });
        }
      }
      if (apiService && bootConfig) {
        await apiService.endTest(bootConfig.testConfig.id, authToken);
      }

      await fwriteAgentJobs([{ ...job, status: 'error', error: formatError(error) }], { update: true });
    }
  }

  async runJob(agent: EmuAgent, apiService: ApiService, bootConfig: EmuBootConfig, authToken: string) {
    try {
      await agent.runBenchmark();
      await apiService.endTest(bootConfig.testConfig.id, authToken);
      console.log('Test finished');
    } catch (error) {
      console.error(`Test failed: ${formatError(error)}`);
  
      const testId = bootConfig.testConfig.id;
      if (testId) {
        const state = await freadTestState(testId);
        if (state) {
          await fwriteAgentState(testId, { ...state, status: 'error' });
        }
      }
      if (apiService && bootConfig) {
        await apiService.endTest(bootConfig.testConfig.id, authToken);
      }
    }
  }
}
