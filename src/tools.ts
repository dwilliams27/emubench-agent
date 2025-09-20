import { EmulationService } from "@/services/emulation.service";
import { ControllerInputSchema } from "@/types/tools";
import { directionToStickPosition } from "@/utils";
import { tool } from "ai";
import { z } from "zod";

export function getTools(emulationService: EmulationService) {
  return {
    sendControllerInput: tool({
      description: 'Press buttons, move sticks, or press triggers on the gamecube controller',
      parameters: ControllerInputSchema,
      execute: async ({ actions, duration }) => {
        const ipcRequest = {
          connected: true,
          ...((actions.buttons || actions.triggers) ? { buttons: { ...actions.buttons, ...actions.triggers } } : {}),
          ...(actions.mainStick?.direction ? { mainStick: directionToStickPosition(actions.mainStick?.direction) } : {}),
          ...(actions.cStick?.direction ? { cStick: directionToStickPosition(actions.cStick?.direction) } : {}),
          frames: duration,
        }
        
        const inputResponse = await emulationService.postControllerInput(ipcRequest);

        return inputResponse;
      }
    }),
    wait: tool({
      description: 'Wait for a specific number of frames',
      parameters: z.object({
        frames: z.number().min(1).max(240).describe("The number of frames to wait for"),
      }),
      execute: async ({ frames }) => {
        const ipcRequest = {
          connected: true,
          frames,
        }
        
        const inputResponse = await emulationService.postControllerInput(ipcRequest);

        return inputResponse;
      }
    })
  };
}
