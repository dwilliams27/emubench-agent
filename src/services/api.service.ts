import axios, { AxiosInstance } from "axios";

export class ApiService {
  private axiosInstance: AxiosInstance;

  constructor(url: string, authToken: string) {
    this.axiosInstance = axios.create({
      baseURL: url,
      headers: {
        Authorization: `Bearer ${authToken}`
      }
    });
  }

  async endTest(testId: string) {
    try {
      console.log(`[Api] Ending test`);
      const response = await this.axiosInstance.post(
        `/test-orx/end`,
        { testId },
        {
          headers: {
            'Content-Type': 'application/json'
          } 
        }
      );
      console.log(`[Api] Test successfuly ended`);
      return response.data;
    } catch (error) {
      const axiosError = error as any;
      console.error(`[Api] Error ending test: ${axiosError.message} ${axiosError.response?.data}`);
      return null;
    }
  }

  async attemptTokenExchange(testId: string, exchangeToken: string | undefined) {
    try {
      console.log(`[Api] Attempting token exchange`);
      const response = await this.axiosInstance.post(
        `/test-orx/tests/${testId}/token-exchange`,
        { exchangeToken },
        {
          headers: {
            'Content-Type': 'application/json'
          } 
        }
      );
      if (response.data.googleToken) {
        return response.data;
      }
      return null;
    } catch (error) {
      const axiosError = error as any;
      console.error(`[Api] Error with token exchange: ${axiosError.message} ${axiosError.response?.data}`);
      return null;
    }
  }
}
