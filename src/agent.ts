import { EmulationService } from '@/services/emulation.service';
import { LoggerService } from '@/services/logger.service';
import { getTools } from '@/tools';
import { BenchmarkResult } from '@/types/tools';
import { EmuAgentConfig, EmuBootConfig, EmuTestConfig, EmuLogBlock, EmuTurn, EmuLlmMessageContentItem, EmuLogNamespace } from '@/shared/types';
import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';
import { openai } from '@ai-sdk/openai';
import { generateText, GenerateTextResult, ToolSet } from 'ai';
import { ApiService } from '@/services/api.service';
import { emuEvaluateCondition } from '@/shared/conditions/evaluate';
import { formatError } from '@/shared/utils/error';
import { genId, HISTORY_ATOM_ID, HISTORY_SLICE_ID, LOG_BLOCK_ID } from '@/shared/utils/id';
import { freadTestState, fwriteTestRun, fwriteTestState } from '@/shared/services/resource-locator.service';
import { EmuHistorySlice, EmuTestResult, EmuTestRun } from '@/shared/types/test-run';
import { EmuConditionPrimitiveResult } from '@/shared/conditions/types';

export class EmuAgent {
  private agentConfig: EmuAgentConfig;
  private testConfig: EmuTestConfig;

  private mostRecentScreenshot?: string;
  private screenshotCache: Record<string, string> = {};

  private currentContextMemWatches: Record<string, string> = {};

  constructor(
    private bootConfig: EmuBootConfig,
    private emulationService: EmulationService,
    private apiService: ApiService,
    private logger: LoggerService
  ) {
    this.agentConfig = bootConfig.agentConfig;
    this.testConfig = bootConfig.testConfig;

    if (!this.agentConfig.systemPrompt) {
      throw new Error('System prompt is required');
    }
    if (!this.agentConfig.llmProvider || !['openai', 'anthropic', 'google'].includes(this.agentConfig.llmProvider)) {
      throw new Error('Invalid or missing LLM provider');
    }
    if (!this.agentConfig.model) {
      throw new Error('Model is required');
    }
  }

  private getModel(provider: string, model: string) {
    switch (provider) {
      case 'openai': return openai(model);
      case 'anthropic': return anthropic(model);
      case 'google': return google(model);
      default: throw new Error(`Unknown provider: ${provider}`);
    }
  }

