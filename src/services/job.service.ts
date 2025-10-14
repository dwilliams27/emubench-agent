import { EmuAgent } from "@/agent";
import { ApiService } from "@/services/api.service";
import { EmulationService } from "@/services/emulation.service";
import { LoggerService } from "@/services/logger.service";
import { freadTest, fwriteAgentJobs, fwriteTestFields } from "@/shared/services/resource-locator.service";
import { EmuAgentJob } from "@/shared/types/agent";
import { EmuTest } from "@/shared/types/test";
import { formatError } from "@/shared/utils/error";

export class JobService {
  async handleIncomingJob(job: EmuAgentJob, apiService: ApiService) {
    await fwriteAgentJobs([{ ...job, status: "running" }], { update: true });

    const authToken = job.authToken;
    const testPath = job.testPath;
    const testId = job.testId;

    let test: EmuTest | null = null;

    try {
      if (!authToken || !testPath || !testId) {
        throw new Error('Missing required environment variables');
      }

      test = await freadTest(testId);
      if (!test?.bootConfig) {
        throw new Error('Could not read boot config');
      }

      let testReady = false;
      let googleToken;
      let retries = 20;
      
      while (!testReady && retries-- > 0) {
        try {
          test = await freadTest(testId);
          if (!test) {
            throw new Error('Could not read test');
          }
          if (!test.emulatorState || !test.sharedState) {
            throw new Error('Could not read emulator state or shared state');
          }
          if (!test.sharedState.exchangeToken) {
            throw new Error('No exchange token yet');
          }

          googleToken = await apiService.attemptTokenExchange(test.bootConfig.testConfig.id, authToken, test.sharedState.exchangeToken);
          const status = test.emulatorState.status;
          if (status === 'emulator-ready' && test.sharedState.emulatorUri && googleToken) {
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

      if (!test) {
        throw new Error('Could not read test');
      }

      if (!testReady) {
        throw new Error('Test not ready in time');
      }

      if (!test.sharedState?.emulatorUri) {
        throw new Error('Could not get emulator uri');
      }

      const emulationService = new EmulationService(test.sharedState.emulatorUri, googleToken);
      const logger = new LoggerService(test.bootConfig.testConfig.id);
      const agent = new EmuAgent(
        test.bootConfig,
        emulationService,
        apiService,
        logger,
        authToken
      );

      const result = await fwriteTestFields(testId, {
        'testState.status': 'running',
        'emulatorState.status': 'running',
        'agentState.status': 'running'
      });
      
      if (!result) {
        throw new Error('Could not update test to running');
      }
    
      await agent.runBenchmark();
      await apiService.endTest(test.bootConfig.testConfig.id, authToken);
      await fwriteAgentJobs([{ ...job, status: "completed" }], { update: true });
    } catch (error) {
      console.error(`Test setup failed: ${formatError(error)}`);

      if (testId) {
        const result = await fwriteTestFields(testId, {
          'agentState.status': 'error',
        });
      }
      if (test?.bootConfig) {
        await apiService.endTest(test.bootConfig.testConfig.id, authToken);
      } else {
        console.error('Could not end test');
      }

      await fwriteAgentJobs([{ ...job, status: 'error', error: formatError(error) }], { update: true });
    }
  }
}
