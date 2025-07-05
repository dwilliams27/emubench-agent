import { EmulationService } from '@/services/emulation.service';
import { LoggerService, LogMetadata, LogNamespace } from '@/services/logger.service';
import { getTools } from '@/tools';
import { EmuAgentConfig, BenchmarkResult, EmuBootConfig, EmuTestConfig, EmuHistoryItem, Turn, LlmMessageContentItem, LogBlock } from '@/types';
import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';
import { openai } from '@ai-sdk/openai';
import { generateText, GenerateTextResult, ToolSet } from 'ai';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';

export class EmuAgent {
  private agentConfig: EmuAgentConfig;
  private testConfig: EmuTestConfig;

  private contextMemWatchValues: Record<string, string> = {};
  private endStateMemWatchValues: Record<string, string> = {};

  private mostRecentScreenshot?: NonSharedBuffer;

  constructor(
    private bootConfig: EmuBootConfig,
    private authToken: string,
    private testStatePath: string,
    private emulationService: EmulationService,
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

    const requestInit = {
      headers: {
        "Authorization": `Bearer ${this.authToken}`,
      }
    };
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

  async generateEmuHistoryItems(llmResult: GenerateTextResult<ToolSet, unknown>): Promise<EmuHistoryItem[]> {
    const timestamp = new Date().toISOString();
    const results = [{
      type: 'message',
      timestamp,
      screenshotNames: [],
      llmMessageContent: [{ type: 'text', text: `${timestamp} - Message: ${llmResult.text}` }],
    }] as EmuHistoryItem[];
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
          results[results.length - 1].screenshotNames.push(`${toolResult.result.screenshot}.png`);

          this.mostRecentScreenshot = imageData;
        }
      }
    }

    return results;
  }

  async writeHistoryItemToLogFile(item: EmuHistoryItem) {
    // Write this item to 
  }

  async callLlm(prompt: LlmMessageContentItem[], tools: any): Promise<ReturnType<typeof generateText>> {
    console.log('Calling LLM...');
    
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
          // TODO: Huh?
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
    return [
      { type: 'text', text: `Action history:` },
      ...actionHistory,
      { type: 'text', text: taskPrompt },
      { type: 'text', text: "Most recent screenshot:" },
      { type: 'image', image: this.mostRecentScreenshot },
      { type: 'text', text: "Decide what to do to best proceed towards your goal" },
    ];
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
    const logBlock: LogBlock = {
      title: `Agent Turn ${turn.iteration}`,
      logs: []
    };
    
    let screenshotIndex = 0;
    for (const historyItem of turn.historyItems) {
      for (const llmMessage of historyItem.llmMessageContent) {
        if (llmMessage.image) {
          logBlock.logs.push({
            text: 'image',
            metadata: {
              [LogMetadata.SCREENSHOT_NAME]: historyItem.screenshotNames[screenshotIndex]
            }
          });
          screenshotIndex++;
        } else {
          logBlock.logs.push({
            text: llmMessage.text!,
            metadata: {}
          });
        }
      }
    }

    await this.logger.log(LogNamespace.AGENT, logBlock, true);
  }
  
  async runBenchmark(): Promise<boolean> {
    console.log('Starting benchmark...');

    let iteration = 0;
    const history: Turn[] = [];
    const tools = getTools(this.emulationService);
    
    this.mostRecentScreenshot = await this.loadScreenshot('0');
    
    while (iteration < this.agentConfig.maxIterations) {
      console.log(`Iteration ${iteration + 1}/${this.agentConfig.maxIterations}`);
      
      const gameState = await this.getGameState();
      const prompt = this.buildContextualPrompt(history);

      console.log(`------ Iteration ${iteration + 1} ------`);
      const response = await this.callLlm(prompt, tools);

      const turn: Turn = {
        iteration,
        historyItems: [],
      }

      const historyItems = await this.generateEmuHistoryItems(response);
      turn.historyItems.push(...historyItems);

      console.log(`------LLM Response: ${response.text}------`);
      
      // TODO: Record tool calls to history
      // const toolHistoryItem = await this.generateEmuHistoryItem({
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
    console.log('Benchmark completed after', iteration + 1, 'iterations');
    console.log(
      'Final chat history:\n',
      JSON.stringify(
        this.buildContextualPrompt(history).filter((item) => !item.image)
      )
    );

    await this.endTest();
    
    const result = this.generateBenchmarkResult(history);
    const resultFilePath = path.join(this.testStatePath, 'result.json');
    writeFileSync(resultFilePath, JSON.stringify(result, null, 2));

    return true;
  }

  async endTest() {
    console.log('Ending test...');
    // TODO: Kill game container
    console.log('Session termintated');
  }
}