  async loadScreenshot(name: string) {
    const filename = `${name}.png`;
    if (this.screenshotCache[filename]) {
      return this.screenshotCache[filename];
    }
    let imageData;
    let retries = 2;
    while (!imageData && retries > 0) {
      try {
        const screenshotData = await this.apiService.fetchScreenshots(this.bootConfig.testConfig.id);
        if (!screenshotData) {
          console.log(`No screenshots found, trying again`);
          continue;
        }
        this.screenshotCache = { ...this.screenshotCache, ...screenshotData };
        if (!screenshotData[filename]) {
          console.log(`Screenshot ${filename} not found in cache, trying again`);
          continue;
        }
        imageData = screenshotData[filename];
      } catch (error) {
        retries -= 1;
        // Wait in case screenshot doesnt have public url yet
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    return imageData;
  }

  async handleLlmResponse(llmResult: GenerateTextResult<ToolSet, unknown>, iteration: number): Promise<EmuLogBlock> {
    const timestamp = new Date().toISOString();
    const results: EmuLogBlock = {
      id: genId(LOG_BLOCK_ID),
      title: `Turn ${iteration}`,
      logs: [{
        text: llmResult.text,
        metadata: {
          type: 'message',
          timestamp
        }
      }]
    };
    // TODO: I'm lazy
    for (const toolResult of (llmResult.toolResults as any)) {
      results.logs.push({
        text: '',
        metadata: {
          type: 'tool-call',
          timestamp,
          toolName: toolResult.toolName,
          toolPayload: toolResult.args
        }
      });
      if (toolResult.result?.screenshot) {
        const imageData = await this.loadScreenshot(toolResult.result.screenshot);
        if (imageData) {
          // @ts-expect-error
          results.logs[results.logs.length - 1].metadata.screenshotData = imageData;
          // TODO: Awkward
          results.logs[results.logs.length - 1].metadata.screenshotName = `${parseInt(toolResult.result.screenshot) - 1}.png`;

          this.mostRecentScreenshot = imageData;
        } else {
          console.warn(`[Agent] Screenshot ${toolResult.result.screenshot} not found`);
        }
      }
      if (toolResult.result?.endStateMemWatchValues || toolResult.result?.contextMemWatchValues) {
        this.currentContextMemWatches = toolResult.result?.contextMemWatchValues;

        // TODO: Partial updates
        const oldState = await freadTestState(this.bootConfig.testConfig.id);
        if (!oldState) {
          console.error('[Agent] Could not read old test state');
          continue;
        }

        const result = await fwriteTestState(this.bootConfig.testConfig.id, {
          ...oldState,
          stateHistory: {
            ...oldState.stateHistory,
            [iteration]: {
              contextMemWatchValues: toolResult.result?.contextMemWatchValues,
              endStateMemWatchValues: toolResult.result?.endStateMemWatchValues
            }
          }
        });
        if (!result) {
          console.error('[Agent] Could not write updated test state');
        }
      }
    }

    return results;
  }

  async callLlm(prompt: EmuLlmMessageContentItem[], tools: any): Promise<ReturnType<typeof generateText>> {
    this.logger.log(EmuLogNamespace.DEV, 'Calling LLM...');
    
    const model = this.getModel(this.agentConfig.llmProvider, this.agentConfig.model);
    
    return await generateText({
      model,
      messages: [
        {
          role: 'system',
          content: this.agentConfig.systemPrompt
        },
        {
          role: 'user',
          // Huh
          content: prompt as any
        }
      ],
      tools,
      maxTokens: 4000,
      temperature: this.agentConfig.temperature
    });
  }

  buildTaskPrompt(): string {
    return `
<game_context>${this.agentConfig.gameContext}</game_context>
<task_name>${this.agentConfig.task.name}</task_name>
<task_description>${this.agentConfig.task.description}</task_description>
    `;
  }

  turnsToLlmContext(turns: EmuTurn[]): EmuLlmMessageContentItem[] {
    const result: EmuLlmMessageContentItem[] = [];
    turns.forEach(turn => {
      turn.logBlock.logs.forEach(log => {
        switch (log.metadata.type) {
          case ('message'): {
            result.push({
              type: 'text',
              text: log.text
            });
            break;
          };
          case ('tool-call'): {
            result.push({
              type: 'text',
              text: `Tool: ${log.metadata.toolName} called with payload ${JSON.stringify(log.metadata.toolPayload)}`
            });

            // @ts-expect-error
            if (log.metadata.screenshotData) {
              result.push({
                type: 'image',
                // @ts-expect-error
                image: log.metadata.screenshotData
              })
            }
            break;
          }
        }
      })
    });
    return result;
  }

  buildContextualPrompt(turns: EmuTurn[]): EmuLlmMessageContentItem[] {
    const taskPrompt = this.buildTaskPrompt();
    const actionHistory = this.turnsToLlmContext(turns);
    const result: EmuLlmMessageContentItem[] = [
      { type: 'text', text: `<action_history>` },
      ...actionHistory,
      { type: 'text', text: `</action_history>` },
      { type: 'text', text: taskPrompt },
      { type: 'text', text: "<most_recent_screenshot>" }
    ];
    if (this.mostRecentScreenshot) {
      result.push({ type: 'image', image: this.mostRecentScreenshot });
    }
    result.push({ type: 'text', text: "</most_recent_screenshot>" });
    result.push({ type: 'text', text: "Decide what to do to best proceed towards your goal" });

    return result;
  }

  evaluateTestCondition(): EmuConditionPrimitiveResult {
    try {
      const condition = this.bootConfig.goalConfig.condition;
      for (const key in condition.inputs) {
        const input = condition.inputs[key];
        input.rawValue = this.currentContextMemWatches[input.name] || input.rawValue;
      }
      const result = emuEvaluateCondition(condition);
      console.log(`----- Condition evaluation result: ${result} -----`);

      return result;
    } catch (error) {
      console.error('Error evaluating condition:', formatError(error));
      return false;
    }
  }

  async logTurn(turn: EmuTurn) {
    await this.logger.log(
      EmuLogNamespace.AGENT,
      {
        ...turn.logBlock,
        logs: turn.logBlock.logs.map((log) => {
          const logCopy = { ...log };
          // @ts-expect-error TODO: Fix this
          delete logCopy.metadata.screenshotData;
          return logCopy;
        })
      },
      true
    );
  }

  turnsToTestHistory(turns: EmuTurn[]): EmuHistorySlice[] {
    return turns.map(turn => ({
      id: genId(HISTORY_SLICE_ID),
      turn: turn.iteration,
      images: turn.logBlock.logs
        .filter(log => log.metadata.type === 'tool-call' && log.metadata.screenshotName)
        .map(log => ({
          id: genId(HISTORY_ATOM_ID),
          eventTimestamp: new Date(log.metadata.timestamp),
          type: 'screenshot',
          screenshotName: log.metadata.screenshotName
        })),
      agentLogs: turn.logBlock.logs
        .filter(log => log.metadata.type === 'message')
        .map(log => ({
          id: genId(HISTORY_ATOM_ID),
          eventTimestamp: new Date(log.metadata.timestamp),
          type: 'log',
          log
        })),
      // TODO: Memory watch history
      memoryWatches: [],
      // memoryWatches: turn.logBlock.logs
      //   .filter(log => log.metadata.type === 'tool-call' && (log.metadata.endStateMemWatchValues || log.metadata.contextMemWatchValues))
      //   .map(log => ({
      //     id: genId(HISTORY_ATOM_ID),
      //     eventTimestamp: new Date(log.metadata.timestamp),
      //     type: 'memory-watch',
      //     memoryWatch: {
      //       contextMemWatchValues: log.metadata.contextMemWatchValues,
      //       endStateMemWatchValues: log.metadata.endStateMemWatchValues
      //     }
      //   }))
    }));
  }

  async recordTestRun(testHistory: EmuTurn[], errorDetails?: string) {
    const conditionPrimitiveResult = this.evaluateTestCondition();
    let conditionResult: 'passed' | 'failed' | 'error' = !!conditionPrimitiveResult ? 'passed' : 'failed';
    if (errorDetails) {
      conditionResult = 'error';
    }
    const result: EmuTestResult = {
      emuCondition: this.bootConfig.goalConfig.condition,
      conditionResult,
      conditionPrimitiveResult,
      errorDetails: errorDetails || ''
    };

    const testRun: EmuTestRun = {
      id: this.bootConfig.testConfig.id,
      history: this.turnsToTestHistory(testHistory),
      bootConfig: this.bootConfig,
      result
    };

    let success = await fwriteTestRun(testRun);
    if (!success) {
      this.logger.log(EmuLogNamespace.DEV, `FAILED TO WRITE TEST RUN`);
    }
  }
  
  async runBenchmark(): Promise<boolean> {
    this.logger.log(EmuLogNamespace.DEV, 'Starting benchmark...');

    let iteration = 1;
    const history: EmuTurn[] = [];
    const tools = getTools(this.emulationService);
    
    try {
      this.mostRecentScreenshot = await this.loadScreenshot('0');
    
      while (iteration < this.agentConfig.maxIterations) {
        this.logger.log(EmuLogNamespace.DEV, `Iteration ${iteration}/${this.agentConfig.maxIterations}`);
        
        const prompt = this.buildContextualPrompt(history);

        this.logger.log(EmuLogNamespace.DEV, `------ Iteration ${iteration} ------`);
        const response = await this.callLlm(prompt, tools);
        this.logger.log(EmuLogNamespace.DEV, `------ LLM Response: ${response.text} ------`);

        const logBlock = await this.handleLlmResponse(response, iteration);
        const turn: EmuTurn = {
          iteration,
          logBlock,
        }
        history.push(turn);
        await this.logTurn(turn);
        
        const isComplete = this.evaluateTestCondition();
        if (isComplete) {
          this.logger.log(EmuLogNamespace.DEV, `Condition met! Test complete`);
          break;
        }

        iteration++;
      }
      this.logger.log(EmuLogNamespace.DEV, `Benchmark completed after ${iteration + 1} iterations`);

      await this.recordTestRun(history);
    } catch (error) {
      this.logger.log(EmuLogNamespace.DEV, `Benchmark failed: ${formatError(error)}`);
      await this.recordTestRun(history, formatError(error));
      throw error;
    }

    return true;
  }
}
