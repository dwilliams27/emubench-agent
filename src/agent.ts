import { EmulationService } from '@/services/emulation.service';
import { LoggerService } from '@/services/logger.service';
import { getTools } from '@/tools';
import { EmuAgentConfig, EmuBootConfig, EmuEmulatorConfig, EmuLogBlock, EmuTurn, EmuLlmMessageContentItem, EmuLogNamespace } from '@/shared/types';
import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';
import { openai } from '@ai-sdk/openai';
import { generateText, GenerateTextResult, ToolSet } from 'ai';
import { ApiService } from '@/services/api.service';
import { emuEvaluateCondition } from '@/shared/conditions/evaluate';
import { formatError } from '@/shared/utils/error';
import { genId, HISTORY_ATOM_ID, HISTORY_SLICE_ID, LOG_BLOCK_ID } from '@/shared/utils/id';
import { fwriteTestFields, fwriteTestResult } from '@/shared/services/resource-locator.service';
import { EmuHistorySlice, EmuTestResult, EmuTestResultData } from '@/shared/types/test-result';
import { EmuConditionPrimitiveResult } from '@/shared/conditions/types';

export class EmuAgent {
  private agentConfig: EmuAgentConfig;
  private emulatorConfig: EmuEmulatorConfig;

  private mostRecentScreenshot?: string;
  private mostRecentReward?: number;
  private screenshotCache: Record<string, string> = {};

  private currentContextMemWatches: Record<string, string> = {};

  private longTermMemory: string = '';

  private tokenUsage = {
    input: 0,
    output: 0,
    reasoning: 0,
    total: 0
  };

