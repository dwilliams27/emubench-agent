import { EmuAgentConfig, BenchmarkResult, EmuBootConfig, EmuTestConfig, ChatHistoryItem } from '@/types';
import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';
import { openai } from '@ai-sdk/openai';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { generateText, tool } from 'ai';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import path from 'path';
import z from 'zod';

export class EmuAgent {
  private mcpClient: Client;
  private transport: StreamableHTTPClientTransport;
  private agentConfig: EmuAgentConfig;
  private testConfig: EmuTestConfig;

  constructor(
    private bootConfig: EmuBootConfig,
    private authToken: string,
    private mcpSessionId: string,
    private testStatePath: string,
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
        "emu-session-id": this.mcpSessionId,
      }
    };
    this.transport = new StreamableHTTPClientTransport(new URL(this.agentConfig.mcpServerEndpoint), { requestInit });
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

  async getLatestScreenshots(count: number = 10): Promise<string[]> {
    const screenshotPath = path.join(this.testStatePath, 'ScreenShots');
    const files = readdirSync(screenshotPath)
      .filter(f => f.endsWith('.png'))
      .sort((a, b) => b.localeCompare(a))
      .slice(0, count);

    return files.map(f => path.join(screenshotPath, f));
  }

  async callLLMWithVision(prompt: string, mcpTools?: any[]): Promise<ReturnType<typeof generateText>> {
    console.log('Calling LLM with vision...');
    const screenshots = await this.getLatestScreenshots();
    console.log(`Screenshots for context: ${screenshots.join(', ')}`);

    const images = screenshots.map(path => ({
      type: 'image' as const,
      image: readFileSync(path)
    }));
    
    const model = this.getModel(this.agentConfig.llmProvider, this.agentConfig.model);
    const tools = mcpTools ? this.convertMCPToolsToAISDKTools(mcpTools) : undefined;
    
    return await generateText({
      model,
      messages: [
        {
          role: 'system',
          content: this.agentConfig.systemPrompt
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'text', text: "Current screenshot of game:" },
            ...images
          ]
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
Task: ${this.agentConfig.task.name}
Description: ${this.agentConfig.task.description}
    `;
  }

  chatHistoryToString(history: ChatHistoryItem[]): string {
    return history.map(item => {
      return `${item.timestamp} - ${item.type}: ${item.content}`;
    }).join('\n');
  }

  buildContextualPrompt(history: ChatHistoryItem[]): string {
    const taskPrompt = this.buildTaskPrompt();
    const actionHistory = this.chatHistoryToString(history);
    return `
${taskPrompt}
Action history:
${actionHistory}
`
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
      case 'sendControllerInput': {
        return 0;
      }
      case 'wait': {
        return 1;
      }
      default: {
        return 99;
      }
    }
  }
  
  async runBenchmark(): Promise<boolean> {
    console.log('Starting benchmark...');
    await this.initializeMcpClient();
    console.log('MCP client initialized');

    let iteration = 0;
    const history: ChatHistoryItem[] = [];
    const mcpTools = (await this.mcpClient.listTools())?.tools;
    console.log(`Found ${mcpTools.length} tools`);
    
    while (iteration < this.agentConfig.maxIterations) {
      console.log(`Iteration ${iteration + 1}/${this.agentConfig.maxIterations}`);
      
      const gameState = await this.getGameState();
      const prompt = this.buildContextualPrompt(history);

      console.log(`------ Iteration ${iteration + 1} ------`);
      const response = await this.callLLMWithVision(prompt, mcpTools);
      const currentTimestamp = new Date().toISOString();
      
      history.push({ type: 'message', content: response.text, timestamp: currentTimestamp });
      console.log(`------LLM Response: ${response.text}------`);
      
      // Execute tool calls if any
      if (response.toolCalls && response.toolCalls.length > 0) {
        console.log(`Executing ${response.toolCalls.length} tool calls...`);
        const sortedToolCalls = response.toolCalls.sort((a, b) => {
          return this.getToolRankByName(a.toolName) - this.getToolRankByName(b.toolName);
        });
        for (const toolCall of sortedToolCalls) {
          console.log(`Executing tool: ${toolCall.toolName} with args: ${JSON.stringify(toolCall.args)}`);
          const result = await this.mcpClient.callTool({
            name: toolCall.toolName,
            arguments: toolCall.args
          });
          
          history.push({
            type: 'tool_call',
            content: `Tool name: ${toolCall.toolName}; Arguments: ${JSON.stringify(toolCall.args)}`,
            timestamp: currentTimestamp
          });
        }
      }
      
      // Check if task completed
      const isComplete = await this.checkTaskCompletion(response.text);
      if (isComplete) break;
      
      iteration++;
    }
    console.log('Benchmark completed after', iteration + 1, 'iterations');
    console.log('Final chat history:\n', this.chatHistoryToString(history));

    await this.endTest();
    
    const result = this.generateBenchmarkResult(history);
    const resultFilePath = path.join(this.testStatePath, 'result.json');
    writeFileSync(resultFilePath, JSON.stringify(result, null, 2));

    return true;
  }

  async endTest() {
    console.log('Ending test...');
    await this.transport.terminateSession();
    console.log('Session termintated');
  }
  
  convertMCPToolsToAISDKTools(mcpTools: any[]) {
    const toolsObject: Record<string, any> = {};
    
    mcpTools.forEach(mcpTool => {
      toolsObject[mcpTool.name] = tool({
        description: mcpTool.description,
        parameters: this.jsonSchemaToZodSchema(mcpTool.inputSchema),
        execute: async (args: any) => {
          return { toolName: mcpTool.name, args };
        }
      });
    });
    
    return toolsObject;
  }

  private jsonSchemaToZodSchema(schema: any): z.ZodType {
    if (schema.type === 'object') {
      const shape: Record<string, z.ZodType> = {};
      
      if (schema.properties) {
        Object.entries(schema.properties).forEach(([key, prop]: [string, any]) => {
          let zodType = this.jsonSchemaToZodSchema(prop);
          
          // Make field optional if not in required array
          if (!schema.required?.includes(key)) {
            zodType = zodType.optional();
          }
          
          shape[key] = zodType;
        });
      }
      
      return z.object(shape);
    }
    
    switch (schema.type) {
      case 'string':
        let stringSchema = z.string();
        if (schema.enum) {
          return z.enum(schema.enum);
        }
        return stringSchema;
      case 'number':
        return z.number();
      case 'integer':
        return z.number().int();
      case 'boolean':
        return z.boolean();
      case 'array':
        return z.array(this.jsonSchemaToZodSchema(schema.items || {}));
      default:
        return z.any();
    }
  }
}
