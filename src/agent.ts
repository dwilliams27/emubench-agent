import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';
import { openai } from '@ai-sdk/openai';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { generateText } from 'ai';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import path from 'path';

export interface AgentConfig {
  systemPrompt: string;
  llmProvider: 'openai' | 'anthropic' | 'google';
  model: string;
  maxIterations: number;
  temperature: number;
  mcpServerEndpoint: string;
  // TODO: Rethink structure, base on TestConfig
  testConfig: {
    id: string;
    name: string;
    description: string;
    successCriteria: string[];
    visualCues: string[];
  };
}

// TODO
export interface BenchmarkResult {
  success: boolean;
}

export class EmuAgent {
  private mcpClient: Client;
  private transport: StreamableHTTPClientTransport;

  constructor(
    private config: AgentConfig,
    private mcpEndpoint: string,
    private mcpSessionId: string,
    private testStatePath: string,
  ) {
    if (!this.config.systemPrompt) {
      throw new Error('System prompt is required');
    }
    if (!this.config.llmProvider || !['openai', 'anthropic', 'google'].includes(this.config.llmProvider)) {
      throw new Error('Invalid or missing LLM provider');
    }
    if (!this.config.model) {
      throw new Error('Model is required');
    }
    this.transport = new StreamableHTTPClientTransport(new URL(this.mcpEndpoint), { sessionId: this.mcpSessionId });
    this.mcpClient = new Client({ name: 'emubench-agent', version: '1.0.0' }, { capabilities: {} });
  }

  private async initializeMcpClient() {
    await this.mcpClient.connect(this.transport);
  }

  private getModel(provider: string, model: string) {
    switch (provider) {
      case 'openai': return openai(model);
      case 'anthropic': return anthropic(model);
      case 'google': return google(model);
      default: throw new Error(`Unknown provider: ${provider}`);
    }
  }

  async getLatestScreenshots(count: number = 1): Promise<string[]> {
    const screenshotPath = path.join(this.testStatePath, 'ScreenShots');
    const files = readdirSync(screenshotPath)
      .filter(f => f.endsWith('.png'))
      .map(f => ({
        name: f,
        time: statSync(path.join(screenshotPath, f)).mtime
      }))
      .sort((a, b) => b.time.getTime() - a.time.getTime())
      .slice(0, count);

    return files.map(f => path.join(screenshotPath, f.name));
  }

  async callLLMWithVision(prompt: string, toolCalls?: any[]): Promise<any> {
    const screenshots = await this.getLatestScreenshots();
    
    const images = screenshots.map(path => ({
      type: 'image' as const,
      image: readFileSync(path)
    }));
    
    const model = this.getModel(this.config.llmProvider, this.config.model);
    
    return await generateText({
      model,
      messages: [
        {
          role: 'system',
          content: this.config.systemPrompt
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            ...images
          ]
        }
      ],
      tools: toolCalls ? this.convertMCPToolsToAISDK(toolCalls) : undefined,
      maxTokens: 4000,
      temperature: this.config.temperature
    });
  }

  async getGameState() {
    // TODO
    return {};
  }

  buildContextualPrompt(gameState: any, iteration: number): string {
    // TODO
    return `Iteration ${iteration}:\n` +
           `Game State: ${JSON.stringify(gameState)}\n` +
           `Task: ${this.config.testConfig.name}\n` +
           `Description: ${this.config.testConfig.description}\n` +
           `Visual Cues: ${this.config.testConfig.visualCues.join(', ')}\n` +
           `Success Criteria: ${this.config.testConfig.successCriteria.join(', ')}\n`;
  }

  async checkTaskCompletion(responseText: string): Promise<boolean> {
    // TODO
    return true;
  }

  generateBenchmarkResult(history: any[]): BenchmarkResult {
    // TODO
    return { success: true };
  }
  
  async runBenchmark(): Promise<boolean> {
    await this.initializeMcpClient();

    let iteration = 0;
    const history = [];
    
    while (iteration < this.config.maxIterations) {
      // TODO: Typing?
      const mcpTools = await this.mcpClient.listTools() as unknown as any[];
      const gameState = await this.getGameState();
      const prompt = this.buildContextualPrompt(gameState, iteration);

      const response = await this.callLLMWithVision(prompt, mcpTools);
      
      history.push({
        type: 'assistant_response',
        content: response.text,
        iteration,
        timestamp: Date.now()
      });
      
      // Execute tool calls if any
      if (response.toolCalls && response.toolCalls.length > 0) {
        for (const toolCall of response.toolCalls) {
          const result = await this.mcpClient.callTool({
            name: toolCall.toolName,
            arguments: toolCall.args
          });
          
          history.push({
            type: 'tool_result',
            toolName: toolCall.toolName,
            result,
            timestamp: Date.now()
          });
        }
        
        // Wait a bit for game state to update
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      // Check if task completed
      const isComplete = await this.checkTaskCompletion(response.text);
      if (isComplete) break;
      
      iteration++;
    }
    
    const result = this.generateBenchmarkResult(history);
    const resultFilePath = path.join(this.testStatePath, 'result.json');
    writeFileSync(resultFilePath, JSON.stringify(result, null, 2));

    return true;
  }
  
  convertMCPToolsToAISDK(mcpTools: any[]) {
    return mcpTools.reduce((acc, tool) => {
      acc[tool.name] = {
        description: tool.description,
        parameters: tool.inputSchema
      };
      return acc;
    }, {});
  }
}
