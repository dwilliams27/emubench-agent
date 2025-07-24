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

interface Buttons {
  a: boolean;
  b: boolean;
  x: boolean;
  y: boolean;
  z: boolean;
  start: boolean;
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  l: boolean;
  r: boolean;
}

interface StickPosition {
  x: number; // 0-255, center at 128
  y: number; // 0-255, center at 128
}

export interface IpcControllerInputRequest {
  connected: boolean;
  buttons?: Partial<Buttons>;
  mainStick?: StickPosition;
  cStick?: StickPosition;
  frames: number;
}

export const ControllerInputSchema = z.object({
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
});
