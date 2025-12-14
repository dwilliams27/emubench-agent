import { formatError } from "@/shared/utils/error";
import { IpcControllerInputRequest } from "@/types/tools";
import axios, { AxiosInstance } from "axios";

export interface PostControllerInputResponse {
  contextMemWatchValues: Record<string, string>;
  endStateMemWatchValues: Record<string, string>;
  screenshot: string;
};

export class EmulationService {
  private axiosInstance: AxiosInstance;

  constructor(url: string, googleToken: string) {
    this.axiosInstance = axios.create({
      baseURL: url,
      headers: {
        Authorization: `Bearer ${googleToken}`
      }
    });
  }

  async postControllerInput(
    request: IpcControllerInputRequest,
    controllerPort = 0,
  ): Promise<PostControllerInputResponse | null> {
    try {
      console.log(`[Emulation] Sending controller input: ${JSON.stringify(request)}`);
      const response = await this.axiosInstance.post(
        `/api/controller/${controllerPort}`,
        request,
        { 
          headers: {
            'Content-Type': 'application/json'
          } 
        }
      );
      return response.data;
    } catch (error) {
      console.error('[Emulation] Error sending controller input:', formatError(error));
      return null;
    }
  }

  async saveStateSlot(slot: number) {
    try {
      console.log(`[Emulation] Saving state to slot ${slot}`);
      const response = await this.axiosInstance.post(
        `/api/emulation/state`,
        { action: 'save', to: slot },
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    } catch (error) {
      console.error('Error saving state to slot:', formatError(error));
      return null;
    }
  }

  async loadStateSlot(slot: number) {
    try {
      console.log(`[Emulation] Loading state from slot ${slot}`);
      const response = await this.axiosInstance.post(
        `/api/emulation/state`,
        { action: 'load', to: slot },
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    } catch (error) {
      console.error('Error loading state from slot:', formatError(error));
      return null;
    }
  }

  async saveStateFile(file: string) {
    try {
      console.log(`[Emulation] Saving state to file ${file}`);
      const response = await this.axiosInstance.post(
        `/api/emulation/state`,
        { action: 'save', to: file },
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    } catch (error) {
      console.error('Error saving state to file:', formatError(error));
      return null;
    }
  }

  async loadStateFile(file: string) {
    try {
      console.log(`[Emulation] Loading state from file ${file}`);
      const response = await this.axiosInstance.post(
        `/api/emulation/state`,
        { action: 'load', to: file },
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    } catch (error) {
      console.error('Error loading state from file:', formatError(error));
      return null;
    }
  }

  async setEmulationSpeed(speed: number) {
    try {
      console.log(`[Emulation] Setting emulation speed to ${speed}`);
      const response = await this.axiosInstance.post(
        `/api/emulation/config`,
        { speed },
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    } catch (error) {
      console.error('Error setting emulation speed:', formatError(error));
      return null;
    }
  }

  async setEmulationState(action: "play" | "pause") {
    try {
      console.log(`[Emulation] Setting emulation state to ${action}`);
      const response = await this.axiosInstance.post(
        `/api/emulation/state`,
        { action },
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    } catch (error) {
      console.error('Error setting emulation state:', formatError(error));
      return null;
    }
  }
}
