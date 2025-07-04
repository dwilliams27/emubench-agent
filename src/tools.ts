import { EmulationService } from "@/services/emulation.service";
import { directionToStickPosition } from "@/utils";
import { tool } from "ai";
import { z } from "zod";

export function getTools(emulationService: EmulationService) {
  return {
    sendControllerInput: tool({
      description: 'Press buttons, move sticks, or press triggers on the gamecube controller',
      parameters: z.object({
        actions: z.object({
          buttons: z.object({
            a: z.boolean().optional().describe("Press/release the A button"),
            b: z.boolean().optional().describe("Press/release the B button"),
            x: z.boolean().optional().describe("Press/release the X button"),
            y: z.boolean().optional().describe("Press/release the Y button"),
            z: z.boolean().optional().describe("Press/release the Z button"),
            start: z.boolean().optional().describe("Press/release the Start button"),
            up: z.boolean().optional().describe("Press/release the D-Pad Up button"),
            down: z.boolean().optional().describe("Press/release the D-Pad Down button"),
            left: z.boolean().optional().describe("Press/release the D-Pad Left button"),
            right: z.boolean().optional().describe("Press/release the D-Pad Right button"),
          }).optional().describe("Specify button states (true=pressed, false=released). Omit buttons to leave them unchanged."),

          mainStick: z.object({
            direction: z.enum(["up", "right", "down", "left"]).optional().describe("The direction to move the stick in (up, right, down, left)."),
          }).optional().describe("Specify main analog stick position. Omit to leave unchanged."),

          cStick: z.object({
            direction: z.enum(["up", "right", "down", "left"]).optional().describe("The direction to move the stick in (up, right, down, left)."),
          }).optional().describe("Specify C-stick position. Omit to leave unchanged."),

          triggers: z.object({
             l: z.boolean().optional().describe("Press/release the Left Trigger"),
             r: z.boolean().optional().describe("Press/release the Right Trigger"),
          }).optional().describe("Specify analog trigger pressure. Omit to leave unchanged."),
        }).describe("Define the controller actions to perform. Only include the controls you want to change."),
        duration: z.enum(["5", "15", "30", "60"]).describe("How how many frames to press the buttons."),
      }),
      execute: async ({ actions, duration }) => {
        const ipcRequest = {
          connected: true,
          ...((actions.buttons || actions.triggers) ? { buttons: { ...actions.buttons, ...actions.triggers } } : {}),
          ...(actions.mainStick?.direction ? { mainStick: directionToStickPosition(actions.mainStick?.direction) } : {}),
          ...(actions.cStick?.direction ? { cStick: directionToStickPosition(actions.cStick?.direction) } : {}),
          frames: parseInt(duration),
        }
        
        const inputResponse = await emulationService.postControllerInput(ipcRequest);
        // TODO: Handle memwatch response
        // inputResponse.endStateMemWatchValues;
        // inputResponse.contextMemWatchValues;

        return inputResponse;
      }
    }),
    wait: tool({
      description: 'Wait for a specific number of frames',
      parameters: z.object({
        frames: z.number().min(1).describe("The number of frames to wait for"),
      }),
      execute: async ({ frames }) => {
        const ipcRequest = {
          connected: true,
          frames,
        }
        
        const inputResponse = await emulationService.postControllerInput(ipcRequest);
        // TODO: Handle memwatch response
        // inputResponse.endStateMemWatchValues;
        // inputResponse.contextMemWatchValues;

        return inputResponse;
      }
    })
  };
}
