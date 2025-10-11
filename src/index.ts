import { ApiService } from "@/services/api.service";
import { configDotenv } from "dotenv";
import { freadAgentJobs } from "@/shared/services/resource-locator.service";
import express from 'express';
import { JobService } from "@/services/job.service";
import { EmuAgentJob } from "@/shared/types/agent";

configDotenv();

const apiService = new ApiService("https://api.emubench.com");
const jobService = new JobService();

const app = express();
app.use(express.json());
app.use(express.raw({ type: 'application/protobuf' }));
app.get('/', (req, res) => res.status(200).send('OK'));
app.post('/', async (req, res) => {
  try {
    const eventType = req.headers['ce-type'];
    const documentPath = req.headers['ce-subject'];
    const eventId = req.headers['ce-id'];
    const eventTime = req.headers['ce-time'];
    
    console.log('[Base] Event received:', {
      type: eventType,
      path: documentPath,
      id: eventId,
      time: eventTime
    });
    
    const docId = documentPath?.toString().split('/').pop();
    if (!docId) {
      throw new Error('No document ID found in path');
    }

    const jobResult = await freadAgentJobs([docId]);
    if (!jobResult || !jobResult[0]) {
      throw new Error('No job found for document ID');
    }
    const job = jobResult[0] as EmuAgentJob;
    
    jobService.handleIncomingJob(job, apiService);
  } catch (error) {
    console.error('Error processing event:', error);
  }
  res.status(200).send('OK');
});

app.use((req, res) => {
  res.status(404).json({
    error: 'EMUBENCH_AGENT_404',
    message: 'Endpoint not found in emubench-agent service',
    path: req.path,
    method: req.method
  });
});

app.listen(process.env.PORT || 8080, () => {
  console.log(`🧠 Agent listening on port ${process.env.PORT || 8080}`);
});