  constructor(
    private bootConfig: EmuBootConfig,
    private emulationService: EmulationService,
    private apiService: ApiService,
    private logger: LoggerService,
    private authToken: string
  ) {
    this.agentConfig = bootConfig.agentConfig;
    this.emulatorConfig = bootConfig.emulatorConfig;

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
    let image: { url: string; data: string } | null = null;
    let retries = 2;
    while (!image && retries > 0) {
      try {
        const screenshots = await this.apiService.fetchScreenshots(this.bootConfig.id, this.authToken);
        if (!screenshots) {
          console.log(`No screenshots found, trying again`);
          continue;
        }
        if (!screenshots[filename]) {
          console.log(`Screenshot ${filename} not found in cache, trying again`);
          continue;
        }
        image = screenshots[filename];
      } catch (error) {
        retries -= 1;
        // Wait in case screenshot doesnt have public url yet
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    return image;
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

    this.tokenUsage.input += llmResult.usage.inputTokens || 0;
    this.tokenUsage.output += llmResult.usage.outputTokens || 0;
    this.tokenUsage.reasoning += llmResult.usage.reasoningTokens || 0;
    this.tokenUsage.total += llmResult.usage.totalTokens || 0;

    // TODO: I'm lazy
    for (const toolResult of (llmResult.toolResults as any)) {
      results.logs.push({
        text: '',
        metadata: {
          type: 'tool-call',
          timestamp,
          toolName: toolResult.toolName,
          toolPayload: toolResult.input
        }
      });
      if (toolResult.output?.screenshot) {
        const image = await this.loadScreenshot(toolResult.output.screenshot);
        if (image) {
          // @ts-expect-error
          results.logs[results.logs.length - 1].metadata.screenshotData = image.data;
          results.logs[results.logs.length - 1].metadata.screenshotName = image.url;

          this.mostRecentScreenshot = image.data;
        } else {
          console.warn(`[Agent] Screenshot ${toolResult.output.screenshot} not found`);
        }
      }
      if (toolResult.output?.endStateMemWatchValues || toolResult.output?.contextMemWatchValues) {
        this.currentContextMemWatches = toolResult.output?.contextMemWatchValues;
        results.logs[results.logs.length - 1].metadata.contextMemWatchValues = toolResult.output?.contextMemWatchValues;
        results.logs[results.logs.length - 1].metadata.endStateMemWatchValues = toolResult.output?.endStateMemWatchValues;

        const result = await fwriteTestFields(this.bootConfig.id, {
          [`testState.stateHistory.turn_${iteration}`]: {
            contextMemWatchValues: toolResult.output?.contextMemWatchValues,
            endStateMemWatchValues: toolResult.output?.endStateMemWatchValues
          },
        });

        if (!result) {
          console.error(`[Agent] ${this.bootConfig.id}: Could not write updated test state`);
        }
      }
      if (toolResult.recordMemory) {
        this.longTermMemory = `${this.longTermMemory}\n<thought>${toolResult.recordMemory}</thought>`;
      }
    }

    // Update firstore
    const result = await fwriteTestFields(this.bootConfig.id, {
      [`agentState.inputTokenCount`]: this.tokenUsage.input,
      [`agentState.outputTokenCount`]: this.tokenUsage.output,
      [`agentState.reasoningTokenCount`]: this.tokenUsage.reasoning,
      [`agentState.totalTokenCount`]: this.tokenUsage.total,
      [`agentState.memory.longTermNotes`]: this.longTermMemory
    });

    if (!result) {
      console.error(`[Agent] ${this.bootConfig.id}: Could not write updated tokens and memory`);
    }

    return results;
  }

  async callLlm(prompt: EmuLlmMessageContentItem[], tools: any): Promise<ReturnType<typeof generateText>> {
    this.logger.log(EmuLogNamespace.DEV, 'Calling LLM...');
    
    const model = this.getModel(this.agentConfig.llmProvider, this.agentConfig.model);
    const timeoutMs = 45_000;
    let retries = 3;
    let lastError: any = null;

    while (retries > 0) {
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`LLM call timed out after ${timeoutMs}ms`)), timeoutMs);
      });
      const generatePromise = generateText({
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
        maxOutputTokens: 4000,
        temperature: this.agentConfig.temperature
      });
      
      try {
        const result = await Promise.race([generatePromise, timeoutPromise]) as ReturnType<typeof generateText>;
        this.logger.log(EmuLogNamespace.DEV, 'LLM call completed successfully');
        return result;
      } catch (error) {
        this.logger.log(EmuLogNamespace.DEV, `LLM call failed: ${formatError(error)}`);
        lastError = error;
      }
      retries -= 1;
    }
    
    throw lastError || new Error('LLM call failed after multiple attempts');
  }

  buildTaskPrompt(): string {
    return `
<game_context>${this.agentConfig.gameContext}</game_context>
<task_name>${this.agentConfig.taskName}</task_name>
<task_description>${this.agentConfig.taskDescription}</task_description>
    `;
  }

  turnsToLlmContext(turns: EmuTurn[]): EmuLlmMessageContentItem[] {
    const result: EmuLlmMessageContentItem[] = [];
    const iterations = Math.min(turns.length, this.bootConfig.agentConfig.turnMemoryLength);
    for (let i = 0; i < iterations; i++) {
      turns[turns.length - 1 - i].logBlock.logs.forEach(log => {
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
              text: `<informational>Tool Information: ${log.metadata.toolName} was called with payload ${JSON.stringify(log.metadata.toolPayload)}</informational>`
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
      });
    }
    return result;
  }

  buildContextualPrompt(turns: EmuTurn[]): EmuLlmMessageContentItem[] {
    const result: EmuLlmMessageContentItem[] = [];
    
    if (this.bootConfig.agentConfig.turnMemoryLength > 0) {
      const actionHistory = this.turnsToLlmContext(turns);
      result.push(
        { type: 'text', text: `<recent_actions>` },
        ...actionHistory,
        { type: 'text', text: `</recent_actions>` }
      );
    }
    if (this.bootConfig.agentConfig.longTermMemory) {
      result.push(
        { type: 'text', text: `<memory>${this.longTermMemory}</memory>` },
      );
    }

    const taskPrompt = this.buildTaskPrompt();
    result.push(
      { type: 'text', text: taskPrompt },
    );

    if (this.bootConfig.goalConfig.rewardFunction) {
      result.push(
        { type: 'text', text: `<reward_function_description>${this.bootConfig.goalConfig.rewardDescription}</reward_function_description>` },
      );
      result.push(
        { type: 'text', text: `<current_reward>${this.mostRecentReward}</current_reward>` },
      );
    }
    
    if (this.mostRecentScreenshot) {
      result.push(
        { type: 'text', text: "<most_recent_screenshot>" },
        { type: 'image', image: this.mostRecentScreenshot },
        { type: 'text', text: "</most_recent_screenshot>" }
      );
    }

    return result;
  }

  evaluateTestCondition(): { successResult: EmuConditionPrimitiveResult, failResult: EmuConditionPrimitiveResult, reward: number | null } {
    try {
      const successCondition = this.bootConfig.goalConfig.successCondition;
      const failCondition = this.bootConfig.goalConfig.failCondition;
      const rewardFunction = this.bootConfig.goalConfig.rewardFunction;
      console.log('----- Evaluating conditions -----');
      console.log('currentContextMemWatches:');
      console.log(this.currentContextMemWatches)

      console.log('input raw values:');

      let successResult: EmuConditionPrimitiveResult = false;
      let failResult: EmuConditionPrimitiveResult = false;
      let reward: number | null = null;

      if (successCondition) {
        for (const key in successCondition.inputs) {
          const input = successCondition.inputs[key];
          input.rawValue = this.currentContextMemWatches[input.name] || input.rawValue;
          // TODO: Why needed
          input.parsedValue = undefined;
          console.log(input.name, input.rawValue);
        }
        successResult = emuEvaluateCondition(successCondition);
      }
      
      if (failCondition) {
        for (const key in failCondition.inputs) {
          const input = failCondition.inputs[key];
          input.rawValue = this.currentContextMemWatches[input.name] || input.rawValue;
          // TODO: Why needed
          input.parsedValue = undefined;
          console.log(input.name, input.rawValue);
        }
        failResult = emuEvaluateCondition(failCondition);
      }

      if (rewardFunction) {
        for (const key in rewardFunction.inputs) {
          const input = rewardFunction.inputs[key];
          input.rawValue = this.currentContextMemWatches[input.name] || input.rawValue;
          // TODO: Why needed
          input.parsedValue = undefined;
          console.log(input.name, input.rawValue);
        }
        reward = emuEvaluateCondition(rewardFunction) as number;
      }

      console.log(`----- Success Condition evaluation result: ${successResult} -----`);
      console.log(`----- Fail Condition evaluation result: ${failResult} -----`);
      console.log(`----- Reward Function evaluation result: ${reward} -----`);

      return {
        successResult,
        failResult,
        reward
      };
    } catch (error) {
      console.error('Error evaluating condition:', formatError(error));
      return { successResult: false, failResult: true, reward: null };
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
      memoryWatches: turn.logBlock.logs
        .filter(log => log.metadata.type === 'tool-call' && (log.metadata.endStateMemWatchValues || log.metadata.contextMemWatchValues))
        .map(log => ({
          id: genId(HISTORY_ATOM_ID),
          eventTimestamp: new Date(log.metadata.timestamp),
          type: 'memory-watch',
          memoryWatch: {
            contextMemWatchValues: log.metadata.contextMemWatchValues,
            endStateMemWatchValues: log.metadata.endStateMemWatchValues
          }
        }))
    }));
  }

  async recordTestResult(testHistory: EmuTurn[], errorDetails?: string) {
    const conditionResults = this.evaluateTestCondition();

    let conditionResult: 'passed' | 'failed' | 'error' = !!conditionResults.successResult && !conditionResults.failResult ? 'passed' : 'failed';
    if (errorDetails) {
      conditionResult = 'error';
    }
    if (this.bootConfig.goalConfig.successCondition) {
      for (const key of Object.keys(this.bootConfig.goalConfig.successCondition.inputs)) {
        this.bootConfig.goalConfig.successCondition.inputs[key].rawValue = this.bootConfig.goalConfig.successCondition.inputs[key].rawValue ?? "N/A";
      }
    }
    
    const data: EmuTestResultData = {
      conditionResult,
      conditionPrimitiveResult: conditionResults.successResult,
      reward: conditionResults.reward,
      errorDetails: errorDetails || ''
    };

    const testResult: EmuTestResult = {
      id: this.bootConfig.id,
      history: this.turnsToTestHistory(testHistory),
      bootConfig: this.bootConfig,
      data,
      experimentId: this.bootConfig.experimentId,
      experimentRunGroupId: this.bootConfig.experimentRunGroupId
    };

    await fwriteTestFields(
      this.bootConfig.id,
      {
        'result': data,
      }
    );
    let success = await fwriteTestResult(testResult);
    if (!success) {
      this.logger.log(EmuLogNamespace.DEV, `FAILED TO WRITE TEST RESULT`);
    }
  }
  
  async runBenchmark(): Promise<boolean> {
    this.logger.log(EmuLogNamespace.DEV, 'Starting benchmark...');

    let iteration = 1;
    const history: EmuTurn[] = [];
    const tools = getTools(this.bootConfig, this.emulationService);
    
    try {
      this.mostRecentScreenshot = (await this.loadScreenshot('0'))?.data;
    
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
        
        const conditionResult = this.evaluateTestCondition();
        if (conditionResult.successResult) {
          this.logger.log(EmuLogNamespace.DEV, `Condition met! Test complete`);
          break;
        }
        if (conditionResult.failResult) {
          this.logger.log(EmuLogNamespace.DEV, `Fail Condition! Test complete`);
          break;
        }
        if (conditionResult.reward !== null) {
          this.mostRecentReward = conditionResult.reward;
          this.logger.log(EmuLogNamespace.DEV, `Reward updated: ${this.mostRecentReward}`);
        }

        iteration++;
      }
      this.logger.log(EmuLogNamespace.DEV, `Benchmark completed after ${iteration + 1} iterations`);

      await this.recordTestResult(history);
    } catch (error) {
      this.logger.log(EmuLogNamespace.DEV, `Benchmark failed: ${formatError(error)}`);
      await this.recordTestResult(history, formatError(error));
      throw error;
    }

    return true;
  }
}
