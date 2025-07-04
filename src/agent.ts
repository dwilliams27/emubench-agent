import { EmulationService } from '@/services/emulation.service';
import { getTools } from '@/tools';
import { EmuAgentConfig, BenchmarkResult, EmuBootConfig, EmuTestConfig, EmuHistoryItem, ToolNames, SendControllerInputResponse, Turn, LlmMessageContentItem } from '@/types';
import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';
import { openai } from '@ai-sdk/openai';
import { generateText, GenerateTextResult, tool, ToolSet } from 'ai';
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
    private emulationService: EmulationService
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

  async generateEmuHistoryItem(llmResult: GenerateTextResult<ToolSet, unknown>) {
    const result = {
      type: 'message',
      content: llmResult.text,
      timestamp: new Date().toISOString(),
    } as EmuHistoryItem;
    const items: LlmMessageContentItem[] = [
      { type: 'text', text: `${result.timestamp} - ${result.type}: ${result.content}` },
    ];
    // TODO: I'm lazy
    for (const toolResult of (llmResult.toolResults as any)) {
      if (toolResult.result?.screenshot) {
        const imageData = await this.loadScreenshot(toolResult.result.screenshot);
        if (imageData) {
          items.push(...[
            {
              type: 'text' as const,
              text: `Tool call: ${toolResult.toolName} called with params ${JSON.stringify(toolResult.args)}`
            },
            {
              type: 'image' as const,
              image: imageData
            }
          ]);

          this.mostRecentScreenshot = imageData;
        }
      }
    }
    result.llmMessageContent = items;

    return result;
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

  getToolRankByName(name: string) {
    switch (name) {
      case ToolNames.sendControllerInput: {
        return 0;
      }
      case ToolNames.wait: {
        return 1;
      }
      default: {
        return 99;
      }
    }
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

      const historyItem = await this.generateEmuHistoryItem(response);
      turn.historyItems.push(historyItem);

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
