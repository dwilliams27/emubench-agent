import { freadDevLogs, fwriteDevLogs, freadAgentLogs, fwriteAgentLogs } from '@/shared/services/resource-locator.service';
import { EmuLogBlock, EmuLogNamespace } from '@/shared/types';

export class LoggerService {
  private logBuffer: Record<string, any[]> = {
    [EmuLogNamespace.DEV]: [],
    [EmuLogNamespace.AGENT]: []
  };
  private firestoreCollectionMap = {
    [EmuLogNamespace.DEV]: { read: freadDevLogs, write: fwriteDevLogs },
    [EmuLogNamespace.AGENT]: { read: freadAgentLogs, write: fwriteAgentLogs }
  }

  constructor(private testId: string) {}

  async log(namespace: string, logEntry: any, immediateFlush = false) {
    if (!(namespace in this.logBuffer)) {
      throw new Error('Namespace does not exist');
    }
    let entry: EmuLogBlock = typeof logEntry === "string" ? { title: 'log', logs: [{ text: logEntry }] } : logEntry;
    this.logBuffer[namespace].push(entry);
    if (immediateFlush) {
      await this.flush(namespace);
    }
    console.log(`[${namespace}] ${JSON.stringify(logEntry)}`)
  }

  private async flush(namespace: string) {
    if (this.logBuffer[namespace].length === 0) return;

    const logsToWrite = this.logBuffer[namespace].splice(0);
    switch (namespace) {
      case EmuLogNamespace.DEV: {
        await this.firestoreCollectionMap[namespace].write(this.testId, logsToWrite);
      }
      case EmuLogNamespace.AGENT:
        break;
      default:
        throw new Error('Invalid namespace for logs');
    }
    
  }
}
