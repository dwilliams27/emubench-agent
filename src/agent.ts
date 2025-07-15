import { EmulationService } from '@/services/emulation.service';
import { LoggerService, LogMetadata, LogNamespace } from '@/services/logger.service';
import { getTools } from '@/tools';
import { BenchmarkResult, Turn, LlmMessageContentItem, HistoryItem } from '@/types/types';
import { EmuAgentConfig, EmuBootConfig, EmuTestConfig, EmuLogBlock } from '@/types/shared';
import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';
import { openai } from '@ai-sdk/openai';
import { generateText, GenerateTextResult, ToolSet } from 'ai';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { FirebaseCollection, FirebaseFile, FirebaseService, FirebaseSubCollection } from '@/services/firebase.service';

export class EmuAgent {
  private agentConfig: EmuAgentConfig;
  private testConfig: EmuTestConfig;

  private mostRecentScreenshot?: NonSharedBuffer;

  constructor(
    private bootConfig: EmuBootConfig,
    private authToken: string,
    private testStatePath: string,
    private emulationService: EmulationService,
    private firbaseService: FirebaseService,
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
    const screenshotPath = path.join(this.testStatePath, 'ScreenShots');
    let imageData;
    let retries = 2;
    while (!imageData && retries > 0) {
      try {
        imageData = readFileSync(path.join(screenshotPath, `${name}.png`));
      } catch (error) {
        retries -= 1;
        // Wait in case FUSE hasnt picked up new screenshot yet
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    return imageData;
  }

  async generateHistoryItems(llmResult: GenerateTextResult<ToolSet, unknown>, iteration: number): Promise<HistoryItem[]> {
    const timestamp = new Date().toISOString();
    const results = [{
      type: 'message',
      timestamp,
      screenshotNames: [],
      llmMessageContent: [{ type: 'text', text: `${timestamp} - Message: ${llmResult.text}` }],
    }] as HistoryItem[];
    // TODO: I'm lazy
    for (const toolResult of (llmResult.toolResults as any)) {
      results.push({
        type: 'tool_call',
        timestamp,
        screenshotNames: [],
        llmMessageContent: [
          {
            type: 'text' as const,
            text: `${timestamp} - ToolCall: ${toolResult.toolName} called with ${JSON.stringify(toolResult.args)}`
          },
        ]
      });
      if (toolResult.result?.screenshot) {
        const imageData = await this.loadScreenshot(toolResult.result.screenshot);
        if (imageData) {
          results[results.length - 1].llmMessageContent.push({
            type: 'image' as const,
            image: imageData
          });
          // TODO: Awkward
          results[results.length - 1].screenshotNames.push(`${parseInt(toolResult.result.screenshot) - 1}.png`);

          this.mostRecentScreenshot = imageData;
        }
      }
      if (toolResult.result?.endStateMemWatchValues && toolResult.result?.contextMemWatchValues) {
        const oldState = (await this.firbaseService.read({
          collection: FirebaseCollection.SESSIONS,
          subCollection: FirebaseSubCollection.STATE,
          file: FirebaseFile.TEST_STATE,
          testId: this.bootConfig.testConfig.id,
        }))[0];
        await this.firbaseService.write({
          collection: FirebaseCollection.SESSIONS,
          subCollection: FirebaseSubCollection.STATE,
          file: FirebaseFile.TEST_STATE,
          testId: this.bootConfig.testConfig.id,
          payload: [{
            ...oldState,
            [iteration]: {
              contextMemWatchValues: toolResult.result?.contextMemWatchValues,
              endStateMemWatchValues: toolResult.result?.endStateMemWatchValues
            }
          }]
        });
      }
    }

    return results;
  }

  async writeHistoryItemToLogFile(item: HistoryItem) {
    // Write this item to 
  }

  async callLlm(prompt: LlmMessageContentItem[], tools: any): Promise<ReturnType<typeof generateText>> {
    this.logger.log(LogNamespace.DEV, 'Calling LLM...');
    
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

  async getGameState() {
    // TODO
    return {};
  }

  buildTaskPrompt(): string {
    return `
<game_context>${this.agentConfig.gameContext}</game_context>
<task_name>${this.agentConfig.task.name}</task_name>
<task_description>${this.agentConfig.task.description}</task_description>
    `;
  }

  flattenChatHistory(history: Turn[]): LlmMessageContentItem[] {
    const result: LlmMessageContentItem[] = [];
    history.forEach(turn => {
      turn.historyItems.forEach(historyItem => {
        result.push(...historyItem.llmMessageContent);
      })
    });
    return result;
  }

  buildContextualPrompt(history: Turn[]): LlmMessageContentItem[] {
    const taskPrompt = this.buildTaskPrompt();
    const actionHistory = this.flattenChatHistory(history);
    const result: LlmMessageContentItem[] = [
      { type: 'text', text: `Action history:` },
      ...actionHistory,
      { type: 'text', text: taskPrompt },
      { type: 'text', text: "Most recent screenshot:" }
    ];
    if (this.mostRecentScreenshot) {
      result.push({ type: 'image', image: this.mostRecentScreenshot });
    }
    result.push({ type: 'text', text: "Decide what to do to best proceed towards your goal" });

    return result;
  }

  async checkTaskCompletion(responseText: string): Promise<boolean> {
    // TODO
    return false;
  }

  generateBenchmarkResult(history: any[]): BenchmarkResult {
    // TODO
    return { success: true };
  }

  async logTurn(turn: Turn) {
    const EmuLogBlock: EmuLogBlock = {
      title: `Agent Turn ${turn.iteration}`,
      logs: []
    };
    
    let screenshotIndex = 0;
    for (const historyItem of turn.historyItems) {
      for (const llmMessage of historyItem.llmMessageContent) {
        if (llmMessage.image) {
          EmuLogBlock.logs.push({
            text: 'image',
            metadata: {
              [LogMetadata.SCREENSHOT_NAME]: historyItem.screenshotNames[screenshotIndex]
            }
          });
          screenshotIndex++;
        } else {
          EmuLogBlock.logs.push({
            text: llmMessage.text!
          });
        }
      }
    }

    await this.logger.log(LogNamespace.AGENT, EmuLogBlock, true);
  }
  
  async runBenchmark(): Promise<boolean> {
    this.logger.log(LogNamespace.DEV, 'Starting benchmark...');

    let iteration = 1;
    const history: Turn[] = [];
    const tools = getTools(this.emulationService);
    
    this.mostRecentScreenshot = await this.loadScreenshot('0');
    
    while (iteration < this.agentConfig.maxIterations) {
      this.logger.log(LogNamespace.DEV, `Iteration ${iteration}/${this.agentConfig.maxIterations}`);
      
      const gameState = await this.getGameState();
      const prompt = this.buildContextualPrompt(history);

      this.logger.log(LogNamespace.DEV, `------ Iteration ${iteration} ------`);
      const response = await this.callLlm(prompt, tools);

      const turn: Turn = {
        iteration,
        historyItems: [],
      }

      const historyItems = await this.generateHistoryItems(response, iteration);
      turn.historyItems.push(...historyItems);

      this.logger.log(LogNamespace.DEV, `------LLM Response: ${response.text}------`);
      
      // TODO: Record tool calls to history
      // const toolHistoryItem = await this.generateHistoryItem({
      //   type: 'tool_call',
      //   content: response.text,
      //   timestamp: currentTimestamp,
      //   screenshotName
      // });
      // turn.historyItems.push(toolHistoryItem);

      history.push(turn);
      await this.logTurn(turn);
      
      // Check if task completed
      const isComplete = await this.checkTaskCompletion(response.text);
      if (isComplete) break;

      iteration++;
    }
    this.logger.log(LogNamespace.DEV, `Benchmark completed after ${iteration + 1} iterations`);
    
    const result = this.generateBenchmarkResult(history);
    const resultFilePath = path.join(this.testStatePath, 'result.json');
    writeFileSync(resultFilePath, JSON.stringify(result, null, 2));

    return true;
  }
}
