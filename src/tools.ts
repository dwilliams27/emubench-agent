import { EmulationService } from "@/services/emulation.service";
import { ControllerInputSchema } from "@/types/tools";
import { directionToStickPosition } from "@/utils";
import { tool } from "ai";
import { z } from "zod";

type ControllerInput = z.infer<typeof ControllerInputSchema>;

export function getTools(emulationService: EmulationService) {
  return {
    sendControllerInput: tool({
      description: 'Press buttons, move sticks, or press triggers on the gamecube controller',
      inputSchema: ControllerInputSchema,
      execute: async ({ actions, duration }: ControllerInput) => {
        const ipcRequest = {
          connected: true,
          ...((actions.buttons || actions.triggers) ? { buttons: { ...actions.buttons, ...actions.triggers } } : {}),
          ...(
            (actions.mainStick?.x || actions.mainStick?.y) 
            ? { mainStick: directionToStickPosition({ x: actions.mainStick?.x, y: actions.mainStick?.y }) } 
            : {}),
          ...(
            actions.cStick?.direction
            ? { cStick: directionToStickPosition({ direction: actions.cStick?.direction, x: actions.cStick?.x, y: actions.cStick?.y }) }
            : {}),
          frames: duration,
        }
        
        const inputResponse = await emulationService.postControllerInput(ipcRequest);

        return inputResponse;
      }
    }),
    wait: tool({
      description: 'Wait for a specific number of frames',
      inputSchema: z.object({
        frames: z.number().min(1).max(240).describe("The number of frames to wait for"),
      }),
      execute: async ({ frames }: { frames: number }) => {
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
