import { promises } from 'fs';
import path from 'path';

export const LogNamespace = {
  DEV: 'DEV',
  AGENT: 'AGENT'
};

export const LogMetadata = {
  SCREENSHOT_NAME: 'SCREENSHOT_NAME'
};

export class LoggerService {
  private logBuffer: Record<string, any[]> = {
    [LogNamespace.DEV]: [],
    [LogNamespace.AGENT]: []
  };
  private logFiles = {
    [LogNamespace.DEV]: 'dev_logs.txt',
    [LogNamespace.AGENT]: 'agent_logs.txt'
  }

  constructor(private bucketPath: string) {}

  async log(namespace: string, logEntry: any, immediateFlush = false) {
    if (!(namespace in this.logBuffer)) {
      throw new Error('Namespace does not exist');
    }
    this.logBuffer[namespace].push(logEntry);
    if (immediateFlush) {
      await this.flush(namespace);
    }
    console.log(`[${namespace}] ${JSON.stringify(logEntry)}`)
  }

  private async flush(namespace: string) {
    if (this.logBuffer[namespace].length === 0) return;

    const logsToWrite = this.logBuffer[namespace].splice(0);
    const content = logsToWrite.map(log => JSON.stringify(log)).join('$$ENDLOG$$') + '$$ENDLOG$$';
    
    await promises.appendFile(path.join(this.bucketPath, this.logFiles[namespace]), content);
  }
}
