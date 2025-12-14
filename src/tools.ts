import { EmulationService } from "@/services/emulation.service";
import { EmuBootConfig } from "@/shared/types";
import { SingleControllerInputSchema, MultipleControllerInputSchema, IpcControllerInputRequest, MultipleControllerInput, SingleControllerInput } from "@/types/tools";
import { tool } from "ai";
import { z } from "zod";

const SingleInputDescription = `Submit controller input for a specific number of frames (between 2-120).`;
const MultipleInputDescription = `Submit one or more controller inputs in sequence, each for a specific number of frames (between 2-120).`;

export function getTools(bootConfig: EmuBootConfig, emulationService: EmulationService) {
  return {
    sendControllerInput: tool({
      description: bootConfig.agentConfig.multiInput ? MultipleInputDescription : SingleInputDescription,
      inputSchema: bootConfig.agentConfig.multiInput ? MultipleControllerInputSchema : SingleControllerInputSchema,
      execute: async (options: SingleControllerInput | MultipleControllerInput) => {
        const payload: IpcControllerInputRequest = { inputs: [] };
        if (bootConfig.agentConfig.multiInput) {
          payload.inputs = (options as MultipleControllerInput).inputs;
        } else {
          payload.inputs = [(options as SingleControllerInput)];
        }
        
        const inputResponse = await emulationService.postControllerInput(payload);

        return inputResponse;
      }
    }),
    ...(bootConfig.agentConfig.longTermMemory && {
      recordMemory: tool({
        description: 'Record a long term memory.',
        inputSchema: z.object({
          text: z.string(),
        }),
        execute: async ({ text }: { text: string }) => {
          return { recordMemory: text }
        }
      })
    })
  };
}
