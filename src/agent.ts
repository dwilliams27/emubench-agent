import { EmuAgentConfig, BenchmarkResult, EmuBootConfig, EmuTestConfig } from '@/types';
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

  async callLLMWithVision(prompt: string, mcpTools?: any[]): Promise<any> {
    console.log('Calling LLM with vision...');
    const screenshots = await this.getLatestScreenshots();
    
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

  buildContextualPrompt(): string {
    // TODO
    return `Task: ${this.agentConfig.task.name}
Description: ${this.agentConfig.task.description}
    `;
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
    console.log('Starting benchmark...');
    await this.initializeMcpClient();
    console.log('MCP client initialized');

    let iteration = 0;
    const history = [];
    
    while (iteration < this.agentConfig.maxIterations) {
      console.log(`Iteration ${iteration + 1}/${this.agentConfig.maxIterations}`);
      // TODO: Typing?
      const mcpTools = (await this.mcpClient.listTools())?.tools;
      console.log(`Found ${mcpTools.length} tools`);
      const gameState = await this.getGameState();
      const prompt = this.buildContextualPrompt();

      console.log(`Prompt for iteration ${iteration + 1}:`, prompt);
      const response = await this.callLLMWithVision(prompt, mcpTools);
      
      history.push({
        type: 'assistant_response',
        content: response.text,
        iteration,
        timestamp: Date.now()
      });
      
      // Execute tool calls if any
      if (response.toolCalls && response.toolCalls.length > 0) {
        console.log(`Executing ${response.toolCalls.length} tool calls...`);
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
        
        // TODO: Needed?
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      // Check if task completed
      const isComplete = await this.checkTaskCompletion(response.text);
      if (isComplete) break;
      
      iteration++;
    }
    console.log('Benchmark completed after', iteration + 1, 'iterations');
    
    const result = this.generateBenchmarkResult(history);
    const resultFilePath = path.join(this.testStatePath, 'result.json');
    writeFileSync(resultFilePath, JSON.stringify(result, null, 2));

    return true;
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
