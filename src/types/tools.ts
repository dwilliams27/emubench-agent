// TODO: Share better
import z from "zod";

// TODO
export interface BenchmarkResult {
  success: boolean;
}

export const ToolNames = {
  sendControllerInput: 'sendControllerInput',
  wait: 'wait'
}

export interface SendControllerInputResponse {
  contextMemWatchValues: Record<string, string>;
  endStateMemWatchValues: Record<string, string>;
  screenshot: string;
}

export interface IpcControllerInputRequest {
  inputs: SingleControllerInput[];
}

export const SingleControllerInputSchema = z.object({
  buttons: z.object({
    a: z.boolean().optional().describe("Press the A button"),
    b: z.boolean().optional().describe("Press the B button"),
    x: z.boolean().optional().describe("Press the X button"),
    y: z.boolean().optional().describe("Press the Y button"),
    z: z.boolean().optional().describe("Press the Z button"),
    start: z.boolean().optional().describe("Press the Start button"),
    up: z.boolean().optional().describe("Press the D-Pad Up button"),
    down: z.boolean().optional().describe("Press the D-Pad Down button"),
    left: z.boolean().optional().describe("Press the D-Pad Left button"),
    right: z.boolean().optional().describe("Press the D-Pad Right button"),
  }).optional().describe("Specify button states."),

  mainStick: z.object({
    x: z.number().min(0).max(255).optional().describe("The X position of the main analog stick (0-255. 0 is LEFT, 128 is CENTER, and 255 is RIGHT)."),
    y: z.number().min(0).max(255).optional().describe("The Y position of the main analog stick (0-255, 0 is DOWN, 128 is CENTER, and 255 is UP)."),
  }).optional().describe("Specify main analog stick position. You must specify x and y for a specific position."),

  cStick: z.object({
    x: z.number().min(0).max(255).optional().describe("The X position of the c stick (0-255. 0 is LEFT, 128 is CENTER, and 255 is RIGHT)."),
    y: z.number().min(0).max(255).optional().describe("The Y position of the c stick (0-255, 0 is DOWN, 128 is CENTER, and 255 is UP)."),
    direction: z.enum(["up", "right", "down", "left"]).optional().describe("The direction to move the stick in (up, right, down, left)."),
  }).optional().describe("Specify C-stick position. You must specify x and y for a specific position."),

  triggers: z.object({
      l: z.boolean().optional().describe("Press/release the Left Trigger"),
      r: z.boolean().optional().describe("Press/release the Right Trigger"),
  }).optional().describe("Specify trigger states."),
  frames: z.number().min(2).max(120).describe("How how many frames (MUST be between 2-120 frames) the input should last."),
});

export const MultipleControllerInputSchema = z.object({
  inputs: z.array(SingleControllerInputSchema).min(1).describe("An array of controller inputs to execute in sequence."),
});

export type SingleControllerInput = z.infer<typeof SingleControllerInputSchema>;
export type MultipleControllerInput = z.infer<typeof MultipleControllerInputSchema>;
