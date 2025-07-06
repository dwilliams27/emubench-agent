import { FirebaseCollection, FirebaseService, FirebaseSubCollection } from '@/services/firebase.service';
import { EmuLogBlock } from '@/types/shared';

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
  private firestoreSubCollection = {
    [LogNamespace.DEV]: FirebaseSubCollection.DEV_LOGS,
    [LogNamespace.AGENT]: FirebaseSubCollection.AGENT_LOGS
  }

  constructor(private testId: string, private firebaseService: FirebaseService) {}

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

    await this.firebaseService.write({
      collection: FirebaseCollection.SESSIONS,
      subCollection: this.firestoreSubCollection[namespace],
      testId: this.testId,
      payload: logsToWrite
    });
  }
}
