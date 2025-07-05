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
      return response.data;
    } catch (error) {
      const axiosError = error as any;
      console.error(`[Api] Error ending test: ${axiosError.message} ${axiosError.response?.data}`);
      return null;
    }
  }

}
