import { EmuAgent } from "@/agent";
import { BootConfig } from "@/types";
import { configDotenv } from "dotenv";
import { readFileSync } from 'fs';
import path from "path";

configDotenv();

const authToken = process.env.AUTH_TOKEN;
const mcpSessionId = process.env.MCP_SESSION_ID;
const testPath = process.env.TEST_PATH;

if (!authToken || !mcpSessionId || !testPath) {
  throw new Error('Missing required environment variables');
}

const configContent = readFileSync(path.join(testPath, 'test_config.json'), 'utf-8');
const bootConfig = JSON.parse(configContent) as BootConfig;

const agent = new EmuAgent(
  bootConfig,
  authToken,
  mcpSessionId,
  testPath
);

await agent.runBenchmark();
