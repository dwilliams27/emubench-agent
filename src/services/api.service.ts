import { formatError } from "@/shared/utils/error";
import axios, { AxiosInstance } from "axios";

export class ApiService {
  private axiosInstance: AxiosInstance;
  private screenshotCache: Record<string, string> = {};

  constructor(url: string) {
    this.axiosInstance = axios.create({
      baseURL: url,
    });
  }

  async endTest(testId: string, authToken: string) {
    try {
      console.log(`[Api] Ending test`);
      const response = await this.axiosInstance.post(
        `/test-orx/end`,
        { testId },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`
          }
        }
      );
      console.log(`[Api] Test successfuly ended`);
      return response.data;
    } catch (error) {
      const axiosError = error as any;
      console.error(`[Api] Error ending test: ${formatError(axiosError)}`);
      return null;
    }
  }

  async attemptTokenExchange(testId: string, authToken: string, exchangeToken: string | undefined) {
    try {
      console.log(`[Api] Attempting token exchange`);
      const response = await this.axiosInstance.post(
        `/test-orx/tests/${testId}/token-exchange`,
        { exchangeToken },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`
          } 
        }
      );
      if (response.data.token) {
        return response.data.token;
      }
      return null;
    } catch (error) {
      const axiosError = error as any;
      console.error(`[Api] Error with token exchange: ${formatError(axiosError)}`);
      return null;
    }
  }

  async fetchScreenshots(testId: string, authToken: string): Promise<Record<string, string> | null> {
    try {
      console.log(`[Api] Fetching screenshots`);
      const response = await this.axiosInstance.get(
        `/test-orx/tests/${testId}/screenshots`,
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`
          } 
        }
      );
      if (response.data.screenshots) {
        // Fetch each screenshot from the URLs provided
        console.log(`[Api] Fetched ${Object.keys(response.data.screenshots).length} screenshots`);
        for (const key of Object.keys(response.data.screenshots)) {
          const screenshotUrl = response.data.screenshots[key];
          if (this.screenshotCache[screenshotUrl]) {
            response.data.screenshots[key] = this.screenshotCache[screenshotUrl];
            continue;
          }
          try {
            const screenshotResponse = await this.axiosInstance.get(screenshotUrl, {
              responseType: 'arraybuffer',
              headers: {
                'Content-Type': 'application/octet-stream',
              }
            });
            const base64Screenshot = `data:image/png;base64,${Buffer.from(screenshotResponse.data, 'binary').toString('base64')}`;
            this.screenshotCache[screenshotUrl] = base64Screenshot;
            response.data.screenshots[key] = base64Screenshot;
          } catch (screenshotError) {
            console.error(`[Api] Error fetching screenshot ${key}: ${formatError(screenshotError)}`);
            response.data.screenshots[key] = null;
          }
        }
        console.log(`[Api] Successfully fetched screenshots`);
        return response.data.screenshots;
      }
      console.error(`[Api] No screenshots found in response`);
      return null;
    } catch (error) {
      const axiosError = error as any;
      console.error(`[Api] Error with token exchange: ${formatError(axiosError)}`);
      return null;
    }
  }
}
