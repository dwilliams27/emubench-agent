import { FirebaseCollection, FirebaseService, FirebaseSubCollection } from '@/services/firebase.service';
import { EmuLogBlock, EmuLogNamespace } from '@/types/shared';

export class LoggerService {
  private logBuffer: Record<string, any[]> = {
    [EmuLogNamespace.DEV]: [],
    [EmuLogNamespace.AGENT]: []
  };
  private firestoreSubCollection = {
    [EmuLogNamespace.DEV]: FirebaseSubCollection.DEV_LOGS,
    [EmuLogNamespace.AGENT]: FirebaseSubCollection.AGENT_LOGS
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
