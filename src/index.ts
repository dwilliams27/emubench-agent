import { EmuAgent } from "@/agent";
import { configDotenv } from "dotenv";

configDotenv();

const mcpEndpoint = process.env.MCP_SERVER_ENDPOINT;
const mcpSessionId = process.env.MCP_SESSION_ID;
// TODO: Entire config as env?
const testId = 'tst-faketesting';
if (!mcpEndpoint || !mcpSessionId) {
  throw new Error('MCP_SERVER_ENDPOINT or MCP_SESSION_ID environment variable is not set');
}
const agent = new EmuAgent(
  {
    systemPrompt: 'You are an intelligent agent that is adept at playing video games.',
    llmProvider: 'openai',
    model: 'gpt-4o',
    maxIterations: 5,
    temperature: 0.7,
    mcpServerEndpoint: mcpEndpoint,
    testConfig: {
      id: testId,
      name: 'Example Task',
      description: 'This is an example task description.',
      successCriteria: [],
      visualCues: [],
    },
  },
  mcpEndpoint,
  mcpSessionId,
  `/tmp/gcs/emubench-sessions/${testId}`
);
